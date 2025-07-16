import { supabase } from './supabaseClient.js';

// --- DOM Elements ---
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');
const logoutButton = document.getElementById('logout-button');
const onboardingView = document.getElementById('onboarding-view');
const dashboardView = document.getElementById('dashboard-view');
const setupForm = document.getElementById('setup-form');
const setupError = document.getElementById('setup-error');
const attendanceSummary = document.getElementById('attendance-summary');
const dailyLogContainer = document.getElementById('daily-log-container');
const historicalDatePicker = document.getElementById('historical-date');
const settingsSection = document.getElementById('settings-section');
const saveAttendanceContainer = document.getElementById('save-attendance-container');

// --- State ---
let currentUser = null;
let userProfile = null;
let attendanceLog = [];
let pendingChanges = new Map(); // For batch updates

// --- Utility Functions ---
const showLoading = (message = 'Loading...') => {
    loadingText.textContent = message;
    loadingOverlay.style.display = 'flex';
};
const hideLoading = () => {
    loadingOverlay.style.display = 'none';
};

/**
 * Main initialization function.
 */
const init = async () => {
    // This function remains the same as the manual builder version
    showLoading('Authenticating...');
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session) { window.location.href = '/index.html'; return; }
    currentUser = session.user;
    const { data, profileError } = await supabase.from('profiles').select('*').single();
    if (profileError && profileError.code !== 'PGRST116') { hideLoading(); return console.error('Error fetching profile:', profileError); }
    if (data) {
        userProfile = data;
        await runFullAttendanceUpdate();
    } else {
        // Fallback to onboarding if no profile exists
        hideLoading();
        window.location.href = '/dashboard.html'; // Or your dedicated onboarding page
    }
};

/**
 * Main update and render pipeline.
 */
const runFullAttendanceUpdate = async () => {
    showLoading('Updating attendance records...');
    await populateAttendanceLog();
    showLoading('Loading your dashboard...');
    await loadFullAttendanceLog();
    renderDashboard();
    hideLoading();
}

/**
 * CORRECTED: The "automatic daily increment" feature.
 * This version fixes the off-by-one error that prevented today's lectures from being created.
 */
const populateAttendanceLog = async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // If last_log_date is null (first time), start from the day before the semester start date.
    // This ensures the loop correctly includes the start date itself.
    let lastLog = userProfile.last_log_date 
        ? new Date(userProfile.last_log_date + 'T00:00:00') 
        : new Date(new Date(userProfile.start_date).setDate(new Date(userProfile.start_date).getDate() - 1));

    let currentDate = new Date(lastLog);
    currentDate.setDate(currentDate.getDate() + 1);
    
    const newLogEntries = [];
    
    // The loop now correctly runs from the day after the last log up to and including today.
    while (currentDate <= today) {
        const dayIndex = currentDate.getDay();
        if (dayIndex !== 0 && dayIndex !== 6) {
            const dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dayIndex];
            const lecturesToday = userProfile.timetable_json[dayName] || [];
            for (const subjectString of lecturesToday) {
                const parts = subjectString.split(' ');
                const category = parts.pop();
                const subject_name = parts.join(' ');
                newLogEntries.push({ user_id: currentUser.id, date: new Date(currentDate).toISOString().slice(0, 10), subject_name: subject_name, category: category, status: 'Missed' });
            }
        }
        currentDate.setDate(currentDate.getDate() + 1);
    }
    
    if (newLogEntries.length > 0) { await supabase.from('attendance_log').insert(newLogEntries, { onConflict: 'user_id,date,subject_name,category' }); }
    
    // Update the profile with today's date so we don't re-process these days again on the next load.
    await supabase.from('profiles').update({ last_log_date: today.toISOString().slice(0, 10) }).eq('id', currentUser.id);
};

/**
 * Fetches the entire attendance log.
 */
const loadFullAttendanceLog = async () => {
    const { data, error } = await supabase.from('attendance_log').select('*').order('date', { ascending: false });
    if (error) return console.error("Error fetching attendance log:", error);
    attendanceLog = data;
};

/**
 * Renders the entire dashboard UI.
 */
const renderDashboard = () => {
    renderSummaryTable();
    const todayStr = new Date().toISOString().slice(0, 10);
    historicalDatePicker.value = todayStr;
    renderScheduleForDate(todayStr);
    dashboardView.style.display = 'block';
    onboardingView.style.display = 'none';
};

/**
 * Renders the summary table with lecture weighting.
 */
const renderSummaryTable = () => {
    // This function remains the same as the previous correct version.
    const subjectStats = {};
    for (const log of attendanceLog) {
        const baseSubject = log.subject_name;
        if (!subjectStats[baseSubject]) { subjectStats[baseSubject] = { Theory: { Attended: 0, Held: 0 }, Lab: { Attended: 0, Held: 0 }}; }
        let weight = 1;
        if (log.category === 'Lab' || baseSubject === 'DA' || baseSubject === 'DSA') { weight = 2; }
        if (log.status !== 'Cancelled') {
            subjectStats[baseSubject][log.category].Held += weight;
            if (log.status === 'Attended') { subjectStats[baseSubject][log.category].Attended += weight; }
        }
    }
    let tableHTML = `<h3 class="text-xl font-bold text-gray-800 mb-4">Overall Summary</h3><div class="overflow-x-auto"><table class="min-w-full divide-y divide-gray-200"><thead class="bg-gray-50"><tr><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Subject</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Attended</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Held</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Percentage</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Overall Subject %</th></tr></thead><tbody class="bg-white divide-y divide-gray-200">`;
    if (Object.keys(subjectStats).length === 0) { tableHTML += `<tr><td colspan="6" class="px-6 py-4 text-center text-gray-500">No attendance data to display yet.</td></tr>`; }
    else {
        for (const subjectName of Object.keys(subjectStats).sort()) {
            const stats = subjectStats[subjectName];
            const totalHeld = stats.Theory.Held + stats.Lab.Held;
            const totalAttended = stats.Theory.Attended + stats.Lab.Attended;
            const overallPercentage = totalHeld > 0 ? ((totalAttended / totalHeld) * 100).toFixed(1) : '100.0';
            const hasTheory = stats.Theory.Held > 0;
            const hasLab = stats.Lab.Held > 0;
            const rowSpan = (hasTheory && hasLab) ? `rowspan="2"` : ``;
            if (hasTheory) {
                const percentage = stats.Theory.Held > 0 ? ((stats.Theory.Attended / stats.Theory.Held) * 100).toFixed(1) : '100.0';
                tableHTML += `<tr class="${percentage < userProfile.attendance_threshold ? 'bg-red-50' : ''}"><td class="px-6 py-4 whitespace-nowrap font-medium text-gray-900" ${rowSpan}>${subjectName}</td><td class="px-6 py-4 whitespace-nowrap text-gray-500">Theory</td><td class="px-6 py-4 whitespace-nowrap text-gray-500">${stats.Theory.Attended}</td><td class="px-6 py-4 whitespace-nowrap text-gray-500">${stats.Theory.Held}</td><td class="px-6 py-4 whitespace-nowrap text-gray-500 font-medium ${percentage < userProfile.attendance_threshold ? 'text-red-600' : 'text-gray-900'}">${percentage}%</td><td class="px-6 py-4 whitespace-nowrap font-medium ${overallPercentage < userProfile.attendance_threshold ? 'text-red-600' : 'text-gray-900'}" ${rowSpan}>${overallPercentage}%</td></tr>`;
            }
            if (hasLab) {
                const percentage = stats.Lab.Held > 0 ? ((stats.Lab.Attended / stats.Lab.Held) * 100).toFixed(1) : '100.0';
                tableHTML += `<tr class="${percentage < userProfile.attendance_threshold ? 'bg-red-50' : ''}">${hasTheory ? '' : `<td class="px-6 py-4 whitespace-nowrap font-medium text-gray-900">${subjectName}</td>`}<td class="px-6 py-4 whitespace-nowrap text-gray-500">Lab</td><td class="px-6 py-4 whitespace-nowrap text-gray-500">${stats.Lab.Attended}</td><td class="px-6 py-4 whitespace-nowrap text-gray-500">${stats.Lab.Held}</td><td class="px-6 py-4 whitespace-nowrap text-gray-500 font-medium ${percentage < userProfile.attendance_threshold ? 'text-red-600' : 'text-gray-900'}">${percentage}%</td>${hasTheory ? '' : `<td class="px-6 py-4 whitespace-nowrap font-medium ${overallPercentage < userProfile.attendance_threshold ? 'text-red-600' : 'text-gray-900'}">${overallPercentage}%</td>`}</tr>`;
            }
        }
    }
    tableHTML += '</tbody></table></div>';
    attendanceSummary.innerHTML = tableHTML;
};

/**
 * Renders the interactive logger for a specific date.
 */
const renderScheduleForDate = (dateStr) => {
    pendingChanges.clear(); // Clear any pending changes when the date changes
    saveAttendanceContainer.innerHTML = ''; // Hide save button

    const lecturesOnDate = attendanceLog.filter(log => log.date.slice(0, 10) === dateStr);
    if (lecturesOnDate.length === 0) { dailyLogContainer.innerHTML = `<p class="text-center text-gray-500 py-4">No classes scheduled for this day.</p>`; return; }
    
    let logHTML = `<div class="space-y-4">`;
    lecturesOnDate.sort((a,b) => a.subject_name.localeCompare(b.subject_name)).forEach(log => {
        logHTML += `<div class="log-item flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                        <strong class="text-gray-800">${log.subject_name} (${log.category})</strong>
                        <div class="log-actions flex space-x-2" data-log-id="${log.id}">
                            <button data-status="Attended" class="log-btn px-3 py-1 text-sm font-medium rounded-md ${log.status === 'Attended' ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-green-200'}">Attended</button>
                            <button data-status="Missed" class="log-btn px-3 py-1 text-sm font-medium rounded-md ${log.status === 'Missed' ? 'bg-red-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-red-200'}">Missed</button>
                            <button data-status="Cancelled" class="log-btn px-3 py-1 text-sm font-medium rounded-md ${log.status === 'Cancelled' ? 'bg-yellow-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-yellow-200'}">Cancelled</button>
                        </div>
                    </div>`;
    });
    logHTML += `</div>`;
    dailyLogContainer.innerHTML = logHTML;
};

/**
 * NEW: Handles clicks on attendance buttons locally without refreshing.
 */
function handleMarkAttendance(e) {
    const button = e.target.closest('.log-btn');
    if (!button) return;

    const newStatus = button.dataset.status;
    const buttonGroup = button.parentElement;
    const logId = buttonGroup.dataset.logId;

    // Store the change to be saved later
    pendingChanges.set(logId, newStatus);

    // Update button styles instantly
    const allButtons = buttonGroup.querySelectorAll('.log-btn');
    allButtons.forEach(btn => {
        btn.classList.remove('bg-green-500', 'bg-red-500', 'bg-yellow-500', 'text-white');
        btn.classList.add('bg-gray-200', 'text-gray-700');
    });
    button.classList.add(...(newStatus === 'Attended' ? ['bg-green-500', 'text-white'] :
                           newStatus === 'Missed' ? ['bg-red-500', 'text-white'] :
                           ['bg-yellow-500', 'text-white']));
    
    // Show the save button if it's not already visible
    if (!saveAttendanceContainer.querySelector('button')) {
        saveAttendanceContainer.innerHTML = `<button id="save-attendance-btn" class="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg shadow-lg">Save Changes</button>`;
    }
}

/**
 * NEW: Saves all pending changes to the database.
 */
async function handleSaveChanges() {
    if (pendingChanges.size === 0) return;
    
    showLoading('Saving...');
    
    const updates = Array.from(pendingChanges).map(([id, status]) => ({
        id: parseInt(id),
        status: status
    }));

    const { error } = await supabase.from('attendance_log').upsert(updates);
    
    if (error) {
        alert("Error saving changes: " + error.message);
        hideLoading();
        return;
    }

    pendingChanges.clear();
    saveAttendanceContainer.innerHTML = '';

    // Instead of re-fetching everything, we can just update our local cache and re-render
    updates.forEach(update => {
        const logIndex = attendanceLog.findIndex(log => log.id === update.id);
        if (logIndex !== -1) {
            attendanceLog[logIndex].status = update.status;
        }
    });

    renderSummaryTable(); // Re-render the main summary table with new stats
    hideLoading();
}

// --- EVENT HANDLERS ---
function handleDateChange(e) {
    if (pendingChanges.size > 0) {
        if (!confirm("You have unsaved changes. Are you sure you want to discard them?")) {
            e.target.value = Array.from(pendingChanges.keys())[0] ? attendanceLog.find(log => log.id == Array.from(pendingChanges.keys())[0]).date.slice(0, 10) : e.target.value;
            return;
        }
    }
    renderScheduleForDate(e.target.value);
}

// --- ATTACH EVENT LISTENERS ---
// Use event delegation for all dynamic content
document.addEventListener('DOMContentLoaded', init);
logoutButton.addEventListener('click', () => supabase.auth.signOut().then(() => window.location.href = '/index.html'));
actionsSection.addEventListener('click', (e) => {
    if (e.target.id === 'save-attendance-btn') {
        handleSaveChanges();
    } else {
        handleMarkAttendance(e);
    }
});
historicalDatePicker.addEventListener('change', handleDateChange);

// --- The manual setup functions are no longer needed here as they are on a different page ---
// --- If your onboarding is still in this file, you would keep those functions and listeners ---