// Wait for the DOM to be fully loaded before running scripts
document.addEventListener('DOMContentLoaded', () => {

    // Get references to DOM elements
    const courseForm = document.getElementById('courseForm');
    const progressContainer = document.querySelector('.progress-container');
    const progressBar = progressContainer?.querySelector('.progress-bar');
    const progressText = progressContainer?.querySelector('.progress-text');
    const progressLog = document.getElementById('progressLog'); // Get the new log element
    const resultsArea = document.getElementById('resultsArea');
    const alertArea = document.getElementById('alertArea');
    const yearInput = document.getElementById('year');
    const quarterSelect = document.getElementById('quarter'); // Get quarter select element
    const allCoursesPane = document.getElementById('all-courses');
    const availableCoursesPane = document.getElementById('available-courses');
    const unavailableCoursesPane = document.getElementById('unavailable-courses');
    const filterTabs = document.getElementById('filterTabs');
    const expandAllBtn = document.getElementById('expandAllBtn');
    const collapseAllBtn = document.getElementById('collapseAllBtn');

    let eventSource = null; // Variable to hold the EventSource connection
    let currentAbortController = null; // Track current fetch abort controller
    let currentReader = null; // Track the current stream reader
    let currentYear = ''; // Store year for link generation
    let currentQuarter = ''; // Store quarter for link generation

    // --- Input Validation and Initialization ---
    if (yearInput) {
        yearInput.value = new Date().getFullYear();
    } else {
        console.error("Year input element not found.");
    }

    // --- Utility Functions ---

    function showAlert(message, type = 'danger') {
        if (!alertArea) { console.error("Alert area element not found."); return; }
        alertArea.innerHTML = `
            <div class="alert alert-${type} alert-dismissible fade show" role="alert">
                ${message}
                <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
            </div>
        `;
    }

    function clearAlert() {
        if (alertArea) alertArea.innerHTML = '';
    }

    function getStatusBadgeClass(status) {
        const lowerStatus = status ? status.toLowerCase() : 'unknown';
        if (lowerStatus === 'open') return 'status-open';
        if (lowerStatus === 'waitl') return 'status-waitl';
        if (lowerStatus === 'full') return 'status-full';
        if (lowerStatus === 'newonly') return 'status-newonly';
        return 'status-unknown';
    }

    /**
     * Cancels any ongoing fetch request and stream reading.
     */
    function cancelOngoingSearch() {
        // Cancel the fetch request if one is in progress
        if (currentAbortController) {
            console.log("Aborting previous fetch request");
            currentAbortController.abort();
            currentAbortController = null;
        }
        
        // Cancel the stream reader if active
        if (currentReader) {
            console.log("Cancelling previous stream reader");
            currentReader.cancel("New search started").catch(err => 
                console.warn("Error cancelling reader:", err)
            );
            currentReader = null;
        }
        
        // Legacy: close EventSource connection if any
        if (eventSource) {
            eventSource.close();
            console.log("Previous EventSource closed.");
            eventSource = null;
        }
    }

    /**
     * Formats the selected quarter name for the AntAlmanac URL.
     * @param {string} quarterValue - The value from the quarter select dropdown.
     * @returns {string} The formatted quarter name for the URL (e.g., "Spring", "Summer%20Session%201").
     */
    function formatQuarterForAntAlmanac(quarterValue) {
        switch (quarterValue) {
            case "Fall": return "Fall";
            case "Winter": return "Winter";
            case "Spring": return "Spring";
            case "Summer1": return "Summer%20Session%201";
            case "Summer10wk": return "Summer%2010%20Week";
            case "Summer2": return "Summer%20Session%202";
            case "Summer": return "Summer"; // Assuming AntAlmanac might accept a general Summer? Test this.
            default: return quarterValue; // Fallback
        }
    }

    /**
     * Parses department and course number from a course string like "COMPSCI 161".
     * @param {string} courseString - The combined course string.
     * @returns {object | null} An object { deptValue, courseNumber } or null if parsing fails.
     */
    function parseCourseString(courseString) {
        if (!courseString || typeof courseString !== 'string') return null;
        // Match the department (letters, &, /) and the course number (alphanumeric, possibly with letters like 1A)
        const match = courseString.trim().match(/^([A-Z&/]+)\s+(.*)$/i);
        if (match && match.length === 3) {
            return {
                deptValue: match[1].toUpperCase(), // Ensure department is uppercase
                courseNumber: match[2] // Keep course number as is (e.g., '161', '45J', '199W')
            };
        }
        console.warn("Could not parse course string:", courseString);
        return null; // Parsing failed
    }

    /**
     * Extracts time strings from meeting details.
     * @param {Array<string>} meetings - Array of meeting strings.
     * @returns {string} HTML string of extracted times, or 'TBA'.
     */
    function extractTimesFromMeetings(meetings) {
        if (!meetings || !Array.isArray(meetings) || meetings.length === 0) {
            return 'TBA';
        }
        // Regex to find time patterns like "10:00am-11:50am" or "2:00pm - 3:20pm"
        const timeRegex = /\b\d{1,2}:\d{2}(?:[ap]m)?\s*-\s*\d{1,2}:\d{2}(?:[ap]m)?\b/gi;
        const allTimes = meetings.map(meetingStr => {
            if (typeof meetingStr !== 'string') return null;
            const matches = meetingStr.match(timeRegex);
            return matches ? matches.join(', ') : null; // Join if multiple times in one meeting string
        }).filter(time => time !== null); // Remove entries where no time was found

        return allTimes.length > 0 ? allTimes.join('<br>') : 'TBA';
    }

    /**
     * Creates a single table row for a section, linking the code to AntAlmanac.
     * @param {object} section - The section data object.
     * @returns {HTMLTableRowElement} The created table row element.
     */
    function createSectionRow(section) {
        const row = document.createElement('tr');
        const safeSection = section || {};
        const statusBadgeClass = getStatusBadgeClass(safeSection.status);
        const sectionCode = safeSection.code || 'N/A';
        const sectionTimes = extractTimesFromMeetings(safeSection.meetings); // Extract times

        // Create AntAlmanac link for the section code
        // Add specific class 'course-code-link' and onclick handler
        const codeLink = (sectionCode !== 'N/A' && /^\d+$/.test(sectionCode)) // Only link if it looks like a valid code
            ? `<a href="https://antalmanac.com/?courseCode=${sectionCode}"
                 target="_blank"
                 rel="noopener noreferrer"
                 class="course-code-link"  /* Added specific class */
                 onclick="event.stopPropagation()">
                 ${sectionCode}
               </a>`
            : sectionCode;

        row.innerHTML = `
            <td data-label="Code">${codeLink}</td>
            <td data-label="Times" class="column-times">${sectionTimes}</td>
            <td data-label="Instructors">${safeSection.instructors || 'TBA'}</td>
            <td data-label="Status"><span class="badge ${statusBadgeClass} status-badge">${safeSection.status || 'Unknown'}</span></td>
            <td data-label="Meetings" class="meeting-details">${safeSection.meetings && safeSection.meetings.length > 0 ? safeSection.meetings.join('<br>') : 'TBA'}</td>
            <td data-label="Units">${safeSection.units || 'N/A'}</td>
        `;
        return row;
    }

    /**
     * Creates a course card element, linking the title to AntAlmanac via an icon.
     * @param {object} course - The course data object.
     * @param {string} idPrefix - A unique prefix for element IDs within this card.
     * @param {string} year - The selected year (e.g., "2025").
     * @param {string} quarter - The selected quarter value (e.g., "Spring", "Summer1").
     * @returns {HTMLDivElement | null} The created card element or null on error.
     */
    function createCourseCard(course, idPrefix, year, quarter) {
        if (!course || typeof course !== 'object' || !idPrefix || !year || !quarter) {
             console.error("Invalid input to createCourseCard:", course, idPrefix, year, quarter);
             return null;
        }
        const courseCard = document.createElement('div');
        const isAvailable = isCourseAvailable(course);
        courseCard.className = `card course-card ${isAvailable ? 'course-card-available' : ''}`;
        const collapseId = `${idPrefix}-collapse`;
        const headerId = `${idPrefix}-header`;

        // --- Create AntAlmanac Link Icon ---
        let antAlmanacIconLink = ''; // Default to empty string
        const courseTitleText = course.course || 'Unknown Course'; // Plain text title
        const parsedCourse = parseCourseString(course.course);

        if (parsedCourse) {
            const formattedQuarter = formatQuarterForAntAlmanac(quarter);
            const term = `${year}%20${formattedQuarter}`;
            const antAlmanacUrl = `https://antalmanac.com/?term=${term}&deptValue=${parsedCourse.deptValue}&courseNumber=${encodeURIComponent(parsedCourse.courseNumber)}`;
            // Create the icon link separately
            antAlmanacIconLink = `
                <a href="${antAlmanacUrl}"
                   target="_blank"
                   rel="noopener noreferrer"
                   class="antalmanac-link-icon ms-2"  /* Added specific class and margin */
                   onclick="event.stopPropagation()"
                   title="View on AntAlmanac">
                    <i class="fas fa-external-link-alt"></i>
                </a>`;
        }
        // --- End Link Icon Creation ---

        const cardHeader = document.createElement('div');
        cardHeader.className = 'card-header collapsed'; // Start collapsed
        cardHeader.setAttribute('data-bs-toggle', 'collapse');
        cardHeader.setAttribute('data-bs-target', `#${collapseId}`);
        cardHeader.setAttribute('aria-expanded', 'false'); // Start collapsed
        cardHeader.setAttribute('aria-controls', collapseId);
        cardHeader.id = headerId;

        // Use flexbox alignment in the header (defined in CSS)
        // Place title text and icon link together
        cardHeader.innerHTML = `
            <span class="course-title-container">
                ${courseTitleText}
                ${antAlmanacIconLink}
            </span>
            <i class="fas fa-chevron-down collapse-arrow"></i>
        `;
        courseCard.appendChild(cardHeader);


        const collapseWrapper = document.createElement('div');
        collapseWrapper.id = collapseId;
        collapseWrapper.className = 'collapse card-body-wrapper'; // Start collapsed
        collapseWrapper.setAttribute('aria-labelledby', headerId);

        const cardBody = document.createElement('div');
        cardBody.className = 'card-body';

        if (course.error) {
             const errorMsg = document.createElement('p');
             errorMsg.className = 'error-message'; errorMsg.textContent = `Error: ${course.error}`;
             cardBody.appendChild(errorMsg);
        } else if (!course.sections || typeof course.sections !== 'object' || Object.keys(course.sections).length === 0) {
            const noSectionsMsg = document.createElement('p');
            noSectionsMsg.className = 'no-sections-message'; noSectionsMsg.textContent = 'No sections found for this term.';
            cardBody.appendChild(noSectionsMsg);
        } else {
            // Sort section types (Lec, Dis, Lab, etc.)
            const sectionTypes = Object.keys(course.sections).sort((a, b) => {
                const order = { 'Lec': 1, 'Dis': 2, 'Lab': 3, 'Sem': 4, 'Tut': 5, 'Qiz': 6, 'Fld': 7, 'Res': 8, 'Stu': 9, 'Act': 10, 'Col': 11 };
                const orderA = order[a] || 99; const orderB = order[b] || 99;
                if (orderA !== orderB) return orderA - orderB; return a.localeCompare(b);
            });

            sectionTypes.forEach(type => {
                const sectionsOfType = course.sections[type];
                if (!Array.isArray(sectionsOfType) || sectionsOfType.length === 0) return;

                // Add section type header (e.g., "Lectures", "Discussions")
                const typeHeader = document.createElement('h6');
                typeHeader.className = 'section-type-header';
                const typeNameMap = { 'Lec': 'Lectures', 'Dis': 'Discussions', 'Lab': 'Labs', 'Sem': 'Seminars', 'Tut': 'Tutorials', 'Fld': 'Fieldwork', 'Res': 'Research', 'Stu': 'Studio', 'Act': 'Activity', 'Col': 'Colloquium', 'Qiz': 'Quiz Section' };
                typeHeader.textContent = typeNameMap[type] || type; cardBody.appendChild(typeHeader);

                // Create table for sections of this type
                const table = document.createElement('table'); table.className = 'table table-hover table-sm';
                const thead = document.createElement('thead'); 
                thead.innerHTML = `<tr><th>Code</th><th class="column-times">Times</th><th>Instructors</th><th>Status</th><th>Meetings</th><th>Units</th></tr>`;
                table.appendChild(thead);
                const tbody = document.createElement('tbody');
                sectionsOfType.forEach(section => {
                    // Pass the section data to createSectionRow
                    if (section && typeof section === 'object') tbody.appendChild(createSectionRow(section));
                });
                table.appendChild(tbody);
                cardBody.appendChild(table);
            });
        }
        collapseWrapper.appendChild(cardBody);
        courseCard.appendChild(collapseWrapper);
        return courseCard;
    }

    function isCourseAvailable(course) {
        if (!course || typeof course !== 'object' || !course.sections || typeof course.sections !== 'object' || Object.keys(course.sections).length === 0) return false;
        for (const type in course.sections) {
            if (Array.isArray(course.sections[type])) {
                for (const section of course.sections[type]) {
                    if (section && typeof section === 'object' && section.status && typeof section.status === 'string' && section.status.toLowerCase() === 'open') return true;
                }
            }
        }
        return false;
    }

    /**
     * Displays the FINAL course results in the appropriate filter tabs.
     * Clears the progress log.
     * @param {Array<object> | null | undefined} finalResults - An array of course objects.
     * @param {string} year - The selected year.
     * @param {string} quarter - The selected quarter.
     */
    function displayFinalResults(finalResults, year, quarter) {
        // Clear the progress log now that results are final
        if (progressLog) progressLog.innerHTML = '';
        if (progressContainer) progressContainer.classList.add('d-none'); // Ensure progress bar is hidden

        // Ensure all pane elements exist
        if (!allCoursesPane || !availableCoursesPane || !unavailableCoursesPane || !resultsArea) {
             console.error("One or more result pane elements not found for final display.");
             return;
        }

        // Clear previous results from all panes
        allCoursesPane.innerHTML = '';
        availableCoursesPane.innerHTML = '';
        unavailableCoursesPane.innerHTML = '';

        const defaultEmptyMessage = '<p class="empty-tab-message">No courses found matching your criteria.</p>';

        if (!Array.isArray(finalResults) || finalResults.length === 0) {
            allCoursesPane.innerHTML = defaultEmptyMessage;
            availableCoursesPane.innerHTML = defaultEmptyMessage;
            unavailableCoursesPane.innerHTML = defaultEmptyMessage;
        } else {
            let availableCount = 0;
            let unavailableCount = 0;

            finalResults.forEach((course, index) => {
                const allIdPrefix = `all-${index}`;
                const availIdPrefix = `avail-${index}`;
                const unavailIdPrefix = `unavail-${index}`;

                // Pass year and quarter to createCourseCard
                const allCard = createCourseCard(course, allIdPrefix, year, quarter);
                if (allCard) {
                     allCoursesPane.appendChild(allCard);
                     const isAvailable = isCourseAvailable(course);
                     if (isAvailable) {
                         // Pass year and quarter here too
                         const availableCard = createCourseCard(course, availIdPrefix, year, quarter);
                         if(availableCard) { availableCoursesPane.appendChild(availableCard); availableCount++; }
                     } else {
                         // Pass year and quarter here too
                         const unavailableCard = createCourseCard(course, unavailIdPrefix, year, quarter);
                         if(unavailableCard) { unavailableCoursesPane.appendChild(unavailableCard); unavailableCount++; }
                     }
                } else { console.warn("Skipping invalid course data in final display:", course); }
            });

            if (availableCount === 0) availableCoursesPane.innerHTML = '<p class="empty-tab-message">No courses with open sections found.</p>';
            if (unavailableCount === 0) unavailableCoursesPane.innerHTML = '<p class="empty-tab-message">No unavailable courses found.</p>';
            if (allCoursesPane.childElementCount === 0) allCoursesPane.innerHTML = defaultEmptyMessage;
        }

        // Show the results area
        resultsArea.classList.remove('d-none');

        // Set the 'Available Only' tab as active
        const availableTabElement = document.getElementById('available-tab');
        if (availableTabElement && typeof bootstrap !== 'undefined') {
             bootstrap.Tab.getOrCreateInstance(availableTabElement).show();
        }
    }

    /**
     * Handles expanding or collapsing all course cards within the active tab.
     * @param {boolean} expand - True to expand, false to collapse.
     */
    function toggleAllCourses(expand) {
        const activePane = document.querySelector('.tab-pane.fade.show.active');
        if (!activePane) { console.warn("Could not find active tab pane for toggleAllCourses."); return; }
        const collapseElements = activePane.querySelectorAll('.collapse.card-body-wrapper');
        collapseElements.forEach(el => {
            if (typeof bootstrap !== 'undefined' && bootstrap.Collapse) {
                const instance = bootstrap.Collapse.getOrCreateInstance(el);
                if (expand) instance.show(); else instance.hide();
            } else { console.error("Bootstrap Collapse component not found."); }
        });
    }

    // --- Event Listeners ---

    // Form Submission Listener (Uses Fetch API with ReadableStream)
    if (courseForm) {
        courseForm.addEventListener('submit', (e) => {
            e.preventDefault();
            clearAlert();
            if(resultsArea) resultsArea.classList.add('d-none'); // Hide previous results
            if(progressLog) progressLog.innerHTML = ''; // Clear previous log

            // Cancel any ongoing search operations
            cancelOngoingSearch();

            // Show progress indicator
            if (progressContainer && progressBar && progressText) {
                progressBar.style.width = '0%'; // Reset progress bar
                progressBar.textContent = ''; // Clear text inside bar
                progressText.textContent = 'Initiating search...'; // Initial message
                progressContainer.classList.remove('d-none');
            } else {
                 console.error("Progress bar elements not found.");
                 showAlert("Could not initialize progress display.");
                 return; // Don't proceed if progress elements are missing
            }


            // Get form data
            const inputTextElement = document.getElementById('inputText');
            // Get current year and quarter values and store them
            currentYear = yearInput ? yearInput.value : '';
            currentQuarter = quarterSelect ? quarterSelect.value : '';

            const formData = {
                input_text: inputTextElement ? inputTextElement.value.trim() : '',
                year: currentYear,
                quarter: currentQuarter
            };

            // Basic client-side validation
            if (!formData.input_text || !formData.year || !formData.quarter) {
                showAlert('Please fill in all fields.');
                if(progressContainer) progressContainer.classList.add('d-none');
                return;
            }
            if (!/^\d{4}$/.test(formData.year)) {
                showAlert('Please enter a valid 4-digit year.');
                if(progressContainer) progressContainer.classList.add('d-none');
                return;
            }

            // --- Initialize Fetch for Streaming with AbortController ---
            console.log("Initiating fetch to /stream_process");
            
            // Create new abort controller for this request
            currentAbortController = new AbortController();

            fetch('/stream_process', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'text/event-stream' // Tell server we expect a stream
                },
                body: JSON.stringify(formData),
                signal: currentAbortController.signal  // Enable request cancellation
            })
            .then(response => {
                if (!response.ok) {
                    // Handle HTTP errors before trying to read stream
                    throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
                }
                if (!response.body) {
                    throw new Error("Response doesn't contain a readable stream.");
                }
                console.log("Received stream response...");

                // Process the readable stream
                const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
                currentReader = reader; // Store the reader for potential cancellation
                let accumulatedData = ''; // Buffer for incomplete messages

                function processStream({ done, value }) {
                    // Check if this reader is still the current one
                    if (currentReader !== reader) {
                        console.log("Reader is no longer current, stopping processing");
                        reader.cancel("Superseded by newer search").catch(err => 
                            console.warn("Error cancelling superseded reader:", err)
                        );
                        return;
                    }
                    
                    if (done) {
                        console.log("Stream finished.");
                        // Clean up references
                        if (currentReader === reader) {
                            currentReader = null;
                        }
                        // Handle case where stream finishes without a 'complete' message?
                        // This might happen if the connection drops or server terminates unexpectedly.
                        // If no 'complete' message was received and results area is still hidden, show an alert.
                        if (resultsArea && resultsArea.classList.contains('d-none') && !alertArea.innerHTML.includes('Server error')) {
                             showAlert("The connection closed before processing completed. Please try again.", "warning");
                        }
                         // Ensure progress is hidden even if stream ends unexpectedly
                        if(progressContainer) progressContainer.classList.add('d-none');
                        return;
                    }

                    accumulatedData += value;
                    // Process messages separated by double newlines (\n\n)
                    let boundary = accumulatedData.indexOf('\n\n');
                    while (boundary >= 0) {
                        const message = accumulatedData.substring(0, boundary).trim();
                        accumulatedData = accumulatedData.substring(boundary + 2); // Skip \n\n

                        if (message.startsWith('data:')) {
                            const jsonData = message.substring(5).trim(); // Remove 'data:' prefix
                            try {
                                const eventData = JSON.parse(jsonData);
                                // --- Handle different event types ---
                                if (eventData.type === 'progress') {
                                    // Update progress bar
                                    if(progressBar) progressBar.style.width = `${eventData.value}%`;
                                    if(progressBar) progressBar.textContent = `${eventData.value}%`; // Optional text on bar
                                    if(progressText) progressText.textContent = eventData.message || 'Processing...';
                                    // Append to log immediately
                                    if(progressLog && eventData.message) {
                                         const logEntry = document.createElement('div');
                                         logEntry.textContent = eventData.message;
                                         progressLog.appendChild(logEntry);
                                         progressLog.scrollTop = progressLog.scrollHeight; // Auto-scroll
                                    }

                                } else if (eventData.type === 'log') {
                                    // Append log message
                                     if(progressLog && eventData.message) {
                                         const logEntry = document.createElement('div');
                                         logEntry.textContent = eventData.message;
                                         progressLog.appendChild(logEntry);
                                         progressLog.scrollTop = progressLog.scrollHeight; // Auto-scroll
                                     }
                                } else if (eventData.type === 'complete') {
                                    console.log("Received 'complete' message.");
                                    // Clean up references
                                    if (currentReader === reader) {
                                        currentReader = null;
                                    }
                                    // Pass the stored year and quarter to the display function
                                    displayFinalResults(eventData.results, currentYear, currentQuarter);
                                    // Stream should close automatically after this
                                    return; // Stop processing further chunks for this branch
                                } else if (eventData.type === 'error') {
                                     console.error("Received error from server stream:", eventData.message);
                                     showAlert(`Server error: ${eventData.message}`, 'danger');
                                     if(progressContainer) progressContainer.classList.add('d-none'); // Hide progress on error
                                     
                                     // Clean up references
                                     if (currentReader === reader) {
                                         currentReader = null;
                                     }
                                     
                                     reader.cancel().catch(e => console.warn("Error cancelling reader:", e)); // Attempt to cancel the stream reader
                                     return; // Stop processing
                                }
                            } catch (e) {
                                console.error("Error parsing SSE data:", e, "Raw data:", jsonData);
                                // Don't stop the stream, just log the error for this message
                            }
                        } else if (message.startsWith('event:') || message.startsWith('id:') || message.startsWith('retry:')) {
                             // Ignore other SSE fields for now
                        } else if (message) {
                             console.warn("Received non-standard SSE line:", message);
                        }
                        boundary = accumulatedData.indexOf('\n\n'); // Look for next message
                    }

                    // Continue reading the stream
                    return reader.read().then(processStream);
                }

                // Start reading the stream
                return reader.read().then(processStream);

            })
            .catch(error => {
                // Check if this was an abort error (which is expected during cancellation)
                if (error.name === 'AbortError') {
                    console.log('Fetch request was aborted due to a new search starting');
                    return; // Don't show an error for intentional cancellation
                }
                
                console.error('Error during fetch/stream processing:', error);
                showAlert(`An error occurred: ${error.message}`, 'danger');
                
                // Clean up references
                currentReader = null;
                currentAbortController = null;
                
                if(progressContainer) progressContainer.classList.add('d-none'); // Hide progress bar on error
            });
        });
    } else {
        console.error("Course form element not found.");
    }

    const showTimesToggle = document.getElementById('showTimesToggle');

    function handleShowTimesToggle() {
        if (!showTimesToggle || !resultsArea) {
            console.warn("Show times toggle or results area not found for toggling.");
            return;
        }
        const show = showTimesToggle.checked;
        if (show) {
            resultsArea.classList.remove('hide-times-column');
        } else {
            resultsArea.classList.add('hide-times-column');
        }
    }

    if (showTimesToggle) {
        showTimesToggle.addEventListener('change', handleShowTimesToggle);
        // Initialize based on default checked state when the script fully loads and elements are ready.
        handleShowTimesToggle();
    } else {
        console.error("Show Times Toggle element (#showTimesToggle) not found.");
    }

    // Expand All Button Listener
    if (expandAllBtn) {
        expandAllBtn.addEventListener('click', () => toggleAllCourses(true));
    } else { console.error("Expand All button not found."); }

    // Collapse All Button Listener
    if (collapseAllBtn) {
        collapseAllBtn.addEventListener('click', () => toggleAllCourses(false));
    } else { console.error("Collapse All button not found."); }

}); // End DOMContentLoaded listener
