// Configuration for the backend API URL
// IMPORTANT: In a real-world app, this would be injected via environment variables
// during a build process (e.g., using Webpack, Vite, Create React App, etc.)
// For local development, 'http://localhost:5000' is fine.
const BACKEND_API_BASE_URL = 'http://127.0.0.1:5000';

document.addEventListener('DOMContentLoaded', () => {

    const courseForm = document.getElementById('courseForm');
    
    const bodyElement = document.body;
    const inputColumn = document.querySelector('.input-column');
    const outputColumn = document.querySelector('.output-column');
    const progressLogDisplay = outputColumn.querySelector('.progress-log-display');
    const resultsDisplay = outputColumn.querySelector('.results-display');

    const alertArea = document.getElementById('alertArea');
    const yearInput = document.getElementById('year');
    const quarterSelect = document.getElementById('quarter');
    
    // Check if resultsDisplay exists before trying to query it
    let allCoursesPane = null;
    let availableCoursesPane = null;
    let waitlistedCoursesPane = null;
    let unavailableCoursesPane = null;
    
    if (resultsDisplay) {
        allCoursesPane = resultsDisplay.querySelector('#all-courses');
        availableCoursesPane = resultsDisplay.querySelector('#available-courses');
        waitlistedCoursesPane = resultsDisplay.querySelector('#waitlisted-courses');
        unavailableCoursesPane = resultsDisplay.querySelector('#unavailable-courses');
    } else {
        console.error("Results display element not found!");
    }
    
    const filterTabs = resultsDisplay ? resultsDisplay.querySelector('#filterTabs') : null;
    const expandAllBtn = resultsDisplay ? resultsDisplay.querySelector('#expandAllBtn') : null;
    const collapseAllBtn = resultsDisplay ? resultsDisplay.querySelector('#collapseAllBtn') : null;

    let eventSource = null;
    let currentAbortController = null;
    let currentReader = null;
    let currentYear = '';
    let currentQuarter = '';
    
    // Cache for search results to prevent loss when switching modes
    let cachedSearchResults = null;
    let cachedSearchParams = null;
    
    // Cache for schedule results to prevent loss when switching modes
    let cachedScheduleResults = null;

    if (yearInput) {
        yearInput.value = new Date().getFullYear();
    } else {
        console.error("Year input element not found.");
    }

    function showAlert(message, type = 'danger') {
        if (!alertArea) { console.error("Alert area element not found."); return; }
        const wrapper = document.createElement('div');
        wrapper.innerHTML = `
            <div class="alert alert-${type} alert-dismissible fade show" role="alert">
                ${message}
                <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
            </div>
        `;
        alertArea.appendChild(wrapper);
        setTimeout(() => {
            const alertInstance = bootstrap.Alert.getInstance(wrapper.firstChild);
            if (alertInstance) {
                alertInstance.close();
            } else if (wrapper.firstChild) {
                 wrapper.firstChild.classList.remove('show');
                 setTimeout(() => wrapper.remove(), 150);
            } else {
                 // Fallback: remove wrapper if firstChild is undefined
                 setTimeout(() => wrapper.remove(), 150);
            }
        }, 5000);
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

    function cancelOngoingSearch() {
        if (currentAbortController) {
            console.log("Aborting previous fetch request");
            currentAbortController.abort();
            currentAbortController = null;
        }
        if (currentReader) {
            console.log("Cancelling previous stream reader");
            currentReader.cancel("New search started").catch(err => 
                console.warn("Error cancelling reader:", err)
            );
            currentReader = null;
        }
        if (window.currentEventSource) {
            window.currentEventSource.close();
            console.log("Previous EventSource closed.");
            window.currentEventSource = null;
        }
        if (eventSource) {
            eventSource.close();
            console.log("Previous EventSource closed.");
            eventSource = null;
        }
    }

    function formatQuarterForAntAlmanac(quarterValue) {
        switch (quarterValue) {
            case "Fall": return "Fall";
            case "Winter": return "Winter";
            case "Spring": return "Spring";
            case "Summer1": return "Summer%20Session%201";
            case "Summer10wk": return "Summer%2010%20Week";
            case "Summer2": return "Summer%20Session%202";
            default: return encodeURIComponent(quarterValue);
        }
    }

    function parseCourseString(courseString) {
        if (!courseString || typeof courseString !== 'string') return null;
        const match = courseString.trim().match(/^([A-Z&/\s]+?)\s+([A-Z0-9]+(?:[A-Z])?(?:-[A-Z0-9]+(?:[A-Z])?)?)$/i);
        if (match && match.length === 3) {
            return {
                deptValue: match[1].trim().toUpperCase(), 
                courseNumber: match[2].toUpperCase()
            };
        }
        const simpleMatch = courseString.trim().match(/^([A-Z&/]+)\s+(.*)$/i);
        if (simpleMatch && simpleMatch.length === 3) {
            return {
                deptValue: simpleMatch[1].toUpperCase(),
                courseNumber: simpleMatch[2].toUpperCase()
            };
        }
        console.warn("Could not parse course string:", courseString);
        return null;
    }

    function createSectionRow(section) {
        const row = document.createElement('tr');
        const safeSection = section || {};
        const statusBadgeClass = getStatusBadgeClass(safeSection.status);
        const sectionCode = safeSection.code || 'N/A';

        const codeLink = (sectionCode !== 'N/A' && /^\d+$/.test(sectionCode))
            ? `<a href="https://antalmanac.com/?courseCode=${sectionCode}"
                 target="_blank"
                 rel="noopener noreferrer"
                 class="course-code-link"
                 onclick="event.stopPropagation()">
                 ${sectionCode}
               </a>`
            : sectionCode;

        row.innerHTML = `
            <td data-label="Code">${codeLink}</td>
            <td data-label="Instructors">${safeSection.instructors || 'TBA'}</td>
            <td data-label="Status"><span class="badge ${statusBadgeClass} status-badge">${safeSection.status || 'Unknown'}</span></td>
            <td data-label="Meetings" class="meeting-details">${safeSection.meetings && safeSection.meetings.length > 0 ? safeSection.meetings.join('<br>') : 'TBA'}</td>
            <td data-label="Units">${safeSection.units || 'N/A'}</td>
        `;
        return row;
    }

    function createCourseCard(course, idPrefix, year, quarter) {
        if (!course || typeof course !== 'object' || !idPrefix || !year || !quarter) {
             console.error("Invalid input to createCourseCard:", course, idPrefix, year, quarter);
             return null;
        }
        const courseCard = document.createElement('div');
        const isAvailable = isCourseAvailable(course);
        const isWaitlisted = isCourseWaitlisted(course);
        
        let cardClass = 'card course-card';
        if (isAvailable) {
            cardClass += ' course-card-available';
        } else if (isWaitlisted) {
            cardClass += ' course-card-waitlisted';
        }
        
        courseCard.className = cardClass;
        const collapseId = `${idPrefix}-collapse-${Date.now()}${Math.random().toString(36).substring(2,7)}`;
        const headerId = `${idPrefix}-header-${Date.now()}${Math.random().toString(36).substring(2,7)}`;

        let antAlmanacIconLink = '';
        const courseTitleText = course.course || 'Unknown Course';
        const parsedCourse = parseCourseString(course.course);

        if (parsedCourse) {
            const formattedQuarter = formatQuarterForAntAlmanac(quarter);
            const term = `${year}%20${formattedQuarter}`;
            const encodedDeptValue = encodeURIComponent(parsedCourse.deptValue);
            const antAlmanacUrl = `https://antalmanac.com/?term=${term}&deptValue=${encodedDeptValue}&courseNumber=${encodeURIComponent(parsedCourse.courseNumber)}`;
            antAlmanacIconLink = `
                <a href="${antAlmanacUrl}"
                   target="_blank"
                   rel="noopener noreferrer"
                   class="antalmanac-link-icon ms-2"
                   onclick="event.stopPropagation()"
                   title="View on AntAlmanac">
                    <i class="fas fa-external-link-alt"></i>
                </a>`;
        }

        const cardHeader = document.createElement('div');
        cardHeader.className = 'card-header collapsed';
        cardHeader.setAttribute('data-bs-toggle', 'collapse');
        cardHeader.setAttribute('data-bs-target', `#${collapseId}`);
        cardHeader.setAttribute('aria-expanded', 'false'); 
        cardHeader.setAttribute('aria-controls', collapseId);
        cardHeader.id = headerId;

        cardHeader.innerHTML = `
            <div class="d-flex justify-content-between align-items-center w-100">
                <span class="course-title-container">
                    ${courseTitleText}
                    ${antAlmanacIconLink}
                </span>
                <div class="course-actions d-flex align-items-center">
                    <button class="btn btn-outline-success btn-sm me-2 select-course-btn" 
                            data-course="${course.course || 'Unknown'}"
                            onclick="event.stopPropagation(); toggleCourseSelection(this.getAttribute('data-course'), this)"
                            title="Add to Schedule Builder">
                        <i class="fas fa-plus me-1"></i>Select
                    </button>
                    <i class="fas fa-chevron-down collapse-arrow"></i>
                </div>
            </div>
        `;
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
            const sectionTypes = Object.keys(course.sections).sort((a, b) => {
                const order = { 'Lec': 1, 'Dis': 2, 'Lab': 3, 'Sem': 4, 'Tut': 5, 'Qiz': 6, 'Fld': 7, 'Res': 8, 'Stu': 9, 'Act': 10, 'Col': 11 };
                const orderA = order[a] || 99; const orderB = order[b] || 99;
                if (orderA !== orderB) return orderA - orderB; return a.localeCompare(b);
            });

            sectionTypes.forEach(type => {
                const sectionsOfType = course.sections[type];
                if (!Array.isArray(sectionsOfType) || sectionsOfType.length === 0) return;

                const typeHeader = document.createElement('h6');
                typeHeader.className = 'section-type-header';
                const typeNameMap = { 'Lec': 'Lectures', 'Dis': 'Discussions', 'Lab': 'Labs', 'Sem': 'Seminars', 'Tut': 'Tutorials', 'Fld': 'Fieldwork', 'Res': 'Research', 'Stu': 'Studio', 'Act': 'Activity', 'Col': 'Colloquium', 'Qiz': 'Quiz Section' };
                typeHeader.textContent = typeNameMap[type] || type; cardBody.appendChild(typeHeader);

                const table = document.createElement('table'); table.className = 'table table-hover table-sm';
                const thead = document.createElement('thead'); thead.innerHTML = `<tr><th>Code</th><th>Instructors</th><th>Status</th><th>Meetings</th><th>Units</th></tr>`;
                table.appendChild(thead);
                const tbody = document.createElement('tbody');
                sectionsOfType.forEach(section => {
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

    function isCourseWaitlisted(course) {
        if (!course || typeof course !== 'object' || !course.sections || typeof course.sections !== 'object' || Object.keys(course.sections).length === 0) return false;
        let hasWaitlistedSections = false;
        let hasOpenSections = false;
        
        for (const type in course.sections) {
            if (Array.isArray(course.sections[type])) {
                for (const section of course.sections[type]) {
                    if (section && typeof section === 'object' && section.status && typeof section.status === 'string') {
                        const status = section.status.toLowerCase();
                        if (status === 'open') {
                            hasOpenSections = true;
                        } else if (status === 'waitl') {
                            hasWaitlistedSections = true;
                        }
                    }
                }
            }
        }
        
        // Return true only if course has waitlisted sections but no open sections
        return hasWaitlistedSections && !hasOpenSections;
    }

    function displayFinalResultsAndAnimate(finalResults, year, quarter, isRestoredFromCache = false) {
        // Cache the search results and parameters (only if not already cached)
        if (!isRestoredFromCache) {
            cachedSearchResults = finalResults;
            cachedSearchParams = { year, quarter };
            // Clear schedule cache only when displaying NEW course results
            cachedScheduleResults = null;
        }
        
        if (progressLogDisplay) progressLogDisplay.classList.add('d-none');
        if (resultsDisplay) resultsDisplay.classList.remove('d-none');
        
        // Show course finder tabs and hide any schedule results when displaying course results
        const filterTabsContainer = resultsDisplay.querySelector('.filter-controls-container');
        const tabContent = resultsDisplay.querySelector('#filterTabContent');
        const existingScheduleContent = resultsDisplay.querySelector('.schedule-results');
        if (filterTabsContainer) filterTabsContainer.style.display = '';
        if (tabContent) tabContent.style.display = '';
        if (existingScheduleContent) existingScheduleContent.remove();

        // Re-query elements if they weren't found during initial load
        if (!allCoursesPane || !availableCoursesPane || !waitlistedCoursesPane || !unavailableCoursesPane) {
            console.log('Re-querying result pane elements...');
            if (resultsDisplay) {
                allCoursesPane = resultsDisplay.querySelector('#all-courses');
                availableCoursesPane = resultsDisplay.querySelector('#available-courses');
                waitlistedCoursesPane = resultsDisplay.querySelector('#waitlisted-courses');
                unavailableCoursesPane = resultsDisplay.querySelector('#unavailable-courses');
            }
        }

        if (!allCoursesPane || !availableCoursesPane || !waitlistedCoursesPane || !unavailableCoursesPane) {
             console.error("One or more result pane elements not found for final display.");
             console.error("Missing elements:", {
                 allCoursesPane: !!allCoursesPane,
                 availableCoursesPane: !!availableCoursesPane, 
                 waitlistedCoursesPane: !!waitlistedCoursesPane,
                 unavailableCoursesPane: !!unavailableCoursesPane
             });
             return;
        }

        allCoursesPane.innerHTML = '';
        availableCoursesPane.innerHTML = '';
        waitlistedCoursesPane.innerHTML = '';
        unavailableCoursesPane.innerHTML = '';

        const defaultEmptyMessage = '<p class="empty-tab-message">No courses found matching your criteria.</p>';

        if (!Array.isArray(finalResults) || finalResults.length === 0) {
            allCoursesPane.innerHTML = defaultEmptyMessage;
            availableCoursesPane.innerHTML = defaultEmptyMessage;
            waitlistedCoursesPane.innerHTML = defaultEmptyMessage;
            unavailableCoursesPane.innerHTML = defaultEmptyMessage;
        } else {
            let availableCount = 0;
            let waitlistedCount = 0;
            let unavailableCount = 0;

            finalResults.forEach((course, index) => {
                const allIdPrefix = `all-${index}`;
                const availIdPrefix = `avail-${index}`;
                const waitIdPrefix = `wait-${index}`;
                const unavailIdPrefix = `unavail-${index}`;

                const allCard = createCourseCard(course, allIdPrefix, year, quarter);
                if (allCard) {
                     allCoursesPane.appendChild(allCard);
                }

                const isAvailable = isCourseAvailable(course);
                const isWaitlisted = isCourseWaitlisted(course);
                
                if (isAvailable) {
                    const availableCard = createCourseCard(course, availIdPrefix, year, quarter);
                    if (availableCard) {
                        availableCoursesPane.appendChild(availableCard);
                        availableCount++;
                    }
                } else if (isWaitlisted) {
                    const waitlistedCard = createCourseCard(course, waitIdPrefix, year, quarter);
                    if (waitlistedCard) {
                        waitlistedCoursesPane.appendChild(waitlistedCard);
                        waitlistedCount++;
                    }
                } else {
                    const unavailableCard = createCourseCard(course, unavailIdPrefix, year, quarter);
                    if (unavailableCard) {
                        unavailableCoursesPane.appendChild(unavailableCard);
                        unavailableCount++;
                    }
                }
            });

            if (availableCount === 0) availableCoursesPane.innerHTML = '<p class="empty-tab-message">No courses with open sections found.</p>';
            if (waitlistedCount === 0) waitlistedCoursesPane.innerHTML = '<p class="empty-tab-message">No courses with waitlisted-only sections found.</p>';
            if (unavailableCount === 0) unavailableCoursesPane.innerHTML = '<p class="empty-tab-message">No unavailable courses found.</p>';
            if (allCoursesPane.childElementCount === 0 && finalResults.length > 0) {
                 allCoursesPane.innerHTML = '<p class="empty-tab-message">Could not display any courses in the "All" tab.</p>';
            } else if (allCoursesPane.childElementCount === 0 && finalResults.length === 0 ) { 
                allCoursesPane.innerHTML = defaultEmptyMessage;
            }

            setTimeout(() => {
                const panesToAnimate = [allCoursesPane, availableCoursesPane, waitlistedCoursesPane, unavailableCoursesPane];
                panesToAnimate.forEach(pane => {
                    if (pane) { 
                        const cardsInPane = pane.querySelectorAll('.course-card');
                        cardsInPane.forEach((card, indexInPane) => {
                            card.style.transitionDelay = `${indexInPane * 0.075}s`;
                            card.classList.add('visible');
                        });
                    }
                });
            }, 100);
        }

        const availableTabElement = resultsDisplay.querySelector('#available-tab');
        if (availableTabElement && typeof bootstrap !== 'undefined' && bootstrap.Tab) {
             const tabInstance = bootstrap.Tab.getOrCreateInstance(availableTabElement);
             if (tabInstance) tabInstance.show();
        }
        
        // Restore selection state for cached results
        restoreSelectionState();
    }

    // Function to restore the selection state of course buttons
    function restoreSelectionState() {
        if (!selectedCourses || selectedCourses.size === 0) return;
        
        // Update all select buttons to reflect current selection state
        selectedCourses.forEach(courseName => {
            const selectButtons = document.querySelectorAll(`[data-course="${courseName}"]`);
            selectButtons.forEach(button => {
                button.innerHTML = '<i class="fas fa-check me-1"></i>Selected';
                button.className = 'btn btn-success btn-sm me-2 select-course-btn';
                button.title = 'Remove from Schedule Builder';
            });
        });
    }

    function toggleAllCourses(expand) {
        const activePane = resultsDisplay.querySelector('.tab-pane.fade.show.active');
        if (!activePane) { console.warn("Could not find active tab pane for toggleAllCourses."); return; }
        const collapseElements = activePane.querySelectorAll('.collapse.card-body-wrapper');
        collapseElements.forEach(el => {
            if (typeof bootstrap !== 'undefined' && bootstrap.Collapse) {
                const instance = bootstrap.Collapse.getOrCreateInstance(el);
                if (expand) instance.show(); else instance.hide();
            } else { console.error("Bootstrap Collapse component not found."); }
        });
    }

    if (courseForm) {
        courseForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            // Clear cached results when starting a new search
            cachedSearchResults = null;
            cachedSearchParams = null;
            cachedScheduleResults = null;
            
            clearAlert();
            bodyElement.classList.remove('initial-view');
            bodyElement.classList.add('search-view');
            
            const inputText = document.getElementById('inputText').value.trim();
            const year = yearInput.value.trim();
            const quarter = quarterSelect.value;
            
            if (!inputText || !year || !quarter) {
                showAlert('Please fill out all fields.', 'warning');
                return;
            }
            
            // Store for AntAlmanac links
            currentYear = year;
            currentQuarter = quarter;
            
            progressLogDisplay.classList.remove('d-none');
            progressLogDisplay.innerHTML = `
                <div class="progress-container">
                    <div class="progress mb-3">
                        <div class="progress-bar" role="progressbar" style="width: 0%" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100"></div>
                    </div>
                    <div class="log-container">
                        <div class="spinner-border text-primary spinner-border-sm me-2" role="status">
                            <span class="visually-hidden">Loading...</span>
                        </div>
                        <span class="current-progress-text">Starting search...</span>
                    </div>
                </div>`;
            
            resultsDisplay.classList.add('d-none');
            resultsDisplay.querySelectorAll('.tab-pane').forEach(pane => {
                pane.innerHTML = '';
            });
            
            cancelOngoingSearch();

            try {
                        // Create EventSource for Server-Sent Events
        const eventSource = new EventSource(`${BACKEND_API_BASE_URL}/stream_process?` + new URLSearchParams({
                    input_text: inputText,
                    year: year,
                    quarter: quarter
                }));
                
                // Store reference for cancellation
                window.currentEventSource = eventSource;

                eventSource.onmessage = function(event) {
                    try {
                        const data = JSON.parse(event.data);
                        
                        if (data.type === 'progress') {
                            const progressBar = progressLogDisplay.querySelector('.progress-bar');
                            const progressText = progressLogDisplay.querySelector('.current-progress-text');
                            if (progressBar) {
                                progressBar.style.width = `${data.value}%`;
                                progressBar.setAttribute('aria-valuenow', data.value);
                            }
                            if (progressText) {
                                progressText.textContent = data.message || 'Processing...';
                            }
                        } else if (data.type === 'log') {
                            const progressText = progressLogDisplay.querySelector('.current-progress-text');
                            if (progressText) {
                                progressText.textContent = data.message;
                            }
                        } else if (data.type === 'complete') {
                            eventSource.close();
                            window.currentEventSource = null;
                            
                            // Update progress to 100%
                            const progressBar = progressLogDisplay.querySelector('.progress-bar');
                            const progressText = progressLogDisplay.querySelector('.current-progress-text');
                            if (progressBar) progressBar.style.width = '100%';
                            if (progressText) progressText.textContent = 'Search complete!';
                            
                            // Display results
                            displayFinalResultsAndAnimate(data.results, year, quarter);
                        } else if (data.type === 'error') {
                            eventSource.close();
                            window.currentEventSource = null;
                            throw new Error(data.message);
                        }
                    } catch (parseError) {
                        console.error('Error parsing SSE data:', parseError);
                    }
                };

                eventSource.addEventListener('keepalive', function(event) {
                    // Keep-alive event, do nothing
                    console.log('Received keep-alive');
                });

                eventSource.onerror = function(event) {
                    eventSource.close();
                    window.currentEventSource = null;
                    console.error('EventSource error:', event);
                    showAlert('Connection error occurred. Please try again.', 'danger');
                    
                    // Update UI to show error state
                    progressLogDisplay.innerHTML = `
                        <div class="alert alert-danger">
                            <i class="fas fa-exclamation-circle me-2"></i>
                            Connection error occurred. Please try again.
                        </div>`;
                };

            } catch (error) {
                console.error('Error during fetch:', error);
                showAlert(`Error: ${error.message}`, 'danger');
                
                // Update UI to show error state
                progressLogDisplay.innerHTML = `
                    <div class="alert alert-danger">
                        <i class="fas fa-exclamation-circle me-2"></i>
                        ${error.message}
                    </div>`;
            }
        });
    } else {
        console.error("Course form element not found.");
    }

    if (expandAllBtn) {
        expandAllBtn.addEventListener('click', () => toggleAllCourses(true));
    } else { console.error("Expand All button not found."); }

    if (collapseAllBtn) {
        collapseAllBtn.addEventListener('click', () => toggleAllCourses(false));
    } else { console.error("Collapse All button not found."); }

    // Resize functionality
    const resizeHandle = document.getElementById('resizeHandle');
    let isResizing = false;

    if (resizeHandle) {
        resizeHandle.addEventListener('mousedown', function(e) {
            isResizing = true;
            document.body.style.userSelect = 'none'; // Prevent text selection during resize
            document.body.style.cursor = 'col-resize';
        });

        document.addEventListener('mousemove', function(e) {
            if (!isResizing) return;

            const appContainer = document.querySelector('.app-container');
            if (!appContainer) return;

            const containerRect = appContainer.getBoundingClientRect();
            const mouseX = e.clientX - containerRect.left;
            const containerWidth = containerRect.width;
            
            // Calculate new percentages
            const inputColumnPercent = (mouseX / containerWidth) * 100;
            
            // Set constraints (minimum 20%, maximum 80% for input column)
            const minInputWidth = 20;
            const maxInputWidth = 80;
            
            const constrainedInputPercent = Math.max(minInputWidth, Math.min(maxInputWidth, inputColumnPercent));
            const outputPercent = 100 - constrainedInputPercent;
            
            // Update CSS custom properties
            document.documentElement.style.setProperty('--input-column-width', `${constrainedInputPercent}%`);
            document.documentElement.style.setProperty('--output-column-width', `${outputPercent}%`);
        });

        document.addEventListener('mouseup', function() {
            if (isResizing) {
                isResizing = false;
                document.body.style.userSelect = '';
                document.body.style.cursor = '';
            }
        });

        // Handle case where mouse leaves the window while resizing
        document.addEventListener('mouseleave', function() {
            if (isResizing) {
                isResizing = false;
                document.body.style.userSelect = '';
                document.body.style.cursor = '';
            }
        });
    }

    // Mode switching functionality
    const courseFinderMode = document.getElementById('course-finder-mode');
    const scheduleBuilderMode = document.getElementById('schedule-builder-mode');
    const courseFinderCard = document.getElementById('course-finder-card');
    const scheduleBuilderCard = document.getElementById('schedule-builder-card');
    const scheduleBuilderForm = document.getElementById('scheduleBuilderForm');

    // Initialize schedule year field
    const scheduleYearInput = document.getElementById('scheduleYear');
    if (scheduleYearInput) {
        scheduleYearInput.value = new Date().getFullYear();
    }

    // Handle mode switching
    function switchMode() {
        if (courseFinderMode && scheduleBuilderMode && courseFinderCard && scheduleBuilderCard) {
            if (courseFinderMode.checked) {
                courseFinderCard.classList.remove('d-none');
                scheduleBuilderCard.classList.add('d-none');
                // Update page title
                document.querySelector('h1').textContent = 'DegreeWorks Course Finder';
                document.querySelector('.lead').textContent = 'Find available sections for your required courses.';
                
                // Restore cached results if available
                if (cachedSearchResults && cachedSearchParams) {
                    // Show a brief message that results are being restored
                    if (progressLogDisplay) {
                        progressLogDisplay.innerHTML = `
                            <div class="alert alert-info alert-dismissible fade show" role="alert">
                                <i class="fas fa-history me-2"></i>
                                Restoring your previous search results...
                                <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
                            </div>
                        `;
                        progressLogDisplay.classList.remove('d-none');
                    }
                    
                    // Restore results with a slight delay to show the message
                    setTimeout(() => {
                        // Update form fields and global variables to match cached search parameters
                        if (yearInput) yearInput.value = cachedSearchParams.year;
                        if (quarterSelect) quarterSelect.value = cachedSearchParams.quarter;
                        currentYear = cachedSearchParams.year;
                        currentQuarter = cachedSearchParams.quarter;
                        
                        displayFinalResultsAndAnimate(cachedSearchResults, cachedSearchParams.year, cachedSearchParams.quarter, true);
                    }, 100);
                } else {
                    // Only hide results if no cached results exist
                    if (resultsDisplay) {
                        resultsDisplay.classList.add('d-none');
                    }
                }
            } else if (scheduleBuilderMode.checked) {
                courseFinderCard.classList.add('d-none');
                scheduleBuilderCard.classList.remove('d-none');
                // Update page title
                document.querySelector('h1').textContent = 'Smart Schedule Builder';
                document.querySelector('.lead').textContent = 'Build optimized schedules that fit your preferences.';
                
                // Restore cached schedule results if available
                if (cachedScheduleResults) {
                    // Show a brief message that schedule results are being restored
                    if (progressLogDisplay) {
                        progressLogDisplay.innerHTML = `
                            <div class="alert alert-success alert-dismissible fade show" role="alert">
                                <i class="fas fa-history me-2"></i>
                                Restoring your generated schedules...
                                <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
                            </div>
                        `;
                        progressLogDisplay.classList.remove('d-none');
                    }
                    
                    // Restore schedule results with a slight delay to show the message
                    setTimeout(() => {
                        displayScheduleResults(cachedScheduleResults);
                    }, 100);
                } else {
                    // Hide course finder results when in schedule builder mode and no cached schedules
                    if (resultsDisplay) {
                        resultsDisplay.classList.add('d-none');
                    }
                }
            }
            
            // Always clear progress display when switching modes
            if (progressLogDisplay) {
                progressLogDisplay.innerHTML = '';
            }
        }
    }

    // Add event listeners for mode switching
    if (courseFinderMode) {
        courseFinderMode.addEventListener('change', switchMode);
    }
    if (scheduleBuilderMode) {
        scheduleBuilderMode.addEventListener('change', switchMode);
    }

    // Course Selection Management
    let selectedCourses = new Set();
    const cartIconContainer = document.getElementById('cartIconContainer');
    const cartIconBtn = document.getElementById('cartIconBtn');
    const cartBadge = document.getElementById('cartBadge');
    const cartOverlay = document.getElementById('cartOverlay');
    const cartPopupBody = document.getElementById('cartPopupBody');
    const cartCloseBtn = document.getElementById('cartCloseBtn');
    const buildScheduleFromCart = document.getElementById('buildScheduleFromCart');
    const scheduleBuilderCoursesList = document.getElementById('scheduleBuilderCoursesList');

    // Function to toggle course selection
    window.toggleCourseSelection = function(courseName, buttonElement) {
        console.log('toggleCourseSelection called with courseName:', courseName, 'button:', buttonElement);
        if (selectedCourses.has(courseName)) {
            // Remove from selection
            selectedCourses.delete(courseName);
            buttonElement.innerHTML = '<i class="fas fa-plus me-1"></i>Select';
            buttonElement.className = 'btn btn-outline-success btn-sm me-2 select-course-btn';
            buttonElement.title = 'Add to Schedule Builder';
        } else {
            // Add to selection
            selectedCourses.add(courseName);
            buttonElement.innerHTML = '<i class="fas fa-check me-1"></i>Selected';
            buttonElement.className = 'btn btn-success btn-sm me-2 select-course-btn';
            buttonElement.title = 'Remove from Schedule Builder';
        }
        
        updateSelectedCoursesDisplay();
    };

    // Function to remove course from selection (from cart)
    window.removeCourseFromSelection = function(courseName) {
        selectedCourses.delete(courseName);
        
        // Update all select buttons for this course
        const selectButtons = document.querySelectorAll(`[data-course="${courseName}"]`);
        selectButtons.forEach(button => {
            button.innerHTML = '<i class="fas fa-plus me-1"></i>Select';
            button.className = 'btn btn-outline-success btn-sm me-2 select-course-btn';
            button.title = 'Add to Schedule Builder';
        });
        
        updateSelectedCoursesDisplay();
    };

    // Function to update the selected courses display
    function updateSelectedCoursesDisplay() {
        console.log('updateSelectedCoursesDisplay called, selectedCourses:', Array.from(selectedCourses));
        const count = selectedCourses.size;
        
        // Update cart badge
        if (cartBadge) {
            cartBadge.textContent = count;
            console.log('Updated cart badge to:', count);
        } else {
            console.log('cartBadge element not found');
        }
        
        // Always show cart icon and add/remove empty class for animation
        if (cartIconContainer) {
            cartIconContainer.classList.remove('d-none');
            if (count === 0) {
                cartIconContainer.classList.add('empty');
            } else {
                cartIconContainer.classList.remove('empty');
            }
            console.log('Cart icon is always visible, count:', count);
        } else {
            console.log('cartIconContainer element not found');
        }
        
        // Update cart popup contents
        if (cartPopupBody) {
            if (count === 0) {
                cartPopupBody.innerHTML = `
                    <div class="cart-empty-state">
                        <i class="fas fa-shopping-cart"></i>
                        <p class="mb-0">No courses selected yet</p>
                        <small class="text-muted">Use the "Select" buttons on courses to add them here</small>
                    </div>
                `;
            } else {
                const courseItems = Array.from(selectedCourses).map(course => `
                    <div class="cart-course-item">
                        <div class="cart-course-name">${course}</div>
                        <button class="btn btn-outline-danger btn-sm cart-remove-btn" 
                                onclick="removeCourseFromSelection('${course}')"
                                title="Remove course">
                            <i class="fas fa-times me-1"></i>Remove
                        </button>
                    </div>
                `).join('');
                cartPopupBody.innerHTML = courseItems;
            }
        }
        
        // Enable/disable build schedule button
        if (buildScheduleFromCart) {
            buildScheduleFromCart.disabled = count === 0;
        }
        
        // Update schedule builder courses list
        updateScheduleBuilderCoursesList();
    }

    // Function to update the schedule builder courses list
    function updateScheduleBuilderCoursesList() {
        if (!scheduleBuilderCoursesList) return;
        
        const count = selectedCourses.size;
        
        if (count === 0) {
            scheduleBuilderCoursesList.innerHTML = `
                <p class="mb-0">
                    <i class="fas fa-info-circle me-2"></i>
                    Use the Course Finder to search and select courses, then return here to build your schedule.
                </p>
            `;
            scheduleBuilderCoursesList.className = 'alert alert-info';
        } else {
            const courseList = Array.from(selectedCourses).join(', ');
            scheduleBuilderCoursesList.innerHTML = `
                <div class="d-flex justify-content-between align-items-center">
                    <div>
                        <strong>${count} course${count !== 1 ? 's' : ''} selected:</strong>
                        <br><small>${courseList}</small>
                    </div>
                    <button class="btn btn-outline-primary btn-sm" onclick="switchToCourseFinderMode()">
                        <i class="fas fa-edit me-1"></i>Edit
                    </button>
                </div>
            `;
            scheduleBuilderCoursesList.className = 'alert alert-success';
        }
    }

    // Initialize cart display after functions are defined
    updateSelectedCoursesDisplay();

    // Function to switch to course finder mode
    window.switchToCourseFinderMode = function() {
        if (courseFinderMode) {
            courseFinderMode.checked = true;
            switchMode();
        }
    };

    // Make toggleScheduleView available globally
    window.toggleScheduleView = function(scheduleIndex, viewType) {
        const listView = document.getElementById(`schedule-list-${scheduleIndex}`);
        const calendarView = document.getElementById(`calendar-${scheduleIndex}`);
        const listBtn = document.querySelector(`[data-schedule="${scheduleIndex}"][data-view="list"]`);
        const calendarBtn = document.querySelector(`[data-schedule="${scheduleIndex}"][data-view="calendar"]`);

        if (viewType === 'calendar') {
            if (listView) listView.style.display = 'none';
            if (calendarView) calendarView.style.display = 'block';
            if (listBtn) listBtn.classList.remove('active');
            if (calendarBtn) calendarBtn.classList.add('active');
        } else {
            if (listView) listView.style.display = 'block';
            if (calendarView) calendarView.style.display = 'none';
            if (listBtn) listBtn.classList.add('active');
            if (calendarBtn) calendarBtn.classList.remove('active');
        }
    };

    // Cart popup event listeners
    if (cartIconBtn) {
        cartIconBtn.addEventListener('click', function() {
            if (cartOverlay) {
                cartOverlay.classList.remove('d-none');
                // Prevent body scroll when popup is open
                document.body.style.overflow = 'hidden';
            }
        });
    }

    if (cartCloseBtn) {
        cartCloseBtn.addEventListener('click', function() {
            closeCartPopup();
        });
    }

    // Close popup when clicking outside
    if (cartOverlay) {
        cartOverlay.addEventListener('click', function(e) {
            if (e.target === cartOverlay) {
                closeCartPopup();
            }
        });
    }

    // Function to close cart popup
    function closeCartPopup() {
        if (cartOverlay) {
            cartOverlay.classList.add('d-none');
            // Restore body scroll
            document.body.style.overflow = '';
        }
    }

    // Close popup with Escape key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && cartOverlay && !cartOverlay.classList.contains('d-none')) {
            closeCartPopup();
        }
    });

    // Handle build schedule from cart
    if (buildScheduleFromCart) {
        buildScheduleFromCart.addEventListener('click', function() {
            if (selectedCourses.size === 0) {
                showAlert('Please select at least one course first.', 'warning');
                return;
            }
            
            // Close cart popup first
            closeCartPopup();
            
            // Switch to schedule builder mode
            if (scheduleBuilderMode) {
                scheduleBuilderMode.checked = true;
                switchMode();
            }
            
            // Scroll to schedule builder form
            setTimeout(() => {
                const scheduleBuilderCard = document.getElementById('schedule-builder-card');
                if (scheduleBuilderCard) {
                    scheduleBuilderCard.scrollIntoView({ behavior: 'smooth' });
                }
            }, 100);
        });
    }

    // Handle schedule builder form submission
    if (scheduleBuilderForm) {
        scheduleBuilderForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            // Keep cached course finder results - don't clear them when building schedules
            // Users should be able to return to their search results after building schedules
            
            // Clear previous results
            if (resultsDisplay) {
                resultsDisplay.classList.add('d-none');
            }
            if (progressLogDisplay) {
                progressLogDisplay.innerHTML = '';
            }

            // Show progress log
            if (progressLogDisplay) {
                progressLogDisplay.style.display = 'block';
            }

            // Prepare form data using selected courses
            const selectedCoursesArray = Array.from(selectedCourses);
            const formData = {
                required_courses: selectedCoursesArray.join(', '),
                preferred_courses: '', // For now, all selected courses are required
                year: document.getElementById('scheduleYear').value,
                quarter: document.getElementById('scheduleQuarter').value,
                earliest_time: document.getElementById('earliestTime').value,
                latest_time: document.getElementById('latestTime').value,
                schedule_style: document.getElementById('scheduleStyle').value,
                max_schedules: document.getElementById('maxSchedules').value
            };

            // Basic validation
            if (selectedCoursesArray.length === 0) {
                showAlert('Please select at least one course using the Course Finder first.', 'warning');
                return;
            }

            if (!formData.year || !formData.quarter) {
                showAlert('Please select both year and quarter.', 'warning');
                return;
            }

            // Show loading message
            if (progressLogDisplay) {
                progressLogDisplay.innerHTML = `
                    <div class="progress-item">
                        <div class="spinner-border spinner-border-sm me-2" role="status">
                            <span class="visually-hidden">Loading...</span>
                        </div>
                        <span>Building your smart schedule...</span>
                    </div>
                `;
            }

            // Make API call to build schedule
            fetch(`${BACKEND_API_BASE_URL}/build_schedule`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(formData)
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    displayScheduleResults(data.schedules);
                } else {
                    showAlert(data.error || 'Failed to build schedule. Please try again.', 'danger');
                }
            })
            .catch(error => {
                console.error('Error:', error);
                showAlert('An error occurred while building your schedule. Please try again.', 'danger');
            })
            .finally(() => {
                // Hide loading spinner
                if (progressLogDisplay) {
                    progressLogDisplay.innerHTML = '';
                }
            });
        });
    }

    // Function to display schedule results
    function displayScheduleResults(schedules) {
        if (!schedules || schedules.length === 0) {
            showAlert('No valid schedules could be generated with your constraints. Try relaxing some preferences.', 'info');
            return;
        }

        // Cache the schedule results
        cachedScheduleResults = schedules;

        // Show results display
        if (resultsDisplay) {
            resultsDisplay.classList.remove('d-none');
            
            // Clear existing schedule content but preserve course finder content
            const existingContent = resultsDisplay.querySelector('.schedule-results');
            if (existingContent) {
                existingContent.remove();
            }
            
            // Hide course finder tabs when showing schedule results
            const filterTabsContainer = resultsDisplay.querySelector('.filter-controls-container');
            const tabContent = resultsDisplay.querySelector('#filterTabContent');
            if (filterTabsContainer) filterTabsContainer.style.display = 'none';
            if (tabContent) tabContent.style.display = 'none';

            // Create schedule results container
            const scheduleContainer = document.createElement('div');
            scheduleContainer.className = 'schedule-results';
            
            // Add header
            const header = document.createElement('div');
            header.className = 'text-center mb-4';
            header.innerHTML = `
                <h3><i class="fas fa-calendar-alt me-2"></i>Generated Schedules</h3>
                <p class="text-muted">Found ${schedules.length} optimal schedule${schedules.length !== 1 ? 's' : ''} for you!</p>
            `;
            scheduleContainer.appendChild(header);

            // Display each schedule
            schedules.forEach((schedule, index) => {
                const scheduleCard = createScheduleCard(schedule, index + 1);
                scheduleContainer.appendChild(scheduleCard);
            });

            // Insert the schedule results
            const firstChild = resultsDisplay.firstElementChild;
            if (firstChild) {
                resultsDisplay.insertBefore(scheduleContainer, firstChild);
            } else {
                resultsDisplay.appendChild(scheduleContainer);
            }
        }
    }

    // Course color mapping for calendar
    const courseColors = {};
    let colorIndex = 0;

    function getCourseColor(courseName) {
        if (!courseColors[courseName]) {
            courseColors[courseName] = `course-color-${(colorIndex % 10) + 1}`;
            colorIndex++;
        }
        return courseColors[courseName];
    }

    // Function to parse time string to minutes
    function parseTimeToMinutes(timeStr) {
        if (!timeStr) return 0;
        
        try {
            // Handle various time formats
            let cleanTime = timeStr.trim().replace(/\s+/g, '');
            
            // Handle AM/PM format
            if (cleanTime.match(/\d+:?\d*[ap]m?$/i)) {
                let match = cleanTime.match(/(\d+):?(\d*)([ap])m?$/i);
                if (match) {
                    let hours = parseInt(match[1]);
                    let minutes = match[2] ? parseInt(match[2]) : 0;
                    let period = match[3].toLowerCase();
                    
                    if (period === 'p' && hours !== 12) hours += 12;
                    if (period === 'a' && hours === 12) hours = 0;
                    
                    return hours * 60 + minutes;
                }
            }
            
            // Handle 24-hour format
            if (cleanTime.match(/^\d{1,2}:?\d{2}$/)) {
                let parts = cleanTime.split(':');
                if (parts.length === 2) {
                    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
                }
            }
            
            return 0;
        } catch (e) {
            console.warn('Error parsing time:', timeStr, e);
            return 0;
        }
    }

    // Function to format minutes to time string  
    function formatMinutesToTime(minutes) {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        const period = hours >= 12 ? 'PM' : 'AM';
        const displayHours = hours > 12 ? hours - 12 : (hours === 0 ? 12 : hours);
        return `${displayHours}:${mins.toString().padStart(2, '0')} ${period}`;
    }

    // Function to get day abbreviation
    function getDayAbbrev(day) {
        const dayMap = {
            'Monday': 'Mon', 'Tuesday': 'Tue', 'Wednesday': 'Wed',
            'Thursday': 'Thu', 'Friday': 'Fri', 'Saturday': 'Sat', 'Sunday': 'Sun'
        };
        return dayMap[day] || day;
    }

    // Function to create calendar view
    function createCalendarView(schedule, scheduleIndex) {
        const calendarContainer = document.createElement('div');
        calendarContainer.className = 'calendar-container';
        calendarContainer.id = `calendar-${scheduleIndex}`;
        calendarContainer.style.display = 'none'; // Hidden by default

        // Create calendar header
        const header = document.createElement('div');
        header.className = 'calendar-header';
        header.innerHTML = `Weekly Schedule - Option ${scheduleIndex}`;
        calendarContainer.appendChild(header);

        // Create calendar grid
        const grid = document.createElement('div');
        grid.className = 'calendar-grid';

        // Time slots (7 AM to 9 PM)
        const startHour = 7;
        const endHour = 21;
        
        // Days of week
        const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        
        // Add time header (empty corner)
        const timeHeader = document.createElement('div');
        timeHeader.className = 'calendar-time-header';
        grid.appendChild(timeHeader);
        
        // Add day headers
        days.forEach(day => {
            const dayHeader = document.createElement('div');
            dayHeader.className = 'calendar-day-header';
            dayHeader.textContent = getDayAbbrev(day);
            grid.appendChild(dayHeader);
        });

        // Process schedule events
        const events = [];
        const courseColorMap = {};
        let currentColorIndex = 0;

        schedule.sections.forEach(section => {
            const courseName = section.course || 'Unknown';
            if (!courseColorMap[courseName]) {
                courseColorMap[courseName] = `course-color-${(currentColorIndex % 10) + 1}`;
                currentColorIndex++;
            }

            if (section.meetings && section.meetings.length > 0) {
                section.meetings.forEach(meeting => {
                    if (meeting.days && meeting.start_time && meeting.end_time) {
                        meeting.days.forEach(day => {
                            const startMinutes = parseTimeToMinutes(meeting.start_time);
                            const endMinutes = parseTimeToMinutes(meeting.end_time);
                            
                            if (startMinutes >= startHour * 60 && endMinutes <= endHour * 60) {
                                events.push({
                                    day: day,
                                    startMinutes: startMinutes,
                                    endMinutes: endMinutes,
                                    title: `${courseName} ${section.type}`,
                                    details: `${section.code} • ${section.instructor}`,
                                    location: meeting.building && meeting.room ? `${meeting.building} ${meeting.room}` : '',
                                    color: courseColorMap[courseName],
                                    section: section
                                });
                            }
                        });
                    }
                });
            }
        });

        // Create time slots and cells
        for (let hour = startHour; hour < endHour; hour++) {
            // Time slot label
            const timeSlot = document.createElement('div');
            timeSlot.className = 'calendar-time-slot';
            timeSlot.textContent = formatMinutesToTime(hour * 60);
            grid.appendChild(timeSlot);

            // Day cells for this hour
            days.forEach((day, dayIndex) => {
                const cell = document.createElement('div');
                cell.className = 'calendar-cell';
                cell.dataset.day = day;
                cell.dataset.hour = hour;

                // Find events for this day and hour
                const dayEvents = events.filter(event => 
                    event.day === day && 
                    event.startMinutes < (hour + 1) * 60 && 
                    event.endMinutes > hour * 60
                );

                dayEvents.forEach(event => {
                    // Only create event element if this is the starting hour
                    if (Math.floor(event.startMinutes / 60) === hour) {
                        const eventElement = document.createElement('div');
                        eventElement.className = `calendar-event ${event.color}`;
                        
                        // Calculate position and height
                        const startOffset = ((event.startMinutes % 60) / 60) * 100;
                        const duration = event.endMinutes - event.startMinutes;
                        const heightPercent = (duration / 60) * 100;
                        
                        eventElement.style.top = `${startOffset}%`;
                        eventElement.style.height = `${Math.min(heightPercent, 100 - startOffset)}%`;
                        
                        eventElement.innerHTML = `
                            <div class="calendar-event-title">${event.title}</div>
                            <div class="calendar-event-details">${event.details}</div>
                        `;

                        // Add tooltip functionality
                        eventElement.addEventListener('mouseenter', function(e) {
                            showEventTooltip(e, event);
                        });
                        
                        eventElement.addEventListener('mouseleave', function() {
                            hideEventTooltip();
                        });

                        cell.appendChild(eventElement);
                    }
                });

                grid.appendChild(cell);
            });
        }

        calendarContainer.appendChild(grid);

        // Add legend
        if (Object.keys(courseColorMap).length > 0) {
            const legend = document.createElement('div');
            legend.className = 'calendar-legend';
            
            const legendTitle = document.createElement('div');
            legendTitle.className = 'calendar-legend-title';
            legendTitle.textContent = 'Course Colors';
            legend.appendChild(legendTitle);
            
            const legendItems = document.createElement('div');
            legendItems.className = 'calendar-legend-items';
            
            Object.entries(courseColorMap).forEach(([courseName, colorClass]) => {
                const item = document.createElement('div');
                item.className = 'calendar-legend-item';
                
                const colorBox = document.createElement('div');
                colorBox.className = `calendar-legend-color ${colorClass}`;
                
                item.appendChild(colorBox);
                item.appendChild(document.createTextNode(courseName));
                legendItems.appendChild(item);
            });
            
            legend.appendChild(legendItems);
            calendarContainer.appendChild(legend);
        }

        return calendarContainer;
    }

    // Event tooltip functions
    let currentTooltip = null;

    function showEventTooltip(e, event) {
        hideEventTooltip(); // Remove any existing tooltip
        
        const tooltip = document.createElement('div');
        tooltip.className = 'calendar-event-tooltip show';
        
        const timeStr = `${formatMinutesToTime(event.startMinutes)} - ${formatMinutesToTime(event.endMinutes)}`;
        tooltip.innerHTML = `
            <strong>${event.title}</strong><br>
            ${timeStr}<br>
            ${event.details}
            ${event.location ? `<br>${event.location}` : ''}
        `;
        
        document.body.appendChild(tooltip);
        
        // Position tooltip
        const rect = e.target.getBoundingClientRect();
        tooltip.style.left = `${rect.left + rect.width / 2}px`;
        tooltip.style.top = `${rect.top - tooltip.offsetHeight - 5}px`;
        
        // Adjust if tooltip goes off screen
        const tooltipRect = tooltip.getBoundingClientRect();
        if (tooltipRect.right > window.innerWidth) {
            tooltip.style.left = `${window.innerWidth - tooltipRect.width - 10}px`;
        }
        if (tooltipRect.left < 0) {
            tooltip.style.left = '10px';
        }
        if (tooltipRect.top < 0) {
            tooltip.style.top = `${rect.bottom + 5}px`;
        }
        
        currentTooltip = tooltip;
    }

    function hideEventTooltip() {
        if (currentTooltip) {
            currentTooltip.remove();
            currentTooltip = null;
        }
    }



    // Function to create a schedule card
    function createScheduleCard(schedule, index) {
        const card = document.createElement('div');
        card.className = 'card mb-3';
        
        const scoreColor = schedule.score >= 80 ? 'success' : schedule.score >= 60 ? 'warning' : 'secondary';
        
        // Create view toggle controls
        const viewControls = document.createElement('div');
        viewControls.className = 'schedule-view-controls';
        viewControls.innerHTML = `
            <div class="btn-group" role="group">
                <button type="button" class="btn btn-outline-primary view-toggle-btn active" 
                        data-schedule="${index}" data-view="list"
                        onclick="toggleScheduleView(${index}, 'list')">
                    <i class="fas fa-list me-1"></i>List View
                </button>
                <button type="button" class="btn btn-outline-primary view-toggle-btn" 
                        data-schedule="${index}" data-view="calendar"
                        onclick="toggleScheduleView(${index}, 'calendar')">
                    <i class="fas fa-calendar me-1"></i>Calendar View
                </button>
            </div>
        `;

        // Create list view (original content)
        const listView = document.createElement('div');
        listView.id = `schedule-list-${index}`;
        listView.innerHTML = `
            <div class="card-header d-flex justify-content-between align-items-center">
                <h5 class="mb-0">
                    <i class="fas fa-trophy me-2"></i>Schedule Option ${index}
                    <span class="badge bg-${scoreColor} ms-2">Score: ${Math.round(schedule.score || 0)}</span>
                </h5>
                <div class="schedule-stats">
                    <small class="text-muted">
                        ${schedule.total_units || 0} units • 
                        ${schedule.days_on_campus || 0} days • 
                        ${schedule.earliest_class || 'N/A'} - ${schedule.latest_class || 'N/A'}
                    </small>
                </div>
            </div>
            <div class="card-body">
                <div class="row">
                    <div class="col-md-8">
                        <div class="schedule-sections">
                            ${schedule.sections.map(section => `
                                <div class="section-item mb-2 p-2 border rounded">
                                    <div class="d-flex justify-content-between align-items-start">
                                        <div>
                                            <strong>${section.course || 'N/A'}</strong>
                                            <span class="badge bg-secondary ms-2">${section.type || 'N/A'}</span>
                                            <small class="text-muted ms-2">(${section.code || 'N/A'})</small>
                                        </div>
                                        <span class="badge bg-${section.status === 'OPEN' ? 'success' : section.status === 'Waitl' ? 'warning' : 'danger'}">
                                            ${section.status || 'Unknown'}
                                        </span>
                                    </div>
                                    <div class="text-muted small mt-1">
                                        <div><i class="fas fa-user me-1"></i>${section.instructor || 'TBA'}</div>
                                        <div><i class="fas fa-clock me-1"></i>${section.meetings && section.meetings.length > 0 ? section.meetings.map(m => m.formatted || 'TBA').join(', ') : 'TBA'}</div>
                                        <div><i class="fas fa-weight me-1"></i>${section.units || 0} units</div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    <div class="col-md-4">
                        <div class="schedule-summary">
                            <h6><i class="fas fa-info-circle me-2"></i>Summary</h6>
                            <p class="small text-muted">${schedule.summary || 'Schedule summary'}</p>
                            
                            <div class="mt-3">
                                <button class="btn btn-outline-success btn-sm w-100">
                                    <i class="fas fa-heart me-2"></i>Save Schedule
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Create calendar view
        const calendarView = createCalendarView(schedule, index);

        // Assemble the card
        card.appendChild(viewControls);
        card.appendChild(listView);
        card.appendChild(calendarView);
        
        return card;
    }

});
