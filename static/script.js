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
    
    const allCoursesPane = resultsDisplay.querySelector('#all-courses');
    const availableCoursesPane = resultsDisplay.querySelector('#available-courses');
    const unavailableCoursesPane = resultsDisplay.querySelector('#unavailable-courses');
    
    const filterTabs = resultsDisplay.querySelector('#filterTabs');
    const expandAllBtn = resultsDisplay.querySelector('#expandAllBtn');
    const collapseAllBtn = resultsDisplay.querySelector('#collapseAllBtn');

    let eventSource = null;
    let currentAbortController = null;
    let currentReader = null;
    let currentYear = '';
    let currentQuarter = '';

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
        courseCard.className = `card course-card ${isAvailable ? 'course-card-available' : ''}`; 
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
            <span class="course-title-container">
                ${courseTitleText}
                ${antAlmanacIconLink}
            </span>
            <i class="fas fa-chevron-down collapse-arrow"></i>
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

    function displayFinalResultsAndAnimate(finalResults, year, quarter) {
        if (progressLogDisplay) progressLogDisplay.classList.add('d-none');
        if (resultsDisplay) resultsDisplay.classList.remove('d-none');

        if (!allCoursesPane || !availableCoursesPane || !unavailableCoursesPane) {
             console.error("One or more result pane elements not found for final display.");
             return;
        }

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

                const allCard = createCourseCard(course, allIdPrefix, year, quarter);
                if (allCard) {
                     allCoursesPane.appendChild(allCard);
                }

                const isAvailable = isCourseAvailable(course);
                if (isAvailable) {
                    const availableCard = createCourseCard(course, availIdPrefix, year, quarter);
                    if (availableCard) {
                        availableCoursesPane.appendChild(availableCard);
                        availableCount++;
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
            if (unavailableCount === 0) unavailableCoursesPane.innerHTML = '<p class="empty-tab-message">No unavailable courses found.</p>';
            if (allCoursesPane.childElementCount === 0 && finalResults.length > 0) {
                 allCoursesPane.innerHTML = '<p class="empty-tab-message">Could not display any courses in the "All" tab.</p>';
            } else if (allCoursesPane.childElementCount === 0 && finalResults.length === 0 ) { 
                allCoursesPane.innerHTML = defaultEmptyMessage;
            }

            setTimeout(() => {
                const panesToAnimate = [allCoursesPane, availableCoursesPane, unavailableCoursesPane];
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
            
            clearAlert();
            bodyElement.classList.remove('initial-view');
            
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
                // Update to use Netlify function
                const response = await fetch('/.netlify/functions/stream_process', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        input_text: inputText,
                        year: year,
                        quarter: quarter
                    })
                });

                if (!response.ok) {
                    let errorText = 'Server error occurred';
                    try {
                        const errorData = await response.json();
                        errorText = errorData.message || errorText;
                    } catch (e) {
                        console.error('Error parsing error response:', e);
                    }
                    throw new Error(errorText);
                }

                // Process the JSON response (instead of event stream)
                const data = await response.json();
                
                if (data.type === 'error') {
                    throw new Error(data.message);
                } else if (data.type === 'complete') {
                    // Update progress to 100%
                    const progressBar = progressLogDisplay.querySelector('.progress-bar');
                    const progressText = progressLogDisplay.querySelector('.current-progress-text');
                    if (progressBar) progressBar.style.width = '100%';
                    if (progressText) progressText.textContent = 'Search complete!';
                    
                    // Display results
                    displayFinalResultsAndAnimate(data.results, year, quarter);
                }
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

});
