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
let attendanceLog = []; // This will now be a cache of the full log from the DB

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

    if (profileError && profileError.code !== 'PGRST116') { // Ignore 'not found' error
        hideLoading();
        return console.error('Error fetching profile:', profileError);
    }

    if (data) {
        userProfile = data;
        // This is the core logic engine that makes the app dynamic
        await runFullAttendanceUpdate();
    } else {
        // First-time user, show the onboarding screen
        hideLoading();
        onboardingView.style.display = 'block';
        dashboardView.style.display = 'none';
    }
};

/**
 * Orchestrates the entire update and render pipeline. This is the main
 * workflow for a returning user.
 */
const runFullAttendanceUpdate = async () => {
    showLoading('Updating attendance records...');
    await populateAttendanceLog(); // Automatically creates lecture records for past days
    showLoading('Loading your dashboard...');
    await loadFullAttendanceLog(); // Loads all records into memory
    renderDashboard(); // Renders the UI with the fresh data
    hideLoading();
}

/**
 * This is the "automatic daily increment" feature.
 * It checks for days between the last log and today and creates
 * default 'Missed' records for any scheduled lectures.
 */
const populateAttendanceLog = async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize to start of day

    let lastLog;
    if (userProfile.last_log_date) {
        lastLog = new Date(userProfile.last_log_date + 'T00:00:00'); // Ensure correct date parsing
    } else {
        // If it's the very first time, start from the day before the semester
        lastLog = new Date(userProfile.start_date);
        lastLog.setDate(lastLog.getDate() - 1);
    }

    let currentDate = new Date(lastLog);
    currentDate.setDate(currentDate.getDate() + 1); // Start checking from the day AFTER the last log

    const newLogEntries = [];

    while (currentDate <= today) {
        const dayIndex = currentDate.getDay();
        if (dayIndex !== 0 && dayIndex !== 6) { // Skip Sunday and Saturday
            const dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dayIndex];
            const lecturesToday = userProfile.timetable_json[dayName] || [];

            for (const subject of lecturesToday) {
                newLogEntries.push({
                    user_id: currentUser.id,
                    date: new Date(currentDate).toISOString().slice(0, 10),
                    subject_name: subject.replace(/ (Lab|Theory)$/, ''), // Get base name
                    category: subject.endsWith('Lab') ? 'Lab' : 'Theory',
                    status: 'Missed' // Default status is 'Missed'
                });
            }
        }
        currentDate.setDate(currentDate.getDate() + 1);
    }

    if (newLogEntries.length > 0) {
        // `onConflict` ensures we don't create duplicates if the script is run multiple times for the same day.
        await supabase.from('attendance_log').insert(newLogEntries, { onConflict: 'user_id,date,subject_name' });
    }

    // Update the profile with today's date so we don't re-process these days again.
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
    historicalDatePicker.value = todayStr; // Set date picker to today
    renderScheduleForDate(todayStr); // Render today's schedule by default
    dashboardView.style.display = 'block';
    onboardingView.style.display = 'none';
};

/**
 * Calculates all stats from the local attendanceLog and renders the detailed summary table.
 */
const renderSummaryTable = () => {
    const subjectStats = {};

    // 1. Aggregate stats from the log
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

    // 2. Build the HTML table
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
        await runFullAttendanceUpdate(); // Run the main logic after setup is complete

    } catch (error) {
        setupError.textContent = `Error: ${error.message}`;
        console.error(error);
        hideLoading();
    }
};

/**
 * Parses the uploaded PDF to extract the schedule. Tailored for the specific timetable format.
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
                const subjectMap = {};
                potentialSubjects.forEach(subject => {
                    const cleanName = subject.replace(/ m$/, ''); // "Discrete m" -> "Discrete"
                    const category = subject.endsWith('Lab') ? 'Lab' : 'Theory';
                    const regex = new RegExp(`\\b${subject}\\b`, 'g');
                    if (fullText.match(regex)) {
                        if (!subjectMap[cleanName]) subjectMap[cleanName] = [];
                        subjectMap[cleanName].push(category);
                    }
                });
                
                const uniqueSubjects = Object.keys(subjectMap).map(name => {
                    if (subjectMap[name].length > 1 || subjectMap[name][0] === 'Lab') return `${name} Lab`;
                    return name;
                }).filter((value, index, self) => self.indexOf(value) === index);


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
                                 const cleanName = subject.replace(/ m$/, '');
                                 const category = subject.endsWith('Lab') ? 'Lab' : 'Theory';
                                 daySchedule.add(`${cleanName} ${category}`);
                             }
                        });
                        timetable[dayFullName] = Array.from(daySchedule);
                    }
                }
                
                resolve({ timetable, uniqueSubjects: Object.keys(subjectMap) });

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
 * Updates local state for instant UI feedback, then updates the database.
 */
async function handleMarkAttendance(e) {
    if (!e.target.classList.contains('log-btn')) return;

    const button = e.target;
    const logId = button.dataset.id;
    const newStatus = button.dataset.status;

    showLoading('Updating...');

    // Update the local cache for instant UI feedback
    const logIndex = attendanceLog.findIndex(log => log.id == logId);
    if (logIndex === -1) {
        hideLoading();
        return console.error("Log ID not found in cache.");
    }
    attendanceLog[logIndex].status = newStatus;
    
    // Re-render the UI from the updated cache
    renderDashboard();

    // Update the database in the background
    const { error } = await supabase.from('attendance_log').update({ status: newStatus }).eq('id', logId);
    if(error) console.error("Error updating log status:", error);

    hideLoading();
}

/**
 * Handles when the user picks a new date from the calendar to view/edit.
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
    // Delete all logs for the user first
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
                last_log_date: null // Reset the log date to force re-population from the start date
            })
            .eq('id', currentUser.id);

        if (error) throw error;
        
        // Reload everything from scratch with the new timetable
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