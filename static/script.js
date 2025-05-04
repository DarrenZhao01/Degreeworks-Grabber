// Wait for the DOM to be fully loaded before running scripts
document.addEventListener('DOMContentLoaded', () => {

    // Get references to DOM elements
    const courseForm = document.getElementById('courseForm');
    const progressContainer = document.querySelector('.progress-container');
    const progressBar = progressContainer?.querySelector('.progress-bar'); // Use optional chaining
    const progressText = progressContainer?.querySelector('.progress-text'); // Use optional chaining
    const resultsArea = document.getElementById('resultsArea');
    const alertArea = document.getElementById('alertArea');
    const yearInput = document.getElementById('year');
    const allCoursesPane = document.getElementById('all-courses');
    const availableCoursesPane = document.getElementById('available-courses');
    const unavailableCoursesPane = document.getElementById('unavailable-courses');
    const filterTabs = document.getElementById('filterTabs');
    const expandAllBtn = document.getElementById('expandAllBtn');
    const collapseAllBtn = document.getElementById('collapseAllBtn');

    // --- Input Validation and Initialization ---

    // Set default year to current year only if the element exists
    if (yearInput) {
        yearInput.value = new Date().getFullYear();
    } else {
        console.error("Year input element not found.");
    }

    // --- Utility Functions ---

    /**
     * Creates and displays a Bootstrap alert message.
     * @param {string} message - The message to display.
     * @param {string} type - The alert type (e.g., 'danger', 'success', 'warning', 'info'). Defaults to 'danger'.
     */
    function showAlert(message, type = 'danger') {
        if (!alertArea) {
            console.error("Alert area element not found.");
            return;
        }
        alertArea.innerHTML = `
            <div class="alert alert-${type} alert-dismissible fade show" role="alert">
                ${message}
                <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
            </div>
        `;
    }

    /**
     * Clears any existing alert messages.
     */
    function clearAlert() {
        if (alertArea) {
            alertArea.innerHTML = '';
        }
    }

    /**
     * Gets a CSS class for styling the status badge based on the status text.
     * @param {string | null | undefined} status - The section status text (e.g., 'Open', 'Waitl', 'FULL').
     * @returns {string} The CSS class for the badge.
     */
    function getStatusBadgeClass(status) {
        const lowerStatus = status ? status.toLowerCase() : 'unknown'; // Handle null/undefined status
        if (lowerStatus === 'open') return 'status-open';
        if (lowerStatus === 'waitl') return 'status-waitl';
        if (lowerStatus === 'full') return 'status-full';
        if (lowerStatus === 'newonly') return 'status-newonly';
        return 'status-unknown'; // Default for 'Unknown' or other statuses
    }


    /**
     * Creates an HTML table row for a section.
     * @param {object} section - The section data object.
     * @returns {HTMLTableRowElement} The created table row element.
     */
    function createSectionRow(section) {
        const row = document.createElement('tr');
        // Ensure section is valid before accessing properties
        const safeSection = section || {};
        const statusBadgeClass = getStatusBadgeClass(safeSection.status);
        // Add data-label attributes for responsive view
        row.innerHTML = `
            <td data-label="Code">${safeSection.code || 'N/A'}</td>
            <td data-label="Instructors">${safeSection.instructors || 'TBA'}</td>
            <td data-label="Status"><span class="badge ${statusBadgeClass} status-badge">${safeSection.status || 'Unknown'}</span></td>
            <td data-label="Meetings" class="meeting-details">${safeSection.meetings && safeSection.meetings.length > 0 ? safeSection.meetings.join('<br>') : 'TBA'}</td>
            <td data-label="Units">${safeSection.units || 'N/A'}</td>
        `;
        return row;
    }

    /**
     * Creates an HTML card element to display a course and its sections, grouped by type.
     * This card is collapsible and styled based on availability.
     * @param {object} course - The course data object, including grouped sections.
     * @param {string} idPrefix - A unique prefix for element IDs within this card.
     * @returns {HTMLDivElement | null} The created card element, or null if course is invalid.
     */
    function createCourseCard(course, idPrefix) {
        // Basic validation for the course object
        if (!course || typeof course !== 'object' || !idPrefix) {
             console.error("Invalid input to createCourseCard:", course, idPrefix);
             return null; // Return null if input is invalid
        }

        const courseCard = document.createElement('div');
        const isAvailable = isCourseAvailable(course); // Check availability
        courseCard.className = `card course-card ${isAvailable ? 'course-card-available' : ''}`; // Add class if available

        // Generate unique IDs for collapse elements
        const collapseId = `${idPrefix}-collapse`;
        const headerId = `${idPrefix}-header`;

        // Card Header (Clickable Trigger)
        const cardHeader = document.createElement('div');
        cardHeader.className = 'card-header collapsed'; // Start collapsed
        cardHeader.setAttribute('data-bs-toggle', 'collapse');
        cardHeader.setAttribute('data-bs-target', `#${collapseId}`);
        cardHeader.setAttribute('aria-expanded', 'false'); // Initially collapsed
        cardHeader.setAttribute('aria-controls', collapseId);
        cardHeader.id = headerId;
        // Add course name and the collapse arrow icon
        cardHeader.innerHTML = `
            ${course.course || 'Unknown Course'}
            <i class="fas fa-chevron-down collapse-arrow"></i>
        `;
        courseCard.appendChild(cardHeader);

        // Collapsible Wrapper Div for Card Body Content
        const collapseWrapper = document.createElement('div');
        collapseWrapper.id = collapseId;
        collapseWrapper.className = 'collapse card-body-wrapper'; // Add 'collapse', remove 'show' to start collapsed
        collapseWrapper.setAttribute('aria-labelledby', headerId);

        // Inner Card Body (holds the actual content: tables, messages)
        const cardBody = document.createElement('div');
        cardBody.className = 'card-body'; // Keep card-body class for structure if needed

        // Check for processing errors specific to this course
        if (course.error) {
             const errorMsg = document.createElement('p');
             errorMsg.className = 'error-message';
             errorMsg.textContent = `Error: ${course.error}`;
             cardBody.appendChild(errorMsg);
        }
        // Check if there are any sections at all
        else if (!course.sections || typeof course.sections !== 'object' || Object.keys(course.sections).length === 0) {
            const noSectionsMsg = document.createElement('p');
            noSectionsMsg.className = 'no-sections-message';
            noSectionsMsg.textContent = 'No sections found for this term.';
            cardBody.appendChild(noSectionsMsg);
        } else {
            // Get section types and sort them (e.g., Lec, Dis, Lab)
            const sectionTypes = Object.keys(course.sections).sort((a, b) => {
                const order = { 'Lec': 1, 'Dis': 2, 'Lab': 3, 'Sem': 4, 'Tut': 5, 'Qiz': 6, 'Fld': 7, 'Res': 8, 'Stu': 9, 'Act': 10, 'Col': 11 };
                const orderA = order[a] || 99;
                const orderB = order[b] || 99;
                if (orderA !== orderB) return orderA - orderB;
                return a.localeCompare(b);
            });

            // Iterate through each section type
            sectionTypes.forEach(type => {
                const sectionsOfType = course.sections[type];
                // Ensure sectionsOfType is an array and has content
                if (!Array.isArray(sectionsOfType) || sectionsOfType.length === 0) return;

                const typeHeader = document.createElement('h6');
                typeHeader.className = 'section-type-header';
                const typeNameMap = { 'Lec': 'Lectures', 'Dis': 'Discussions', 'Lab': 'Labs', 'Sem': 'Seminars', 'Tut': 'Tutorials', 'Fld': 'Fieldwork', 'Res': 'Research', 'Stu': 'Studio', 'Act': 'Activity', 'Col': 'Colloquium', 'Qiz': 'Quiz Section' };
                typeHeader.textContent = typeNameMap[type] || type;
                cardBody.appendChild(typeHeader);

                const table = document.createElement('table');
                table.className = 'table table-hover table-sm';
                const thead = document.createElement('thead');
                thead.innerHTML = `
                    <tr>
                        <th>Code</th>
                        <th>Instructors</th>
                        <th>Status</th>
                        <th>Meetings</th>
                        <th>Units</th>
                    </tr>
                `;
                table.appendChild(thead);

                const tbody = document.createElement('tbody');
                sectionsOfType.forEach(section => {
                    // Ensure section is valid before creating row
                    if (section && typeof section === 'object') {
                         tbody.appendChild(createSectionRow(section));
                    }
                });
                table.appendChild(tbody);
                cardBody.appendChild(table);
            });
        }

        collapseWrapper.appendChild(cardBody);
        courseCard.appendChild(collapseWrapper);

        return courseCard;
    }

    /**
     * Checks if a course has at least one section with 'Open' status.
     * @param {object | null | undefined} course - The course data object.
     * @returns {boolean} True if at least one section is open, false otherwise.
     */
    function isCourseAvailable(course) {
        // Check if course and sections object exist and are not empty
        if (!course || typeof course !== 'object' || !course.sections || typeof course.sections !== 'object' || Object.keys(course.sections).length === 0) {
            return false; // No sections means unavailable
        }
        // Iterate through each section type (Lec, Dis, etc.)
        for (const type in course.sections) {
            // Ensure the value associated with the type is an array
            if (Array.isArray(course.sections[type])) {
                // Iterate through sections within that type
                for (const section of course.sections[type]) {
                    // Check if section exists and has an 'Open' status (case-insensitive)
                    if (section && typeof section === 'object' && section.status && typeof section.status === 'string' && section.status.toLowerCase() === 'open') {
                        return true; // Found an open section
                    }
                }
            }
        }
        return false; // No open sections found
    }


    /**
     * Displays the fetched and processed course results in the appropriate filter tabs.
     * @param {Array<object> | null | undefined} results - An array of course objects.
     */
    function displayResults(results) {
        // Ensure all pane elements exist
        if (!allCoursesPane || !availableCoursesPane || !unavailableCoursesPane || !resultsArea) {
             console.error("One or more result pane elements not found.");
             if(progressContainer) progressContainer.classList.add('d-none'); // Hide progress if panes missing
             return;
        }

        // Clear previous results from all panes
        allCoursesPane.innerHTML = '';
        availableCoursesPane.innerHTML = '';
        unavailableCoursesPane.innerHTML = '';
        if(progressContainer) progressContainer.classList.add('d-none'); // Hide progress bar

        const defaultEmptyMessage = '<p class="empty-tab-message">No courses found matching your criteria.</p>';

        // Handle cases where results are null, undefined, or not an array
        if (!Array.isArray(results) || results.length === 0) {
            allCoursesPane.innerHTML = defaultEmptyMessage;
            availableCoursesPane.innerHTML = defaultEmptyMessage;
            unavailableCoursesPane.innerHTML = defaultEmptyMessage;
            resultsArea.classList.remove('d-none'); // Show the results area (with tabs)
            // Ensure 'Available' tab is active (even if empty)
            const availableTabElement = document.getElementById('available-tab');
            if (availableTabElement && typeof bootstrap !== 'undefined') {
                 bootstrap.Tab.getOrCreateInstance(availableTabElement).show();
            }
            return;
        }

        let availableCount = 0;
        let unavailableCount = 0;

        // Create and append cards to the correct panes
        results.forEach((course, index) => {
            // Generate unique ID prefixes for each card instance across tabs
            const allIdPrefix = `all-${index}`;
            const availIdPrefix = `avail-${index}`;
            const unavailIdPrefix = `unavail-${index}`;

            // Create cards only if course data is valid
            const allCard = createCourseCard(course, allIdPrefix);
            if (allCard) {
                 allCoursesPane.appendChild(allCard); // Append original card

                 const isAvailable = isCourseAvailable(course);
                 // Add to the specific filter tabs
                 if (isAvailable) {
                     const availableCard = createCourseCard(course, availIdPrefix);
                     if(availableCard) {
                         availableCoursesPane.appendChild(availableCard);
                         availableCount++;
                     }
                 } else {
                     const unavailableCard = createCourseCard(course, unavailIdPrefix);
                     if(unavailableCard) {
                         unavailableCoursesPane.appendChild(unavailableCard);
                         unavailableCount++;
                     }
                 }
            } else {
                console.warn("Skipping invalid course data:", course);
            }
        });

         // Add messages if specific tabs are empty
        if (availableCount === 0) {
            availableCoursesPane.innerHTML = '<p class="empty-tab-message">No courses with open sections found.</p>';
        }
        if (unavailableCount === 0) {
            unavailableCoursesPane.innerHTML = '<p class="empty-tab-message">No unavailable courses found (all found courses have open sections or no sections listed).</p>';
        }
         if (allCoursesPane.childElementCount === 0) { // Check if the All tab is actually empty
             allCoursesPane.innerHTML = '<p class="empty-tab-message">No courses found matching your input.</p>';
         }


        // Show the results area (tabs and content)
        resultsArea.classList.remove('d-none');

         // Set the 'Available Only' tab as active by default after loading results
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
        // Find the currently active tab pane
        const activePane = document.querySelector('.tab-pane.fade.show.active');
        if (!activePane) {
            console.warn("Could not find active tab pane for toggleAllCourses.");
            return;
        }

        // Find all collapse content elements within the active pane
        const collapseElements = activePane.querySelectorAll('.collapse.card-body-wrapper');

        // Iterate and toggle each collapse instance
        collapseElements.forEach(el => {
            // Get or create a Bootstrap Collapse instance for the element
            // Ensure Bootstrap's JS is loaded and available
            if (typeof bootstrap !== 'undefined' && bootstrap.Collapse) {
                const instance = bootstrap.Collapse.getOrCreateInstance(el);
                if (expand) {
                    instance.show();
                } else {
                    instance.hide();
                }
            } else {
                console.error("Bootstrap Collapse component not found. Make sure Bootstrap JS is loaded.");
            }
        });
    }


    // --- Event Listeners ---

    // Form Submission Listener
    if (courseForm) {
        courseForm.addEventListener('submit', async (e) => {
            e.preventDefault(); // Prevent default page reload
            clearAlert(); // Clear previous errors
            if(resultsArea) resultsArea.classList.add('d-none'); // Hide results until ready

            // Show progress indicator if elements exist
            if (progressContainer && progressText) {
                progressText.textContent = 'Searching... Pasting many courses may take a while.';
                progressContainer.classList.remove('d-none');
            }

            // Get form data
            const inputTextElement = document.getElementById('inputText');
            const quarterElement = document.getElementById('quarter');
            const formData = {
                input_text: inputTextElement ? inputTextElement.value.trim() : '',
                year: yearInput ? yearInput.value : '', // Use previously fetched yearInput
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

            // --- API Call ---
            try {
                // Send data to the backend '/process' endpoint
                const response = await fetch('/process', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json' // Indicate expected response type
                    },
                    body: JSON.stringify(formData) // Convert JS object to JSON string
                });

                // Check if the response status indicates success (e.g., 200-299)
                if (!response.ok) {
                     // Attempt to parse error message from backend JSON response
                     let errorMsg = `HTTP error ${response.status}: ${response.statusText}`;
                     try {
                         const errorData = await response.json();
                         // Use backend error message if available
                         if (errorData && errorData.error) {
                             errorMsg = errorData.error;
                         }
                     } catch (jsonError) {
                         // If response is not JSON or parsing fails, stick with the HTTP status text
                         console.error("Could not parse error response JSON:", jsonError);
                     }
                    throw new Error(errorMsg); // Throw error to be caught below
                }

                // Parse the successful JSON response from the backend
                const data = await response.json();

                // Check the status field within the successful response
                if (data.status === 'complete' && data.results) {
                    displayResults(data.results); // Display the results in the tabs
                } else {
                    // Handle cases where status is not 'complete' or results are missing
                    throw new Error(data.error || 'Received incomplete or unexpected data from server.');
                }

            } catch (error) {
                // Catch errors from fetch operation or backend processing
                console.error('Error during form submission:', error);
                // Display the caught error message to the user
                showAlert(`An error occurred: ${error.message}`);
                if(resultsArea) resultsArea.classList.add('d-none'); // Keep results hidden on error
            } finally {
                // Always hide the progress bar after completion or error
                if(progressContainer) progressContainer.classList.add('d-none');
            }
        });
    } else {
        console.error("Course form element not found.");
    }

    // Expand All Button Listener
    if (expandAllBtn) {
        expandAllBtn.addEventListener('click', () => toggleAllCourses(true));
    } else {
        console.error("Expand All button not found.");
    }

    // Collapse All Button Listener
    if (collapseAllBtn) {
        collapseAllBtn.addEventListener('click', () => toggleAllCourses(false));
    } else {
        console.error("Collapse All button not found.");
    }

}); // End DOMContentLoaded listener
