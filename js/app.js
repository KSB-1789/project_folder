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

// --- State ---
let currentUser = null;
let userProfile = null;
let attendanceLog = [];
let setupSubjects = []; 
let pendingChanges = new Map();

// --- Utility ---
const showLoading = (message = 'Loading...') => {
    const loadingText = document.getElementById('loading-text');
    loadingText.textContent = message;
    loadingOverlay.style.display = 'flex';
};
const hideLoading = () => {
    loadingOverlay.style.display = 'none';
};
const toYYYYMMDD = (date) => {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

/**
 * Main initialization function.
 */
const init = async () => {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session) { window.location.href = '/index.html'; return; }
    currentUser = session.user;
    const { data, profileError } = await supabase.from('profiles').select('*').single();
    if (profileError && profileError.code !== 'PGRST116') { hideLoading(); return console.error('Error fetching profile:', profileError); }
    if (data) {
        userProfile = data;
        await runFullAttendanceUpdate();
    } else {
        renderOnboardingUI();
        onboardingView.style.display = 'block';
        hideLoading();
    }
};

/**
 * Main update and render pipeline for existing users.
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
 * Renders the initial state of the manual timetable builder.
 */
const renderOnboardingUI = () => {
    const subjectMasterListUI = document.getElementById('subject-master-list');
    const timetableBuilderGrid = document.getElementById('timetable-grid');
    if (!subjectMasterListUI || !timetableBuilderGrid) return; 

    subjectMasterListUI.innerHTML = setupSubjects.map((sub, index) => `
        <li class="flex justify-between items-center bg-gray-100 p-2 rounded-md">
            <span>${sub.name} (${sub.category})</span>
            <button type="button" data-index="${index}" class="remove-subject-btn text-red-500 hover:text-red-700 font-bold">X</button>
        </li>
    `).join('');

    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    timetableBuilderGrid.innerHTML = days.map(day => `
        <div class="day-column bg-gray-50 p-3 rounded-lg">
            <h4 class="font-bold mb-2 text-center">${day}</h4>
            <div class="flex items-center gap-1 mb-2">
                <select data-day="${day}" class="add-class-select flex-grow w-full pl-2 pr-7 py-1 text-sm bg-white border border-gray-300 rounded-md">
                    <option value="">-- select --</option>
                    ${setupSubjects.map(sub => `<option value="${sub.name} ${sub.category}">${sub.name} (${sub.category})</option>`).join('')}
                </select>
                <button type="button" data-day="${day}" class="add-class-btn bg-blue-500 text-white text-sm rounded-md h-7 w-7 flex-shrink-0">+</button>
            </div>
            <ul data-day="${day}" class="day-schedule-list space-y-1 min-h-[50px]"></ul>
        </div>
    `).join('');
};

/**
 * Automatically creates lecture records for past days.
 */
const populateAttendanceLog = async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let lastLog = userProfile.last_log_date 
        ? new Date(userProfile.last_log_date + 'T00:00:00Z') // Assume UTC from DB for consistency
        : new Date(new Date(userProfile.start_date).setDate(new Date(userProfile.start_date).getDate() - 1));
    let currentDate = new Date(lastLog);
    currentDate.setDate(currentDate.getDate() + 1);
    const newLogEntries = [];
    while (currentDate <= today) {
        const dayIndex = currentDate.getDay();
        if (dayIndex >= 1 && dayIndex <= 5) { // Monday to Friday
            const dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dayIndex];
            const lecturesToday = userProfile.timetable_json[dayName] || [];
            for (const subjectString of lecturesToday) {
                const parts = subjectString.split(' ');
                const category = parts.pop();
                const subject_name = parts.join(' ');
                newLogEntries.push({ user_id: currentUser.id, date: toYYYYMMDD(currentDate), subject_name, category, status: 'Missed' });
            }
        }
        currentDate.setDate(currentDate.getDate() + 1);
    }
    if (newLogEntries.length > 0) { await supabase.from('attendance_log').insert(newLogEntries, { onConflict: 'user_id,date,subject_name,category' }); }
    await supabase.from('profiles').update({ last_log_date: toYYYYMMDD(today) }).eq('id', currentUser.id);
};

const loadFullAttendanceLog = async () => {
    const { data, error } = await supabase.from('attendance_log').select('*').order('date', { ascending: false });
    if (error) { console.error("Error fetching attendance log:", error); attendanceLog = []; }
    else { attendanceLog = data; }
};

const renderDashboard = () => {
    renderSummaryTable();
    const todayStr = toYYYYMMDD(new Date());
    historicalDatePicker.value = todayStr;
    renderScheduleForDate(todayStr);
    dashboardView.style.display = 'block';
    onboardingView.style.display = 'none';
};

const calculateBunkingAssistant = (subjectName, totalAttended, totalHeld) => {
    const threshold = userProfile.attendance_threshold / 100;
    const currentPercentage = totalHeld > 0 ? (totalAttended / totalHeld) : 1;
    if (currentPercentage < threshold) { return { status: 'danger', message: `Below ${userProfile.attendance_threshold}%. Attend all!` }; }
    const safeBunks = Math.floor((totalAttended - (threshold * totalHeld)) / threshold);
    if (safeBunks > 0) { return { status: 'safe', message: `Safe. You can miss ${safeBunks} more.` }; }
    let remainingThisWeek = 0;
    const today = new Date();
    const dayOfWeek = today.getDay();
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        const days = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
        for (let i = dayOfWeek; i <= 5; i++) {
            (userProfile.timetable_json[days[i]] || []).forEach(lecture => {
                if (lecture.startsWith(subjectName)) { remainingThisWeek++; }
            });
        }
    }
    const isDoubleWeight = (subjectName === 'DA' || subjectName === 'DSA' || userProfile.unique_subjects.some(s => s === subjectName && (userProfile.timetable_json[Object.keys(userProfile.timetable_json)[0]] || []).some(lec => lec === `${s} Lab`)));
    const weight = isDoubleWeight ? 2 : 1;
    const futureHeld = totalHeld + (remainingThisWeek * weight);
    const attendedToMaintain = Math.ceil(futureHeld * threshold);
    const neededToAttendFromNow = attendedToMaintain - totalAttended;
    if (neededToAttendFromNow <= (remainingThisWeek > 0 ? (remainingThisWeek-1) * weight : 0)) {
        return { status: 'warning', message: `Risky. Bunk now & you must attend the next ${Math.ceil(neededToAttendFromNow/weight)}.` };
    } else {
        return { status: 'danger', message: `Cannot bunk. Must attend all.` };
    }
};

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
    let tableHTML = `<h3 class="text-xl font-bold text-gray-800 mb-4">Overall Summary</h3><div class="overflow-x-auto"><table class="min-w-full divide-y divide-gray-200"><thead class="bg-gray-50"><tr><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Subject</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Attended</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Held</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Percentage</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Bunking Assistant</th></tr></thead><tbody class="bg-white divide-y divide-gray-200">`;
    if (userProfile.unique_subjects.length === 0) { tableHTML += `<tr><td colspan="6" class="px-6 py-4 text-center text-gray-500">No subjects defined.</td></tr>`; }
    else {
        userProfile.unique_subjects.sort().forEach(subjectName => {
            const stats = subjectStats[subjectName] || { Theory: { Attended: 0, Held: 0 }, Lab: { Attended: 0, Held: 0 }};
            const bunkingInfo = calculateBunkingAssistant(subjectName, stats.Theory.Attended + stats.Lab.Attended, stats.Theory.Held + stats.Lab.Held);
            const statusColorClass = bunkingInfo.status === 'safe' ? 'bg-green-100 text-green-800' : bunkingInfo.status === 'warning' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800';
            let hasTheory = false, hasLab = false;
            for(const day in userProfile.timetable_json) {
                if (userProfile.timetable_json[day].includes(`${subjectName} Theory`)) hasTheory = true;
                if (userProfile.timetable_json[day].includes(`${subjectName} Lab`)) hasLab = true;
            }
            if (!hasTheory && !hasLab) return;
            const rowSpan = (hasTheory && hasLab) ? `rowspan="2"` : ``;
            if (hasTheory) {
                const percentage = stats.Theory.Held > 0 ? ((stats.Theory.Attended / stats.Theory.Held) * 100).toFixed(1) : '100.0';
                tableHTML += `<tr class="${percentage < userProfile.attendance_threshold ? 'bg-red-50' : ''}"><td class="px-6 py-4 whitespace-nowrap font-medium text-gray-900" ${rowSpan}>${subjectName}</td><td class="px-6 py-4 whitespace-nowrap text-gray-500">Theory</td><td class="px-6 py-4 whitespace-nowrap text-gray-500">${stats.Theory.Attended}</td><td class="px-6 py-4 whitespace-nowrap text-gray-500">${stats.Theory.Held}</td><td class="px-6 py-4 whitespace-nowrap font-medium ${percentage < userProfile.attendance_threshold ? 'text-red-600' : 'text-gray-900'}">${percentage}%</td><td class="px-6 py-4 text-sm" ${rowSpan}><div class="p-2 rounded-md ${statusColorClass}">${bunkingInfo.message}</div></td></tr>`;
            }
            if (hasLab) {
                const percentage = stats.Lab.Held > 0 ? ((stats.Lab.Attended / stats.Lab.Held) * 100).toFixed(1) : '100.0';
                tableHTML += `<tr class="${percentage < userProfile.attendance_threshold ? 'bg-red-50' : ''}">${hasTheory ? '' : `<td class="px-6 py-4 whitespace-nowrap font-medium text-gray-900">${subjectName}</td>`}<td class="px-6 py-4 whitespace-nowrap text-gray-500">Lab</td><td class="px-6 py-4 whitespace-nowrap text-gray-500">${stats.Lab.Attended}</td><td class="px-6 py-4 whitespace-nowrap text-gray-500">${stats.Lab.Held}</td><td class="px-6 py-4 whitespace-nowrap font-medium ${percentage < userProfile.attendance_threshold ? 'text-red-600' : 'text-gray-900'}">${percentage}%</td>${hasTheory ? '' : `<td class="px-6 py-4 text-sm"><div class="p-2 rounded-md ${statusColorClass}">${bunkingInfo.message}</div></td>`}</tr>`;
            }
        });
    }
    tableHTML += '</tbody></table></div>';
    attendanceSummary.innerHTML = tableHTML;
};

const renderScheduleForDate = (dateStr) => {
    pendingChanges.clear();
    saveAttendanceContainer.innerHTML = '';
    const lecturesOnDate = attendanceLog.filter(log => log.date === dateStr);
    if (lecturesOnDate.length === 0) { dailyLogContainer.innerHTML = `<p class="text-center text-gray-500 py-4">No classes scheduled for this day.</p>`; return; }
    let logHTML = `<div class="space-y-4">`;
    lecturesOnDate.sort((a,b) => a.subject_name.localeCompare(b.subject_name)).forEach(log => {
        logHTML += `<div class="log-item flex items-center justify-between p-4 bg-gray-50 rounded-lg"><strong class="text-gray-800">${log.subject_name} (${log.category})</strong><div class="log-actions flex space-x-2" data-log-id="${log.id}"><button data-status="Attended" class="log-btn px-3 py-1 text-sm font-medium rounded-md ${log.status === 'Attended' ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-green-200'}">Attended</button><button data-status="Missed" class="log-btn px-3 py-1 text-sm font-medium rounded-md ${log.status === 'Missed' ? 'bg-red-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-red-200'}">Missed</button><button data-status="Cancelled" class="log-btn px-3 py-1 text-sm font-medium rounded-md ${log.status === 'Cancelled' ? 'bg-yellow-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-yellow-200'}">Cancelled</button></div></div>`;
    });
    logHTML += `</div>`;
    dailyLogContainer.innerHTML = logHTML;
};

const handleSetup = async (e) => {
    e.preventDefault();
    showLoading('Saving Timetable...');
    const setupError = document.getElementById('setup-error');
    setupError.textContent = '';
    const startDate = document.getElementById('start-date').value;
    const minAttendance = document.getElementById('min-attendance').value;
    if (!startDate || !minAttendance) { setupError.textContent = 'Please set a start date and attendance percentage.'; hideLoading(); return; }
    if (setupSubjects.length === 0) { setupError.textContent = 'Please add at least one subject.'; hideLoading(); return; }
    const timetable_json = {};
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    days.forEach(day => {
        const classList = document.querySelectorAll(`.day-schedule-list[data-day="${day}"] li`);
        timetable_json[day] = Array.from(classList).map(li => li.dataset.value);
    });
    const uniqueSubjects = [...new Set(setupSubjects.map(sub => sub.name))];
    try {
        const { data, error } = await supabase.from('profiles').insert([{ id: currentUser.id, start_date: startDate, attendance_threshold: parseInt(minAttendance), timetable_json, unique_subjects: uniqueSubjects }]).select().single();
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
    const newSubjectNameInput = document.getElementById('new-subject-name');
    const newSubjectCategorySelect = document.getElementById('new-subject-category');
    const name = newSubjectNameInput.value.trim();
    const category = newSubjectCategorySelect.value;
    if (!name) { alert("Please enter a subject name."); return; }
    if (setupSubjects.some(sub => sub.name === name && sub.category === category)) { alert("This specific subject (name and category) already exists."); return; }
    setupSubjects.push({ name, category });
    newSubjectNameInput.value = '';
    renderOnboardingUI();
}

function handleAddClassToDay(day) {
    const select = document.querySelector(`.add-class-select[data-day="${day}"]`);
    const subjectValue = select.value;
    if (!subjectValue) return;
    const list = document.querySelector(`.day-schedule-list[data-day="${day}"]`);
    const li = document.createElement('li');
    li.className = 'flex justify-between items-center bg-blue-100 text-blue-800 text-sm font-medium px-2 py-1 rounded';
    li.textContent = subjectValue.replace(' Theory', ' (T)').replace(' Lab', ' (L)');
    li.dataset.value = subjectValue;
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-class-btn text-blue-500 hover:text-blue-700 font-bold ml-2';
    removeBtn.textContent = 'x';
    li.appendChild(removeBtn);
    list.appendChild(li);
}

function handleMarkAttendance(e) {
    const button = e.target.closest('.log-btn');
    if (!button) return;
    const newStatus = button.dataset.status;
    const buttonGroup = button.parentElement;
    const logId = buttonGroup.dataset.logId;
    pendingChanges.set(logId, newStatus);
    const allButtons = buttonGroup.querySelectorAll('.log-btn');
    allButtons.forEach(btn => btn.classList.remove('bg-green-500', 'bg-red-500', 'bg-yellow-500', 'text-white'));
    button.classList.add(...(newStatus === 'Attended' ? ['bg-green-500', 'text-white'] : newStatus === 'Missed' ? ['bg-red-500', 'text-white'] : ['bg-yellow-500', 'text-white']));
    if (!saveAttendanceContainer.querySelector('button')) {
        saveAttendanceContainer.innerHTML = `<button id="save-attendance-btn" class="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg shadow-lg">Save Changes</button>`;
    }
}

async function handleSaveChanges() {
    if (pendingChanges.size === 0) return;
    showLoading('Saving...');
    const updatePromises = Array.from(pendingChanges).map(([id, status]) =>
        supabase.from('attendance_log').update({ status }).eq('id', id)
    );
    const results = await Promise.all(updatePromises);
    const anyError = results.some(result => result.error);
    if (anyError) {
        const firstError = results.find(result => result.error).error;
        alert("An error occurred while saving: " + firstError.message);
        hideLoading();
        return;
    }
    for (const [id, status] of pendingChanges) {
        const logIndex = attendanceLog.findIndex(log => log.id == id);
        if (logIndex !== -1) { attendanceLog[logIndex].status = status; }
    }
    pendingChanges.clear();
    saveAttendanceContainer.innerHTML = '';
    renderSummaryTable();
    hideLoading();
}

function handleDateChange(e) {
    if (pendingChanges.size > 0) {
        if (!confirm("You have unsaved changes. Are you sure you want to discard them?")) {
            e.target.value = toYYYYMMDD(new Date(attendanceLog.find(log => log.id == Array.from(pendingChanges.keys())[0]).date + 'T00:00:00Z'));
            return;
        }
    }
    renderScheduleForDate(e.target.value);
}

// --- ATTACH EVENT LISTENERS ---
document.addEventListener('DOMContentLoaded', init);
logoutButton.addEventListener('click', () => supabase.auth.signOut().then(() => window.location.href = '/index.html'));
setupForm.addEventListener('submit', handleSetup);
onboardingView.addEventListener('click', (e) => {
    if (e.target.id === 'add-subject-btn') { handleAddSubject(); }
    if (e.target.classList.contains('remove-subject-btn')) { setupSubjects.splice(e.target.dataset.index, 1); renderOnboardingUI(); }
    if (e.target.classList.contains('add-class-btn')) { handleAddClassToDay(e.target.dataset.day); }
    if (e.target.classList.contains('remove-class-btn')) { e.target.parentElement.remove(); }
});
settingsSection.addEventListener('click', async (e) => {
    if (e.target.id === 'clear-attendance-btn') {
        if (!confirm("Are you sure? This will reset all attendance records but will keep your timetable.")) return;
        showLoading('Clearing records...');
        await supabase.from('attendance_log').delete().eq('user_id', currentUser.id);
        await supabase.from('profiles').update({ last_log_date: null }).eq('id', currentUser.id);
        window.location.reload();
    } else if (e.target.id === 'reset-all-btn') {
        if (!confirm("DANGER: This will permanently delete your timetable and all attendance data. Are you sure?")) return;
        showLoading('Resetting everything...');
        await supabase.from('profiles').delete().eq('id', currentUser.id);
        window.location.reload();
    }
});
actionsSection.addEventListener('click', (e) => {
    if (e.target.id === 'save-attendance-btn') { handleSaveChanges(); }
    else if (e.target.closest('.log-actions')) { handleMarkAttendance(e); }
});
historicalDatePicker.addEventListener('change', handleDateChange);