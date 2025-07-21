import { supabase } from './supabaseClient.js';

// --- Constants ---
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

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
    if (appState.isLoading) return;
    appState.isLoading = true;
    const loadingText = document.getElementById('loading-text');
    if (loadingText) loadingText.textContent = message;
    if (loadingOverlay) loadingOverlay.style.display = 'flex';
};

const hideLoading = () => {
    appState.isLoading = false;
    if (loadingOverlay) loadingOverlay.style.display = 'none';
};

const toYYYYMMDD = (date) => {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
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

            if (error && error.code !== 'PGRST116') throw error;
            return data;
        } catch (error) {
            throw new Error(`Failed to fetch profile: ${error.message}`);
        }
    },

    async saveProfile(profileData) {
        try {
            const { error } = await supabase.from('profiles').upsert(profileData);
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
            const updatePromises = [];
            for (const [id, status] of appState.pendingChanges) {
                updatePromises.push(
                    supabase.from('attendance_log').update({ status }).eq('id', id)
                );
            }

            const results = await Promise.all(updatePromises);
            const firstError = results.find(res => res.error);
            if (firstError) throw firstError.error;

            for (const [id, status] of appState.pendingChanges) {
                const logIndex = appState.attendanceLog.findIndex(log => String(log.id) === id);
                if (logIndex !== -1) appState.attendanceLog[logIndex].status = status;
            }
            appState.pendingChanges.clear();
        } catch (error) {
            throw new Error(`Failed to save attendance changes: ${error.message}`);
        }
    },

    async deleteAttendanceForSubjects(subjectsToDelete) {
        if (subjectsToDelete.length === 0) return;
        try {
            const subjectNames = subjectsToDelete.map(s => s.name);
            const { error } = await supabase
                .from('attendance_log')
                .delete()
                .eq('user_id', appState.currentUser.id)
                .in('subject_name', subjectNames);
            if (error) throw error;
        } catch (error) {
            throw new Error(`Failed to delete old attendance records: ${error.message}`);
        }
    }
};

// --- UI State Management ---
const UIManager = {
    updateSaveButton() {
        if (!saveAttendanceContainer) return;
        if (appState.hasPendingChanges() && !saveAttendanceContainer.querySelector('button')) {
            saveAttendanceContainer.innerHTML = `<button id="save-attendance-btn" class="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg shadow-lg transition-transform transform hover:scale-105">Save Changes</button>`;
        } else if (!appState.hasPendingChanges()) {
            saveAttendanceContainer.innerHTML = '';
        }
    },

    showView(viewName) {
        const views = { onboarding: onboardingView, dashboard: dashboardView };
        Object.entries(views).forEach(([name, element]) => {
            if (element) element.style.display = name === viewName ? 'block' : 'none';
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
    getWeight(subjectName, category) {
        if (category === 'Lab') return 2;
        if (subjectName === 'DSA' || subjectName === 'DA') return 2;
        return 1;
    },

    getUpcomingScheduleForSubject(subjectName) {
        const schedule = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (let i = 0; i < 180; i++) {
            const futureDate = new Date();
            futureDate.setDate(today.getDate() + i);

            const dayIndex = futureDate.getDay();
            if (dayIndex >= 1 && dayIndex <= 5) {
                const dayName = WEEKDAYS[dayIndex - 1];
                const lecturesForDay = appState.userProfile.timetable_json[dayName] || [];

                lecturesForDay.forEach(lectureString => {
                    const parts = lectureString.split(' ');
                    const category = parts.pop();
                    const currentSubjectName = parts.join(' ');

                    if (currentSubjectName === subjectName) {
                        schedule.push({
                            date: toYYYYMMDD(futureDate),
                            category: category,
                            weight: this.getWeight(currentSubjectName, category)
                        });
                    }
                });
            }
        }
        return schedule;
    },

    calculateBunkingAdvice(subjectName, totalAttended, totalHeld) {
        const thresholdPercent = appState.userProfile.attendance_threshold;
        const threshold = thresholdPercent / 100;

        if (totalHeld === 0) {
            return { status: 'safe', message: 'No classes held yet.' };
        }

        const currentPercentage = (totalAttended / totalHeld) * 100;

        if (currentPercentage < thresholdPercent) {
            const lecturesNeeded = Math.ceil((threshold * totalHeld - totalAttended) / (1 - threshold));
            const upcomingSchedule = this.getUpcomingScheduleForSubject(subjectName);

            if (upcomingSchedule.length === 0) {
                return { status: 'danger', message: `Need ${lecturesNeeded} more lectures, but no upcoming classes found.` };
            }

            let lecturesGained = 0;
            let sessionsToAttend = 0;
            let theorySessions = 0;
            let labSessions = 0;
            
            const firstWeight = upcomingSchedule[0].weight;
            const hasMixedWeights = upcomingSchedule.some(s => s.weight !== firstWeight);

            for (const session of upcomingSchedule) {
                if (lecturesGained >= lecturesNeeded) break;
                lecturesGained += session.weight;
                sessionsToAttend++;
                if (session.category === 'Theory') theorySessions++;
                else labSessions++;
            }
            
            let message = `Attend next ${sessionsToAttend} sessions to reach ${thresholdPercent}%.`;
            if (hasMixedWeights && labSessions > 0 && theorySessions > 0) {
                message = `Attend next ${sessionsToAttend} sessions (${labSessions} Lab, ${theorySessions} Theory) to reach ${thresholdPercent}%.`;
            } else if (sessionsToAttend === 1 && hasMixedWeights) {
                 message = `Attend next 1 ${labSessions > 0 ? 'Lab' : 'Theory'} session to reach ${thresholdPercent}%.`;
            }
            return { status: 'danger', message };
        }
        
        const bunksAvailable = Math.floor((totalAttended - threshold * totalHeld) / threshold);
        
        if (bunksAvailable >= 1) {
            const upcomingSchedule = this.getUpcomingScheduleForSubject(subjectName);
            let lecturesCanMiss = bunksAvailable;
            let sessionsToMiss = 0;
            for (const session of upcomingSchedule) {
                if (lecturesCanMiss < session.weight) break;
                lecturesCanMiss -= session.weight;
                sessionsToMiss++;
            }
            return { status: 'safe', message: `Safe to miss next ${sessionsToMiss} sessions. Your % will stay above ${thresholdPercent}%.` };
        }
        
        return { status: 'warning', message: `At ${currentPercentage.toFixed(1)}%. Cannot miss any more classes.` };
    },
    
    calculateSummary() {
        const summary = {};
        
        (appState.userProfile.unique_subjects || []).forEach(name => {
            summary[name] = {
                Theory: { attended: 0, held: 0 },
                Lab: { attended: 0, held: 0 }
            };
        });

        for (const log of appState.attendanceLog) {
            const { subject_name, category, status } = log;
            if (!summary[subject_name] || !summary[subject_name][category]) continue;

            const weight = this.getWeight(subject_name, category);
            
            if (status === 'Attended' || status === 'Missed') {
                summary[subject_name][category].held += weight;
            }
            
            if (status === 'Attended') {
                summary[subject_name][category].attended += weight;
            }
        }
        return summary;
    }
};

// --- Rendering Logic ---
const Renderer = {
    renderSummaryTable() {
        if (!attendanceSummary || !appState.userProfile) return;

        const summaryData = AttendanceCalculator.calculateSummary();

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

        const subjects = appState.userProfile.unique_subjects || [];
        if (subjects.length === 0) {
            tableHTML += `<tr><td colspan="6" class="px-6 py-4 text-center text-gray-500">No subjects defined.</td></tr>`;
        } else {
            subjects.sort().forEach(subjectName => {
                const subjectSummary = summaryData[subjectName];
                const hasTheory = this.hasSubjectCategory(subjectName, 'Theory');
                const hasLab = this.hasSubjectCategory(subjectName, 'Lab');
                
                if (!hasTheory && !hasLab) return;

                const theoryData = subjectSummary.Theory;
                const labData = subjectSummary.Lab;
                
                const showCombinedRow = hasTheory && hasLab;
                
                if (hasTheory) {
                    tableHTML += this.renderSubjectRow(subjectName, 'Theory', theoryData.attended, theoryData.held, showCombinedRow, true);
                }
                if (hasLab) {
                    tableHTML += this.renderSubjectRow(subjectName, 'Lab', labData.attended, labData.held, showCombinedRow, !hasTheory);
                }
                if (showCombinedRow) {
                    tableHTML += this.renderCombinedRow(subjectName, theoryData.attended + labData.attended, theoryData.held + labData.held);
                }
            });
        }

        tableHTML += '</tbody></table></div>';
        attendanceSummary.innerHTML = tableHTML;
    },

    _hasCategoryCache: new Map(),
    hasSubjectCategory(subjectName, category) {
        const cacheKey = `${subjectName}-${category}`;
        if (this._hasCategoryCache.has(cacheKey)) return this._hasCategoryCache.get(cacheKey);

        for (const day of WEEKDAYS) {
            if ((appState.userProfile.timetable_json[day] || []).includes(`${subjectName} ${category}`)) {
                this._hasCategoryCache.set(cacheKey, true);
                return true;
            }
        }
        this._hasCategoryCache.set(cacheKey, false);
        return false;
    },

    renderSubjectRow(subjectName, category, attended, held, showCombined, isFirstRow) {
        const percentage = held > 0 ? ((attended / held) * 100).toFixed(1) + '%' : 'N/A';
        const isBelowThreshold = held > 0 && ((attended / held) * 100) < appState.userProfile.attendance_threshold;
        
        let bunkingInfoCell = '';
        if (!showCombined) {
            const bunkingInfo = AttendanceCalculator.calculateBunkingAdvice(subjectName, attended, held);
            const statusColorClass = bunkingInfo.status === 'safe' ? 'bg-green-100 text-green-800' : bunkingInfo.status === 'warning' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800';
            bunkingInfoCell = `<td class="px-6 py-4 text-sm text-center"><div class="p-2 rounded-md ${statusColorClass} inline-block min-w-[180px]">${bunkingInfo.message}</div></td>`;
        }
        
        const rowspan = showCombined ? 3 : 1;
        const subjectCell = isFirstRow ? `<td class="px-6 py-4 whitespace-nowrap font-medium text-gray-900 text-left" rowspan="${rowspan}">${subjectName}</td>` : '';
        
        return `<tr class="${isBelowThreshold ? 'bg-red-50' : ''}">
                    ${subjectCell}
                    <td class="px-6 py-4 whitespace-nowrap text-gray-500 text-left">${category}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-gray-500 text-center">${attended}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-gray-500 text-center">${held}</td>
                    <td class="px-6 py-4 whitespace-nowrap font-medium text-center ${isBelowThreshold ? 'text-red-600' : 'text-gray-900'}">${percentage}</td>
                    ${bunkingInfoCell}
                </tr>`;
    },

    renderCombinedRow(subjectName, totalAttended, totalHeld) {
        const overallPercentage = totalHeld > 0 ? ((totalAttended / totalHeld) * 100).toFixed(1) + '%' : 'N/A';
        const isBelowThreshold = totalHeld > 0 && ((totalAttended / totalHeld) * 100) < appState.userProfile.attendance_threshold;
        
        const bunkingInfo = AttendanceCalculator.calculateBunkingAdvice(subjectName, totalAttended, totalHeld);
        const statusColorClass = bunkingInfo.status === 'safe' ? 'bg-green-100 text-green-800' : bunkingInfo.status === 'warning' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800';

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

        let logHTML = `<div class="space-y-4">`;
        lecturesOnDate
            .sort((a, b) => `${a.subject_name} ${a.category}`.localeCompare(`${b.subject_name} ${b.category}`))
            .forEach(log => {
                const status = appState.pendingChanges.get(String(log.id)) || log.status;
                logHTML += this.renderLectureItem(log, status);
            });
        
        logHTML += `</div>`;
        dailyLogContainer.innerHTML = logHTML;
        UIManager.updateSaveButton();
    },

    renderLectureItem(log, currentStatus) {
        const getButtonClass = (btnStatus, isActive) => {
            const baseClass = 'log-btn px-3 py-1 text-sm font-medium rounded-md transition-colors';
            if (isActive) {
                const activeClasses = {
                    'Attended': 'bg-green-500 text-white',
                    'Missed': 'bg-red-500 text-white',
                    'Cancelled': 'bg-yellow-500 text-white',
                    'Not Held Yet': 'bg-gray-400 text-white'
                };
                return `${baseClass} ${activeClasses[btnStatus]}`;
            }
            return `${baseClass} bg-gray-200 text-gray-700 hover:bg-gray-300`;
        };

        const buttons = ['Attended', 'Missed', 'Cancelled', 'Not Held Yet'];
        let buttonHTML = buttons.map(status => {
            const isActive = (currentStatus || 'Not Held Yet') === status;
            return `<button data-status="${status}" class="${getButtonClass(status, isActive)}">${status}</button>`;
        }).join('');
        
        return `
            <div class="log-item flex items-center justify-between p-4 bg-white rounded-lg shadow-sm" data-log-id="${log.id}">
                <strong class="text-gray-800">${log.subject_name} (${log.category})</strong>
                <div class="log-actions flex flex-wrap gap-2 justify-end">
                    ${buttonHTML}
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
            elements.setupTitle.textContent = "Edit Timetable";
            elements.setupSubtitle.textContent = "Modify subjects and classes. Existing attendance data for changed subjects will be preserved.";
            elements.saveTimetableBtn.textContent = "Save Changes";
            elements.startDateInput.value = appState.userProfile.start_date;
            elements.startDateInput.disabled = true;
            elements.minAttendanceInput.value = appState.userProfile.attendance_threshold;
        } else {
            elements.setupTitle.textContent = "Initial Setup";
            elements.setupSubtitle.textContent = "Welcome! Please build your timetable below.";
            elements.saveTimetableBtn.textContent = "Save and Build Dashboard";
            elements.startDateInput.disabled = false;
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
        container.innerHTML = WEEKDAYS.map(day => {
            const scheduledClasses = appState.isEditingMode ? (appState.userProfile.timetable_json[day] || []) : [];
            
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
        this._hasCategoryCache.clear();
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
        const populateUntilDate = new Date();
        populateUntilDate.setDate(populateUntilDate.getDate() + 7);
        const populateUntilDateStr = toYYYYMMDD(populateUntilDate);

        let populateFromDate;
        if (appState.userProfile.last_log_date) {
            const lastLogDate = new Date(appState.userProfile.last_log_date + 'T00:00:00Z');
            populateFromDate = new Date(lastLogDate.setDate(lastLogDate.getDate() + 1));
        } else {
            populateFromDate = new Date(appState.userProfile.start_date + 'T00:00:00Z');
        }

        if (toYYYYMMDD(populateFromDate) > populateUntilDateStr) {
            return;
        }

        let entriesToUpsert = [];
        let currentDate = new Date(populateFromDate);
        const todayStr = toYYYYMMDD(new Date());
        
        while (toYYYYMMDD(currentDate) <= populateUntilDateStr) {
            const dayIndex = currentDate.getDay();
            if (dayIndex >= 1 && dayIndex <= 5) {
                const dayName = WEEKDAYS[dayIndex - 1];
                const lecturesForDay = [...new Set(appState.userProfile.timetable_json[dayName] || [])];
                
                const currentDateStr = toYYYYMMDD(currentDate);
                const status = currentDateStr < todayStr ? 'Missed' : 'Not Held Yet';

                lecturesForDay.forEach(subjectString => {
                    const parts = subjectString.split(' ');
                    const category = parts.pop();
                    const subject_name = parts.join(' ');
                    
                    entriesToUpsert.push({
                        user_id: appState.currentUser.id,
                        date: currentDateStr,
                        subject_name,
                        category,
                        status: status
                    });
                });
            }
            currentDate.setDate(currentDate.getDate() + 1);
        }

        if (entriesToUpsert.length > 0) {
            const { error } = await supabase.from('attendance_log').upsert(entriesToUpsert, { onConflict: 'user_id,date,subject_name,category' });
            if (error) throw new Error(`Database error during log population: ${error.message}`);
        }
        
        await this.updateLastLogDate(populateUntilDateStr);
    },

    async updateLastLogDate(dateStr) {
        if (appState.userProfile.last_log_date !== dateStr) {
            const { error } = await supabase
                .from('profiles')
                .update({ last_log_date: dateStr })
                .eq('id', appState.currentUser.id);
            if (error) throw error;
            appState.userProfile.last_log_date = dateStr;
        }
    }
};

// --- Main Application Logic ---
const init = async () => {
    try {
        showLoading('Initializing...');
        
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error || !session) {
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
            setupError.textContent = '';

            const formData = this.getSetupFormData();
            if (!this.validateSetupForm(formData)) {
                setupError.textContent = 'Please set a start date, percentage, and add at least one subject.';
                return;
            }

            const oldProfile = appState.userProfile;
            const newProfileData = this.buildProfileData(formData);

            if (appState.isEditingMode) {
                const subjectsToDelete = this.findSubjectsToDelete(oldProfile.unique_subjects, newProfileData.unique_subjects);
                if (subjectsToDelete.length > 0) {
                    const confirmed = await showCustomConfirm(`The following subjects will be completely removed from your history: ${subjectsToDelete.map(s=>s.name).join(', ')}. Are you sure?`);
                    if (!confirmed) return;
                    await DataManager.deleteAttendanceForSubjects(subjectsToDelete);
                }
            }

            await DataManager.saveProfile(newProfileData);
            appState.userProfile = { ...oldProfile, ...newProfileData };

            await runFullAttendanceUpdate();
            UIManager.showView('dashboard');
            
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
        WEEKDAYS.forEach(day => {
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

    findSubjectsToDelete(oldSubjects = [], newSubjects = []) {
        const oldSet = new Set(oldSubjects);
        const newSet = new Set(newSubjects);
        const toDelete = [];
        oldSet.forEach(oldSub => {
            if (!newSet.has(oldSub)) {
                toDelete.push({ name: oldSub });
            }
        });
        return toDelete;
    },
    
    buildProfileData(formData) {
        const baseData = {
            id: appState.currentUser.id,
            start_date: formData.startDate,
            timetable_json: formData.timetable,
            unique_subjects: formData.uniqueSubjects,
            attendance_threshold: parseInt(formData.minAttendance),
        };
        
        if (appState.isEditingMode) {
            return { ...baseData, last_log_date: appState.userProfile.last_log_date };
        } else {
            return { ...baseData, last_log_date: null };
        }
    },
    
    async handleEditTimetable() {
        try {
            if (appState.hasPendingChanges()) {
                const proceed = await showCustomConfirm("You have unsaved attendance changes that will be lost. Continue?");
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
        const subjectSet = new Set();
        for (const day of WEEKDAYS) {
            (appState.userProfile.timetable_json[day] || []).forEach(cls => subjectSet.add(cls));
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
        
        list.insertAdjacentHTML('beforeend', `
            <li class="flex justify-between items-center bg-blue-100 text-blue-800 text-sm font-medium px-2 py-1 rounded" data-value="${select.value}">
                ${select.options[select.selectedIndex].text}
                <button type="button" class="remove-class-btn text-blue-500 hover:text-blue-700 font-bold ml-2">x</button>
            </li>`);
        
        select.value = '';
    },

    handleMarkAttendance(e) {
        const button = e.target.closest('.log-btn');
        if (!button) return;

        const newStatus = button.dataset.status;
        const logItem = button.closest('.log-item');
        const logId = logItem.dataset.logId;

        appState.pendingChanges.set(logId, newStatus);
        
        const allButtons = logItem.querySelectorAll('.log-btn');
        allButtons.forEach(btn => {
            const status = btn.dataset.status;
            const isActive = status === newStatus;
            btn.className = `log-btn px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                isActive 
                ? {Attended: 'bg-green-500 text-white', Missed: 'bg-red-500 text-white', Cancelled: 'bg-yellow-500 text-white', 'Not Held Yet': 'bg-gray-400 text-white'}[status]
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`;
        });

        UIManager.updateSaveButton();
    },

    async handleSaveChanges() {
        if (!appState.hasPendingChanges()) return;
        try {
            showLoading('Saving...');
            await DataManager.saveAttendanceChanges();
            Renderer.renderDashboard();
        } catch (error) {
            handleError(error, 'Failed to save changes');
        } finally {
            hideLoading();
        }
    },

    async handleDateChange(e) {
        if (appState.hasPendingChanges()) {
            const discard = await showCustomConfirm("You have unsaved changes. Discard them?");
            if (!discard) {
                UIManager.setDatePicker(appState.currentViewDate || toYYYYMMDD(new Date()));
                return;
            }
            appState.pendingChanges.clear();
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
                showCustomConfirm("Please select both a date and a weekday schedule.");
                return;
            }

            showLoading('Adding extra day...');
            const lecturesToAdd = appState.userProfile.timetable_json[weekday] || [];
            if (lecturesToAdd.length === 0) {
                showCustomConfirm(`No classes are scheduled on a ${weekday}.`);
                hideLoading();
                return;
            }

            const todayStr = toYYYYMMDD(new Date());
            const defaultStatus = extraDateStr < todayStr ? 'Missed' : 'Not Held Yet';

            const newLogEntries = lecturesToAdd.map(subjectString => {
                const parts = subjectString.split(' ');
                const category = parts.pop();
                const subject_name = parts.join(' ');
                return { user_id: appState.currentUser.id, date: extraDateStr, subject_name, category, status: defaultStatus };
            });

            const { error } = await supabase.from('attendance_log').upsert(newLogEntries, { onConflict: 'user_id,date,subject_name,category' });
            if (error) throw error;
            
            await DataManager.loadAttendanceLog();
            UIManager.setDatePicker(extraDateStr);
            Renderer.renderDashboard();
            
            extraDayModal.style.display = 'none';
            form.reset();
        } catch (error) {
            handleError(error, 'Failed to add extra day');
        } finally {
            hideLoading();
        }
    }
};

// --- Event Listener Management ---
let isInitialized = false;

const initializeApp = () => {
    if (isInitialized) return;

    document.addEventListener('DOMContentLoaded', init);
    
    logoutButton?.addEventListener('click', async () => {
        await supabase.auth.signOut();
        window.location.href = '/index.html';
    });

    setupForm?.addEventListener('submit', EventHandlers.handleSetup.bind(EventHandlers));
    
    onboardingView?.addEventListener('click', (e) => {
        if (e.target.id === 'add-subject-btn') EventHandlers.handleAddSubject();
        else if (e.target.classList.contains('remove-subject-btn')) {
            appState.setupSubjects.splice(e.target.dataset.index, 1);
            Renderer.renderOnboardingUI();
        } 
        else if (e.target.classList.contains('add-class-btn')) EventHandlers.handleAddClassToDay(e.target.dataset.day);
        else if (e.target.classList.contains('remove-class-btn')) e.target.parentElement.remove();
    });

    settingsSection?.addEventListener('click', async (e) => {
        if (e.target.id === 'edit-timetable-btn') await EventHandlers.handleEditTimetable();
        else if (e.target.id === 'clear-attendance-btn') {
            if (!await showCustomConfirm("Are you sure? This resets all attendance but keeps your timetable.")) return;
            showLoading('Clearing records...');
            await supabase.from('attendance_log').delete().eq('user_id', appState.currentUser.id);
            await supabase.from('profiles').update({ last_log_date: null }).eq('id', appState.currentUser.id);
            window.location.reload();
        }
    });

    document.body.addEventListener('click', (e) => {
        if (e.target.id === 'save-attendance-btn') EventHandlers.handleSaveChanges();
        else if (e.target.closest('.log-actions')) EventHandlers.handleMarkAttendance(e);
        else if (e.target.id === 'show-extra-day-modal-btn') {
            if (extraDayModal) extraDayModal.style.display = 'flex';
        }
    });

    extraDayModal?.addEventListener('click', (e) => {
        if (e.target.id === 'cancel-extra-day-btn' || e.target.id === 'extra-day-modal') {
            extraDayModal.style.display = 'none';
            if (extraDayForm) extraDayForm.reset();
        }
    });

    extraDayForm?.addEventListener('submit', EventHandlers.handleAddExtraDay.bind(EventHandlers));
    historicalDatePicker?.addEventListener('change', EventHandlers.handleDateChange.bind(EventHandlers));
    
    confirmYesBtn?.addEventListener('click', () => {
        if (customConfirmModal) customConfirmModal.style.display = 'none';
        if (appState.confirmResolve) appState.confirmResolve(true);
        appState.confirmResolve = null;
    });

    confirmNoBtn?.addEventListener('click', () => {
        if (customConfirmModal) customConfirmModal.style.display = 'none';
        if (appState.confirmResolve) appState.confirmResolve(false);
        appState.confirmResolve = null;
    });

    isInitialized = true;
};

initializeApp();
