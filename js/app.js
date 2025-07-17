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
let isEditingMode = false;

// --- Utility ---
const showLoading = (message = 'Loading...') => {
    const loadingText = document.getElementById('loading-text');
    loadingText.textContent = message;
    loadingOverlay.style.display = 'flex';
};
const hideLoading = () => {
    loadingOverlay.style.display = 'none';
};
const toYYYYMMDD = (dateInput) => {
    const date = new Date(dateInput);
    const userTimezoneOffset = date.getTimezoneOffset() * 60000;
    const correctedDate = new Date(date.getTime() + userTimezoneOffset);
    const year = correctedDate.getFullYear();
    const month = String(correctedDate.getMonth() + 1).padStart(2, '0');
    const day = String(correctedDate.getDate()).padStart(2, '0');
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
        isEditingMode = false;
        renderOnboardingUI();
        onboardingView.style.display = 'block';
        hideLoading();
    }
};

const runFullAttendanceUpdate = async () => {
    showLoading('Updating attendance records...');
    await populateAttendanceLog();
    showLoading('Loading your dashboard...');
    await loadFullAttendanceLog();
    renderDashboard();
    hideLoading();
};

const renderOnboardingUI = () => {
    const subjectMasterListUI = document.getElementById('subject-master-list');
    const timetableBuilderGrid = document.getElementById('timetable-grid');
    if (!subjectMasterListUI || !timetableBuilderGrid) return; 
    const setupTitle = document.getElementById('setup-title');
    const setupSubtitle = document.getElementById('setup-subtitle');
    const saveTimetableBtn = document.getElementById('save-timetable-btn');
    if (isEditingMode) {
        setupTitle.textContent = "Edit Timetable";
        setupSubtitle.textContent = "Add or remove subjects and classes below. Your existing attendance will be preserved.";
        saveTimetableBtn.textContent = "Save Changes and Re-calculate";
        document.getElementById('start-date').value = userProfile.start_date;
        document.getElementById('min-attendance').value = userProfile.attendance_threshold;
        document.getElementById('start-date').disabled = true;
    } else {
        setupTitle.textContent = "Initial Setup";
        setupSubtitle.textContent = "Welcome! Please build your timetable below.";
        saveTimetableBtn.textContent = "Save and Build Dashboard";
        document.getElementById('start-date').disabled = false;
    }
    subjectMasterListUI.innerHTML = setupSubjects.map((sub, index) => `<li class="flex justify-between items-center bg-gray-100 p-2 rounded-md"><span>${sub.name} (${sub.category})</span><button type="button" data-index="${index}" class="remove-subject-btn text-red-500 hover:text-red-700 font-bold">X</button></li>`).join('');
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    timetableBuilderGrid.innerHTML = days.map(day => {
        const scheduledClasses = isEditingMode ? (userProfile.timetable_json[day] || []) : [];
        return `<div class="day-column bg-gray-50 p-3 rounded-lg"><h4 class="font-bold mb-2 text-center">${day}</h4><div class="flex items-center gap-1 mb-2"><select data-day="${day}" class="add-class-select flex-grow w-full pl-2 pr-7 py-1 text-sm bg-white border border-gray-300 rounded-md"><option value="">-- select --</option>${setupSubjects.map(sub => `<option value="${sub.name} ${sub.category}">${sub.name} (${sub.category})</option>`).join('')}</select><button type="button" data-day="${day}" class="add-class-btn bg-blue-500 text-white text-sm rounded-md h-7 w-7 flex-shrink-0">+</button></div><ul data-day="${day}" class="day-schedule-list space-y-1 min-h-[50px]">${scheduledClasses.map(cls => `<li class="flex justify-between items-center bg-blue-100 text-blue-800 text-sm font-medium px-2 py-1 rounded" data-value="${cls}">${cls.replace(' Theory', ' (T)').replace(' Lab', ' (L)')}<button type="button" class="remove-class-btn text-blue-500 hover:text-blue-700 font-bold ml-2">x</button></li>`).join('')}</ul></div>`;
    }).join('');
};

const populateAttendanceLog = async () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const startDateInput = userProfile.start_date;
    let lastLogDate = userProfile.last_log_date ? new Date(userProfile.last_log_date + 'T12:00:00') : new Date(new Date(startDateInput + 'T12:00:00').setDate(new Date(startDateInput + 'T12:00:00').getDate() - 1));
    let currentDate = new Date(lastLogDate);
    currentDate.setDate(currentDate.getDate() + 1);
    const newLogEntries = [];
    while (currentDate <= today) {
        const dayIndex = currentDate.getDay();
        if (dayIndex >= 1 && dayIndex <= 5) {
            const dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dayIndex];
            const lecturesToday = userProfile.timetable_json[dayName] || [];
            const isCurrentDay = toYYYYMMDD(currentDate) === toYYYYMMDD(today);
            const status = isCurrentDay ? 'Not Held Yet' : 'Missed';
            for (const subjectString of lecturesToday) {
                const parts = subjectString.split(' ');
                const category = parts.pop();
                const subject_name = parts.join(' ');
                newLogEntries.push({ user_id: currentUser.id, date: toYYYYMMDD(currentDate), subject_name, category, status });
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

/**
 * FINAL CORRECTED VERSION: This function uses a simpler, robust integer-based
 * calculation that is not prone to floating-point errors.
 */
const calculateBunkingAssistant = (subjectName, totalAttended, totalHeld) => {
    const threshold = userProfile.attendance_threshold / 100;

    // Calculate the absolute minimum classes one must attend
    const minAttended = Math.ceil(totalHeld * threshold);

    if (totalAttended < minAttended) {
        return { status: 'danger', message: `Below ${userProfile.attendance_threshold}%. Attend all!` };
    }

    // This is the number of classes you are "ahead" by. It's the true number of bunks available.
    const bunksAvailable = totalAttended - minAttended;

    if (bunksAvailable >= 1) {
        return { status: 'safe', message: `Safe. You can miss ${bunksAvailable} more class(es).` };
    }

    // If bunksAvailable is 0, you are at the threshold. Any bunk is risky.
    let remainingThisWeek = 0;
    const today = new Date();
    const dayOfWeek = today.getDay(); // Sunday=0, Monday=1...
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        const days = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
        for (let i = dayOfWeek; i <= 5; i++) {
            (userProfile.timetable_json[days[i]] || []).forEach(lecture => {
                if (lecture.startsWith(subjectName)) {
                    remainingThisWeek++;
                }
            });
        }
    }

    return { status: 'warning', message: `Risky. At ${userProfile.attendance_threshold}%. Attend next ${remainingThisWeek} class(es).` };
};

const renderSummaryTable = () => {
    const subjectStats = {};
    for (const log of attendanceLog) {
        if (log.status === 'Not Held Yet') continue;
        const baseSubject = log.subject_name;
        if (!subjectStats[baseSubject]) { subjectStats[baseSubject] = { Theory: { Attended: 0, Held: 0 }, Lab: { Attended: 0, Held: 0 }}; }
        const isDoubleWeighted = (baseSubject === 'DA' || baseSubject === 'DSA' || log.category === 'Lab');
        const weight = isDoubleWeighted ? 2 : 1;
        if (log.status !== 'Cancelled') {
            subjectStats[baseSubject][log.category].Held += weight;
            if (log.status === 'Attended') { subjectStats[baseSubject][log.category].Attended += weight; }
        }
    }

    let tableHTML = `<h3 class="text-xl font-bold text-gray-800 mb-4">Overall Summary (up to yesterday)</h3><div class="overflow-x-auto"><table class="min-w-full divide-y divide-gray-200"><thead class="bg-gray-50"><tr><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Subject</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Attended</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Held</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Percentage</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Bunking Assistant</th></tr></thead><tbody class="bg-white divide-y divide-gray-200">`;
    if (!userProfile.unique_subjects || userProfile.unique_subjects.length === 0) { tableHTML += `<tr><td colspan="6" class="px-6 py-4 text-center text-gray-500">No subjects defined.</td></tr>`; }
    else {
        userProfile.unique_subjects.sort().forEach(subjectName => {
            const stats = subjectStats[subjectName] || { Theory: { Attended: 0, Held: 0 }, Lab: { Attended: 0, Held: 0 }};
            let hasTheory = false, hasLab = false;
            for(const day in userProfile.timetable_json) {
                if (userProfile.timetable_json[day].includes(`${subjectName} Theory`)) hasTheory = true;
                if (userProfile.timetable_json[day].includes(`${subjectName} Lab`)) hasLab = true;
            }
            if (!hasTheory && !hasLab) return;

            const showCombinedRow = hasTheory && hasLab;
            
            if (hasTheory) {
                const percentage = stats.Theory.Held > 0 ? ((stats.Theory.Attended / stats.Theory.Held) * 100).toFixed(1) : '100.0';
                tableHTML += `<tr class="${percentage < userProfile.attendance_threshold ? 'bg-red-50' : ''}"><td class="px-6 py-4 whitespace-nowrap font-medium text-gray-900" ${showCombinedRow ? '' : 'rowspan="1"'}>${subjectName}</td><td class="px-6 py-4 whitespace-nowrap text-gray-500">Theory</td><td class="px-6 py-4 whitespace-nowrap text-gray-500">${stats.Theory.Attended}</td><td class="px-6 py-4 whitespace-nowrap text-gray-500">${stats.Theory.Held}</td><td class="px-6 py-4 whitespace-nowrap font-medium ${percentage < userProfile.attendance_threshold ? 'text-red-600' : 'text-gray-900'}">${percentage}%</td>${!showCombinedRow ? `<td class="px-6 py-4 text-sm" rowspan="1"><div class="p-2 rounded-md bg-green-100 text-green-800">Cannot bunk. Must attend all.</div></td>` : ``}</tr>`;
            }
            if (hasLab) {
                const percentage = stats.Lab.Held > 0 ? ((stats.Lab.Attended / stats.Lab.Held) * 100).toFixed(1) : '100.0';
                tableHTML += `<tr class="${percentage < userProfile.attendance_threshold ? 'bg-red-50' : ''}">${hasTheory ? '' : `<td class="px-6 py-4 whitespace-nowrap font-medium text-gray-900">${subjectName}</td>`}<td class="px-6 py-4 whitespace-nowrap text-gray-500">Lab</td><td class="px-6 py-4 whitespace-nowrap text-gray-500">${stats.Lab.Attended}</td><td class="px-6 py-4 whitespace-nowrap text-gray-500">${stats.Lab.Held}</td><td class="px-6 py-4 whitespace-nowrap font-medium ${percentage < userProfile.attendance_threshold ? 'text-red-600' : 'text-gray-900'}">${percentage}%</td>${!showCombinedRow ? `<td class="px-6 py-4 text-sm"><div class="p-2 rounded-md bg-red-100 text-red-800">Cannot bunk. Must attend all.</div></td>` : ``}</tr>`;
            }

            if (showCombinedRow) {
                const totalAttended = stats.Theory.Attended + stats.Lab.Attended;
                const totalHeld = stats.Theory.Held + stats.Lab.Held;
                const overallPercentage = totalHeld > 0 ? ((totalAttended / totalHeld) * 100).toFixed(1) : '100.0';
                const bunkingInfo = calculateBunkingAssistant(subjectName, totalAttended, totalHeld);
                const statusColorClass = bunkingInfo.status === 'safe' ? 'bg-green-100 text-green-800' : bunkingInfo.status === 'warning' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800';
                tableHTML += `<tr class="bg-gray-100 font-semibold border-t-2 border-gray-300"><td colspan="2" class="px-6 py-3 text-right text-gray-800">Total</td><td class="px-6 py-3">${totalAttended}</td><td class="px-6 py-3">${totalHeld}</td><td class="px-6 py-3 ${overallPercentage < userProfile.attendance_threshold ? 'text-red-600' : 'text-gray-900'}">${overallPercentage}%</td><td class="px-6 py-3 text-sm"><div class="p-2 rounded-md ${statusColorClass}">${bunkingInfo.message}</div></td></tr>`;
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
    const isToday = dateStr === toYYYYMMDD(new Date());
    let logHTML = `<div class="space-y-4">`;
    lecturesOnDate.sort((a,b) => a.subject_name.localeCompare(b.subject_name)).forEach(log => {
        const notHeldYetButton = isToday ? `<button data-status="Not Held Yet" class="log-btn px-3 py-1 text-sm font-medium rounded-md ${log.status === 'Not Held Yet' ? 'bg-gray-400 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-400'}">Not Held Yet</button>` : '';
        logHTML += `<div class="log-item flex items-center justify-between p-4 bg-gray-50 rounded-lg"><strong class="text-gray-800">${log.subject_name} (${log.category})</strong><div class="log-actions flex flex-wrap gap-2 justify-end" data-log-id="${log.id}">${notHeldYetButton}<button data-status="Attended" class="log-btn px-3 py-1 text-sm font-medium rounded-md ${log.status === 'Attended' ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-green-200'}">Attended</button><button data-status="Missed" class="log-btn px-3 py-1 text-sm font-medium rounded-md ${log.status === 'Missed' ? 'bg-red-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-red-200'}">Missed</button><button data-status="Cancelled" class="log-btn px-3 py-1 text-sm font-medium rounded-md ${log.status === 'Cancelled' ? 'bg-yellow-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-yellow-200'}">Cancelled</button></div></div>`;
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
        hideLoading(); saveButton.disabled = false; return;
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
        const { error } = await supabase.from('profiles').update({ timetable_json: newTimetable, unique_subjects: newUniqueSubjects, attendance_threshold: parseInt(minAttendance), last_log_date: null }).eq('id', currentUser.id);
        if (error) { setupError.textContent = `Error: ${error.message}`; hideLoading(); saveButton.disabled = false; return; }
    } else {
        const { error } = await supabase.from('profiles').insert([{ id: currentUser.id, start_date: startDate, attendance_threshold: parseInt(minAttendance), timetable_json: newTimetable, unique_subjects: newUniqueSubjects }]).single();
        if (error) { setupError.textContent = `Error: ${error.message}`; hideLoading(); saveButton.disabled = false; return; }
    }
    isEditingMode = false;
    saveButton.disabled = false;
    await init();
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
    if (!name) return alert("Please enter a subject name.");
    if (setupSubjects.some(sub => sub.name === name && sub.category === category)) return alert("This specific subject already exists.");
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
    buttonGroup.querySelectorAll('.log-btn').forEach(btn => btn.classList.remove('bg-green-500', 'bg-red-500', 'bg-yellow-500', 'bg-gray-400', 'text-white'));
    button.classList.add(...(newStatus === 'Attended' ? ['bg-green-500', 'text-white'] : newStatus === 'Missed' ? ['bg-red-500', 'text-white'] : newStatus === 'Cancelled' ? ['bg-yellow-500', 'text-white'] : ['bg-gray-400', 'text-white']));
    if (!saveAttendanceContainer.querySelector('button')) {
        saveAttendanceContainer.innerHTML = `<button id="save-attendance-btn" class="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg shadow-lg">Save Changes</button>`;
    }
};

const handleSaveChanges = async () => {
    if (pendingChanges.size === 0) return;
    showLoading('Saving...');
    const updatePromises = Array.from(pendingChanges).map(([id, status]) => supabase.from('attendance_log').update({ status }).eq('id', id));
    const results = await Promise.all(updatePromises);
    const anyError = results.some(result => result.error);
    if (anyError) {
        alert("An error occurred while saving: " + results.find(r => r.error).error.message);
        hideLoading(); return;
    }
    for (const [id, status] of pendingChanges) {
        const logIndex = attendanceLog.findIndex(log => log.id == id);
        if (logIndex !== -1) { attendanceLog[logIndex].status = status; }
    }
    pendingChanges.clear();
    saveAttendanceContainer.innerHTML = '';
    renderSummaryTable();
    hideLoading();
};

const handleDateChange = (e) => {
    if (pendingChanges.size > 0 && !confirm("You have unsaved changes. Discard them?")) {
        e.target.value = toYYYYMMDD(new Date(attendanceLog.find(log => log.id == Array.from(pendingChanges.keys())[0]).date + 'T12:00:00'));
        return;
    }
    renderScheduleForDate(e.target.value);
};

// --- ATTACH EVENT LISTENERS ---
document.addEventListener('DOMContentLoaded', init);
logoutButton.addEventListener('click', () => supabase.auth.signOut().then(() => window.location.href = '/index.html'));
setupForm.addEventListener('submit', handleSetup);
onboardingView.addEventListener('click', (e) => {
    if (e.target.id === 'add-subject-btn') handleAddSubject();
    if (e.target.classList.contains('remove-subject-btn')) { setupSubjects.splice(e.target.dataset.index, 1); renderOnboardingUI(); }
    if (e.target.classList.contains('add-class-btn')) { handleAddClassToDay(e.target.dataset.day); }
    if (e.target.classList.contains('remove-class-btn')) { e.target.parentElement.remove(); }
});
settingsSection.addEventListener('click', async (e) => {
    if (e.target.id === 'edit-timetable-btn') {
        handleEditTimetable();
    } else if (e.target.id === 'clear-attendance-btn') {
        if (!confirm("Are you sure? This will reset all attendance records but will keep your timetable.")) return;
        showLoading('Clearing records...');
        await supabase.from('attendance_log').delete().eq('user_id', currentUser.id);
        await supabase.from('profiles').update({ last_log_date: null }).eq('id', currentUser.id);
        window.location.reload();
    }
});
actionsSection.addEventListener('click', (e) => {
    if (e.target.id === 'save-attendance-btn') { handleSaveChanges(); }
    else if (e.target.closest('.log-actions')) { handleMarkAttendance(e); }
});
historicalDatePicker.addEventListener('change', handleDateChange);