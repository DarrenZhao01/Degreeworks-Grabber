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
    const allCoursesPane = document.getElementById('all-courses');
    const availableCoursesPane = document.getElementById('available-courses');
    const unavailableCoursesPane = document.getElementById('unavailable-courses');
    const filterTabs = document.getElementById('filterTabs');
    const expandAllBtn = document.getElementById('expandAllBtn');
    const collapseAllBtn = document.getElementById('collapseAllBtn');

    let eventSource = null; // Variable to hold the EventSource connection

    // --- Input Validation and Initialization ---
    if (yearInput) {
        yearInput.value = new Date().getFullYear();
    } else {
        console.error("Year input element not found.");
    }

    // --- Utility Functions (Mostly Unchanged) ---

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

    function createSectionRow(section) {
        const row = document.createElement('tr');
        const safeSection = section || {};
        const statusBadgeClass = getStatusBadgeClass(safeSection.status);
        row.innerHTML = `
            <td data-label="Code">${safeSection.code || 'N/A'}</td>
            <td data-label="Instructors">${safeSection.instructors || 'TBA'}</td>
            <td data-label="Status"><span class="badge ${statusBadgeClass} status-badge">${safeSection.status || 'Unknown'}</span></td>
            <td data-label="Meetings" class="meeting-details">${safeSection.meetings && safeSection.meetings.length > 0 ? safeSection.meetings.join('<br>') : 'TBA'}</td>
            <td data-label="Units">${safeSection.units || 'N/A'}</td>
        `;
        return row;
    }

    function createCourseCard(course, idPrefix) {
        if (!course || typeof course !== 'object' || !idPrefix) {
             console.error("Invalid input to createCourseCard:", course, idPrefix);
             return null;
        }
        const courseCard = document.createElement('div');
        const isAvailable = isCourseAvailable(course);
        courseCard.className = `card course-card ${isAvailable ? 'course-card-available' : ''}`;
        const collapseId = `${idPrefix}-collapse`;
        const headerId = `${idPrefix}-header`;
        const cardHeader = document.createElement('div');
        cardHeader.className = 'card-header collapsed';
        cardHeader.setAttribute('data-bs-toggle', 'collapse');
        cardHeader.setAttribute('data-bs-target', `#${collapseId}`);
        cardHeader.setAttribute('aria-expanded', 'false');
        cardHeader.setAttribute('aria-controls', collapseId);
        cardHeader.id = headerId;
        cardHeader.innerHTML = `${course.course || 'Unknown Course'} <i class="fas fa-chevron-down collapse-arrow"></i>`;
        courseCard.appendChild(cardHeader);
        const collapseWrapper = document.createElement('div');
        collapseWrapper.id = collapseId;
        collapseWrapper.className = 'collapse card-body-wrapper';
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
            const sectionTypes = Object.keys(course.sections).sort((a, b) => { /* ... sorting logic ... */
                const order = { 'Lec': 1, 'Dis': 2, 'Lab': 3, 'Sem': 4, 'Tut': 5, 'Qiz': 6, 'Fld': 7, 'Res': 8, 'Stu': 9, 'Act': 10, 'Col': 11 };
                const orderA = order[a] || 99; const orderB = order[b] || 99;
                if (orderA !== orderB) return orderA - orderB; return a.localeCompare(b);
            });
            sectionTypes.forEach(type => {
                const sectionsOfType = course.sections[type];
                if (!Array.isArray(sectionsOfType) || sectionsOfType.length === 0) return;
                const typeHeader = document.createElement('h6');
                typeHeader.className = 'section-type-header';
                const typeNameMap = { /* ... type names ... */ 'Lec': 'Lectures', 'Dis': 'Discussions', 'Lab': 'Labs', 'Sem': 'Seminars', 'Tut': 'Tutorials', 'Fld': 'Fieldwork', 'Res': 'Research', 'Stu': 'Studio', 'Act': 'Activity', 'Col': 'Colloquium', 'Qiz': 'Quiz Section' };
                typeHeader.textContent = typeNameMap[type] || type; cardBody.appendChild(typeHeader);
                const table = document.createElement('table'); table.className = 'table table-hover table-sm';
                const thead = document.createElement('thead'); thead.innerHTML = `<tr><th>Code</th><th>Instructors</th><th>Status</th><th>Meetings</th><th>Units</th></tr>`;
                table.appendChild(thead); const tbody = document.createElement('tbody');
                sectionsOfType.forEach(section => { if (section && typeof section === 'object') tbody.appendChild(createSectionRow(section)); });
                table.appendChild(tbody); cardBody.appendChild(table);
            });
        }
        collapseWrapper.appendChild(cardBody); courseCard.appendChild(collapseWrapper);
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
     */
    function displayFinalResults(finalResults) {
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

                const allCard = createCourseCard(course, allIdPrefix);
                if (allCard) {
                     allCoursesPane.appendChild(allCard);
                     const isAvailable = isCourseAvailable(course);
                     if (isAvailable) {
                         const availableCard = createCourseCard(course, availIdPrefix);
                         if(availableCard) { availableCoursesPane.appendChild(availableCard); availableCount++; }
                     } else {
                         const unavailableCard = createCourseCard(course, unavailIdPrefix);
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

    // Form Submission Listener (Now uses EventSource)
    if (courseForm) {
        courseForm.addEventListener('submit', (e) => {
            e.preventDefault();
            clearAlert();
            if(resultsArea) resultsArea.classList.add('d-none'); // Hide previous results
            if(progressLog) progressLog.innerHTML = ''; // Clear previous log

            // Close existing EventSource connection if any
            if (eventSource) {
                eventSource.close();
                console.log("Previous EventSource closed.");
            }

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
            const quarterElement = document.getElementById('quarter');
            const formData = {
                input_text: inputTextElement ? inputTextElement.value.trim() : '',
                year: yearInput ? yearInput.value : '',
                quarter: quarterElement ? quarterElement.value : ''
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

            // --- Initialize EventSource ---
            // We need to send POST data. EventSource only supports GET.
            // Workaround: Use fetch to initiate, then handle stream? No, SSE standard is GET.
            // Option 1: Pass data via query params (less ideal for potentially long text).
            // Option 2: Use a library that wraps Fetch/XHR to simulate EventSource with POST.
            // Option 3: (Simplest for now) Use GET and query parameters. Let's try this first.
            // **Correction:** Flask can handle POST for SSE setup. The client *connects* via EventSource (GET),
            // but the *initial* request that *triggers* the stream generation can be POST.
            // Let's stick to the POST approach for `/stream_process` in Flask.
            // The client side needs to initiate the POST and then somehow listen?
            // This is where standard EventSource fails.
            //
            // **Revised Approach:** Use Fetch API with ReadableStream.
            // This is more modern and handles POST body streaming.

            console.log("Initiating fetch to /stream_process");

            fetch('/stream_process', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'text/event-stream' // Important: Tell server we expect a stream
                },
                body: JSON.stringify(formData)
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
                let accumulatedData = ''; // Buffer for incomplete messages

                function processStream({ done, value }) {
                    if (done) {
                        console.log("Stream finished.");
                        // Handle case where stream finishes without a 'complete' message?
                        if(progressContainer) progressContainer.classList.add('d-none');
                        // If no 'complete' message was received, maybe show an alert.
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
                                    displayFinalResults(eventData.results); // Display final results
                                    // Stream should close automatically after this
                                    return; // Stop processing further chunks for this branch
                                } else if (eventData.type === 'error') {
                                     console.error("Received error from server stream:", eventData.message);
                                     showAlert(`Server error: ${eventData.message}`, 'danger');
                                     if(progressContainer) progressContainer.classList.add('d-none'); // Hide progress on error
                                     reader.cancel(); // Attempt to cancel the stream reader
                                     return; // Stop processing
                                }
                            } catch (e) {
                                console.error("Error parsing SSE data:", e, "Raw data:", jsonData);
                            }
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
                console.error('Error during fetch/stream processing:', error);
                showAlert(`An error occurred: ${error.message}`, 'danger');
                if(progressContainer) progressContainer.classList.add('d-none'); // Hide progress bar on error
                if (eventSource) { // Ensure any old EventSource is closed on error too
                    eventSource.close();
                    eventSource = null;
                }
            });
        });
    } else {
        console.error("Course form element not found.");
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