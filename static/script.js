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
        courseForm.addEventListener('submit', (e) => {
            e.preventDefault();
            clearAlert();
            cancelOngoingSearch();

            bodyElement.classList.remove('initial-view');
            bodyElement.classList.add('search-view');

            if (progressLogDisplay) {
                progressLogDisplay.innerHTML = '';
                progressLogDisplay.classList.remove('d-none');
                const initialLogEntry = document.createElement('div');
                initialLogEntry.textContent = 'Initiating search...';
                progressLogDisplay.appendChild(initialLogEntry);
                progressLogDisplay.scrollTop = progressLogDisplay.scrollHeight;
            }
            if (resultsDisplay) resultsDisplay.classList.add('d-none');

            currentYear = yearInput ? yearInput.value : '';
            currentQuarter = quarterSelect ? quarterSelect.value : '';
            const inputTextElement = document.getElementById('inputText');
            const formData = {
                input_text: inputTextElement ? inputTextElement.value.trim() : '',
                year: currentYear,
                quarter: currentQuarter
            };

            if (!formData.input_text || !formData.year || !formData.quarter) {
                showAlert('Please fill in all fields.');
                bodyElement.classList.remove('search-view'); 
                bodyElement.classList.add('initial-view');
                if(progressLogDisplay) progressLogDisplay.classList.add('d-none');
                return;
            }
            if (!/^\d{4}$/.test(formData.year)) {
                showAlert('Please enter a valid 4-digit year.');
                bodyElement.classList.remove('search-view'); 
                bodyElement.classList.add('initial-view');
                if(progressLogDisplay) progressLogDisplay.classList.add('d-none');
                return;
            }

            currentAbortController = new AbortController();
            fetch('/stream_process', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
                body: JSON.stringify(formData),
                signal: currentAbortController.signal
            })
            .then(response => {
                if (!response.ok) throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
                if (!response.body) throw new Error("Response doesn't contain a readable stream.");
                
                const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
                currentReader = reader;
                let accumulatedData = '';

                function processStream({ done, value }) {
                    if (currentReader !== reader) {
                        console.log("Reader is no longer current, stopping processing");
                        reader.cancel("Superseded by newer search").catch(err => console.warn("Error cancelling superseded reader:", err));
                        return;
                    }
                    
                    if (value) accumulatedData += value;

                    let boundary = accumulatedData.indexOf('\n\n');
                    while (boundary >= 0) {
                        const message = accumulatedData.substring(0, boundary).trim();
                        accumulatedData = accumulatedData.substring(boundary + 2);
                        if (message.startsWith('event: keepalive')) {
                            console.log("Received keepalive event, connection is healthy");
                            const dataIndex = accumulatedData.indexOf('data:');
                            if (dataIndex === 0) {
                                const dataEnd = accumulatedData.indexOf('\n\n');
                                if (dataEnd > 0) {
                                    const pingData = accumulatedData.substring(5, dataEnd).trim();
                                    console.log("Keepalive ping data:", pingData);
                                    accumulatedData = accumulatedData.substring(dataEnd + 2);
                                }
                            }
                        } else if (message.startsWith('data:')) {
                            const jsonData = message.substring(5).trim();
                            try {
                                const eventData = JSON.parse(jsonData);
                                if (eventData.type === 'progress' || eventData.type === 'log') {
                                    if(progressLogDisplay && eventData.message) {
                                         const logEntry = document.createElement('div');
                                         logEntry.textContent = eventData.message;
                                         if (progressLogDisplay.children.length === 1 && progressLogDisplay.firstChild.textContent === 'Initiating search...') {
                                            progressLogDisplay.innerHTML = '';
                                         }
                                         progressLogDisplay.appendChild(logEntry);
                                         progressLogDisplay.scrollTop = progressLogDisplay.scrollHeight;
                                    }
                                } else if (eventData.type === 'complete') {
                                    console.log("Received 'complete' message.");
                                    if (currentReader === reader) currentReader = null;
                                    displayFinalResultsAndAnimate(eventData.results, currentYear, currentQuarter);
                                } else if (eventData.type === 'error') {
                                     console.error("Received error from server stream:", eventData.message);
                                     showAlert(`Server error: ${eventData.message}`, 'danger');
                                     if(progressLogDisplay) progressLogDisplay.classList.add('d-none');
                                     if (currentReader === reader) currentReader = null;
                                     reader.cancel("Server error received").catch(e => console.warn("Error cancelling reader on server error:", e));
                                     return; 
                                }
                            } catch (e) {
                                console.error("Error parsing SSE data:", e, "Raw data:", jsonData);
                            }
                        } else if (message.match(/^id:|^retry:/)) {
                            console.log("Received SSE field:", message);
                        } else if (message.trim() !== '') {
                            console.warn("Received unexpected SSE message format:", message);
                        }
                        boundary = accumulatedData.indexOf('\n\n');
                    }

                    if (done) {
                        console.log("Stream finished.");
                        if (currentReader === reader) currentReader = null;
                        if (resultsDisplay && resultsDisplay.classList.contains('d-none') && !alertArea.innerHTML.includes('Server error')) {
                             showAlert("The connection closed before processing completed. Please try again.", "warning");
                             if(progressLogDisplay) progressLogDisplay.classList.add('d-none');
                        }
                        return;
                    }
                    return reader.read().then(processStream);
                }
                return reader.read().then(processStream);
            })
            .catch(error => {
                if (error.name === 'AbortError') {
                    console.log('Fetch request was aborted.');
                    return; 
                }
                console.error('Error during fetch/stream processing:', error);
                showAlert(`An error occurred: ${error.message}`, 'danger');
                currentReader = null;
                currentAbortController = null;
                if(progressLogDisplay) progressLogDisplay.classList.add('d-none');
            });
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
