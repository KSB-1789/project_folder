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

// --- Onboarding Elements ---
const addSubjectBtn = document.getElementById('add-subject-btn');
const newSubjectNameInput = document.getElementById('new-subject-name');
const newSubjectCategorySelect = document.getElementById('new-subject-category');
const subjectMasterListUI = document.getElementById('subject-master-list');
const timetableBuilderUI = document.querySelector('#timetable-builder .grid');
const resetScheduleBtn = document.getElementById('reset-schedule-btn');

// --- State ---
let currentUser = null;
let userProfile = null;
let attendanceLog = [];
let setupSubjects = []; // Temporary state for building the timetable

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
        hideLoading();
        renderOnboardingUI();
        onboardingView.style.display = 'block';
        dashboardView.style.display = 'none';
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
 * NEW: Renders the initial state of the manual timetable builder.
 */
const renderOnboardingUI = () => {
    // Render master subject list
    subjectMasterListUI.innerHTML = setupSubjects.map((sub, index) => `
        <li class="flex justify-between items-center bg-gray-100 p-2 rounded-md">
            <span>${sub.name} (${sub.category})</span>
            <button type="button" data-index="${index}" class="remove-subject-btn text-red-500 hover:text-red-700 font-bold">X</button>
        </li>
    `).join('');

    // Render the day columns for the builder
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    timetableBuilderUI.innerHTML = days.map(day => `
        <div class="day-column bg-gray-50 p-3 rounded-lg">
            <h4 class="font-bold mb-2 text-center">${day}</h4>
            <div class="flex items-center gap-1 mb-2">
                <select data-day="${day}" class="add-class-select flex-grow w-full pl-2 pr-7 py-1 text-sm bg-white border border-gray-300 rounded-md">
                    <option value="">-- select --</option>
                    ${setupSubjects.map(sub => `<option value="${sub.name} ${sub.category}">${sub.name} (${sub.category})</option>`).join('')}
                </select>
                <button type="button" data-day="${day}" class="add-class-btn bg-blue-500 text-white text-sm rounded-md h-7 w-7 flex-shrink-0">+</button>
            </div>
            <ul data-day="${day}" class="day-schedule-list space-y-1">
                <!-- Classes for this day will be added here -->
            </ul>
        </div>
    `).join('');
}


/**
 * The "automatic daily increment" feature.
 */
const populateAttendanceLog = async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let lastLog;
    if (userProfile.last_log_date) { lastLog = new Date(userProfile.last_log_date + 'T00:00:00'); }
    else { lastLog = new Date(userProfile.start_date); lastLog.setDate(lastLog.getDate() - 1); }
    let currentDate = new Date(lastLog);
    currentDate.setDate(currentDate.getDate() + 1);
    const newLogEntries = [];
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
    const { error } = await supabase.from('profiles').update({ last_log_date: today.toISOString().slice(0, 10) }).eq('id', currentUser.id);
    if (error) console.error("Error updating last_log_date", error);
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
 * UPDATED: Renders the summary table with new lecture weighting.
 */
const renderSummaryTable = () => {
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
    const lecturesOnDate = attendanceLog.filter(log => log.date.slice(0, 10) === dateStr);
    if (lecturesOnDate.length === 0) { dailyLogContainer.innerHTML = `<p class="text-center text-gray-500 py-4">No classes scheduled for this day.</p>`; return; }
    let logHTML = `<div class="space-y-4">`;
    lecturesOnDate.sort((a,b) => a.subject_name.localeCompare(b.subject_name)).forEach(log => {
        logHTML += `<div class="log-item flex items-center justify-between p-4 bg-gray-50 rounded-lg"><strong class="text-gray-800">${log.subject_name} (${log.category})</strong><div class="log-actions flex space-x-2"><button data-id="${log.id}" data-status="Attended" class="log-btn px-3 py-1 text-sm font-medium rounded-md ${log.status === 'Attended' ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-green-200'}">Attended</button><button data-id="${log.id}" data-status="Missed" class="log-btn px-3 py-1 text-sm font-medium rounded-md ${log.status === 'Missed' ? 'bg-red-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-red-200'}">Missed</button><button data-id="${log.id}" data-status="Cancelled" class="log-btn px-3 py-1 text-sm font-medium rounded-md ${log.status === 'Cancelled' ? 'bg-yellow-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-yellow-200'}">Cancelled</button></div></div>`;
    });
    logHTML += `</div>`;
    dailyLogContainer.innerHTML = logHTML;
};

/**
 * Handles the initial user setup form submission.
 */
const handleSetup = async (e) => {
    e.preventDefault();
    showLoading('Saving Timetable...');
    setupError.textContent = '';
    const startDate = document.getElementById('start-date').value;
    const minAttendance = document.getElementById('min-attendance').value;
    if (!startDate || !minAttendance) { setupError.textContent = 'Please set a start date and attendance percentage.'; hideLoading(); return; }

    // Construct the timetable_json from the UI
    const timetable_json = {};
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    days.forEach(day => {
        const classList = document.querySelectorAll(`.day-schedule-list[data-day="${day}"] li`);
        timetable_json[day] = Array.from(classList).map(li => li.dataset.value);
    });

    const uniqueSubjects = setupSubjects.map(sub => sub.name);

    try {
        const { data, error } = await supabase.from('profiles').insert([{ id: currentUser.id, start_date: startDate, attendance_threshold: parseInt(minAttendance), timetable_json: timetable_json, unique_subjects: uniqueSubjects }]).select().single();
        if (error) throw error;
        userProfile = data;
        await runFullAttendanceUpdate();
    } catch (error) {
        setupError.textContent = `Error: ${error.message}`;
        console.error(error);
        hideLoading();
    }
};

// --- EVENT HANDLERS ---
function handleAddSubject() {
    const name = newSubjectNameInput.value.trim();
    const category = newSubjectCategorySelect.value;
    if (!name) { alert("Please enter a subject name."); return; }
    if (setupSubjects.some(sub => sub.name === name && sub.category === category)) { alert("This subject already exists."); return; }
    setupSubjects.push({ name, category });
    newSubjectNameInput.value = '';
    renderOnboardingUI(); // Re-render the whole onboarding UI to update lists
}

function handleAddClassToDay(day) {
    const select = document.querySelector(`.add-class-select[data-day="${day}"]`);
    const subjectValue = select.value;
    if (!subjectValue) return;

    const list = document.querySelector(`.day-schedule-list[data-day="${day}"]`);
    // Prevent duplicates
    if (Array.from(list.children).some(li => li.dataset.value === subjectValue)) {
        alert("This class is already scheduled for this day.");
        return;
    }

    const li = document.createElement('li');
    li.className = 'flex justify-between items-center bg-blue-100 text-blue-800 text-sm font-medium px-2 py-1 rounded';
    li.textContent = subjectValue.replace(' Theory', ' (T)').replace(' Lab', ' (L)');
    li.dataset.value = subjectValue;
    
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-class-btn text-blue-500 hover:text-blue-700 font-bold';
    removeBtn.textContent = 'x';
    li.appendChild(removeBtn);
    
    list.appendChild(li);
}

// --- ATTACH EVENT LISTENERS ---
document.addEventListener('DOMContentLoaded', init);
logoutButton.addEventListener('click', () => supabase.auth.signOut().then(() => window.location.href = '/index.html'));
setupForm.addEventListener('submit', handleSetup);

// Event delegation for dynamically created buttons
onboardingView.addEventListener('click', (e) => {
    if (e.target.id === 'add-subject-btn') handleAddSubject();
    if (e.target.classList.contains('remove-subject-btn')) {
        const index = e.target.dataset.index;
        setupSubjects.splice(index, 1);
        renderOnboardingUI();
    }
    if (e.target.classList.contains('add-class-btn')) {
        const day = e.target.dataset.day;
        handleAddClassToDay(day);
    }
    if (e.target.classList.contains('remove-class-btn')) {
        e.target.parentElement.remove();
    }
});

resetScheduleBtn.addEventListener('click', async () => {
    if (!confirm("Are you sure? This will delete all your attendance data and allow you to create a new timetable.")) return;
    showLoading('Resetting...');
    await supabase.from('attendance_log').delete().eq('user_id', currentUser.id);
    await supabase.from('profiles').delete().eq('id', currentUser.id);
    hideLoading();
    window.location.reload();
});

async function handleMarkAttendance(e) {
    if (!e.target.classList.contains('log-btn')) return;
    const button = e.target;
    const logId = button.dataset.id;
    const newStatus = button.dataset.status;
    showLoading('Updating...');
    const logIndex = attendanceLog.findIndex(log => log.id == logId);
    if (logIndex === -1) { hideLoading(); return; }
    attendanceLog[logIndex].status = newStatus;
    renderDashboard();
    await supabase.from('attendance_log').update({ status: newStatus }).eq('id', logId);
    hideLoading();
}

function handleDateChange(e) { renderScheduleForDate(e.target.value); }

dashboardView.addEventListener('click', handleMarkAttendance);
historicalDatePicker.addEventListener('change', handleDateChange);