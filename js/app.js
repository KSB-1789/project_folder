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
const saveLogButton = document.getElementById('save-log-button');

const updateSettingsForm = document.getElementById('update-settings-form');
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

const getTodayDay = () => {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return days[new Date().getDay()];
};

// --- Authentication & Initialization ---
const init = async () => {
    showLoading('Authenticating...');
    const { data: { session }, error } = await supabase.auth.getSession();

    if (error || !session) {
        window.location.href = '/index.html';
        return;
    }
    currentUser = session.user;

    await loadUserProfile();
    hideLoading();
};

const loadUserProfile = async () => {
    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', currentUser.id)
        .single();

    if (error && error.code !== 'PGRST116') { // PGRST116: 'exact one row not found'
        console.error('Error fetching profile:', error);
        return;
    }

    if (data) {
        userProfile = data;
        await loadAttendanceLog();
        renderDashboard();
    } else {
        // First-time user, show onboarding
        dashboardView.style.display = 'none';
        onboardingView.style.display = 'block';
    }
};

const loadAttendanceLog = async () => {
    const { data, error } = await supabase
        .from('attendance_log')
        .select('*')
        .eq('user_id', currentUser.id);

    if (error) {
        console.error('Error fetching attendance log:', error);
    } else {
        attendanceLog = data;
    }
};

// --- Onboarding Logic ---
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
        await loadAttendanceLog();
        renderDashboard();

    } catch (error) {
        setupError.textContent = `Error: ${error.message}`;
        console.error(error);
    } finally {
        hideLoading();
    }
};

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
                    // We use a space to ensure words from different items don't merge
                    fullText += textContent.items.map(item => item.str).join(' ');
                }

                // --- NEW, ROBUST PARSING LOGIC ---

                // 1. Define a list of all possible subjects from your specific timetable.
                // This makes the parser much more reliable than guessing.
                // We include variations to catch everything.
                const potentialSubjects = [
                    "DA Lab", "DSA Lab", "IoT Lab", // Multi-word subjects first
                    "DA", "OS", "IoT", "Stats", "DSA",
                    "Discrete m" // Handle the specific "Discrete m" case
                ];

                // 2. Find which of these subjects actually exist in the document.
                const uniqueSubjects = new Set();
                potentialSubjects.forEach(subject => {
                    // Use a regular expression to find the subject as a whole word
                    const regex = new RegExp(`\\b${subject}\\b`, 'g');
                    if (fullText.match(regex)) {
                        // Clean up "Discrete m" to just be "Discrete" for simplicity
                        const cleanSubject = subject === "Discrete m" ? "Discrete" : subject;
                        uniqueSubjects.add(cleanSubject);
                    }
                });

                if (uniqueSubjects.size === 0) {
                    reject(new Error("Could not find any known subjects in the PDF. The PDF format may have changed."));
                    return;
                }

                // 3. Use the days of the week as anchors to build the schedule.
                const timetable = {};
                const days = ["Mo", "Tu", "We", "Th", "Fr"];
                const dayFullNames = { Mo: "Monday", Tu: "Tuesday", We: "Wednesday", Th: "Thursday", Fr: "Friday" };

                // Add a "sentinel" at the end to properly segment the last day (Friday)
                const textWithSentinel = fullText + " End";
                const dayRegex = /(Mo|Tu|We|Th|Fr|End)/g;

                // Split the document into chunks based on the days
                const parts = textWithSentinel.split(dayRegex);

                for (let i = 0; i < parts.length; i++) {
                    const part = parts[i];
                    if (days.includes(part)) {
                        const dayAbbreviation = part;
                        const dayFullName = dayFullNames[dayAbbreviation];
                        const daySchedule = [];
                        
                        // The text for this day is the next item in the split array
                        const dayTextContent = parts[i + 1] || "";

                        // Check which subjects appear in this day's text
                        uniqueSubjects.forEach(subject => {
                            // The "Discrete" subject was stored clean, but we search for its original form in the text
                            const searchString = subject === "Discrete" ? "Discrete m" : subject;
                            if (dayTextContent.includes(searchString)) {
                                daySchedule.push(subject);
                            }
                        });
                        timetable[dayFullName] = daySchedule;
                    }
                }
                
                resolve({ timetable, uniqueSubjects: Array.from(uniqueSubjects) });

            } catch (err) {
                reject(new Error(`Failed to process PDF. ${err.message}`));
            }
        };
        reader.onerror = () => reject(new Error("Failed to read the file."));
        reader.readAsArrayBuffer(file);
    });
};


// --- Core Logic ---
const calculateAttendance = () => {
    const { start_date, timetable_json, unique_subjects, attendance_threshold } = userProfile;
    const results = {};
    const today = new Date();
    const startDate = new Date(start_date);

    unique_subjects.forEach(subject => {
        results[subject] = {
            total: 0,
            attended: 0,
            absent: 0,
            cancelled: 0,
        };
    });

    // Count total classes held
    for (let d = new Date(startDate); d <= today; d.setDate(d.getDate() + 1)) {
        const dayIndex = d.getDay();
        if (dayIndex === 0 || dayIndex === 6) continue; // Skip weekends

        const dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dayIndex];
        const lecturesToday = timetable_json[dayName] || [];
        
        lecturesToday.forEach(subject => {
            if (results[subject]) {
                results[subject].total++;
            }
        });
    }

    // Adjust counts based on attendance log
    attendanceLog.forEach(log => {
        if(results[log.subject_name]) {
            if (log.status === 'absent') {
                results[log.subject_name].absent++;
            } else if (log.status === 'cancelled') {
                results[log.subject_name].cancelled++;
                results[log.subject_name].total--; // Cancelled classes don't count towards total held
            }
        }
    });

    // Calculate final stats
    Object.keys(results).forEach(subject => {
        const res = results[subject];
        res.attended = res.total - res.absent;
        res.percentage = res.total > 0 ? ((res.attended / res.total) * 100).toFixed(2) : 100;
        const minAttended = Math.ceil(res.total * (attendance_threshold / 100));
        res.bunksAvailable = res.attended - minAttended;
    });

    return results;
};

// --- Rendering ---
const renderDashboard = () => {
    onboardingView.style.display = 'none';
    const attendanceData = calculateAttendance();
    const { attendance_threshold } = userProfile;

    let tableHTML = `
        <table>
            <thead>
                <tr>
                    <th>Subject</th>
                    <th>Total Held</th>
                    <th>Attended</th>
                    <th>Percentage</th>
                    <th>Bunks Available</th>
                </tr>
            </thead>
            <tbody>
    `;
    for (const subject in attendanceData) {
        const data = attendanceData[subject];
        const isLow = data.percentage < attendance_threshold;
        tableHTML += `
            <tr class="${isLow ? 'low-attendance' : ''}">
                <td>${subject}</td>
                <td>${data.total}</td>
                <td>${data.attended}</td>
                <td>${data.percentage}% ${isLow ? '🔻' : ''}</td>
                <td>${data.bunksAvailable < 0 ? `Short by ${Math.abs(data.bunksAvailable)}` : data.bunksAvailable}</td>
            </tr>
        `;
    }
    tableHTML += `</tbody></table>`;
    attendanceSummary.innerHTML = tableHTML;
    
    renderDailyLogOptions();
    renderSettings();
    dashboardView.style.display = 'block';
};

const renderDailyLogOptions = () => {
    const todayDay = getTodayDay();
    const subjectsToday = userProfile.timetable_json[todayDay] || [];
    
    if (subjectsToday.length === 0) {
        dailyLogContainer.innerHTML = `<p>No classes scheduled for today (${todayDay}).</p>`;
        saveLogButton.style.display = 'none';
        return;
    }

    let logHTML = '';
    subjectsToday.forEach(subject => {
        logHTML += `
            <div class="log-item">
                <strong>${subject}</strong>
                <select data-subject="${subject}">
                    <option value="present">Present</option>
                    <option value="absent">Absent</option>
                    <option value="cancelled">Cancelled</option>
                </select>
            </div>
        `;
    });
    dailyLogContainer.innerHTML = logHTML;
    saveLogButton.style.display = 'block';
};

const renderSettings = () => {
    document.getElementById('update-start-date').value = userProfile.start_date;
    document.getElementById('update-min-attendance').value = userProfile.attendance_threshold;
}

// --- Event Handlers ---
const handleLogout = async () => {
    showLoading('Logging out...');
    await supabase.auth.signOut();
    window.location.href = '/index.html';
};

const handleSaveLog = async () => {
    showLoading('Saving log...');
    const today = new Date().toISOString().slice(0, 10);
    const logEntries = [];

    const selects = dailyLogContainer.querySelectorAll('select');
    selects.forEach(select => {
        const subject = select.dataset.subject;
        const status = select.value;
        if (status === 'absent' || status === 'cancelled') {
            logEntries.push({
                user_id: currentUser.id,
                date: today,
                subject_name: subject,
                status: status
            });
        }
    });

    if (logEntries.length > 0) {
        // Simple approach: delete old logs for today and insert new ones
        await supabase.from('attendance_log').delete().match({ user_id: currentUser.id, date: today });
        const { error } = await supabase.from('attendance_log').insert(logEntries);
        if (error) {
            alert('Error saving log: ' + error.message);
        }
    } else {
        // If everything is marked present, ensure no logs for today exist
         await supabase.from('attendance_log').delete().match({ user_id: currentUser.id, date: today });
    }

    await loadAttendanceLog();
    renderDashboard();
    hideLoading();
};

const handleUpdateSettings = async (e) => {
    e.preventDefault();
    showLoading('Updating settings...');
    
    const newStartDate = document.getElementById('update-start-date').value;
    const newThreshold = document.getElementById('update-min-attendance').value;

    const { error } = await supabase
        .from('profiles')
        .update({ start_date: newStartDate, attendance_threshold: parseInt(newThreshold) })
        .eq('id', currentUser.id);

    if (error) {
        alert("Failed to update settings: " + error.message);
    } else {
        await loadUserProfile(); // Reload profile and re-render
    }
    
    hideLoading();
};

const handleUpdateTimetable = async (e) => {
    e.preventDefault();
    showLoading('Updating timetable...');
    const pdfFile = document.getElementById('update-timetable-pdf').files[0];
    if (!pdfFile) {
        hideLoading();
        return;
    }

    try {
        const { timetable, uniqueSubjects } = await parseTimetable(pdfFile);
        const { error } = await supabase
            .from('profiles')
            .update({ timetable_json: timetable, unique_subjects: uniqueSubjects })
            .eq('id', currentUser.id);

        if (error) throw error;
        
        await loadUserProfile(); // Reload profile and re-render

    } catch (error) {
        alert("Failed to update timetable: " + error.message);
    } finally {
        hideLoading();
    }
};

// --- Attach Event Listeners ---
logoutButton.addEventListener('click', handleLogout);
setupForm.addEventListener('submit', handleSetup);
saveLogButton.addEventListener('click', handleSaveLog);
updateSettingsForm.addEventListener('submit', handleUpdateSettings);
updateTimetableForm.addEventListener('submit', handleUpdateTimetable);


// --- Initial Load ---
document.addEventListener('DOMContentLoaded', init);