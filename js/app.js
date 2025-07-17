import { supabase } from './supabaseClient.js';

// --- DOM Elements ---
const loadingOverlay = document.getElementById('loading-overlay');
const logoutButton = document.getElementById('logout-button');
const onboardingView = document.getElementById('onboarding-view');
const dashboardView = document.getElementById('dashboard-view');
const setupForm = document.getElementById('setup-form');
const historicalDatePicker = document.getElementById('historical-date');
const attendanceSummary = document.getElementById('attendance-summary');
const dailyLogContainer = document.getElementById('daily-log-container');
const saveAttendanceContainer = document.getElementById('save-attendance-container');
const actionsSection = document.getElementById('actions-section');
const settingsSection = document.getElementById('settings-section');
const extraDayModal = document.getElementById('extra-day-modal');
const extraDayForm = document.getElementById('extra-day-form');
const customConfirmModal = document.getElementById('custom-confirm-modal');
const confirmModalText = document.getElementById('confirm-modal-text');
const confirmYesBtn = document.getElementById('confirm-yes-btn');
const confirmNoBtn = document.getElementById('confirm-no-btn');


// --- State ---
let currentUser = null;
let userProfile = null;
let attendanceLog = [];
let setupSubjects = []; 
let pendingChanges = new Map();
let isEditingMode = false;
let confirmResolve = null; // To handle promise-based confirmation

// --- Utility Functions ---

/**
 * Shows a loading overlay with a specific message.
 * @param {string} message - The message to display.
 */
const showLoading = (message = 'Loading...') => {
    const loadingText = document.getElementById('loading-text');
    loadingText.textContent = message;
    loadingOverlay.style.display = 'flex';
};

/**
 * Hides the loading overlay.
 */
const hideLoading = () => {
    loadingOverlay.style.display = 'none';
};

/**
 * Converts a date object or string to 'YYYY-MM-DD' format, correctly handling timezones.
 * @param {Date|string} dateInput - The date to format.
 * @returns {string} The date in YYYY-MM-DD format.
 */
const toYYYYMMDD = (dateInput) => {
    const date = new Date(dateInput);
    // Use UTC methods to avoid timezone-related errors, ensuring the date is consistent.
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

/**
 * Shows a custom confirmation dialog instead of the native browser `confirm()`.
 * @param {string} message - The question to ask the user.
 * @returns {Promise<boolean>} - A promise that resolves to true if 'Yes' is clicked, false otherwise.
 */
const showCustomConfirm = (message) => {
    confirmModalText.textContent = message;
    customConfirmModal.style.display = 'flex';
    return new Promise((resolve) => {
        confirmResolve = resolve;
    });
};


// --- Core Application Logic ---

/**
 * Main initialization function. Checks user session and fetches profile data.
 */
const init = async () => {
    showLoading('Initializing...');
    const { data: { session }, error } = await supabase.auth.getSession();
    
    if (error || !session) {
        window.location.href = '/index.html';
        return;
    }
    currentUser = session.user;

    // Fetch the profile for the CURRENTLY LOGGED IN user.
    const { data, error: profileError } = await supabase.from('profiles').select('*').eq('id', currentUser.id).single();

    if (profileError && profileError.code !== 'PGRST116') { // PGRST116 means no rows found
        hideLoading();
        console.error('Error fetching profile:', profileError);
        return;
    }

    if (data) {
        userProfile = data;
        await runFullAttendanceUpdate();
    } else {
        isEditingMode = false;
        renderOnboardingUI();
        onboardingView.style.display = 'block';
        dashboardView.style.display = 'none';
        hideLoading();
    }
};

/**
 * Orchestrates the full sequence of updating and rendering the dashboard.
 */
const runFullAttendanceUpdate = async () => {
    showLoading('Updating attendance records...');
    await populateAttendanceLog();
    
    showLoading('Loading your dashboard...');
    await loadFullAttendanceLog();
    
    renderDashboard();
    hideLoading();
};

/**
 * Renders the initial setup or "edit timetable" view.
 */
const renderOnboardingUI = () => {
    const subjectMasterListUI = document.getElementById('subject-master-list');
    const timetableBuilderGrid = document.getElementById('timetable-grid');
    if (!subjectMasterListUI || !timetableBuilderGrid) return;

    const setupTitle = document.getElementById('setup-title');
    const setupSubtitle = document.getElementById('setup-subtitle');
    const saveTimetableBtn = document.getElementById('save-timetable-btn');
    const startDateInput = document.getElementById('start-date');
    const minAttendanceInput = document.getElementById('min-attendance');

    if (isEditingMode) {
        setupTitle.textContent = "Edit Timetable";
        setupSubtitle.textContent = "Add or remove subjects and classes below. Your existing attendance will be preserved.";
        saveTimetableBtn.textContent = "Save Changes and Re-calculate";
        startDateInput.value = userProfile.start_date;
        minAttendanceInput.value = userProfile.attendance_threshold;
        startDateInput.disabled = true;
    } else {
        setupTitle.textContent = "Initial Setup";
        setupSubtitle.textContent = "Welcome! Please build your timetable below.";
        saveTimetableBtn.textContent = "Save and Build Dashboard";
        startDateInput.disabled = false;
    }

    subjectMasterListUI.innerHTML = setupSubjects.map((sub, index) => `
        <li class="flex justify-between items-center bg-gray-100 p-2 rounded-md">
            <span>${sub.name} (${sub.category})</span>
            <button type="button" data-index="${index}" class="remove-subject-btn text-red-500 hover:text-red-700 font-bold">X</button>
        </li>`).join('');

    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    timetableBuilderGrid.innerHTML = days.map(day => {
        const scheduledClasses = isEditingMode ? (userProfile.timetable_json[day] || []) : [];
        return `
            <div class="day-column bg-gray-50 p-3 rounded-lg">
                <h4 class="font-bold mb-2 text-center">${day}</h4>
                <div class="flex items-center gap-1 mb-2">
                    <select data-day="${day}" class="add-class-select flex-grow w-full pl-2 pr-7 py-1 text-sm bg-white border border-gray-300 rounded-md">
                        <option value="">-- select --</option>
                        ${setupSubjects.map(sub => `<option value="${sub.name} ${sub.category}">${sub.name} (${sub.category})</option>`).join('')}
                    </select>
                    <button type="button" data-day="${day}" class="add-class-btn bg-blue-500 text-white text-sm rounded-md h-7 w-7 flex-shrink-0">+</button>
                </div>
                <ul data-day="${day}" class="day-schedule-list space-y-1 min-h-[50px]">
                    ${scheduledClasses.map(cls => `
                        <li class="flex justify-between items-center bg-blue-100 text-blue-800 text-sm font-medium px-2 py-1 rounded" data-value="${cls}">
                            ${cls.replace(' Theory', ' (T)').replace(' Lab', ' (L)')}
                            <button type="button" class="remove-class-btn text-blue-500 hover:text-blue-700 font-bold ml-2">x</button>
                        </li>`).join('')}
                </ul>
            </div>`;
    }).join('');
};


/**
 * Populates the attendance log with entries from the last logged date up to today.
 */
const populateAttendanceLog = async () => {
    const today = new Date();
    const startDate = new Date(userProfile.start_date + 'T12:00:00Z');

    let currentDate;
    if (userProfile.last_log_date) {
        currentDate = new Date(userProfile.last_log_date + 'T12:00:00Z');
        currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    } else {
        currentDate = new Date(startDate);
    }
    
    if (currentDate > today) return;

    const newLogEntries = [];
    const todayStr = toYYYYMMDD(today);

    while (toYYYYMMDD(currentDate) <= todayStr) {
        const dayIndex = currentDate.getUTCDay();
        if (dayIndex >= 1 && dayIndex <= 5) {
            const dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dayIndex];
            const lecturesToday = userProfile.timetable_json[dayName] || [];
            const dateStr = toYYYYMMDD(currentDate);
            const isCurrentDay = dateStr === todayStr;
            const defaultStatus = isCurrentDay ? 'Not Held Yet' : 'Missed';

            for (const subjectString of lecturesToday) {
                const parts = subjectString.split(' ');
                const category = parts.pop();
                const subject_name = parts.join(' ');
                newLogEntries.push({ user_id: currentUser.id, date: dateStr, subject_name, category, status: defaultStatus });
            }
        }
        currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    }

    if (newLogEntries.length > 0) {
        await supabase.from('attendance_log').upsert(newLogEntries, { onConflict: 'user_id,date,subject_name,category' });
    }
    
    await supabase.from('profiles').update({ last_log_date: todayStr }).eq('id', currentUser.id);
};


/**
 * Fetches the complete attendance log for the user from the database.
 */
const loadFullAttendanceLog = async () => {
    const { data, error } = await supabase.from('attendance_log').select('*').eq('user_id', currentUser.id).order('date', { ascending: false });

    if (error) {
        console.error("Error fetching attendance log:", error);
        attendanceLog = [];
    } else {
        attendanceLog = data;
    }
};

/**
 * Renders the main dashboard view.
 */
const renderDashboard = () => {
    renderSummaryTable();
    const todayStr = toYYYYMMDD(new Date());
    historicalDatePicker.value = todayStr;
    renderScheduleForDate(todayStr);
    dashboardView.style.display = 'block';
    onboardingView.style.display = 'none';
};

/**
 * Checks if a subject should have its attendance weighted (e.g., labs counting double).
 * @param {string} subjectName - The name of the subject.
 * @returns {boolean} - True if the subject is double weighted.
 */
const isDoubleWeighted = (subjectName) => {
    // Example of hardcoded weighted subjects
    if (subjectName === 'DA' || subjectName === 'DSA') return true;
    // Example of dynamically checking if a lab exists for the subject
    for (const day in userProfile.timetable_json) {
        if (userProfile.timetable_json[day].some(lec => lec === `${subjectName} Lab`)) {
            return true;
        }
    }
    return false;
};

/**
 * Calculates bunking advice based on the user's formula.
 * @param {string} subjectName - The name of the subject.
 * @param {number} totalAttended - Total classes attended.
 * @param {number} totalHeld - Total classes held.
 * @returns {object} - An object with status and message.
 */
const calculateBunkingAssistant = (subjectName, totalAttended, totalHeld) => {
    const threshold = userProfile.attendance_threshold / 100;
    const minAttended = Math.ceil(totalHeld * threshold);
    if (totalAttended < minAttended) {
        return { status: 'danger', message: `Below ${userProfile.attendance_threshold}%. Attend all!` };
    }
    const bunksAvailable = totalAttended - minAttended;
    if (bunksAvailable >= 1) {
        return { status: 'safe', message: `Safe. You can miss ${bunksAvailable} more.` };
    }
    return { status: 'warning', message: `Risky. At ${userProfile.attendance_threshold}%. Cannot miss.` };
};

/**
 * Renders the main attendance summary table with updated logic.
 */
const renderSummaryTable = () => {
    const today = new Date();
    const startDate = new Date(userProfile.start_date + 'T12:00:00Z');

    // 1. Calculate the true "Held" count for every subject based on the schedule up to today.
    const heldCounts = {};
    if (startDate <= today) {
        let currentDate = new Date(startDate);
        while (currentDate <= today) {
            const dayIndex = currentDate.getUTCDay();
            if (dayIndex >= 1 && dayIndex <= 5) { // Monday to Friday
                const dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dayIndex];
                const lecturesToday = userProfile.timetable_json[dayName] || [];
                
                for (const subjectString of lecturesToday) {
                    const parts = subjectString.split(' ');
                    const category = parts.pop();
                    const subject_name = parts.join(' ');
                    
                    if (!heldCounts[subject_name]) heldCounts[subject_name] = { Theory: 0, Lab: 0 };
                    
                    const weight = isDoubleWeighted(subject_name) ? 2 : 1;
                    heldCounts[subject_name][category] += weight;
                }
            }
            currentDate.setUTCDate(currentDate.getUTCDate() + 1);
        }
    }

    // 2. Calculate the "Attended" count from the entire log.
    const attendedCounts = {};
    for (const log of attendanceLog) {
        if (log.status === 'Attended') {
            const subjectName = log.subject_name;
            if (!attendedCounts[subjectName]) attendedCounts[subjectName] = { Theory: 0, Lab: 0 };
            const weight = isDoubleWeighted(subjectName) ? 2 : 1;
            attendedCounts[subjectName][log.category] += weight;
        }
    }

    // 3. Build the table using the new stats
    let tableHTML = `<h3 class="text-xl font-bold text-gray-800 mb-4">Overall Summary</h3>
    <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 border border-gray-200">
            <thead class="bg-gray-50">
                <tr>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Subject</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                    <th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Attended</th>
                    <th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Held</th>
                    <th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Percentage</th>
                    <th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Bunking Assistant</th>
                </tr>
            </thead>
            <tbody class="bg-white divide-y divide-x divide-gray-200">`;
    
    if (!userProfile.unique_subjects || userProfile.unique_subjects.length === 0) {
        tableHTML += `<tr><td colspan="6" class="px-6 py-4 text-center text-gray-500">No subjects defined.</td></tr>`;
    } else {
        userProfile.unique_subjects.sort().forEach(subjectName => {
            let hasTheory = false, hasLab = false;
            for(const day in userProfile.timetable_json) {
                if (userProfile.timetable_json[day].includes(`${subjectName} Theory`)) hasTheory = true;
                if (userProfile.timetable_json[day].includes(`${subjectName} Lab`)) hasLab = true;
            }
            if (!hasTheory && !hasLab) return;

            const theoryHeld = heldCounts[subjectName]?.Theory || 0;
            const theoryAttended = attendedCounts[subjectName]?.Theory || 0;
            const labHeld = heldCounts[subjectName]?.Lab || 0;
            const labAttended = attendedCounts[subjectName]?.Lab || 0;

            const showCombinedRow = hasTheory && hasLab;
            
            if (hasTheory) {
                const percentage = theoryHeld > 0 ? ((theoryAttended / theoryHeld) * 100).toFixed(1) + '%' : '100.0%';
                const bunkingInfo = calculateBunkingAssistant(subjectName, theoryAttended, theoryHeld);
                const statusColorClass = bunkingInfo.status === 'safe' ? 'bg-green-100 text-green-800' : bunkingInfo.status === 'warning' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800';
                const bunkingCell = !showCombinedRow ? `<td class="px-6 py-4 text-sm text-center"><div class="p-2 rounded-md ${statusColorClass} inline-block min-w-[180px]">${bunkingInfo.message}</div></td>` : ``;
                tableHTML += `<tr class="${theoryHeld > 0 && ((theoryAttended / theoryHeld) * 100) < userProfile.attendance_threshold ? 'bg-red-50' : ''}">
                                <td class="px-6 py-4 whitespace-nowrap font-medium text-gray-900 text-left" rowspan="${showCombinedRow ? 2 : 1}">${subjectName}</td>
                                <td class="px-6 py-4 whitespace-nowrap text-gray-500 text-left">Theory</td>
                                <td class="px-6 py-4 whitespace-nowrap text-gray-500 text-center">${theoryAttended}</td>
                                <td class="px-6 py-4 whitespace-nowrap text-gray-500 text-center">${theoryHeld}</td>
                                <td class="px-6 py-4 whitespace-nowrap font-medium text-center ${theoryHeld > 0 && ((theoryAttended / theoryHeld) * 100) < userProfile.attendance_threshold ? 'text-red-600' : 'text-gray-900'}">${percentage}</td>
                                ${bunkingCell}
                              </tr>`;
            }
            if (hasLab) {
                const percentage = labHeld > 0 ? ((labAttended / labHeld) * 100).toFixed(1) + '%' : '100.0%';
                const bunkingInfo = calculateBunkingAssistant(subjectName, labAttended, labHeld);
                const statusColorClass = bunkingInfo.status === 'safe' ? 'bg-green-100 text-green-800' : bunkingInfo.status === 'warning' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800';
                const bunkingCell = !showCombinedRow ? `<td class="px-6 py-4 text-sm text-center"><div class="p-2 rounded-md ${statusColorClass} inline-block min-w-[180px]">${bunkingInfo.message}</div></td>` : ``;
                tableHTML += `<tr class="${labHeld > 0 && ((labAttended / labHeld) * 100) < userProfile.attendance_threshold ? 'bg-red-50' : ''}">
                                ${hasTheory ? '' : `<td class="px-6 py-4 whitespace-nowrap font-medium text-gray-900 text-left">${subjectName}</td>`}
                                <td class="px-6 py-4 whitespace-nowrap text-gray-500 text-left">Lab</td>
                                <td class="px-6 py-4 whitespace-nowrap text-gray-500 text-center">${labAttended}</td>
                                <td class="px-6 py-4 whitespace-nowrap text-gray-500 text-center">${labHeld}</td>
                                <td class="px-6 py-4 whitespace-nowrap font-medium text-center ${labHeld > 0 && ((labAttended / labHeld) * 100) < userProfile.attendance_threshold ? 'text-red-600' : 'text-gray-900'}">${percentage}</td>
                                ${bunkingCell}
                              </tr>`;
            }

            if (showCombinedRow) {
                const totalAttended = theoryAttended + labAttended;
                const totalHeld = theoryHeld + labHeld;
                const overallPercentage = totalHeld > 0 ? ((totalAttended / totalHeld) * 100).toFixed(1) + '%' : '100.0%';
                const bunkingInfo = calculateBunkingAssistant(subjectName, totalAttended, totalHeld);
                const statusColorClass = bunkingInfo.status === 'safe' ? 'bg-green-100 text-green-800' : bunkingInfo.status === 'warning' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800';
                tableHTML = tableHTML.replace(`<td class="px-6 py-4 whitespace-nowrap font-medium text-gray-900 text-left" rowspan="2">${subjectName}</td>`, `<td class="px-6 py-4 whitespace-nowrap font-medium text-gray-900 text-left align-top" rowspan="3">${subjectName}</td>`);
                tableHTML += `<tr class="bg-gray-100 font-semibold border-t-2 border-gray-300">
                                <td class="px-6 py-3 text-left text-gray-800">Total</td>
                                <td class="px-6 py-3 text-center">${totalAttended}</td>
                                <td class="px-6 py-3 text-center">${totalHeld}</td>
                                <td class="px-6 py-3 text-center ${totalHeld > 0 && ((totalAttended / totalHeld) * 100) < userProfile.attendance_threshold ? 'text-red-600' : 'text-gray-900'}">${overallPercentage}</td>
                                <td class="px-6 py-3 text-sm text-center"><div class="p-2 rounded-md ${statusColorClass} inline-block min-w-[180px]">${bunkingInfo.message}</div></td>
                              </tr>`;
            }
        });
    }
    tableHTML += '</tbody></table></div>';
    attendanceSummary.innerHTML = tableHTML;
};


/**
 * Renders the list of classes for a specific date.
 * @param {string} dateStr - The date to render the schedule for, in 'YYYY-MM-DD' format.
 */
const renderScheduleForDate = (dateStr) => {
    pendingChanges.clear();
    saveAttendanceContainer.innerHTML = '';
    
    const lecturesOnDate = attendanceLog.filter(log => log.date === dateStr);
    
    if (lecturesOnDate.length === 0) {
        dailyLogContainer.innerHTML = `<p class="text-center text-gray-500 py-4">No classes scheduled for this day.</p>`;
        return;
    }

    const selectedDate = new Date(dateStr + 'T12:00:00Z'); // Use UTC for comparison
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0); // Set to UTC midnight
    const showNotHeldYet = selectedDate >= today;

    let logHTML = `<div class="space-y-4">`;
    
    lecturesOnDate.sort((a, b) => a.subject_name.localeCompare(b.subject_name)).forEach(log => {
        const status = pendingChanges.get(String(log.id)) || log.status;

        const getButtonClass = (btnStatus) => {
            const baseClass = 'log-btn px-3 py-1 text-sm font-medium rounded-md';
            if (status === btnStatus) {
                switch(btnStatus) {
                    case 'Attended': return `${baseClass} bg-green-500 text-white`;
                    case 'Missed': return `${baseClass} bg-red-500 text-white`;
                    case 'Cancelled': return `${baseClass} bg-yellow-500 text-white`;
                    case 'Not Held Yet': return `${baseClass} bg-gray-400 text-white`;
                }
            }
            return `${baseClass} bg-gray-200 text-gray-700 hover:bg-gray-300`;
        };

        const notHeldYetButton = showNotHeldYet ? `<button data-status="Not Held Yet" class="${getButtonClass('Not Held Yet')}">Not Held Yet</button>` : '';

        logHTML += `
            <div class="log-item flex items-center justify-between p-4 bg-white rounded-lg shadow-sm">
                <strong class="text-gray-800">${log.subject_name} (${log.category})</strong>
                <div class="log-actions flex flex-wrap gap-2 justify-end" data-log-id="${log.id}">
                    ${notHeldYetButton}
                    <button data-status="Attended" class="${getButtonClass('Attended')}">Attended</button>
                    <button data-status="Missed" class="${getButtonClass('Missed')}">Missed</button>
                    <button data-status="Cancelled" class="${getButtonClass('Cancelled')}">Cancelled</button>
                </div>
            </div>`;
    });
    logHTML += `</div>`;
    dailyLogContainer.innerHTML = logHTML;
};


// --- EVENT HANDLERS ---

const handleSetup = async (e) => {
    e.preventDefault();
    const saveButton = e.target.querySelector('button[type="submit"]');
    saveButton.disabled = true;
    showLoading(isEditingMode ? 'Updating Timetable...' : 'Saving Timetable...');

    const setupError = document.getElementById('setup-error');
    setupError.textContent = '';

    const startDate = document.getElementById('start-date').value;
    const minAttendance = document.getElementById('min-attendance').value;

    if (!startDate || !minAttendance || setupSubjects.length === 0) {
        setupError.textContent = 'Please set a start date, percentage, and add at least one subject.';
        hideLoading();
        saveButton.disabled = false;
        return;
    }

    const newTimetable = {};
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    days.forEach(day => {
        const classList = document.querySelectorAll(`.day-schedule-list[data-day="${day}"] li`);
        newTimetable[day] = Array.from(classList).map(li => li.dataset.value);
    });

    const newUniqueSubjects = [...new Set(setupSubjects.map(sub => sub.name))];
    
    if (isEditingMode) {
        const oldTimetable = userProfile.timetable_json;
        const classesToDelete = [];
        for (const day in oldTimetable) {
            oldTimetable[day].forEach(oldClass => {
                if (!newTimetable[day] || !newTimetable[day].includes(oldClass)) {
                    const parts = oldClass.split(' ');
                    const category = parts.pop();
                    const name = parts.join(' ');
                    classesToDelete.push({ name, category });
                }
            });
        }
        if (classesToDelete.length > 0) {
            const uniqueToDelete = [...new Map(classesToDelete.map(item => [`${item.name}-${item.category}`, item])).values()];
            await Promise.all(uniqueToDelete.map(cls => supabase.from('attendance_log').delete().eq('user_id', currentUser.id).eq('subject_name', cls.name).eq('category', cls.category)));
        }
    }

    const profileData = {
        id: currentUser.id, // This is the primary key
        start_date: startDate,
        timetable_json: newTimetable,
        unique_subjects: newUniqueSubjects,
        attendance_threshold: parseInt(minAttendance),
        last_log_date: null
    };
    
    // **FIXED**: Chain .select().single() to the upsert to get the returned row.
    const { data: newProfile, error } = await supabase.from('profiles').upsert(profileData).select().single();

    if (error) {
        setupError.textContent = `Error saving profile: ${error.message}`;
        hideLoading();
        saveButton.disabled = false;
        return;
    }
    
    // **FIXED**: Use the data returned from the database to avoid race conditions.
    userProfile = newProfile;
    isEditingMode = false;
    saveButton.disabled = false;
    await runFullAttendanceUpdate();
};

const handleEditTimetable = () => {
    isEditingMode = true;
    setupSubjects = [];
    const subjectSet = new Set();
    
    for (const day in userProfile.timetable_json) {
        userProfile.timetable_json[day].forEach(cls => subjectSet.add(cls));
    }
    
    setupSubjects = Array.from(subjectSet).map(cls => {
        const parts = cls.split(' ');
        const category = parts.pop();
        const name = parts.join(' ');
        return { name, category };
    });

    renderOnboardingUI();
    dashboardView.style.display = 'none';
    onboardingView.style.display = 'block';
};

const handleAddSubject = () => {
    const newSubjectNameInput = document.getElementById('new-subject-name');
    const newSubjectCategorySelect = document.getElementById('new-subject-category');
    const name = newSubjectNameInput.value.trim();
    const category = newSubjectCategorySelect.value;
    
    if (!name) {
        showCustomConfirm("Please enter a subject name.");
        return;
    }
    if (setupSubjects.some(sub => sub.name === name && sub.category === category)) {
        showCustomConfirm("This specific subject (name and category) already exists.");
        return;
    }
    
    setupSubjects.push({ name, category });
    newSubjectNameInput.value = '';
    renderOnboardingUI();
};

const handleAddClassToDay = (day) => {
    const select = document.querySelector(`.add-class-select[data-day="${day}"]`);
    if (!select.value) return;
    
    const list = document.querySelector(`.day-schedule-list[data-day="${day}"]`);
    const li = document.createElement('li');
    li.className = 'flex justify-between items-center bg-blue-100 text-blue-800 text-sm font-medium px-2 py-1 rounded';
    li.textContent = select.options[select.selectedIndex].text;
    li.dataset.value = select.value;
    
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-class-btn text-blue-500 hover:text-blue-700 font-bold ml-2';
    removeBtn.textContent = 'x';
    li.appendChild(removeBtn);
    list.appendChild(li);
};

const handleMarkAttendance = (e) => {
    const button = e.target.closest('.log-btn');
    if (!button) return;

    const newStatus = button.dataset.status;
    const buttonGroup = button.parentElement;
    const logId = buttonGroup.dataset.logId;

    pendingChanges.set(logId, newStatus);

    buttonGroup.querySelectorAll('.log-btn').forEach(btn => {
        btn.classList.remove('bg-green-500', 'bg-red-500', 'bg-yellow-500', 'bg-gray-400', 'text-white');
        btn.classList.add('bg-gray-200', 'text-gray-700', 'hover:bg-gray-300');
    });
    
    button.classList.remove('bg-gray-200', 'text-gray-700', 'hover:bg-gray-300');
    const activeClasses = newStatus === 'Attended' ? ['bg-green-500', 'text-white']
                        : newStatus === 'Missed' ? ['bg-red-500', 'text-white']
                        : newStatus === 'Cancelled' ? ['bg-yellow-500', 'text-white']
                        : ['bg-gray-400', 'text-white'];
    button.classList.add(...activeClasses);

    if (!saveAttendanceContainer.querySelector('button')) {
        saveAttendanceContainer.innerHTML = `<button id="save-attendance-btn" class="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg shadow-lg transition-transform transform hover:scale-105">Save Changes</button>`;
    }
};

const handleSaveChanges = async () => {
    if (pendingChanges.size === 0) return;
    showLoading('Saving...');

    const updatePromises = Array.from(pendingChanges).map(([id, status]) =>
        supabase.from('attendance_log').update({ status }).eq('id', id)
    );

    const results = await Promise.all(updatePromises);
    const anyError = results.some(result => result.error);

    if (anyError) {
        const errorMsg = results.find(r => r.error).error.message;
        showCustomConfirm(`An error occurred while saving: ${errorMsg}`);
        hideLoading();
        return;
    }

    for (const [id, status] of pendingChanges) {
        const logIndex = attendanceLog.findIndex(log => String(log.id) === id);
        if (logIndex !== -1) {
            attendanceLog[logIndex].status = status;
        }
    }

    pendingChanges.clear();
    saveAttendanceContainer.innerHTML = '';
    renderSummaryTable();
    hideLoading();
};

const handleDateChange = async (e) => {
    if (pendingChanges.size > 0) {
        const discard = await showCustomConfirm("You have unsaved changes. Are you sure you want to discard them?");
        if (!discard) {
            const originalDate = attendanceLog.find(log => pendingChanges.has(String(log.id))).date;
            e.target.value = originalDate;
            return;
        }
    }
    renderScheduleForDate(e.target.value);
};

const handleAddExtraDay = async (e) => {
    e.preventDefault();
    const form = e.target;
    const extraDateStr = form.elements['extra-day-date'].value;
    const weekday = form.elements['weekday-to-follow'].value;

    if (!extraDateStr || !weekday) {
        showCustomConfirm("Please select both a date and a weekday schedule to follow.");
        return;
    }

    showLoading('Adding extra day...');
    const lecturesToAdd = userProfile.timetable_json[weekday] || [];
    if (lecturesToAdd.length === 0) {
        hideLoading();
        showCustomConfirm(`There are no classes scheduled on a ${weekday} to add.`);
        return;
    }
    
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const selectedDate = new Date(extraDateStr + 'T12:00:00Z');
    const status = selectedDate < today ? 'Missed' : 'Not Held Yet';

    const newLogEntries = lecturesToAdd.map(subjectString => {
        const parts = subjectString.split(' ');
        const category = parts.pop();
        const subject_name = parts.join(' ');
        return { user_id: currentUser.id, date: extraDateStr, subject_name, category, status };
    });

    const { error } = await supabase.from('attendance_log').upsert(newLogEntries, { onConflict: 'user_id,date,subject_name,category' });
    if (error) {
        showCustomConfirm("Error adding extra day: " + error.message);
        hideLoading();
        return;
    }

    await loadFullAttendanceLog();
    historicalDatePicker.value = extraDateStr;
    renderScheduleForDate(extraDateStr);
    hideLoading();
    extraDayModal.style.display = 'none';
    form.reset();
};

// --- ATTACH EVENT LISTENERS ---
document.addEventListener('DOMContentLoaded', init);

logoutButton.addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = '/index.html';
});

setupForm.addEventListener('submit', handleSetup);

onboardingView.addEventListener('click', (e) => {
    if (e.target.id === 'add-subject-btn') handleAddSubject();
    if (e.target.classList.contains('remove-subject-btn')) {
        setupSubjects.splice(e.target.dataset.index, 1);
        renderOnboardingUI();
    }
    if (e.target.classList.contains('add-class-btn')) {
        handleAddClassToDay(e.target.dataset.day);
    }
    if (e.target.classList.contains('remove-class-btn')) {
        e.target.parentElement.remove();
    }
});

settingsSection.addEventListener('click', async (e) => {
    if (e.target.id === 'edit-timetable-btn') {
        handleEditTimetable();
    } else if (e.target.id === 'clear-attendance-btn') {
        const confirmed = await showCustomConfirm("Are you sure? This will reset all attendance records but will keep your timetable.");
        if (!confirmed) return;
        
        showLoading('Clearing records...');
        await supabase.from('attendance_log').delete().eq('user_id', currentUser.id);
        await supabase.from('profiles').update({ last_log_date: null }).eq('id', currentUser.id);
        window.location.reload();
    }
});

actionsSection.addEventListener('click', (e) => {
    if (e.target.id === 'save-attendance-btn') {
        handleSaveChanges();
    } else if (e.target.closest('.log-actions')) {
        handleMarkAttendance(e);
    } else if (e.target.id === 'show-extra-day-modal-btn') {
        extraDayModal.style.display = 'flex';
    }
});

extraDayModal.addEventListener('click', (e) => {
    if (e.target.id === 'cancel-extra-day-btn' || e.target.id === 'extra-day-modal') {
        extraDayModal.style.display = 'none';
        extraDayForm.reset();
    }
});

extraDayForm.addEventListener('submit', handleAddExtraDay);
historicalDatePicker.addEventListener('change', handleDateChange);

// Listeners for the custom confirmation modal
confirmYesBtn.addEventListener('click', () => {
    customConfirmModal.style.display = 'none';
    if (confirmResolve) confirmResolve(true);
});

confirmNoBtn.addEventListener('click', () => {
    customConfirmModal.style.display = 'none';
    if (confirmResolve) confirmResolve(false);
});
