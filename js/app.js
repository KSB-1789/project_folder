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

// --- Application State ---
class AppState {
    constructor() {
        this.currentUser = null;
        this.userProfile = null;
        this.attendanceLog = [];
        this.setupSubjects = [];
        this.pendingChanges = new Map();
        this.isEditingMode = false;
        this.confirmResolve = null;
        this.isLoading = false;
        this.currentViewDate = null;
    }

    reset() {
        this.userProfile = null;
        this.attendanceLog = [];
        this.setupSubjects = [];
        this.pendingChanges.clear();
        this.isEditingMode = false;
        this.currentViewDate = null;
    }

    setCurrentViewDate(dateStr) {
        this.currentViewDate = dateStr;
    }

    hasPendingChanges() {
        return this.pendingChanges.size > 0;
    }
}

const appState = new AppState();

// --- Utility Functions ---
const showLoading = (message = 'Loading...') => {
    if (appState.isLoading) return; // Prevent multiple loading overlays
    appState.isLoading = true;
    const loadingText = document.getElementById('loading-text');
    if (loadingText) loadingText.textContent = message;
    if (loadingOverlay) loadingOverlay.style.display = 'flex';
};

const hideLoading = () => {
    appState.isLoading = false;
    if (loadingOverlay) loadingOverlay.style.display = 'none';
};

const toYYYYMMDD = (dateInput) => {
    const date = new Date(dateInput);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const showCustomConfirm = (message) => {
    if (confirmModalText) confirmModalText.textContent = message;
    if (customConfirmModal) customConfirmModal.style.display = 'flex';
    return new Promise((resolve) => {
        appState.confirmResolve = resolve;
    });
};

// --- Error Handling ---
const handleError = (error, context = '') => {
    console.error(`Error in ${context}:`, error);
    const message = error.message || 'An unexpected error occurred';
    showCustomConfirm(`${context ? context + ': ' : ''}${message}`);
    hideLoading();
};

// --- Data Management ---
const DataManager = {
    async fetchUserProfile() {
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', appState.currentUser.id)
                .single();

            if (error && error.code !== 'PGRST116') {
                throw error;
            }

            return data;
        } catch (error) {
            throw new Error(`Failed to fetch profile: ${error.message}`);
        }
    },

    async saveProfile(profileData) {
        try {
            const { error } = await supabase
                .from('profiles')
                .upsert(profileData);

            if (error) throw error;
        } catch (error) {
            throw new Error(`Failed to save profile: ${error.message}`);
        }
    },

    async loadAttendanceLog() {
        try {
            const { data, error } = await supabase
                .from('attendance_log')
                .select('*')
                .eq('user_id', appState.currentUser.id)
                .order('date', { ascending: false });

            if (error) throw error;
            
            appState.attendanceLog = data || [];
        } catch (error) {
            throw new Error(`Failed to load attendance log: ${error.message}`);
        }
    },

    async saveAttendanceChanges() {
        if (!appState.hasPendingChanges()) return;

        try {
            const updatePromises = Array.from(appState.pendingChanges).map(([id, status]) =>
                supabase.from('attendance_log').update({ status }).eq('id', id)
            );

            const results = await Promise.all(updatePromises);
            const errors = results.filter(result => result.error);

            if (errors.length > 0) {
                throw new Error(errors[0].error.message);
            }

            // Update local state
            for (const [id, status] of appState.pendingChanges) {
                const logIndex = appState.attendanceLog.findIndex(log => String(log.id) === id);
                if (logIndex !== -1) {
                    appState.attendanceLog[logIndex].status = status;
                }
            }

            appState.pendingChanges.clear();
        } catch (error) {
            throw new Error(`Failed to save attendance changes: ${error.message}`);
        }
    },

    async deleteAttendanceForClasses(classesToDelete) {
        if (classesToDelete.length === 0) return;

        try {
            const deletePromises = classesToDelete.map(cls =>
                supabase
                    .from('attendance_log')
                    .delete()
                    .eq('user_id', appState.currentUser.id)
                    .eq('subject_name', cls.name)
                    .eq('category', cls.category)
            );

            await Promise.all(deletePromises);
        } catch (error) {
            throw new Error(`Failed to delete attendance records: ${error.message}`);
        }
    }
};

// --- UI State Management ---
const UIManager = {
    updateSaveButton() {
        if (!saveAttendanceContainer) return;
        
        if (appState.hasPendingChanges() && !saveAttendanceContainer.querySelector('button')) {
            saveAttendanceContainer.innerHTML = `
                <button id="save-attendance-btn" class="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg shadow-lg transition-transform transform hover:scale-105">
                    Save Changes
                </button>`;
        } else if (!appState.hasPendingChanges()) {
            saveAttendanceContainer.innerHTML = '';
        }
    },

    showView(viewName) {
        const views = { onboarding: onboardingView, dashboard: dashboardView };
        
        Object.entries(views).forEach(([name, element]) => {
            if (element) {
                element.style.display = name === viewName ? 'block' : 'none';
            }
        });
    },

    setDatePicker(dateStr) {
        if (historicalDatePicker && historicalDatePicker.value !== dateStr) {
            historicalDatePicker.value = dateStr;
        }
    }
};

// --- Business Logic ---
const AttendanceCalculator = {
    isDoubleWeighted(subjectName) {
        if (subjectName === 'DA' || subjectName === 'DSA') return true;
        
        if (!appState.userProfile?.timetable_json) return false;
        
        for (const day in appState.userProfile.timetable_json) {
            if (appState.userProfile.timetable_json[day].some(lec => lec === `${subjectName} Lab`)) {
                return true;
            }
        }
        return false;
    },

    calculateBunkingAdvice(subjectName, totalAttended, totalHeld) {
        const threshold = appState.userProfile.attendance_threshold / 100;
        const minAttended = Math.ceil(totalHeld * threshold);
        
        if (totalAttended < minAttended) {
            return { 
                status: 'danger', 
                message: `Below ${appState.userProfile.attendance_threshold}%. Attend all!` 
            };
        }
        
        const bunksAvailable = totalAttended - minAttended;
        
        if (bunksAvailable >= 1) {
            return { 
                status: 'safe', 
                message: `Safe. You can miss ${bunksAvailable} more.` 
            };
        }
        
        return { 
            status: 'warning', 
            message: `Risky. At ${appState.userProfile.attendance_threshold}%. Cannot miss.` 
        };
    },

    calculateHeldCounts() {
        const heldCounts = {};
        const today = new Date();
        const startDate = new Date(appState.userProfile.start_date + 'T12:00:00Z');

        if (startDate <= today) {
            let currentDate = new Date(startDate);
            while (currentDate <= today) {
                const dayIndex = currentDate.getUTCDay();
                if (dayIndex >= 1 && dayIndex <= 5) {
                    const dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dayIndex];
                    const lecturesToday = appState.userProfile.timetable_json[dayName] || [];
                    
                    for (const subjectString of lecturesToday) {
                        const parts = subjectString.split(' ');
                        const category = parts.pop();
                        const subject_name = parts.join(' ');
                        
                        if (!heldCounts[subject_name]) {
                            heldCounts[subject_name] = { Theory: 0, Lab: 0 };
                        }
                        
                        const weight = this.isDoubleWeighted(subject_name) ? 2 : 1;
                        heldCounts[subject_name][category] += weight;
                    }
                }
                currentDate.setUTCDate(currentDate.getUTCDate() + 1);
            }
        }

        return heldCounts;
    },

    calculateAttendedCounts() {
        const attendedCounts = {};
        
        for (const log of appState.attendanceLog) {
            if (log.status === 'Attended') {
                const subjectName = log.subject_name;
                if (!attendedCounts[subjectName]) {
                    attendedCounts[subjectName] = { Theory: 0, Lab: 0 };
                }
                const weight = this.isDoubleWeighted(subjectName) ? 2 : 1;
                attendedCounts[subjectName][log.category] += weight;
            }
        }

        return attendedCounts;
    }
};

// --- Rendering Logic ---
const Renderer = {
    renderSummaryTable() {
        if (!attendanceSummary || !appState.userProfile) return;

        const heldCounts = AttendanceCalculator.calculateHeldCounts();
        const attendedCounts = AttendanceCalculator.calculateAttendedCounts();

        let tableHTML = `
            <h3 class="text-xl font-bold text-gray-800 mb-4">Overall Summary</h3>
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

        if (!appState.userProfile.unique_subjects || appState.userProfile.unique_subjects.length === 0) {
            tableHTML += `<tr><td colspan="6" class="px-6 py-4 text-center text-gray-500">No subjects defined.</td></tr>`;
        } else {
            appState.userProfile.unique_subjects.sort().forEach(subjectName => {
                const hasTheory = this.hasSubjectCategory(subjectName, 'Theory');
                const hasLab = this.hasSubjectCategory(subjectName, 'Lab');
                
                if (!hasTheory && !hasLab) return;

                const theoryHeld = heldCounts[subjectName]?.Theory || 0;
                const theoryAttended = attendedCounts[subjectName]?.Theory || 0;
                const labHeld = heldCounts[subjectName]?.Lab || 0;
                const labAttended = attendedCounts[subjectName]?.Lab || 0;

                const showCombinedRow = hasTheory && hasLab;
                
                if (hasTheory) {
                    tableHTML += this.renderSubjectRow(subjectName, 'Theory', theoryAttended, theoryHeld, showCombinedRow, true);
                }
                
                if (hasLab) {
                    tableHTML += this.renderSubjectRow(subjectName, 'Lab', labAttended, labHeld, showCombinedRow, !hasTheory);
                }

                if (showCombinedRow) {
                    tableHTML += this.renderCombinedRow(subjectName, theoryAttended + labAttended, theoryHeld + labHeld);
                }
            });
        }

        tableHTML += '</tbody></table></div>';
        attendanceSummary.innerHTML = tableHTML;
    },

    hasSubjectCategory(subjectName, category) {
        for (const day in appState.userProfile.timetable_json) {
            if (appState.userProfile.timetable_json[day].includes(`${subjectName} ${category}`)) {
                return true;
            }
        }
        return false;
    },

    renderSubjectRow(subjectName, category, attended, held, showCombined, isFirst) {
        const percentage = held > 0 ? ((attended / held) * 100).toFixed(1) + '%' : '100.0%';
        const isBelowThreshold = held > 0 && ((attended / held) * 100) < appState.userProfile.attendance_threshold;
        const rowspan = showCombined ? 3 : 1;
        
        const bunkingInfo = AttendanceCalculator.calculateBunkingAdvice(subjectName, attended, held);
        const statusColorClass = bunkingInfo.status === 'safe' ? 'bg-green-100 text-green-800' 
                                : bunkingInfo.status === 'warning' ? 'bg-yellow-100 text-yellow-800' 
                                : 'bg-red-100 text-red-800';

        const subjectCell = isFirst ? `<td class="px-6 py-4 whitespace-nowrap font-medium text-gray-900 text-left" rowspan="${rowspan}">${subjectName}</td>` : '';
        const bunkingCell = !showCombined ? `<td class="px-6 py-4 text-sm text-center"><div class="p-2 rounded-md ${statusColorClass} inline-block min-w-[180px]">${bunkingInfo.message}</div></td>` : '';

        return `<tr class="${isBelowThreshold ? 'bg-red-50' : ''}">
                    ${subjectCell}
                    <td class="px-6 py-4 whitespace-nowrap text-gray-500 text-left">${category}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-gray-500 text-center">${attended}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-gray-500 text-center">${held}</td>
                    <td class="px-6 py-4 whitespace-nowrap font-medium text-center ${isBelowThreshold ? 'text-red-600' : 'text-gray-900'}">${percentage}</td>
                    ${bunkingCell}
                </tr>`;
    },

    renderCombinedRow(subjectName, totalAttended, totalHeld) {
        const overallPercentage = totalHeld > 0 ? ((totalAttended / totalHeld) * 100).toFixed(1) + '%' : '100.0%';
        const isBelowThreshold = totalHeld > 0 && ((totalAttended / totalHeld) * 100) < appState.userProfile.attendance_threshold;
        
        const bunkingInfo = AttendanceCalculator.calculateBunkingAdvice(subjectName, totalAttended, totalHeld);
        const statusColorClass = bunkingInfo.status === 'safe' ? 'bg-green-100 text-green-800' 
                                : bunkingInfo.status === 'warning' ? 'bg-yellow-100 text-yellow-800' 
                                : 'bg-red-100 text-red-800';

        return `<tr class="bg-gray-100 font-semibold border-t-2 border-gray-300">
                    <td class="px-6 py-3 text-left text-gray-800">Total</td>
                    <td class="px-6 py-3 text-center">${totalAttended}</td>
                    <td class="px-6 py-3 text-center">${totalHeld}</td>
                    <td class="px-6 py-3 text-center ${isBelowThreshold ? 'text-red-600' : 'text-gray-900'}">${overallPercentage}</td>
                    <td class="px-6 py-3 text-sm text-center"><div class="p-2 rounded-md ${statusColorClass} inline-block min-w-[180px]">${bunkingInfo.message}</div></td>
                </tr>`;
    },

    renderScheduleForDate(dateStr) {
        if (!dailyLogContainer) return;

        appState.setCurrentViewDate(dateStr);
        const lecturesOnDate = appState.attendanceLog.filter(log => log.date === dateStr);
        
        if (lecturesOnDate.length === 0) {
            dailyLogContainer.innerHTML = `<p class="text-center text-gray-500 py-4">No classes scheduled for this day.</p>`;
            UIManager.updateSaveButton();
            return;
        }

        const selectedDate = new Date(dateStr + 'T12:00:00Z');
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        const showNotHeldYet = selectedDate >= today;

        let logHTML = `<div class="space-y-4">`;
        
        lecturesOnDate
            .sort((a, b) => a.subject_name.localeCompare(b.subject_name))
            .forEach(log => {
                const status = appState.pendingChanges.get(String(log.id)) || log.status;
                logHTML += this.renderLectureItem(log, status, showNotHeldYet);
            });
        
        logHTML += `</div>`;
        dailyLogContainer.innerHTML = logHTML;
        UIManager.updateSaveButton();
    },

    renderLectureItem(log, currentStatus, showNotHeldYet) {
        const getButtonClass = (btnStatus) => {
            const baseClass = 'log-btn px-3 py-1 text-sm font-medium rounded-md transition-colors';
            if (currentStatus === btnStatus) {
                switch(btnStatus) {
                    case 'Attended': return `${baseClass} bg-green-500 text-white`;
                    case 'Missed': return `${baseClass} bg-red-500 text-white`;
                    case 'Cancelled': return `${baseClass} bg-yellow-500 text-white`;
                    case 'Not Held Yet': return `${baseClass} bg-gray-400 text-white`;
                }
            }
            return `${baseClass} bg-gray-200 text-gray-700 hover:bg-gray-300`;
        };

        const notHeldYetButton = showNotHeldYet ? 
            `<button data-status="Not Held Yet" class="${getButtonClass('Not Held Yet')}">Not Held Yet</button>` : '';

        return `
            <div class="log-item flex items-center justify-between p-4 bg-white rounded-lg shadow-sm">
                <strong class="text-gray-800">${log.subject_name} (${log.category})</strong>
                <div class="log-actions flex flex-wrap gap-2 justify-end" data-log-id="${log.id}">
                    ${notHeldYetButton}
                    <button data-status="Attended" class="${getButtonClass('Attended')}">Attended</button>
                    <button data-status="Missed" class="${getButtonClass('Missed')}">Missed</button>
                    <button data-status="Cancelled" class="${getButtonClass('Cancelled')}">Cancelled</button>
                </div>
            </div>`;
    },

    renderOnboardingUI() {
        const subjectMasterListUI = document.getElementById('subject-master-list');
        const timetableBuilderGrid = document.getElementById('timetable-grid');
        if (!subjectMasterListUI || !timetableBuilderGrid) return;

        this.updateOnboardingHeaders();
        this.renderSubjectList(subjectMasterListUI);
        this.renderTimetableGrid(timetableBuilderGrid);
    },

    updateOnboardingHeaders() {
        const elements = {
            setupTitle: document.getElementById('setup-title'),
            setupSubtitle: document.getElementById('setup-subtitle'),
            saveTimetableBtn: document.getElementById('save-timetable-btn'),
            startDateInput: document.getElementById('start-date'),
            minAttendanceInput: document.getElementById('min-attendance')
        };

        if (appState.isEditingMode) {
            if (elements.setupTitle) elements.setupTitle.textContent = "Edit Timetable";
            if (elements.setupSubtitle) elements.setupSubtitle.textContent = "Add or remove subjects and classes below. Your existing attendance will be preserved.";
            if (elements.saveTimetableBtn) elements.saveTimetableBtn.textContent = "Save Changes and Re-calculate";
            if (elements.startDateInput) {
                elements.startDateInput.value = appState.userProfile.start_date;
                elements.startDateInput.disabled = true;
            }
            if (elements.minAttendanceInput) elements.minAttendanceInput.value = appState.userProfile.attendance_threshold;
        } else {
            if (elements.setupTitle) elements.setupTitle.textContent = "Initial Setup";
            if (elements.setupSubtitle) elements.setupSubtitle.textContent = "Welcome! Please build your timetable below.";
            if (elements.saveTimetableBtn) elements.saveTimetableBtn.textContent = "Save and Build Dashboard";
            if (elements.startDateInput) elements.startDateInput.disabled = false;
        }
    },

    renderSubjectList(container) {
        container.innerHTML = appState.setupSubjects.map((sub, index) => `
            <li class="flex justify-between items-center bg-gray-100 p-2 rounded-md">
                <span>${sub.name} (${sub.category})</span>
                <button type="button" data-index="${index}" class="remove-subject-btn text-red-500 hover:text-red-700 font-bold">X</button>
            </li>`).join('');
    },

    renderTimetableGrid(container) {
        const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
        container.innerHTML = days.map(day => {
            const scheduledClasses = appState.isEditingMode ? 
                (appState.userProfile.timetable_json[day] || []) : [];
            
            return `
                <div class="day-column bg-gray-50 p-3 rounded-lg">
                    <h4 class="font-bold mb-2 text-center">${day}</h4>
                    <div class="flex items-center gap-1 mb-2">
                        <select data-day="${day}" class="add-class-select flex-grow w-full pl-2 pr-7 py-1 text-sm bg-white border border-gray-300 rounded-md">
                            <option value="">-- select --</option>
                            ${appState.setupSubjects.map(sub => `<option value="${sub.name} ${sub.category}">${sub.name} (${sub.category})</option>`).join('')}
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
    },

    renderDashboard() {
        this.renderSummaryTable();
        
        const todayStr = toYYYYMMDD(new Date());
        const selectedDate = appState.currentViewDate || todayStr;
        
        UIManager.setDatePicker(selectedDate);
        this.renderScheduleForDate(selectedDate);
        UIManager.showView('dashboard');
    }
};

// --- Attendance Population Logic ---
const AttendancePopulator = {
    async populateAttendanceLog() {
        const today = new Date();
        const todayStr = toYYYYMMDD(today);
        const startDate = new Date(appState.userProfile.start_date + 'T12:00:00Z');

        let currentDate = appState.userProfile.last_log_date 
            ? new Date(appState.userProfile.last_log_date + 'T12:00:00Z')
            : new Date(startDate);

        if (appState.userProfile.last_log_date) {
            currentDate.setUTCDate(currentDate.getUTCDate() + 1);
        }
        
        if (currentDate > today) {
            await this.updateLastLogDate(todayStr);
            return;
        }

        let lastSuccessfulDateStr = appState.userProfile.last_log_date;

        while (toYYYYMMDD(currentDate) <= todayStr) {
            try {
                const dateStr = toYYYYMMDD(currentDate);
                const dayIndex = currentDate.getUTCDay();
                
                if (dayIndex >= 1 && dayIndex <= 5) {
                    const dailyEntries = this.generateDailyEntries(currentDate, dateStr, todayStr);
                    
                    if (dailyEntries.length > 0) {
                        await this.insertDailyEntries(dailyEntries);
                    }
                }
                
                lastSuccessfulDateStr = dateStr;
                currentDate.setUTCDate(currentDate.getUTCDate() + 1);
            } catch (error) {
                console.error(`Failed to populate log for date: ${toYYYYMMDD(currentDate)}`, error);
                if (lastSuccessfulDateStr) {
                    await this.updateLastLogDate(lastSuccessfulDateStr);
                }
                throw error;
            }
        }
        
        await this.updateLastLogDate(todayStr);
    },

    generateDailyEntries(currentDate, dateStr, todayStr) {
        const dayIndex = currentDate.getUTCDay();
        const dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dayIndex];
        const defaultStatus = dateStr === todayStr ? 'Not Held Yet' : 'Missed';
        
        const uniqueLecturesToday = [...new Set(appState.userProfile.timetable_json[dayName] || [])];

        return uniqueLecturesToday.map(subjectString => {
            const parts = subjectString.split(' ');
            const category = parts.pop();
            const subject_name = parts.join(' ');
            
            return {
                user_id: appState.currentUser.id,
                date: dateStr,
                subject_name,
                category,
                status: defaultStatus
            };
        });
    },

    async insertDailyEntries(dailyEntries) {
        const { error } = await supabase
            .from('attendance_log')
            .upsert(dailyEntries, { onConflict: 'user_id,date,subject_name,category' });

        if (error) {
            throw new Error(`Database error: ${error.message}`);
        }
    },

    async updateLastLogDate(dateStr) {
        if (appState.userProfile.last_log_date !== dateStr) {
            await supabase
                .from('profiles')
                .update({ last_log_date: dateStr })
                .eq('id', appState.currentUser.id);
        }
    }
};

// --- Main Application Logic ---
const init = async () => {
    try {
        showLoading('Initializing...');
        
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error) {
            console.error('Session error:', error);
            window.location.href = '/index.html';
            return;
        }
        
        if (!session) {
            window.location.href = '/index.html';
            return;
        }
        
        appState.currentUser = session.user;
        const profile = await DataManager.fetchUserProfile();

        if (profile) {
            appState.userProfile = profile;
            await runFullAttendanceUpdate();
        } else {
            appState.isEditingMode = false;
            Renderer.renderOnboardingUI();
            UIManager.showView('onboarding');
        }
    } catch (error) {
        handleError(error, 'Initialization failed');
    } finally {
        hideLoading();
    }
};

const runFullAttendanceUpdate = async () => {
    try {
        showLoading('Updating attendance records...');
        await AttendancePopulator.populateAttendanceLog();
        
        showLoading('Loading your dashboard...');
        await DataManager.loadAttendanceLog();
        
        // Clear any stale pending changes
        appState.pendingChanges.clear();
        
        Renderer.renderDashboard();
    } catch (error) {
        handleError(error, 'Failed to update attendance');
    } finally {
        hideLoading();
    }
};

// --- Event Handlers ---
const EventHandlers = {
    async handleSetup(e) {
        e.preventDefault();
        const saveButton = e.target.querySelector('button[type="submit"]');
        saveButton.disabled = true;

        try {
            showLoading(appState.isEditingMode ? 'Updating Timetable...' : 'Saving Timetable...');
            
            const setupError = document.getElementById('setup-error');
            if (setupError) setupError.textContent = '';

            const formData = this.getSetupFormData();
            
            if (!this.validateSetupForm(formData)) {
                const setupError = document.getElementById('setup-error');
                if (setupError) setupError.textContent = 'Please set a start date, percentage, and add at least one subject.';
                return;
            }

            if (appState.isEditingMode) {
                await this.handleTimetableEdit(formData);
            }

            const profileData = this.buildProfileData(formData);
            await DataManager.saveProfile(profileData);
            
            window.location.reload();
        } catch (error) {
            handleError(error, 'Setup failed');
        } finally {
            saveButton.disabled = false;
            hideLoading();
        }
    },

    getSetupFormData() {
        const startDateInput = document.getElementById('start-date');
        const minAttendanceInput = document.getElementById('min-attendance');
        
        const timetable = {};
        const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
        
        days.forEach(day => {
            const classList = document.querySelectorAll(`.day-schedule-list[data-day="${day}"] li`);
            timetable[day] = Array.from(classList).map(li => li.dataset.value);
        });

        return {
            startDate: startDateInput?.value,
            minAttendance: minAttendanceInput?.value,
            timetable,
            uniqueSubjects: [...new Set(appState.setupSubjects.map(sub => sub.name))]
        };
    },

    validateSetupForm(formData) {
        return formData.startDate && formData.minAttendance && appState.setupSubjects.length > 0;
    },

    async handleTimetableEdit(formData) {
        const oldTimetable = appState.userProfile.timetable_json;
        const classesToDelete = this.findClassesToDelete(oldTimetable, formData.timetable);
        
        if (classesToDelete.length > 0) {
            await DataManager.deleteAttendanceForClasses(classesToDelete);
        }
    },

    findClassesToDelete(oldTimetable, newTimetable) {
        const classesToDelete = [];
        
        for (const day in oldTimetable) {
            oldTimetable[day].forEach(oldClass => {
                if (!newTimetable[day] || !newTimetable[day].includes(oldClass)) {
                    const parts = oldClass.split(' ');
                    const category = parts.pop();
                    const name = parts.join(' ');
                    
                    // Check if this subject+category exists anywhere in new timetable
                    let existsInNewTimetable = false;
                    for (const newDay in newTimetable) {
                        if (newTimetable[newDay].includes(oldClass)) {
                            existsInNewTimetable = true;
                            break;
                        }
                    }
                    
                    if (!existsInNewTimetable) {
                        classesToDelete.push({ name, category });
                    }
                }
            });
        }
        
        return [...new Map(classesToDelete.map(item => [`${item.name}-${item.category}`, item])).values()];
    },

    buildProfileData(formData) {
        return {
            id: appState.currentUser.id,
            start_date: formData.startDate,
            timetable_json: formData.timetable,
            unique_subjects: formData.uniqueSubjects,
            attendance_threshold: parseInt(formData.minAttendance),
            last_log_date: null
        };
    },

    async handleEditTimetable() {
        try {
            if (appState.hasPendingChanges()) {
                const proceed = await showCustomConfirm("You have unsaved attendance changes. Are you sure you want to edit the timetable? Unsaved changes will be lost.");
                if (!proceed) return;
                
                appState.pendingChanges.clear();
                UIManager.updateSaveButton();
            }

            appState.isEditingMode = true;
            this.prepareEditingSubjects();
            
            Renderer.renderOnboardingUI();
            UIManager.showView('onboarding');
        } catch (error) {
            handleError(error, 'Failed to enter edit mode');
        }
    },

    prepareEditingSubjects() {
        appState.setupSubjects = [];
        const subjectSet = new Set();
        
        for (const day in appState.userProfile.timetable_json) {
            appState.userProfile.timetable_json[day].forEach(cls => subjectSet.add(cls));
        }
        
        appState.setupSubjects = Array.from(subjectSet).map(cls => {
            const parts = cls.split(' ');
            const category = parts.pop();
            const name = parts.join(' ');
            return { name, category };
        });
    },

    handleAddSubject() {
        const nameInput = document.getElementById('new-subject-name');
        const categorySelect = document.getElementById('new-subject-category');
        
        if (!nameInput || !categorySelect) return;
        
        const name = nameInput.value.trim();
        const category = categorySelect.value;
        
        if (!name) {
            showCustomConfirm("Please enter a subject name.");
            return;
        }
        
        if (appState.setupSubjects.some(sub => sub.name === name && sub.category === category)) {
            showCustomConfirm("This specific subject (name and category) already exists.");
            return;
        }
        
        appState.setupSubjects.push({ name, category });
        nameInput.value = '';
        Renderer.renderOnboardingUI();
    },

    handleAddClassToDay(day) {
        const select = document.querySelector(`.add-class-select[data-day="${day}"]`);
        if (!select || !select.value) return;
        
        const list = document.querySelector(`.day-schedule-list[data-day="${day}"]`);
        if (!list) return;
        
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
        
        select.value = '';
    },

    handleMarkAttendance(e) {
        const button = e.target.closest('.log-btn');
        if (!button) return;

        const newStatus = button.dataset.status;
        const buttonGroup = button.parentElement;
        const logId = buttonGroup.dataset.logId;

        appState.pendingChanges.set(logId, newStatus);

        // Update button visual states
        this.updateAttendanceButtonStates(buttonGroup, button, newStatus);
        UIManager.updateSaveButton();
    },

    updateAttendanceButtonStates(buttonGroup, activeButton, newStatus) {
        buttonGroup.querySelectorAll('.log-btn').forEach(btn => {
            btn.classList.remove('bg-green-500', 'bg-red-500', 'bg-yellow-500', 'bg-gray-400', 'text-white');
            btn.classList.add('bg-gray-200', 'text-gray-700', 'hover:bg-gray-300');
        });
        
        activeButton.classList.remove('bg-gray-200', 'text-gray-700', 'hover:bg-gray-300');
        
        const activeClasses = {
            'Attended': ['bg-green-500', 'text-white'],
            'Missed': ['bg-red-500', 'text-white'],
            'Cancelled': ['bg-yellow-500', 'text-white'],
            'Not Held Yet': ['bg-gray-400', 'text-white']
        };
        
        activeButton.classList.add(...(activeClasses[newStatus] || []));
    },

    async handleSaveChanges() {
        if (!appState.hasPendingChanges()) return;
        
        try {
            showLoading('Saving...');
            await DataManager.saveAttendanceChanges();
            
            UIManager.updateSaveButton();
            Renderer.renderSummaryTable();
            
            // Re-render current date to show saved changes
            if (appState.currentViewDate) {
                Renderer.renderScheduleForDate(appState.currentViewDate);
            }
        } catch (error) {
            handleError(error, 'Failed to save changes');
        } finally {
            hideLoading();
        }
    },

    async handleDateChange(e) {
        if (appState.hasPendingChanges()) {
            const discard = await showCustomConfirm("You have unsaved changes. Are you sure you want to discard them?");
            if (!discard) {
                // Restore original date
                UIManager.setDatePicker(appState.currentViewDate || toYYYYMMDD(new Date()));
                return;
            }
            appState.pendingChanges.clear();
            UIManager.updateSaveButton();
        }
        
        Renderer.renderScheduleForDate(e.target.value);
    },

    async handleAddExtraDay(e) {
        e.preventDefault();
        
        try {
            const form = e.target;
            const extraDateStr = form.elements['extra-day-date'].value;
            const weekday = form.elements['weekday-to-follow'].value;

            if (!extraDateStr || !weekday) {
                showCustomConfirm("Please select both a date and a weekday schedule to follow.");
                return;
            }

            showLoading('Adding extra day...');
            
            const lecturesToAdd = appState.userProfile.timetable_json[weekday] || [];
            if (lecturesToAdd.length === 0) {
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
                return { 
                    user_id: appState.currentUser.id, 
                    date: extraDateStr, 
                    subject_name, 
                    category, 
                    status 
                };
            });

            const { error } = await supabase
                .from('attendance_log')
                .upsert(newLogEntries, { onConflict: 'user_id,date,subject_name,category' });
                
            if (error) throw error;

            await DataManager.loadAttendanceLog();
            UIManager.setDatePicker(extraDateStr);
            Renderer.renderScheduleForDate(extraDateStr);
            
            const extraDayModal = document.getElementById('extra-day-modal');
            if (extraDayModal) extraDayModal.style.display = 'none';
            form.reset();
        } catch (error) {
            handleError(error, 'Failed to add extra day');
        } finally {
            hideLoading();
        }
    }
};

// --- Event Listener Management ---
let eventListeners = [];

const addEventListenerWithCleanup = (element, event, handler) => {
    if (element) {
        element.addEventListener(event, handler);
        eventListeners.push({ element, event, handler });
    }
};

const cleanupEventListeners = () => {
    eventListeners.forEach(({ element, event, handler }) => {
        element.removeEventListener(event, handler);
    });
    eventListeners = [];
};

// --- Initialize Event Listeners ---
document.addEventListener('DOMContentLoaded', init);
window.addEventListener('beforeunload', cleanupEventListeners);

// Core UI Events
addEventListenerWithCleanup(logoutButton, 'click', async () => {
    try {
        await supabase.auth.signOut();
        window.location.href = '/index.html';
    } catch (error) {
        console.error('Logout error:', error);
    }
});

addEventListenerWithCleanup(setupForm, 'submit', EventHandlers.handleSetup.bind(EventHandlers));

// Onboarding Events
addEventListenerWithCleanup(onboardingView, 'click', (e) => {
    if (e.target.id === 'add-subject-btn') {
        EventHandlers.handleAddSubject();
    } else if (e.target.classList.contains('remove-subject-btn')) {
        appState.setupSubjects.splice(e.target.dataset.index, 1);
        Renderer.renderOnboardingUI();
    } else if (e.target.classList.contains('add-class-btn')) {
        EventHandlers.handleAddClassToDay(e.target.dataset.day);
    } else if (e.target.classList.contains('remove-class-btn')) {
        e.target.parentElement.remove();
    }
});

// Settings Events
addEventListenerWithCleanup(settingsSection, 'click', async (e) => {
    try {
        if (e.target.id === 'edit-timetable-btn') {
            await EventHandlers.handleEditTimetable();
        } else if (e.target.id === 'clear-attendance-btn') {
            const confirmed = await showCustomConfirm("Are you sure? This will reset all attendance records but will keep your timetable.");
            if (!confirmed) return;
            
            showLoading('Clearing records...');
            await supabase.from('attendance_log').delete().eq('user_id', appState.currentUser.id);
            await supabase.from('profiles').update({ last_log_date: null }).eq('id', appState.currentUser.id);
            window.location.reload();
        }
    } catch (error) {
        handleError(error, 'Settings action failed');
    }
});

// Dashboard Events
addEventListenerWithCleanup(actionsSection, 'click', (e) => {
    if (e.target.id === 'save-attendance-btn') {
        EventHandlers.handleSaveChanges();
    } else if (e.target.closest('.log-actions')) {
        EventHandlers.handleMarkAttendance(e);
    } else if (e.target.id === 'show-extra-day-modal-btn') {
        const extraDayModal = document.getElementById('extra-day-modal');
        if (extraDayModal) extraDayModal.style.display = 'flex';
    }
});

// Modal Events
addEventListenerWithCleanup(extraDayModal, 'click', (e) => {
    if (e.target.id === 'cancel-extra-day-btn' || e.target.id === 'extra-day-modal') {
        extraDayModal.style.display = 'none';
        const extraDayForm = document.getElementById('extra-day-form');
        if (extraDayForm) extraDayForm.reset();
    }
});

addEventListenerWithCleanup(extraDayForm, 'submit', EventHandlers.handleAddExtraDay.bind(EventHandlers));
addEventListenerWithCleanup(historicalDatePicker, 'change', EventHandlers.handleDateChange.bind(EventHandlers));

// Confirmation Modal Events
addEventListenerWithCleanup(confirmYesBtn, 'click', () => {
    if (customConfirmModal) customConfirmModal.style.display = 'none';
    if (appState.confirmResolve) {
        appState.confirmResolve(true);
        appState.confirmResolve = null;
    }
});

addEventListenerWithCleanup(confirmNoBtn, 'click', () => {
    if (customConfirmModal) customConfirmModal.style.display = 'none';
    if (appState.confirmResolve) {
        appState.confirmResolve(false);
        appState.confirmResolve = null;
    }
});
