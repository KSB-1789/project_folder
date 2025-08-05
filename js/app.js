import { supabase } from './supabaseClient.js';

// --- Constants ---
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

// --- DOM Elements (will be assigned after DOM is loaded) ---
let loadingOverlay, logoutButton, dashboardView, timetableModal, timetableForm, extraDayModal, extraDayForm, customConfirmModal, confirmModalText, confirmYesBtn, confirmNoBtn;

// --- Application State ---
class AppState {
    constructor() {
        this.currentUser = null;
        this.userProfile = null;
        this.attendanceLog = [];
        this.setupSubjects = []; // Used only inside the timetable modal
        this.pendingChanges = new Map();
        this.editingTimetable = null; // The timetable object being edited
        this.currentViewDate = new Date();
    }

    getActiveTimetable(date = new Date()) {
        if (!this.userProfile?.timetables) return null;
        const dateStr = toYYYYMMDD(date);
        
        // First check for special timetables
        const specialTimetable = this.userProfile.timetables.find(tt => 
            (tt.type === 'special' || tt.type === undefined) && 
            dateStr >= tt.startDate && 
            dateStr <= tt.endDate &&
            (tt.isActive === true || tt.isActive === undefined)
        );
        
        if (specialTimetable) return specialTimetable;
        
        // Then check for normal timetables
        return this.userProfile.timetables.find(tt => 
            (tt.type === 'normal' || tt.type === undefined) && 
            dateStr >= tt.startDate && 
            dateStr <= tt.endDate &&
            (tt.isActive === true || tt.isActive === undefined)
        );
    }

    getTimetableForDate(date = new Date()) {
        if (!this.userProfile?.timetables) return null;
        const dateStr = toYYYYMMDD(date);
        
        // Return all active timetables that apply to this date
        return this.userProfile.timetables.filter(tt => 
            dateStr >= tt.startDate && 
            dateStr <= tt.endDate &&
            (tt.isActive === true || tt.isActive === undefined)
        );
    }

    isAttendancePaused() {
        return this.userProfile?.attendance_paused || false;
    }
}
const appState = new AppState();

// --- Utility Functions ---
const showLoading = (message = 'Loading...') => {
    const loadingText = document.getElementById('loading-text');
    if (loadingText) loadingText.textContent = message;
    if (loadingOverlay) loadingOverlay.style.display = 'flex';
};

const hideLoading = () => {
    if (loadingOverlay) loadingOverlay.style.display = 'none';
};

const toYYYYMMDD = (date) => {
    if (!date) return null;
    
    try {
        const d = new Date(date);
        if (isNaN(d.getTime())) {
            console.warn('Invalid date provided to toYYYYMMDD:', date);
            return null;
        }
        d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); // Adjust for timezone
        return d.toISOString().split('T')[0];
    } catch (error) {
        console.error('Error in toYYYYMMDD:', error, 'Input:', date);
        return null;
    }
};

const showCustomConfirm = (message) => {
    if (!customConfirmModal) return Promise.resolve(window.confirm(message));
    
    confirmModalText.textContent = message;
    customConfirmModal.style.display = 'flex';
    return new Promise((resolve) => {
        const onYes = () => cleanupAndResolve(true);
        const onNo = () => cleanupAndResolve(false);
        const cleanupAndResolve = (value) => {
            customConfirmModal.style.display = 'none';
            confirmYesBtn.removeEventListener('click', onYes);
            confirmNoBtn.removeEventListener('click', onNo);
            resolve(value);
        };
        confirmYesBtn.addEventListener('click', onYes, { once: true });
        confirmNoBtn.addEventListener('click', onNo, { once: true });
    });
};

const handleError = (error, context = '') => {
    console.error(`Error in ${context}:`, error);
    alert(`${context}: ${error.message || 'An unexpected error occurred.'}`);
    hideLoading();
};

// --- Data Management ---
const DataManager = {
    async fetchUserProfile() {
        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', appState.currentUser.id)
            .single();
        if (error && error.code !== 'PGRST116') throw error;
        return data;
    },

    async saveUserProfile(profileData) {
        try {
            const { error } = await supabase.from('profiles').upsert(profileData);
            if (error) throw error;
        } catch (error) {
            console.error('Error saving user profile:', error);
            throw error;
        }
    },

    async updateAttendancePauseStatus(paused) {
        const { error } = await supabase.from('profiles').update({ attendance_paused: paused }).eq('id', appState.currentUser.id);
        if (error) throw error;
        appState.userProfile.attendance_paused = paused;
    },

    async loadAttendanceLog() {
        const { data, error } = await supabase.from('attendance_log').select('*').eq('user_id', appState.currentUser.id);
        if (error) throw error;
        appState.attendanceLog = data || [];
    },

    async saveAttendanceChanges() {
        if (appState.pendingChanges.size === 0) return;
        const updatePromises = Array.from(appState.pendingChanges, ([id, status]) =>
            supabase.from('attendance_log').update({ status }).eq('id', id)
        );
        const results = await Promise.all(updatePromises);
        const firstError = results.find(res => res.error);
        if (firstError) throw firstError.error;
        appState.pendingChanges.clear();
        await DataManager.loadAttendanceLog();
    }
};

// --- Business Logic ---
const AttendanceCalculator = {
    getWeight(subjectFullName, date) {
        const activeTimetable = appState.getActiveTimetable(date);
        return activeTimetable?.subjectWeights?.[subjectFullName] || 1;
    },

    getSubjectAttendance(subjectName, category, date) {
        const logEntries = appState.attendanceLog.filter(log => 
            log.subject_name === subjectName && 
            log.category === category &&
            new Date(log.date) <= new Date(date)
        );
        
        let attended = 0, held = 0;
        logEntries.forEach(log => {
            const weight = this.getWeight(`${log.subject_name} ${log.category}`, new Date(log.date));
            if (log.status === 'Attended' || log.status === 'Missed') held += weight;
            if (log.status === 'Attended') attended += weight;
        });
        
        return { attended, held };
    },
    
    getUpcomingScheduleForSubject(subjectName) {
        const schedule = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (let i = 0; i < 180; i++) {
            const futureDate = new Date();
            futureDate.setDate(today.getDate() + i);
            const activeTimetable = appState.getActiveTimetable(futureDate);
            if (!activeTimetable) continue;

            const dayName = WEEKDAYS[futureDate.getDay() - 1];
            if (!dayName) continue;

            (activeTimetable.schedule[dayName] || []).forEach(lectureString => {
                if (lectureString.startsWith(subjectName)) {
                    const parts = lectureString.split(' ');
                    const category = parts.pop();
                    schedule.push({ weight: this.getWeight(lectureString, futureDate), category });
                }
            });
        }
        return schedule;
    },
    
    calculateBunkingAdvice(subjectName, totalAttended, totalHeld) {
        const thresholdPercent = appState.userProfile.attendance_threshold;
        const threshold = thresholdPercent / 100;
        if (totalHeld === 0) return { status: 'safe', message: 'No classes held yet.' };
        const currentPercentage = (totalAttended / totalHeld) * 100;

        if (currentPercentage < thresholdPercent) {
            const lecturesNeeded = Math.ceil((threshold * totalHeld - totalAttended) / (1 - threshold));
            const upcomingSchedule = this.getUpcomingScheduleForSubject(subjectName);
            if (upcomingSchedule.length === 0) return { status: 'danger', message: `Need ${lecturesNeeded} more lectures, no classes found.` };

            let lecturesGained = 0, sessionsToAttend = 0, theorySessions = 0, labSessions = 0;
            const hasMixedWeights = upcomingSchedule.some(s => s.weight !== upcomingSchedule[0].weight);

            for (const session of upcomingSchedule) {
                if (lecturesGained >= lecturesNeeded) break;
                lecturesGained += session.weight;
                sessionsToAttend++;
                if (session.category === 'Theory') theorySessions++; else labSessions++;
            }
            
            let message = `Attend next ${sessionsToAttend} sessions to reach ${thresholdPercent}%.`;
            if (hasMixedWeights && (labSessions > 0 || theorySessions > 0)) {
                const breakdown = [labSessions > 0 ? `${labSessions} Lab` : '', theorySessions > 0 ? `${theorySessions} Theory` : ''].filter(Boolean).join(', ');
                message = `Attend next ${sessionsToAttend} sessions (${breakdown}) to reach ${thresholdPercent}%.`;
            }
            return { status: 'danger', message };
        }
        
        const bunksAvailable = Math.floor((totalAttended - threshold * totalHeld) / threshold);
        if (bunksAvailable >= 1) {
            const upcomingSchedule = this.getUpcomingScheduleForSubject(subjectName);
            let lecturesCanMiss = bunksAvailable, sessionsToMiss = 0;
            for (const session of upcomingSchedule) {
                if (lecturesCanMiss < session.weight) break;
                lecturesCanMiss -= session.weight;
                sessionsToMiss++;
            }
            return { status: 'safe', message: `Safe to miss next ${sessionsToMiss} sessions.` };
        }
        
        return { status: 'warning', message: `At ${currentPercentage.toFixed(1)}%. Cannot miss.` };
    },
    
    calculateSummary() {
        const summary = {};
        const allSubjects = new Set();
        (appState.userProfile.timetables || []).forEach(tt => {
            Object.keys(tt.subjectWeights || {}).forEach(subFullName => {
                const subjectName = subFullName.split(' ').slice(0, -1).join(' ');
                allSubjects.add(subjectName);
            });
        });

        allSubjects.forEach(name => {
            summary[name] = { Theory: { attended: 0, held: 0 }, Lab: { attended: 0, held: 0 } };
        });

        for (const log of appState.attendanceLog) {
            const { date, subject_name, category, status } = log;
            
            // Always count held classes (for consistent dashboard display)
            const weight = this.getWeight(`${subject_name} ${category}`, new Date(date));
            if (!summary[subject_name]) continue;

            if (status === 'Attended' || status === 'Missed') {
                summary[subject_name][category].held += weight;
            }
            
            // Only count attended classes based on pause status
            if (status === 'Attended') {
                if (appState.isAttendancePaused()) {
                    // When paused, only count attendance from special timetables
                    const activeTimetable = appState.getActiveTimetable(new Date(date));
                    if (activeTimetable && activeTimetable.type === 'special') {
                        summary[subject_name][category].attended += weight;
                    }
                } else {
                    // When not paused, count all attendance
                    summary[subject_name][category].attended += weight;
                }
            }
        }
        return summary;
    }
};

// --- Rendering Logic ---
const Renderer = {
    renderDashboard() {
        dashboardView.innerHTML = `
            <div id="attendance-summary" class="bg-white/70 dark:bg-apple-gray-900/70 backdrop-blur-xl p-8 rounded-2xl shadow-apple dark:shadow-apple-dark border border-gray-200/50 dark:border-apple-gray-800/50"></div>
            <div id="actions-section" class="bg-white/70 dark:bg-apple-gray-900/70 backdrop-blur-xl p-8 rounded-2xl shadow-apple dark:shadow-apple-dark border border-gray-200/50 dark:border-apple-gray-800/50">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-2xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-300 bg-clip-text text-transparent">Mark Attendance</h2>
                    <button id="show-extra-day-modal-btn" class="bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white font-semibold py-2.5 px-4 rounded-xl text-sm shadow-apple dark:shadow-apple-dark transition-all duration-200 border border-indigo-400/20">Add Extra Day</button>
                </div>
                <div class="date-selector mb-4">
                    <label for="historical-date" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Select Date:</label>
                    <input type="date" id="historical-date" class="block w-full px-4 py-3 bg-gray-50/80 dark:bg-apple-gray-800/80 border border-gray-200/50 dark:border-apple-gray-700/50 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 dark:text-white backdrop-blur-sm transition-all duration-200">
                </div>
                <div id="daily-log-container"></div>
                <div id="save-attendance-container" class="mt-4"></div>
            </div>
            <div id="settings-section" class="bg-white/70 dark:bg-apple-gray-900/70 backdrop-blur-xl p-8 rounded-2xl shadow-apple dark:shadow-apple-dark border border-gray-200/50 dark:border-apple-gray-800/50">
                <h2 class="text-2xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-300 bg-clip-text text-transparent mb-6">Settings</h2>
                <div class="space-y-6">
                    <div>
                        <h3 class="text-lg font-semibold text-gray-800 dark:text-white mb-3">Attendance Control</h3>
                        <div class="flex items-center justify-between p-6 bg-gray-50/80 dark:bg-apple-gray-850/80 rounded-2xl backdrop-blur-sm border border-gray-200/50 dark:border-apple-gray-800/50">
                            <div>
                                <p class="text-sm font-medium text-gray-700 dark:text-gray-300">Normal Timetable Attendance</p>
                                <p class="text-xs text-gray-500 dark:text-gray-400">Pause normal timetable counting (special timetables continue)</p>
                            </div>
                            <button id="toggle-attendance-btn" class="px-4 py-2 rounded-lg font-semibold transition-colors">
                                ${appState.isAttendancePaused() ? 'Resume Normal' : 'Pause Normal'}
                            </button>
                        </div>
                    </div>
                    <div>
                        <h3 class="text-lg font-semibold text-gray-800 dark:text-white mb-3">Timetable Management</h3>
                        <div id="timetables-list" class="space-y-3 mb-4"></div>
                        <div class="flex gap-2">
                            <button id="add-normal-timetable-btn" class="flex-1 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-semibold py-3 px-4 rounded-xl shadow-apple dark:shadow-apple-dark transition-all duration-200 border border-green-400/20">Add Normal Timetable</button>
                            <button id="add-special-timetable-btn" class="flex-1 bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white font-semibold py-3 px-4 rounded-xl shadow-apple dark:shadow-apple-dark transition-all duration-200 border border-purple-400/20">Add Special Timetable</button>
                        </div>
                    </div>
                    <div>
                        <p class="text-sm font-medium text-gray-700 dark:text-gray-300">Clear Attendance Records</p>
                        <p class="text-xs text-gray-500 dark:text-gray-400 mb-2">Resets all attendance records to default but keeps your timetables.</p>
                        <button id="clear-attendance-btn" class="w-full bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white font-semibold py-3 px-4 rounded-xl shadow-apple dark:shadow-apple-dark transition-all duration-200 border border-orange-400/20">Clear All Attendance</button>
                    </div>
                </div>
            </div>`;

        const attendanceSummary = document.getElementById('attendance-summary');
        const dailyLogContainer = document.getElementById('daily-log-container');
        
        if (!appState.getActiveTimetable()) {
            if (attendanceSummary) {
                attendanceSummary.innerHTML = `<div class="text-center p-12">
                    <div class="flex flex-col items-center space-y-4">
                        <div class="w-20 h-20 bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-blue-900/30 dark:to-indigo-900/30 rounded-3xl flex items-center justify-center shadow-apple dark:shadow-apple-dark">
                            <svg class="w-10 h-10 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                            </svg>
                        </div>
                        <div class="text-center">
                            <h2 class="text-2xl font-bold mb-2 bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-300 bg-clip-text text-transparent">No Active Timetable</h2>
                            <p class="text-gray-600 dark:text-gray-400 max-w-md">Create your first timetable with subjects and schedule to start tracking attendance</p>
                        </div>
                    </div>
                </div>`;
            }
            if (dailyLogContainer) {
                dailyLogContainer.innerHTML = '';
            }
        } else {
            const activeTimetable = appState.getActiveTimetable();
            const statusIndicator = document.createElement('div');
            statusIndicator.className = 'mb-4 p-3 rounded-lg border-l-4';
            
            if (activeTimetable.type === 'special') {
                statusIndicator.className += ' bg-purple-50/80 dark:bg-purple-900/20 border-purple-400 dark:border-purple-600 backdrop-blur-sm';
                statusIndicator.innerHTML = `
                    <div class="flex items-center">
                        <span class="text-purple-800 dark:text-purple-300 font-semibold">Special Timetable Active:</span>
                        <span class="ml-2 text-purple-600 dark:text-purple-400">${activeTimetable.name}</span>
                        ${appState.isAttendancePaused() ? '<span class="ml-2 text-xs bg-yellow-100 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-300 px-2 py-1 rounded-full">Normal Timetables Paused</span>' : ''}
                    </div>
                `;
            } else {
                statusIndicator.className += ' bg-blue-50/80 dark:bg-blue-900/20 border-blue-400 dark:border-blue-600 backdrop-blur-sm';
                statusIndicator.innerHTML = `
                    <div class="flex items-center">
                        <span class="text-blue-800 dark:text-blue-300 font-semibold">Normal Timetable Active:</span>
                        <span class="ml-2 text-blue-600 dark:text-blue-400">${activeTimetable.name}</span>
                        ${appState.isAttendancePaused() ? '<span class="ml-2 text-xs bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-300 px-2 py-1 rounded-full">Attendance Paused</span>' : ''}
                    </div>
                `;
            }
            
            const summaryContainer = document.getElementById('attendance-summary');
            if (summaryContainer) {
                summaryContainer.insertBefore(statusIndicator, summaryContainer.firstChild);
            }
            
            this.renderSummaryTable();
            this.renderDailyLog();
        }
        this.renderTimetablesList();
    },

    renderSummaryTable() {
        const summaryData = AttendanceCalculator.calculateSummary();
        const subjects = Object.keys(summaryData).sort();
        const attendanceSummaryEl = document.getElementById('attendance-summary');
        
        let tableHTML = `
            <h3 class="text-xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-300 bg-clip-text text-transparent mb-6">Overall Summary</h3>
            <div class="overflow-x-auto rounded-2xl border border-gray-200/50 dark:border-apple-gray-800/50 shadow-apple dark:shadow-apple-dark">
                <table class="min-w-full divide-y divide-gray-200/50 dark:divide-apple-gray-800/50">
                    <thead class="bg-gray-50/80 dark:bg-apple-gray-850/80 backdrop-blur-sm">
                        <tr>
                            <th class="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Subject</th>
                            <th class="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Category</th>
                            <th class="px-6 py-4 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Attended</th>
                            <th class="px-6 py-4 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Held</th>
                            <th class="px-6 py-4 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Percentage</th>
                            <th class="px-6 py-4 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Bunking Assistant</th>
                        </tr>
                    </thead>
                    <tbody class="bg-white/80 dark:bg-apple-gray-900/80 backdrop-blur-sm divide-y divide-gray-200/50 dark:divide-apple-gray-800/50">`;

        if (subjects.length === 0) {
            tableHTML += `<tr><td colspan="6" class="px-6 py-8 text-center">
                <div class="flex flex-col items-center space-y-3">
                    <div class="w-16 h-16 bg-gray-100 dark:bg-apple-gray-800 rounded-2xl flex items-center justify-center">
                        <svg class="w-8 h-8 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"></path>
                        </svg>
                    </div>
                    <div class="text-center">
                        <p class="text-gray-700 dark:text-gray-300 font-medium mb-1">No subjects found</p>
                        <p class="text-sm text-gray-500 dark:text-gray-400">Create a timetable with subjects to see your attendance summary</p>
                    </div>
                </div>
            </td></tr>`;
        } else {
            subjects.forEach(subjectName => {
                const subjectSummary = summaryData[subjectName];
                const hasTheory = subjectSummary.Theory.held > 0 || subjectSummary.Theory.attended > 0;
                const hasLab = subjectSummary.Lab.held > 0 || subjectSummary.Lab.attended > 0;
                
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
        attendanceSummaryEl.innerHTML = tableHTML;
    },

    renderSubjectRow(subjectName, category, attended, held, showCombined, isFirstRow) {
        const percentage = held > 0 ? ((attended / held) * 100).toFixed(1) + '%' : 'N/A';
        const isBelowThreshold = held > 0 && ((attended / held) * 100) < appState.userProfile.attendance_threshold;
        
        let bunkingInfoCell = '';
        if (!showCombined) {
            const bunkingInfo = AttendanceCalculator.calculateBunkingAdvice(subjectName, attended, held);
            const statusColorClass = bunkingInfo.status === 'safe' ? 'bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-300' : bunkingInfo.status === 'warning' ? 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-300' : 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-300';
            bunkingInfoCell = `<td class="px-6 py-4 text-sm text-center"><div class="p-3 rounded-xl ${statusColorClass} inline-block min-w-[180px] font-medium shadow-sm backdrop-blur-sm">${bunkingInfo.message}</div></td>`;
        } else {
            bunkingInfoCell = `<td class="px-6 py-4 text-sm text-center"></td>`;
        }
        
        const rowspan = showCombined ? 3 : 1;
        const subjectCell = isFirstRow ? `<td class="px-6 py-4 whitespace-nowrap font-semibold text-gray-900 dark:text-white text-left" rowspan="${rowspan}">${subjectName}</td>` : '';
        
        return `<tr class="${isBelowThreshold ? 'bg-red-50/80 dark:bg-red-900/20' : 'hover:bg-gray-50/50 dark:hover:bg-apple-gray-850/50'} transition-colors duration-200">
                    ${subjectCell}
                    <td class="px-6 py-4 whitespace-nowrap text-gray-600 dark:text-gray-300 text-left font-medium">${category}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-gray-600 dark:text-gray-300 text-center font-medium">${attended}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-gray-600 dark:text-gray-300 text-center font-medium">${held}</td>
                    <td class="px-6 py-4 whitespace-nowrap font-semibold text-center ${isBelowThreshold ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}">${percentage}</td>
                    ${bunkingInfoCell}
                </tr>`;
    },

    renderCombinedRow(subjectName, totalAttended, totalHeld) {
        const overallPercentage = totalHeld > 0 ? ((totalAttended / totalHeld) * 100).toFixed(1) + '%' : 'N/A';
        const isBelowThreshold = totalHeld > 0 && ((totalAttended / totalHeld) * 100) < appState.userProfile.attendance_threshold;
        
        const bunkingInfo = AttendanceCalculator.calculateBunkingAdvice(subjectName, totalAttended, totalHeld);
        const statusColorClass = bunkingInfo.status === 'safe' ? 'bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-300' : bunkingInfo.status === 'warning' ? 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-300' : 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-300';

        return `<tr class="bg-gray-100/80 dark:bg-apple-gray-800/80 font-semibold border-t-2 border-gray-300/50 dark:border-apple-gray-700/50 backdrop-blur-sm">
                    <td class="px-6 py-4 text-left text-gray-800 dark:text-gray-200 font-bold">Total</td>
                    <td class="px-6 py-4 text-center text-gray-800 dark:text-gray-200 font-bold">${totalAttended}</td>
                    <td class="px-6 py-4 text-center text-gray-800 dark:text-gray-200 font-bold">${totalHeld}</td>
                    <td class="px-6 py-4 text-center font-bold ${isBelowThreshold ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}">${overallPercentage}</td>
                    <td class="px-6 py-4 text-sm text-center"><div class="p-3 rounded-xl ${statusColorClass} inline-block min-w-[180px] font-medium shadow-sm">${bunkingInfo.message}</div></td>
                </tr>`;
    },

    renderDailyLog(dateStr = toYYYYMMDD(new Date())) {
        appState.currentViewDate = new Date(dateStr);
        const historicalDateInput = document.getElementById('historical-date');
        if (historicalDateInput) {
            historicalDateInput.value = dateStr;
        }
        const dailyLogContainerEl = document.getElementById('daily-log-container');
        
        // Get the active timetable for this date
        const activeTimetable = appState.getActiveTimetable(new Date(dateStr));
        const dayName = WEEKDAYS[new Date(dateStr).getDay() - 1];
        
        if (!activeTimetable) {
            dailyLogContainerEl.innerHTML = `
                <div class="text-center py-8">
                    <p class="text-gray-500 dark:text-gray-400 mb-2">No active timetable for this date.</p>
                    <p class="text-sm text-gray-400 dark:text-gray-500">Please create or activate a timetable in Settings.</p>
                </div>`;
            return;
        }
        
        // Get scheduled classes for this day
        const scheduledClasses = activeTimetable.schedule[dayName] || [];
        
        if (scheduledClasses.length === 0) {
            dailyLogContainerEl.innerHTML = `
                <div class="text-center py-8">
                    <p class="text-gray-500 dark:text-gray-400 mb-2">No classes scheduled for ${dayName}.</p>
                    <p class="text-sm text-gray-400 dark:text-gray-500">Edit your timetable to add classes for this day.</p>
                </div>`;
            return;
        }
        
        // Get existing attendance logs for this date
        const existingLogs = appState.attendanceLog.filter(log => log.date === dateStr);
        
        // Create attendance entries for all scheduled classes
        const allClasses = scheduledClasses.map(subjectString => {
            const parts = subjectString.split(' ');
            const category = parts.pop();
            const subject_name = parts.join(' ');
            
            // Find existing log or create new one
            const existingLog = existingLogs.find(log => 
                log.subject_name === subject_name && log.category === category
            );
            
            if (existingLog) {
                return existingLog;
            } else {
                // Create new attendance log entry
                const newLog = {
                    id: Date.now() + Math.random(), // Temporary ID
                    user_id: appState.currentUser.id,
                    date: dateStr,
                    subject_name,
                    category,
                    status: 'Not Held Yet'
                };
                return newLog;
            }
        });
        
        // Render the attendance marking interface
        dailyLogContainerEl.innerHTML = `
            <div class="space-y-4">
                ${allClasses
                    .sort((a,b) => `${a.subject_name} ${a.category}`.localeCompare(`${b.subject_name} ${b.category}`))
                    .map(log => this.renderLectureItem(log)).join('')}
            </div>`;
        
        this.updateSaveButton();
    },

    renderLectureItem(log) {
        const currentStatus = appState.pendingChanges.get(log.id) || log.status;
        const getButtonClass = (btnStatus) => {
            const baseClass = 'log-btn px-4 py-2.5 text-sm font-semibold rounded-xl transition-all duration-200 cursor-pointer border';
            const activeClasses = {
                'Attended': 'bg-gradient-to-r from-green-500 to-green-600 text-white shadow-apple dark:shadow-apple-dark border-green-400/20',
                'Missed': 'bg-gradient-to-r from-red-500 to-red-600 text-white shadow-apple dark:shadow-apple-dark border-red-400/20',
                'Cancelled': 'bg-gradient-to-r from-yellow-500 to-yellow-600 text-white shadow-apple dark:shadow-apple-dark border-yellow-400/20',
                'Not Held Yet': 'bg-gradient-to-r from-gray-500 to-gray-600 text-white shadow-apple dark:shadow-apple-dark border-gray-400/20'
            };
            const inactiveClass = 'bg-gray-100/80 dark:bg-apple-gray-800/80 text-gray-700 dark:text-gray-300 hover:bg-gray-200/80 dark:hover:bg-apple-gray-700/80 border-gray-200/50 dark:border-apple-gray-700/50 backdrop-blur-sm';
            return currentStatus === btnStatus ? `${baseClass} ${activeClasses[btnStatus]}` : `${baseClass} ${inactiveClass}`;
        };

        return `
            <div class="log-item flex items-center justify-between p-5 bg-white/80 dark:bg-apple-gray-850/80 rounded-2xl shadow-apple dark:shadow-apple-dark border border-gray-200/50 dark:border-apple-gray-800/50 backdrop-blur-sm transition-all duration-200 hover:shadow-apple-lg dark:hover:shadow-apple-dark-lg" data-log-id="${log.id}">
                <strong class="text-gray-900 dark:text-white font-semibold">${log.subject_name} (${log.category})</strong>
                <div class="log-actions flex flex-wrap gap-2 justify-end">
                    <button data-status="Attended" class="${getButtonClass('Attended')}">Attended</button>
                    <button data-status="Missed" class="${getButtonClass('Missed')}">Missed</button>
                    <button data-status="Cancelled" class="${getButtonClass('Cancelled')}">Cancelled</button>
                    <button data-status="Not Held Yet" class="${getButtonClass('Not Held Yet')}">Not Held Yet</button>
                </div>
            </div>`;
    },
    
    updateSaveButton() {
        const saveAttendanceContainerEl = document.getElementById('save-attendance-container');
        if (appState.pendingChanges.size > 0 && !saveAttendanceContainerEl.querySelector('button')) {
            saveAttendanceContainerEl.innerHTML = `<button id="save-attendance-btn" class="w-full bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-semibold py-3 px-4 rounded-xl shadow-apple dark:shadow-apple-dark transition-all duration-200 border border-blue-400/20">Save Changes</button>`;
        } else if (appState.pendingChanges.size === 0) {
            saveAttendanceContainerEl.innerHTML = '';
        }
    },

    renderTimetablesList() {
        const timetables = appState.userProfile?.timetables || [];
        const activeTimetable = appState.getActiveTimetable();
        const timetablesListContainerEl = document.getElementById('timetables-list');
        
        // Update attendance toggle button - only show if manual control is needed
        const toggleBtn = document.getElementById('toggle-attendance-btn');
        const hasActiveSpecial = appState.userProfile.timetables?.some(tt => 
            (tt.type === 'special' || tt.type === undefined) && tt.isActive
        );
        
        if (toggleBtn) {
            // Hide manual toggle if automation is in effect
            if (hasActiveSpecial) {
                toggleBtn.style.display = 'none';
            } else {
                toggleBtn.style.display = 'block';
                toggleBtn.textContent = appState.isAttendancePaused() ? 'Resume Normal' : 'Pause Normal';
                toggleBtn.className = appState.isAttendancePaused() 
                    ? 'px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-semibold transition-colors'
                    : 'px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-semibold transition-colors';
            }
        }
        
        // Add status indicator at the top
        const statusIndicator = activeTimetable ? `
            <div class="mb-4 p-4 rounded-2xl ${activeTimetable.type === 'special' ? 'bg-purple-50/80 dark:bg-purple-900/20 border border-purple-200/50 dark:border-purple-800/50' : 'bg-blue-50/80 dark:bg-blue-900/20 border border-blue-200/50 dark:border-blue-800/50'} backdrop-blur-sm shadow-apple dark:shadow-apple-dark">
                <p class="text-sm font-semibold ${activeTimetable.type === 'special' ? 'text-purple-800 dark:text-purple-300' : 'text-blue-800 dark:text-blue-300'}">
                    Active Timetable: ${activeTimetable.name}
                    ${activeTimetable.type === 'special' ?
                        '<span class="ml-2 text-xs bg-purple-100 dark:bg-purple-900/50 text-purple-800 dark:text-purple-300 px-2 py-1 rounded-full">Special</span>' :
                        '<span class="ml-2 text-xs bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-300 px-2 py-1 rounded-full">Normal</span>'
                    }
                </p>
                ${appState.isAttendancePaused() && activeTimetable.type === 'normal' ?
                    '<p class="text-xs text-gray-600 dark:text-gray-400 mt-2">Normal timetable paused automatically due to active special timetable.</p>' : ''
                }
            </div>
        ` : '';
        
        timetablesListContainerEl.innerHTML = statusIndicator + timetables.map(tt => {
            const isActive = activeTimetable && tt.id === activeTimetable.id;
            const timetableType = tt.type || 'normal';
            const typeBadge = timetableType === 'special' 
                ? '<span class="text-xs font-medium text-purple-800 bg-purple-100 px-2 py-1 rounded-full">Special</span>'
                : '<span class="text-xs font-medium text-blue-800 bg-blue-100 px-2 py-1 rounded-full">Normal</span>';
            
            const activeBadge = isActive 
                ? '<span class="text-xs font-medium text-green-800 bg-green-100 px-2 py-1 rounded-full ml-1">Active</span>' 
                : '<span class="text-xs font-medium text-gray-600 bg-gray-100 px-2 py-1 rounded-full ml-1">Inactive</span>';
            
            const specialControls = timetableType === 'special' 
                ? `<button data-id="${tt.id}" class="toggle-special-btn ${tt.isActive ? 'bg-yellow-500 hover:bg-yellow-600' : 'bg-green-500 hover:bg-green-600'} text-white px-3 py-1 rounded-md text-sm">${tt.isActive ? 'Deactivate' : 'Activate'}</button>`
                : '';
            
            const normalControls = timetableType === 'normal' 
                ? `<button data-id="${tt.id}" class="toggle-normal-btn ${tt.isActive ? 'bg-yellow-500 hover:bg-yellow-600' : 'bg-green-500 hover:bg-green-600'} text-white px-3 py-1 rounded-md text-sm">${tt.isActive ? 'Deactivate' : 'Activate'}</button>`
                : '';
            
            return `<div class="p-5 bg-gray-50/80 dark:bg-apple-gray-850/80 border border-gray-200/50 dark:border-apple-gray-800/50 rounded-2xl flex justify-between items-center backdrop-blur-sm shadow-apple dark:shadow-apple-dark transition-all duration-200 hover:shadow-apple-lg dark:hover:shadow-apple-dark-lg">
                <div>
                    <p class="font-bold text-gray-800 dark:text-white">${tt.name} ${typeBadge}${activeBadge}</p>
                    <p class="text-sm text-gray-600 dark:text-gray-400">${tt.startDate} to ${tt.endDate}</p>
                </div>
                <div class="flex gap-2">
                    ${specialControls}
                    ${normalControls}
                    <button data-id="${tt.id}" class="duplicate-timetable-btn bg-gray-500 text-white px-3 py-1 rounded-md text-sm">Duplicate</button>
                    <button data-id="${tt.id}" class="edit-timetable-btn bg-blue-500 text-white px-3 py-1 rounded-md text-sm">Edit</button>
                    <button data-id="${tt.id}" class="delete-timetable-btn bg-red-500 text-white px-3 py-1 rounded-md text-sm">Delete</button>
                </div>
            </div>`;
        }).join('');
    },
    
    renderTimetableModalUI() {
        const subjectList = document.getElementById('timetable-subject-master-list');
        const timetableGrid = document.getElementById('timetable-grid-container');
        subjectList.innerHTML = appState.setupSubjects.map((sub, index) => `
            <li class="flex justify-between items-center bg-gray-100/80 dark:bg-apple-gray-800/80 p-3 rounded-xl backdrop-blur-sm border border-gray-200/50 dark:border-apple-gray-700/50">
                <span>${sub.name} (${sub.category}) - Weight: ${sub.weight}</span>
                <button type="button" data-index="${index}" class="remove-subject-btn text-red-500 hover:text-red-700 font-bold">X</button>
            </li>`).join('');

        timetableGrid.innerHTML = WEEKDAYS.map(day => {
            const schedule = appState.editingTimetable?.schedule?.[day] || [];
            return `
                <div class="day-column bg-gray-50/80 dark:bg-apple-gray-850/80 p-4 rounded-2xl backdrop-blur-sm border border-gray-200/50 dark:border-apple-gray-800/50">
                    <h4 class="font-bold mb-2 text-center">${day}</h4>
                    <div class="flex items-center gap-1 mb-2">
                        <select data-day="${day}" class="add-class-select flex-grow w-full p-3 bg-white/80 dark:bg-apple-gray-800/80 border border-gray-200/50 dark:border-apple-gray-700/50 rounded-xl backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 dark:text-white transition-all duration-200">
                            <option value="">-- select class --</option>
                            ${appState.setupSubjects.map(sub => `<option value="${sub.name} ${sub.category}">${sub.name} (${sub.category})</option>`).join('')}
                        </select>
                    </div>
                    <ul data-day="${day}" class="day-schedule-list space-y-1 min-h-[50px]">
                        ${schedule.map(cls => `
                            <li class="flex justify-between items-center bg-blue-100/80 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200 text-sm font-medium px-3 py-2 rounded-xl backdrop-blur-sm border border-blue-200/50 dark:border-blue-800/50" data-value="${cls}">
                                <span>${cls}</span>
                                <button type="button" class="remove-class-btn text-blue-500 hover:text-blue-700 font-bold ml-2">x</button>
                            </li>`).join('')}
                    </ul>
                </div>`;
        }).join('');
    }
};

// --- Attendance Population ---
const AttendancePopulator = {
    async populate() {
        const timetables = appState.userProfile?.timetables || [];
        if (timetables.length === 0) return;

        const populateUntilDate = new Date();
        populateUntilDate.setDate(populateUntilDate.getDate() + 7);
        const populateUntilDateStr = toYYYYMMDD(populateUntilDate);

        let populateFromDate;
        if (appState.userProfile.last_log_date) {
            try {
                const lastLogDate = new Date(appState.userProfile.last_log_date + 'T00:00:00Z');
                if (!isNaN(lastLogDate.getTime())) {
                    populateFromDate = new Date(lastLogDate.setDate(lastLogDate.getDate() + 1));
                } else {
                    populateFromDate = new Date();
                }
            } catch (error) {
                console.warn('Invalid last_log_date, using current date:', appState.userProfile.last_log_date);
                populateFromDate = new Date();
            }
        } else {
            try {
                const earliestStartDate = timetables.reduce((earliest, tt) => {
                    const ttDate = new Date(tt.startDate);
                    const earliestDate = new Date(earliest);
                    return !isNaN(ttDate.getTime()) && ttDate < earliestDate ? tt.startDate : earliest;
                }, timetables[0].startDate);
                populateFromDate = new Date(earliestStartDate + 'T00:00:00Z');
            } catch (error) {
                console.warn('Error calculating earliest start date, using current date');
                populateFromDate = new Date();
            }
        }

        const populateFromDateStr = toYYYYMMDD(populateFromDate);
        if (!populateFromDateStr || populateFromDateStr > populateUntilDateStr) return;

        let entriesToUpsert = [];
        let currentDate = new Date(populateFromDate);
        const todayStr = toYYYYMMDD(new Date());
        const isPaused = appState.isAttendancePaused();
        
        while (true) {
            const currentDateStr = toYYYYMMDD(currentDate);
            if (!currentDateStr || currentDateStr > populateUntilDateStr) break;
            
            const dayIndex = currentDate.getDay();
            if (dayIndex >= 1 && dayIndex <= 5) {
                const dayName = WEEKDAYS[dayIndex - 1];
                const activeTimetable = appState.getActiveTimetable(currentDate);
                
                if (activeTimetable) {
                    const lecturesForDay = [...new Set(activeTimetable.schedule[dayName] || [])];
                    const status = currentDateStr < todayStr ? 'Missed' : 'Not Held Yet';

                    lecturesForDay.forEach(subjectString => {
                        const parts = subjectString.split(' ');
                        const category = parts.pop();
                        const subject_name = parts.join(' ');
                        
                        // Check if this entry already exists
                        const existingEntry = appState.attendanceLog.find(log => 
                            log.date === currentDateStr && 
                            log.subject_name === subject_name && 
                            log.category === category
                        );
                        
                        if (!existingEntry) {
                            // Only create entries if not paused or if this is a special timetable
                            if (!isPaused || (activeTimetable.type === 'special' || activeTimetable.type === undefined)) {
                                entriesToUpsert.push({ user_id: appState.currentUser.id, date: currentDateStr, subject_name, category, status });
                            }
                        }
                    });
                }
            }
            currentDate.setDate(currentDate.getDate() + 1);
        }

        if (entriesToUpsert.length > 0) {
            const { error } = await supabase.from('attendance_log').upsert(entriesToUpsert, { onConflict: 'user_id,date,subject_name,category' });
            if (error) throw new Error(`Database error during log population: ${error.message}`);
        }
        
        await DataManager.saveUserProfile({ ...appState.userProfile, last_log_date: populateUntilDateStr });
        appState.userProfile.last_log_date = populateUntilDateStr;
    }
};

// --- Timetable Management ---
const TimetableManager = {
    openModal(timetableToEdit = null, isDuplicate = false, timetableType = 'normal') {
        appState.editingTimetable = timetableToEdit ? { ...timetableToEdit, isDuplicate } : null;
        const title = document.getElementById('timetable-modal-title');
        
        if (!timetableForm) {
            console.error('Timetable form not found');
            return;
        }
        
        timetableForm.reset();
        appState.setupSubjects = [];

        if (timetableToEdit) {
            title.textContent = isDuplicate ? 'Duplicate Timetable' : 'Edit Timetable';
            
            const nameField = document.getElementById('timetable-name');
            const minAttendanceField = document.getElementById('timetable-min-attendance');
            const startDateField = document.getElementById('timetable-start-date');
            const endDateField = document.getElementById('timetable-end-date');
            const typeField = document.getElementById('timetable-type');
            
            if (nameField) nameField.value = isDuplicate ? `${timetableToEdit.name} (Copy)` : timetableToEdit.name;
            if (minAttendanceField) minAttendanceField.value = appState.userProfile.attendance_threshold;
            if (startDateField) startDateField.value = timetableToEdit.startDate;
            if (endDateField) endDateField.value = timetableToEdit.endDate;
            if (typeField) typeField.value = timetableToEdit.type || 'normal';
            
            appState.setupSubjects = Object.entries(timetableToEdit.subjectWeights || {}).map(([fullName, weight]) => {
                const parts = fullName.split(' ');
                const category = parts.pop();
                const name = parts.join(' ');
                return { name, category, weight };
            });
        } else {
            title.textContent = `Add New ${timetableType === 'special' ? 'Special' : 'Normal'} Timetable`;
            
            const minAttendanceField = document.getElementById('timetable-min-attendance');
            const typeField = document.getElementById('timetable-type');
            
            if (minAttendanceField) minAttendanceField.value = appState.userProfile?.attendance_threshold || 75;
            if (typeField) typeField.value = timetableType;
        }

        Renderer.renderTimetableModalUI();
        this.updateEndDateRequirements(timetableType);
        if (timetableModal) timetableModal.style.display = 'flex';
    },

    updateEndDateRequirements(timetableType) {
        const endDateRequired = document.getElementById('end-date-required');
        const endDateHelp = document.getElementById('end-date-help');
        const endDateField = document.getElementById('timetable-end-date');
        
        if (timetableType === 'special') {
            if (endDateRequired) endDateRequired.style.display = 'inline';
            if (endDateField) endDateField.required = true;
            if (endDateHelp) endDateHelp.textContent = 'Required for special timetables';
        } else {
            if (endDateRequired) endDateRequired.style.display = 'none';
            if (endDateField) endDateField.required = false;
            if (endDateHelp) endDateHelp.textContent = 'Optional for normal timetables (will use 2030-12-31 if not provided)';
        }
    },

    closeModal() {
        timetableModal.style.display = 'none';
        appState.editingTimetable = null;
    },

    async save() {
        const formData = new FormData(timetableForm);
        const timetableType = formData.get('timetable-type') || 'normal';
        
        // Validate dates based on timetable type
        let startDate = formData.get('timetable-start-date');
        let endDate = formData.get('timetable-end-date');
        
        // Debug logging
        console.log('Form data debug:', {
            timetableType,
            startDate,
            endDate,
            name: formData.get('timetable-name'),
            minAttendance: formData.get('timetable-min-attendance')
        });
        
        // Also log all form data entries
        console.log('All form data entries:');
        for (let [key, value] of formData.entries()) {
            console.log(`${key}: ${value}`);
        }
        
        // Start date is always required
        if (!startDate) {
            console.error('Start date is empty or invalid:', startDate);
            
            // Fallback: try to get start date directly from the input element
            const startDateInput = document.getElementById('timetable-start-date');
            if (startDateInput && startDateInput.value) {
                console.log('Found start date in input element:', startDateInput.value);
                startDate = startDateInput.value;
            } else {
                return handleError({ message: 'Please provide a start date.' }, 'Save Timetable');
            }
        }
        
        // For special timetables, end date is mandatory
        if (timetableType === 'special' && !endDate) {
            return handleError({ message: 'Special timetables require an end date.' }, 'Save Timetable');
        }
        
        // If end date is provided, validate it's after start date
        if (endDate && startDate > endDate) {
            return handleError({ message: 'End date cannot be before start date.' }, 'Save Timetable');
        }
        
        const newTimetableData = {
            id: appState.editingTimetable && !appState.editingTimetable.isDuplicate ? appState.editingTimetable.id : crypto.randomUUID(),
            name: formData.get('timetable-name'),
            type: timetableType,
            startDate: startDate,
            endDate: timetableType === 'special' ? endDate : (endDate || '2030-12-31'), // Far future date for normal timetables if no end date
            schedule: {},
            subjectWeights: {},
            isActive: timetableType === 'special' ? false : true // Special timetables start inactive
        };
        
        // Only check for overlapping normal timetables (but allow if user confirms)
        if (timetableType === 'normal') {
            const otherNormalTimetables = (appState.userProfile.timetables || []).filter(tt => 
                tt.id !== newTimetableData.id && (tt.type === 'normal' || tt.type === undefined)
            );
            const isOverlapping = otherNormalTimetables.some(tt => {
                const ttEndDate = tt.endDate || '2030-12-31';
                const newEndDate = newTimetableData.endDate || '2030-12-31';
                return newTimetableData.startDate <= ttEndDate && newEndDate >= tt.startDate;
            });

            if (isOverlapping) {
                const confirmMessage = `This normal timetable overlaps with existing normal timetables. You can manually pause/activate timetables as needed. Continue?`;
                const shouldContinue = await showCustomConfirm(confirmMessage);
                if (!shouldContinue) {
                    return;
                }
            }
        }

        appState.setupSubjects.forEach(sub => {
            newTimetableData.subjectWeights[`${sub.name} ${sub.category}`] = sub.weight;
        });
        WEEKDAYS.forEach(day => {
            const classNodes = timetableForm.querySelectorAll(`.day-schedule-list[data-day="${day}"] li`);
            newTimetableData.schedule[day] = Array.from(classNodes).map(node => node.dataset.value);
        });

        const existingTimetables = appState.userProfile.timetables || [];
        const existingIndex = existingTimetables.findIndex(tt => tt.id === newTimetableData.id);

        if (existingIndex !== -1) {
            existingTimetables[existingIndex] = newTimetableData;
        } else {
            existingTimetables.push(newTimetableData);
        }
        
        const attendanceThreshold = parseInt(formData.get('timetable-min-attendance')) || 75;
        await DataManager.saveUserProfile({ 
            ...appState.userProfile, 
            timetables: existingTimetables, 
            attendance_threshold: attendanceThreshold 
        });
        appState.userProfile.timetables = existingTimetables;
        appState.userProfile.attendance_threshold = attendanceThreshold;

        this.closeModal();
        await runFullAttendanceUpdate();
    },

    async toggleSpecialTimetable(timetableId) {
        const timetable = appState.userProfile.timetables.find(tt => tt.id === timetableId);
        if (!timetable || timetable.type !== 'special') return;
        
        const wasActive = timetable.isActive;
        timetable.isActive = !wasActive;
        
        // If activating a special timetable, automatically pause normal timetables
        if (timetable.isActive && !wasActive) {
            // Pause all normal timetables that overlap with this special timetable
            const overlappingNormalTimetables = appState.userProfile.timetables.filter(tt => 
                (tt.type === 'normal' || tt.type === undefined) && 
                tt.id !== timetableId &&
                tt.isActive &&
                this.doDatesOverlap(timetable.startDate, timetable.endDate, tt.startDate, tt.endDate)
            );
            
            if (overlappingNormalTimetables.length > 0) {
                overlappingNormalTimetables.forEach(tt => {
                    tt.isActive = false;
                });
                
                // Also pause attendance counting for normal timetables
                appState.userProfile.attendance_paused = true;
                
                console.log(`Automatically paused ${overlappingNormalTimetables.length} normal timetables due to special timetable activation`);
                
                // Show notification to user
                this.showNotification(`Special timetable activated! Automatically paused ${overlappingNormalTimetables.length} overlapping normal timetables.`, 'info');
            }
        }
        
        // If deactivating a special timetable, check if we should resume normal timetables
        if (!timetable.isActive && wasActive) {
            // Check if there are any other active special timetables
            const otherActiveSpecialTimetables = appState.userProfile.timetables.filter(tt => 
                (tt.type === 'special' || tt.type === undefined) && 
                tt.id !== timetableId &&
                tt.isActive
            );
            
            // If no other special timetables are active, resume normal timetables
            if (otherActiveSpecialTimetables.length === 0) {
                appState.userProfile.attendance_paused = false;
                console.log('No active special timetables remaining, resuming normal timetable attendance');
                
                // Show notification to user
                this.showNotification('Special timetable deactivated! Normal timetable attendance resumed.', 'success');
            }
        }
        
        await DataManager.saveUserProfile({ ...appState.userProfile, timetables: appState.userProfile.timetables });
        await runFullAttendanceUpdate();
    },

    doDatesOverlap(start1, end1, start2, end2) {
        const s1 = start1 || '1900-01-01';
        const e1 = end1 || '2030-12-31';
        const s2 = start2 || '1900-01-01';
        const e2 = end2 || '2030-12-31';
        
        return s1 <= e2 && e1 >= s2;
    },

    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `fixed top-4 right-4 z-50 p-4 rounded-lg shadow-lg max-w-sm transition-all duration-300 transform translate-x-full`;
        
        // Set background color based on type
        const bgColor = type === 'success' ? 'bg-green-500' : type === 'error' ? 'bg-red-500' : 'bg-blue-500';
        notification.className += ` ${bgColor} text-white`;
        
        notification.innerHTML = `
            <div class="flex items-center justify-between">
                <p class="text-sm font-medium">${message}</p>
                <button class="ml-4 text-white hover:text-gray-200" onclick="this.parentElement.parentElement.remove()">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>
                </button>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        // Animate in
        setTimeout(() => {
            notification.classList.remove('translate-x-full');
        }, 100);
        
        // Auto remove after 5 seconds
        setTimeout(() => {
            notification.classList.add('translate-x-full');
            setTimeout(() => {
                if (notification.parentElement) {
                    notification.remove();
                }
            }, 300);
        }, 5000);
    },

    async toggleNormalTimetable(timetableId) {
        const timetable = appState.userProfile.timetables.find(tt => tt.id === timetableId);
        if (!timetable || (timetable.type !== 'normal' && timetable.type !== undefined)) return;
        
        timetable.isActive = !timetable.isActive;
        await DataManager.saveUserProfile({ ...appState.userProfile, timetables: appState.userProfile.timetables });
        await runFullAttendanceUpdate();
    },

    async delete(timetableId) {
        if (!await showCustomConfirm("Are you sure you want to delete this timetable?")) return;
        const updatedTimetables = appState.userProfile.timetables.filter(tt => tt.id !== timetableId);
        await DataManager.saveUserProfile({ ...appState.userProfile, timetables: updatedTimetables });
        appState.userProfile.timetables = updatedTimetables;
        await runFullAttendanceUpdate();
    }
};

// --- Extra Day Management ---
const ExtraDayManager = {
    async addExtraDay(date, weekdayToFollow) {
        const activeTimetable = appState.getActiveTimetable(new Date(date));
        if (!activeTimetable) {
            throw new Error('No active timetable for the selected date');
        }

        const lecturesForDay = [...new Set(activeTimetable.schedule[weekdayToFollow] || [])];
        const entriesToUpsert = lecturesForDay.map(subjectString => {
            const parts = subjectString.split(' ');
            const category = parts.pop();
            const subject_name = parts.join(' ');
            return { user_id: appState.currentUser.id, date, subject_name, category, status: 'Not Held Yet' };
        });

        if (entriesToUpsert.length > 0) {
            const { error } = await supabase.from('attendance_log').upsert(entriesToUpsert, { onConflict: 'user_id,date,subject_name,category' });
            if (error) throw error;
        }
    }
};

// --- Main Application Logic ---
const init = async () => {
    try {
        showLoading('Initializing...');
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
            window.location.href = '/index.html';
            return;
        }
        appState.currentUser = session.user;
        appState.userProfile = await DataManager.fetchUserProfile();
        
        if (appState.userProfile && appState.userProfile.timetables && appState.userProfile.timetables.length > 0) {
            try {
                await runFullAttendanceUpdate();
                dashboardView.style.display = 'block';
            } catch (error) {
                console.error('Error during attendance update:', error);
                hideLoading();
                // If there's an error, still show the dashboard but with empty state
                dashboardView.style.display = 'block';
                Renderer.renderDashboard();
            }
        } else {
            hideLoading();
            if (!appState.userProfile) {
                appState.userProfile = { 
                    id: appState.currentUser.id, 
                    timetables: [], 
                    attendance_threshold: 75,
                    attendance_paused: false
                };
            } else {
                // Ensure all required fields exist
                if (!appState.userProfile.attendance_threshold) {
                    appState.userProfile.attendance_threshold = 75;
                }
                if (appState.userProfile.attendance_paused === undefined) {
                    appState.userProfile.attendance_paused = false;
                }
                if (!appState.userProfile.timetables) {
                    appState.userProfile.timetables = [];
                }
            }
            
            // Show dashboard first, then open modal
            dashboardView.style.display = 'block';
            Renderer.renderDashboard();
            
            // Small delay to ensure DOM is ready
            setTimeout(() => {
                TimetableManager.openModal();
            }, 100);
        }
    } catch (error) {
        handleError(error, 'Initialization');
    }
};

const runFullAttendanceUpdate = async () => {
    showLoading('Updating records...');
    await AttendancePopulator.populate();
    await DataManager.loadAttendanceLog();
    Renderer.renderDashboard();
    hideLoading();
};

// --- Event Listeners ---
const initializeEventListeners = () => {
    // Dark mode toggle
    const darkModeToggle = document.getElementById('dark-mode-toggle');
    if (darkModeToggle) {
        // Check for saved theme preference or default to light mode
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
            document.documentElement.classList.add('dark');
        }
        
        darkModeToggle.addEventListener('click', () => {
            document.documentElement.classList.toggle('dark');
            const isDark = document.documentElement.classList.contains('dark');
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
        });
    }
    
    if (logoutButton) {
        logoutButton.addEventListener('click', () => supabase.auth.signOut().then(() => window.location.href = '/index.html'));
    }

            document.body.addEventListener('click', async (e) => {
        try {
            const addNormalBtn = e.target.closest('#add-normal-timetable-btn');
            const addSpecialBtn = e.target.closest('#add-special-timetable-btn');
            const toggleAttendanceBtn = e.target.closest('#toggle-attendance-btn');
            const toggleSpecialBtn = e.target.closest('.toggle-special-btn');
            const toggleNormalBtn = e.target.closest('.toggle-normal-btn');
            const editBtn = e.target.closest('.edit-timetable-btn');
            const deleteBtn = e.target.closest('.delete-timetable-btn');
            const duplicateBtn = e.target.closest('.duplicate-timetable-btn');
            const clearBtn = e.target.closest('#clear-attendance-btn');
            const extraDayBtn = e.target.closest('#show-extra-day-modal-btn');
            const logActionBtn = e.target.closest('.log-btn');
            const saveAttendanceBtn = e.target.closest('#save-attendance-btn');
            
            if (addNormalBtn) TimetableManager.openModal(null, false, 'normal');
            if (addSpecialBtn) TimetableManager.openModal(null, false, 'special');
            if (toggleAttendanceBtn) {
                const newPausedState = !appState.isAttendancePaused();
                await DataManager.updateAttendancePauseStatus(newPausedState);
                Renderer.renderTimetablesList();
            }
            if (toggleSpecialBtn) await TimetableManager.toggleSpecialTimetable(toggleSpecialBtn.dataset.id);
            if (toggleNormalBtn) await TimetableManager.toggleNormalTimetable(toggleNormalBtn.dataset.id);
            if (editBtn) {
                const timetable = appState.userProfile.timetables.find(tt => tt.id === editBtn.dataset.id);
                TimetableManager.openModal(timetable);
            }
            if (deleteBtn) await TimetableManager.delete(deleteBtn.dataset.id);
            if (duplicateBtn) {
                const timetable = appState.userProfile.timetables.find(tt => tt.id === duplicateBtn.dataset.id);
                TimetableManager.openModal(timetable, true);
            }
            if (clearBtn) {
                if (await showCustomConfirm("Are you sure? This resets all attendance but keeps your timetables.")) {
                    showLoading('Clearing records...');
                    await supabase.from('attendance_log').delete().eq('user_id', appState.currentUser.id);
                    await DataManager.saveUserProfile({ ...appState.userProfile, last_log_date: null });
                    window.location.reload();
                }
            }
            if (extraDayBtn && extraDayModal) extraDayModal.style.display = 'flex';
            if (logActionBtn) {
                const logItem = logActionBtn.closest('.log-item');
                const logId = parseInt(logItem.dataset.logId);
                const newStatus = logActionBtn.dataset.status;
                appState.pendingChanges.set(logId, newStatus);
                Renderer.renderDailyLog(document.getElementById('historical-date').value);
                Renderer.updateSaveButton();
            }
            if (saveAttendanceBtn) {
                await DataManager.saveAttendanceChanges();
                await runFullAttendanceUpdate();
            }
        } catch(error) {
            handleError(error, 'UI Interaction');
        }
    });

    if (timetableForm) {
        timetableForm.addEventListener('submit', (e) => { e.preventDefault(); TimetableManager.save(); });
        
        // Add event listener for timetable type change
        const typeField = document.getElementById('timetable-type');
        if (typeField) {
            typeField.addEventListener('change', (e) => {
                TimetableManager.updateEndDateRequirements(e.target.value);
            });
        }
    }

    if (extraDayForm) {
        extraDayForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                const date = document.getElementById('extra-day-date').value;
                const weekday = document.getElementById('weekday-to-follow').value;
                await ExtraDayManager.addExtraDay(date, weekday);
                extraDayModal.style.display = 'none';
                await runFullAttendanceUpdate();
            } catch (error) {
                handleError(error, 'Add Extra Day');
            }
        });
    }
    
    document.querySelectorAll('.modal-cancel-btn').forEach(btn => btn.addEventListener('click', (e) => {
        const modal = e.target.closest('.fixed');
        if (modal) modal.style.display = 'none';
    }));

    if (timetableModal) {
        timetableModal.addEventListener('click', (e) => {
            if (e.target.id === 'timetable-add-subject-btn') {
                const nameInput = document.getElementById('timetable-subject-name');
                const name = nameInput.value.trim();
                const category = document.getElementById('timetable-subject-category').value;
                const weight = parseInt(document.getElementById('timetable-subject-weight').value);
                if (name && !appState.setupSubjects.some(s => s.name === name && s.category === category)) {
                    appState.setupSubjects.push({ name, category, weight });
                    Renderer.renderTimetableModalUI();
                    nameInput.value = '';
                }
            }
            const removeSubjectBtn = e.target.closest('.remove-subject-btn');
            if (removeSubjectBtn) {
                appState.setupSubjects.splice(parseInt(removeSubjectBtn.dataset.index), 1);
                Renderer.renderTimetableModalUI();
            }
            const addClassSelect = e.target.closest('.add-class-select');
            if (addClassSelect && addClassSelect.value) {
                const day = addClassSelect.dataset.day;
                const list = timetableModal.querySelector(`.day-schedule-list[data-day="${day}"]`);
                list.insertAdjacentHTML('beforeend', `
                    <li class="flex justify-between items-center bg-blue-100/80 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200 text-sm font-medium px-3 py-2 rounded-xl backdrop-blur-sm border border-blue-200/50 dark:border-blue-800/50" data-value="${addClassSelect.value}">
                        <span>${addClassSelect.value}</span>
                        <button type="button" class="remove-class-btn text-blue-500 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-bold ml-2">x</button>
                    </li>`);
                addClassSelect.value = '';
            }
            const removeClassBtn = e.target.closest('.remove-class-btn');
            if (removeClassBtn) {
                removeClassBtn.closest('li').remove();
            }
        });
    }

    if (dashboardView) {
        dashboardView.addEventListener('change', (e) => {
            if (e.target.id === 'historical-date') {
                if (appState.pendingChanges.size > 0) {
                    showCustomConfirm("You have unsaved changes. Discard them?").then(discard => {
                        if(discard) {
                            appState.pendingChanges.clear();
                            Renderer.renderDailyLog(e.target.value);
                        } else {
                            e.target.value = toYYYYMMDD(appState.currentViewDate);
                        }
                    });
                } else {
                    Renderer.renderDailyLog(e.target.value);
                }
            }
        });
    }
};

// --- Application Entry Point ---
document.addEventListener('DOMContentLoaded', () => {
    // Assign DOM elements once the document is ready
    loadingOverlay = document.getElementById('loading-overlay');
    logoutButton = document.getElementById('logout-button');
    dashboardView = document.getElementById('dashboard-view');
    timetableModal = document.getElementById('timetable-modal');
    timetableForm = document.getElementById('timetable-form');
    extraDayModal = document.getElementById('extra-day-modal');
    extraDayForm = document.getElementById('extra-day-form');
    customConfirmModal = document.getElementById('custom-confirm-modal');
    confirmModalText = document.getElementById('confirm-modal-text');
    confirmYesBtn = document.getElementById('confirm-yes-btn');
    confirmNoBtn = document.getElementById('confirm-no-btn');
    
    // Initialize the app and its listeners
    init();
    initializeEventListeners();
});1.