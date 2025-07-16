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
 * Main initialization function. Authenticates the user, fetches their
 * profile, and kicks off the entire dashboard rendering process.
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
 * Orchestrates the entire update and render pipeline.
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
 * FINAL CORRECTED VERSION
 * This is the "automatic daily increment" feature.
 * It uses the clean data from the parser to reliably create records.
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
                // Example subjectString: "OS Theory" or "DA Lab"
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
        // Add `category` to the conflict resolution to handle Theory/Lab on the same day
        await supabase.from('attendance_log').insert(newLogEntries, { onConflict: 'user_id,date,subject_name,category' });
    }

    const { error } = await supabase.from('profiles').update({ last_log_date: today.toISOString().slice(0, 10) }).eq('id', currentUser.id);
    if (error) console.error("Error updating last_log_date", error);
};

/**
 * Fetches the entire attendance log for the user from the database.
 */
const loadFullAttendanceLog = async () => {
    const { data, error } = await supabase.from('attendance_log').select('*').order('date', { ascending: false });
    if (error) return console.error("Error fetching attendance log:", error);
    attendanceLog = data;
};

/**
 * Renders the entire dashboard, including the summary table and the daily logger.
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
 * Calculates all stats from the local attendanceLog and renders the detailed summary table.
 */
const renderSummaryTable = () => {
    const subjectStats = {};

    for (const log of attendanceLog) {
        const baseSubject = log.subject_name;
        if (!subjectStats[baseSubject]) {
            subjectStats[baseSubject] = {
                Theory: { Attended: 0, Held: 0 },
                Lab: { Attended: 0, Held: 0 }
            };
        }
        if (log.status !== 'Cancelled') {
            subjectStats[baseSubject][log.category].Held++;
            if (log.status === 'Attended') {
                subjectStats[baseSubject][log.category].Attended++;
            }
        }
    }

    let tableHTML = `
        <h3>Overall Summary</h3>
        <table>
            <thead>
                <tr>
                    <th>Subject</th>
                    <th>Category</th>
                    <th>Attended</th>
                    <th>Held</th>
                    <th>Percentage</th>
                    <th>Overall Subject %</th>
                </tr>
            </thead>
            <tbody>
    `;

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
            tableHTML += `
                <tr class="${percentage < userProfile.attendance_threshold ? 'low-attendance' : ''}">
                    <td ${rowSpan}>${subjectName}</td>
                    <td>Theory</td>
                    <td>${stats.Theory.Attended}</td>
                    <td>${stats.Theory.Held}</td>
                    <td>${percentage}%</td>
                    <td ${rowSpan} class="${overallPercentage < userProfile.attendance_threshold ? 'low-attendance' : ''}">${overallPercentage}%</td>
                </tr>
            `;
        }
        if (hasLab) {
            const percentage = stats.Lab.Held > 0 ? ((stats.Lab.Attended / stats.Lab.Held) * 100).toFixed(1) : '100.0';
             tableHTML += `
                <tr class="${percentage < userProfile.attendance_threshold ? 'low-attendance' : ''}">
                    ${hasTheory ? '' : `<td>${subjectName}</td>`}
                    <td>Lab</td>
                    <td>${stats.Lab.Attended}</td>
                    <td>${stats.Lab.Held}</td>
                    <td>${percentage}%</td>
                    ${hasTheory ? '' : `<td class="${overallPercentage < userProfile.attendance_threshold ? 'low-attendance' : ''}">${overallPercentage}%</td>`}
                </tr>
            `;
        }
    }

    tableHTML += '</tbody></table>';
    attendanceSummary.innerHTML = tableHTML;
};

/**
 * Renders the interactive attendance logger for a specific date from the local cache.
 */
const renderScheduleForDate = (dateStr) => {
    const lecturesOnDate = attendanceLog.filter(log => log.date.slice(0, 10) === dateStr);

    if (lecturesOnDate.length === 0) {
        dailyLogContainer.innerHTML = `<p>No classes scheduled for this day.</p>`;
        return;
    }

    let logHTML = `<h3>Schedule for ${dateStr}</h3>`;
    lecturesOnDate.sort((a,b) => a.subject_name.localeCompare(b.subject_name)).forEach(log => {
        logHTML += `
            <div class="log-item">
                <strong>${log.subject_name} (${log.category})</strong>
                <div class="log-actions">
                    <button data-id="${log.id}" data-status="Attended" class="log-btn ${log.status === 'Attended' ? 'active' : ''}">Attended</button>
                    <button data-id="${log.id}" data-status="Missed" class="log-btn ${log.status === 'Missed' ? 'active' : ''}">Missed</button>
                    <button data-id="${log.id}" data-status="Cancelled" class="log-btn ${log.status === 'Cancelled' ? 'active' : ''}">Cancelled</button>
                </div>
            </div>
        `;
    });
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
                id: currentUser.id,
                start_date: startDate,
                attendance_threshold: parseInt(minAttendance),
                timetable_json: timetable,
                unique_subjects: uniqueSubjects
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
 * FINAL CORRECTED VERSION
 * Parses the PDF and stores subjects in a clean "Name Category" format.
 * Example: "OS Theory", "DA Lab", "Discrete Theory"
 */
const parseTimetable = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const pdf = await pdfjsLib.getDocument({ data: event.target.result }).promise;
                let fullText = '';
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    fullText += textContent.items.map(item => item.str).join(' ');
                }

                const potentialSubjects = ["DA Lab", "DSA Lab", "IoT Lab", "DA", "OS", "IoT", "Stats", "DSA", "Discrete m"];
                const uniqueSubjectsFound = new Set();
                const timetable = {};
                const days = { Mo: "Monday", Tu: "Tuesday", We: "Wednesday", Th: "Thursday", Fr: "Friday" };
                
                const dayRegex = /(Mo|Tu|We|Th|Fr|Timetable generated)/g;
                const parts = fullText.split(dayRegex);

                for (let i = 0; i < parts.length; i++) {
                    const part = parts[i];
                    if (days[part]) {
                        const dayFullName = days[part];
                        const daySchedule = new Set();
                        const dayTextContent = parts[i + 1] || "";
                        
                        potentialSubjects.forEach(subject => {
                            if (dayTextContent.includes(subject)) {
                                let cleanName = subject.replace(/ m$/, '');
                                let category = 'Theory';
                                if (subject.endsWith('Lab')) {
                                    cleanName = subject.replace(/ Lab$/, '');
                                    category = 'Lab';
                                }
                                
                                daySchedule.add(`${cleanName} ${category}`);
                                uniqueSubjectsFound.add(cleanName);
                            }
                        });
                        timetable[dayFullName] = Array.from(daySchedule);
                    }
                }

                if (uniqueSubjectsFound.size === 0) {
                    return reject(new Error("Could not detect any known subjects in the timetable."));
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

/**
 * Handles clicks on the 'Attended'/'Missed'/'Cancelled' buttons.
 */
async function handleMarkAttendance(e) {
    if (!e.target.classList.contains('log-btn')) return;

    const button = e.target;
    const logId = button.dataset.id;
    const newStatus = button.dataset.status;

    showLoading('Updating...');

    const logIndex = attendanceLog.findIndex(log => log.id == logId);
    if (logIndex === -1) {
        hideLoading();
        return console.error("Log ID not found in cache.");
    }
    attendanceLog[logIndex].status = newStatus;
    
    renderDashboard();

    const { error } = await supabase.from('attendance_log').update({ status: newStatus }).eq('id', logId);
    if(error) console.error("Error updating log status:", error);

    hideLoading();
}

/**
 * Handles when the user picks a new date from the calendar.
 */
async function handleDateChange(e) {
    renderScheduleForDate(e.target.value);
}

/**
 * Handles re-uploading a timetable, which is a destructive action.
 */
async function handleUpdateTimetable(e) {
    e.preventDefault();
    if (!confirm("Are you sure? This will delete all existing attendance records and reset your schedule.")) {
        return;
    }
    showLoading('Resetting schedule...');
    await supabase.from('attendance_log').delete().eq('user_id', currentUser.id);

    const pdfFile = document.getElementById('update-timetable-pdf').files[0];
    if (!pdfFile) {
        hideLoading();
        return;
    }

    try {
        const { timetable, uniqueSubjects } = await parseTimetable(pdfFile);
        const { error } = await supabase
            .from('profiles')
            .update({ 
                timetable_json: timetable, 
                unique_subjects: uniqueSubjects,
                last_log_date: null
            })
            .eq('id', currentUser.id);

        if (error) throw error;
        
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