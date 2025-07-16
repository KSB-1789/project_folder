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
const updateTimetableForm = document.getElementById('update-timetable-form');

// --- State ---
let currentUser = null;
let userProfile = null;
let attendanceLog = [];

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

    if (error || !session) {
        window.location.href = '/index.html';
        return;
    }
    currentUser = session.user;

    const { data, profileError } = await supabase.from('profiles').select('*').single();

    if (profileError && profileError.code !== 'PGRST116') {
        hideLoading();
        return console.error('Error fetching profile:', profileError);
    }

    if (data) {
        userProfile = data;
        await runFullAttendanceUpdate();
    } else {
        hideLoading();
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
 * The "automatic daily increment" feature.
 */
const populateAttendanceLog = async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let lastLog;
    if (userProfile.last_log_date) {
        lastLog = new Date(userProfile.last_log_date + 'T00:00:00');
    } else {
        lastLog = new Date(userProfile.start_date);
        lastLog.setDate(lastLog.getDate() - 1);
    }

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

                newLogEntries.push({
                    user_id: currentUser.id,
                    date: new Date(currentDate).toISOString().slice(0, 10),
                    subject_name: subject_name,
                    category: category,
                    status: 'Missed'
                });
            }
        }
        currentDate.setDate(currentDate.getDate() + 1);
    }

    if (newLogEntries.length > 0) {
        await supabase.from('attendance_log').insert(newLogEntries, { onConflict: 'user_id,date,subject_name,category' });
    }

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
 * Renders the detailed summary table.
 */
const renderSummaryTable = () => {
    const subjectStats = {};

    for (const log of attendanceLog) {
        const baseSubject = log.subject_name;
        if (!subjectStats[baseSubject]) {
            subjectStats[baseSubject] = { Theory: { Attended: 0, Held: 0 }, Lab: { Attended: 0, Held: 0 }};
        }
        if (log.status !== 'Cancelled') {
            subjectStats[baseSubject][log.category].Held++;
            if (log.status === 'Attended') {
                subjectStats[baseSubject][log.category].Attended++;
            }
        }
    }

    let tableHTML = `
        <h3 class="text-xl font-bold text-gray-800 mb-4">Overall Summary</h3>
        <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-gray-200">
                <thead class="bg-gray-50">
                    <tr>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Subject</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Attended</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Held</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Percentage</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Overall Subject %</th>
                    </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-200">`;

    if (Object.keys(subjectStats).length === 0) {
        tableHTML += `<tr><td colspan="6" class="px-6 py-4 text-center text-gray-500">No attendance data to display yet.</td></tr>`;
    } else {
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

    if (lecturesOnDate.length === 0) {
        dailyLogContainer.innerHTML = `<p class="text-center text-gray-500 py-4">No classes scheduled for this day.</p>`;
        return;
    }

    let logHTML = `<div class="space-y-4">`;
    lecturesOnDate.sort((a,b) => a.subject_name.localeCompare(b.subject_name)).forEach(log => {
        logHTML += `<div class="log-item flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                        <strong class="text-gray-800">${log.subject_name} (${log.category})</strong>
                        <div class="log-actions flex space-x-2">
                            <button data-id="${log.id}" data-status="Attended" class="log-btn px-3 py-1 text-sm font-medium rounded-md ${log.status === 'Attended' ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-green-200'}">Attended</button>
                            <button data-id="${log.id}" data-status="Missed" class="log-btn px-3 py-1 text-sm font-medium rounded-md ${log.status === 'Missed' ? 'bg-red-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-red-200'}">Missed</button>
                            <button data-id="${log.id}" data-status="Cancelled" class="log-btn px-3 py-1 text-sm font-medium rounded-md ${log.status === 'Cancelled' ? 'bg-yellow-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-yellow-200'}">Cancelled</button>
                        </div>
                    </div>`;
    });
    logHTML += `</div>`;
    dailyLogContainer.innerHTML = logHTML;
};

/**
 * Handles the initial user setup form submission.
 */
const handleSetup = async (e) => {
    e.preventDefault();
    showLoading('Parsing Timetable...');
    setupError.textContent = '';

    const startDate = document.getElementById('start-date').value;
    const minAttendance = document.getElementById('min-attendance').value;
    const pdfFile = document.getElementById('timetable-pdf').files[0];

    if (!startDate || !minAttendance || !pdfFile) {
        setupError.textContent = 'All fields are required.';
        hideLoading();
        return;
    }

    try {
        const { timetable, uniqueSubjects } = await parseTimetable(pdfFile);
        
        showLoading('Saving your profile...');
        const { data, error } = await supabase
            .from('profiles')
            .insert([{
                id: currentUser.id, start_date: startDate, attendance_threshold: parseInt(minAttendance),
                timetable_json: timetable, unique_subjects: uniqueSubjects
            }])
            .select()
            .single();

        if (error) throw error;
        
        userProfile = data;
        await runFullAttendanceUpdate();

    } catch (error) {
        setupError.textContent = `Error: ${error.message}`;
        console.error(error);
        hideLoading();
    }
};

/**
 * FINAL, ROBUST PARSER
 * This version uses a completely new strategy that is immune to text fragmentation.
 */
const parseTimetable = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                // `window.pdfjsLib` is used here, which you correctly set up in your HTML.
                const pdf = await window.pdfjsLib.getDocument({ data: event.target.result }).promise;
                let textItems = [];
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    textItems.push(...textContent.items.map(item => item.str.trim()));
                }
                
                // Filter out any empty strings that might have resulted from trimming whitespace.
                textItems = textItems.filter(item => item.length > 0);

                const potentialSubjects = ["DA Lab", "DSA Lab", "IoT Lab", "DA", "OS", "IoT", "Stats", "DSA", "Discrete m"];
                const uniqueSubjectsFound = new Set();
                const timetable = {};

                const dayMarkers = [
                    { key: 'Mo', name: 'Monday' }, { key: 'Tu', name: 'Tuesday' }, { key: 'We', name: 'Wednesday' },
                    { key: 'Th', name: 'Thursday' }, { key: 'Fr', name: 'Friday' }, 
                    // Use "Timetable" as the final marker, as in "Timetable generated"
                    { key: 'Timetable', name: 'End' } 
                ];

                const anchors = [];
                for (const marker of dayMarkers) {
                    const index = textItems.indexOf(marker.key);
                    if (index !== -1) {
                        anchors.push({ name: marker.name, index: index });
                    }
                }

                anchors.sort((a, b) => a.index - b.index);

                if (anchors.length <= 1) {
                     return reject(new Error("Could not find day markers (Mo, Tu, etc.) in the PDF."));
                }

                for (let i = 0; i < anchors.length - 1; i++) {
                    const currentAnchor = anchors[i];
                    const nextAnchor = anchors[i+1];
                    const daySlice = textItems.slice(currentAnchor.index, nextAnchor.index);
                    
                    // Create a searchable, space-agnostic string from the day's text fragments
                    const dayTextContent = daySlice.join('').replace(/\s/g, '');
                    const daySchedule = new Set();
                    
                    potentialSubjects.forEach(subject => {
                        // Create a space-agnostic version of the subject to search for
                        const searchSubject = subject.replace(/\s/g, '');
                        if (dayTextContent.includes(searchSubject)) {
                            let finalName = subject.replace(/ m$/, ''); // "Discrete m" -> "Discrete"
                            let category = 'Theory';
                            if (subject.endsWith('Lab')) {
                                finalName = subject.replace(/ Lab$/, ''); // "DA Lab" -> "DA"
                                category = 'Lab';
                            }
                            daySchedule.add(`${finalName} ${category}`);
                            uniqueSubjectsFound.add(finalName);
                        }
                    });
                    timetable[currentAnchor.name] = Array.from(daySchedule);
                }

                if (uniqueSubjectsFound.size === 0) {
                    return reject(new Error("Could not detect any known subjects in the timetable. Please ensure the PDF is a text-based document."));
                }
                
                resolve({ timetable, uniqueSubjects: Array.from(uniqueSubjectsFound) });

            } catch (err) {
                reject(new Error(`Failed to process PDF. ${err.message}`));
            }
        };
        reader.onerror = () => reject(new Error("Failed to read the file."));
        reader.readAsArrayBuffer(file);
    });
};


// --- EVENT HANDLERS ---
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

function handleDateChange(e) {
    renderScheduleForDate(e.target.value);
}

async function handleUpdateTimetable(e) {
    e.preventDefault();
    if (!confirm("Are you sure? This will reset all your attendance data.")) { return; }
    showLoading('Resetting schedule...');
    await supabase.from('attendance_log').delete().eq('user_id', currentUser.id);
    const pdfFile = document.getElementById('update-timetable-pdf').files[0];
    if (!pdfFile) { hideLoading(); return; }
    try {
        const { timetable, uniqueSubjects } = await parseTimetable(pdfFile);
        await supabase.from('profiles').update({ timetable_json: timetable, unique_subjects: uniqueSubjects, last_log_date: null }).eq('id', currentUser.id);
        await init();
    } catch (error) {
        alert("Failed to update timetable: " + error.message);
    } finally {
        hideLoading();
    }
}

// --- ATTACH EVENT LISTENERS ---
document.addEventListener('DOMContentLoaded', init);
logoutButton.addEventListener('click', () => supabase.auth.signOut().then(() => window.location.href = '/index.html'));
setupForm.addEventListener('submit', handleSetup);
updateTimetableForm.addEventListener('submit', handleUpdateTimetable);
dailyLogContainer.addEventListener('click', handleMarkAttendance);
historicalDatePicker.addEventListener('change', handleDateChange);