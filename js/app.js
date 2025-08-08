import { supabase } from './supabaseClient.js';

// Global state
let currentUser = null;
let userProfile = null;
let currentDate = new Date().toISOString().split('T')[0];
let isLoading = false;

// DOM elements
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');
const dashboardView = document.getElementById('dashboard-view');
const logoutButton = document.getElementById('logout-button');
const darkModeToggle = document.getElementById('dark-mode-toggle');
const assistantModal = document.getElementById('assistant-modal');

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
    await initializeApp();
    setupEventListeners();
});

async function initializeApp() {
    try {
        showLoading('Checking authentication...');
        
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) throw error;
        
        if (!session) {
            window.location.href = 'index.html';
            return;
        }
        
        currentUser = session.user;
        await loadUserProfile();
        await backfillAttendanceLogs();
        await renderDashboard();
        
    } catch (error) {
        console.error('Initialization error:', error);
        showError('Failed to initialize app: ' + error.message);
    } finally {
        hideLoading();
    }
}

function setupEventListeners() {
    logoutButton.addEventListener('click', handleLogout);
    darkModeToggle.addEventListener('click', toggleDarkMode);
    
    // Modal event listeners
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-cancel-btn')) {
            closeAllModals();
        }
    });
    // Extra day form
    const extraDayForm = document.getElementById('extra-day-form');
    if (extraDayForm) {
        extraDayForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await saveExtraWorkingDay();
        });
    }
    
    // Initialize dark mode
    initializeDarkMode();
}

function initializeDarkMode() {
    const isDark = localStorage.getItem('darkMode') === 'true' || 
                   (!localStorage.getItem('darkMode') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    
    if (isDark) {
        document.documentElement.classList.add('dark');
    }
}

function toggleDarkMode() {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('darkMode', isDark);
}

async function handleLogout() {
    try {
        showLoading('Logging out...');
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        window.location.href = 'index.html';
    } catch (error) {
        console.error('Logout error:', error);
        showError('Failed to logout: ' + error.message);
        hideLoading();
    }
}

async function loadUserProfile() {
    try {
        showLoading('Loading profile...');
        
        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', currentUser.id)
            .single();
        
        if (error && error.code !== 'PGRST116') throw error;
        
        if (!data) {
            // Create new profile
            userProfile = {
                id: currentUser.id,
                attendance_threshold: 75,
                timetables: [],
                active_timetable_id: null,
                last_log_date: null,
                attendance_paused: false
            };
            
            const { error: insertError } = await supabase
                .from('profiles')
                .insert(userProfile);
            
            if (insertError) throw insertError;
        } else {
            userProfile = data;
            // Ensure timetables is an array
            if (!userProfile.timetables) {
                userProfile.timetables = [];
            }
        }
    } catch (error) {
        console.error('Profile loading error:', error);
        throw error;
    }
}

async function renderDashboard() {
    try {
        showLoading('Loading dashboard...');
        
        if (!userProfile.timetables || userProfile.timetables.length === 0) {
            renderOnboarding();
        } else {
            await renderMainDashboard();
        }
    } catch (error) {
        console.error('Dashboard rendering error:', error);
        showError('Failed to load dashboard: ' + error.message);
    }
}

function renderOnboarding() {
    dashboardView.innerHTML = `
        <div class="bg-white/70 dark:bg-apple-gray-900/70 backdrop-blur-xl rounded-2xl p-6 sm:p-8 shadow-apple dark:shadow-apple-dark border border-gray-200/50 dark:border-apple-gray-800/50">
            <div class="text-center mb-8">
                <h2 class="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-white mb-4">Welcome to Smart Attendance Tracker! 🎓</h2>
                <p class="text-gray-600 dark:text-gray-300 text-base sm:text-lg">Let's set up your first timetable to get started.</p>
            </div>
            
            <div class="max-w-2xl mx-auto">
                <div class="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 p-6 rounded-xl border border-blue-200/50 dark:border-blue-800/50 mb-6">
                    <h3 class="font-semibold text-lg text-gray-800 dark:text-white mb-3">Quick Setup Guide:</h3>
                    <ul class="space-y-2 text-gray-600 dark:text-gray-300">
                        <li class="flex items-start gap-2">
                            <span class="text-blue-500 font-bold">1.</span>
                            <span>Create your weekly class schedule</span>
                        </li>
                        <li class="flex items-start gap-2">
                            <span class="text-blue-500 font-bold">2.</span>
                            <span>Set custom weights for different subjects</span>
                        </li>
                        <li class="flex items-start gap-2">
                            <span class="text-blue-500 font-bold">3.</span>
                            <span>Start tracking your attendance automatically</span>
                        </li>
                    </ul>
                </div>
                
                <div class="text-center">
                    <button onclick="openTimetableModal()" class="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-semibold py-3 px-8 rounded-xl shadow-apple dark:shadow-apple-dark transition-all duration-300 border border-blue-400/20 text-lg">
                        Create Your First Timetable
                    </button>
                </div>
            </div>
        </div>
    `;
    
    dashboardView.style.display = 'block';
}

async function renderMainDashboard() {
    const activeTimetable = getActiveTimetable(currentDate);
    const attendanceData = await getAttendanceData();
    
    dashboardView.innerHTML = `
        <!-- Status Cards -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-8">
            ${renderStatusCards(activeTimetable, attendanceData)}
        </div>
        
        <!-- Main Content -->
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">
            <!-- Attendance Tracker -->
            <div class="lg:col-span-2">
                ${await renderAttendanceTracker(activeTimetable)}
            </div>
            
            <!-- Sidebar -->
            <div class="space-y-6">
                ${renderAttendanceSummary(attendanceData)}
                ${renderQuickActions()}
            </div>
        </div>
        
        <!-- Settings Section -->
        <div class="mt-8">
            ${renderSettings()}
        </div>
    `;
    
    dashboardView.style.display = 'block';
    setupDashboardEventListeners();
}

function renderStatusCards(activeTimetable, attendanceData) {
    const totalSubjects = attendanceData.length;
    const aboveThreshold = attendanceData.filter(item => item.percentage >= userProfile.attendance_threshold).length;
    const avgAttendance = totalSubjects > 0 ? 
        (attendanceData.reduce((sum, item) => sum + item.percentage, 0) / totalSubjects).toFixed(1) : 0;
    
    return `
        <div class="bg-white/70 dark:bg-apple-gray-900/70 backdrop-blur-xl rounded-2xl p-4 sm:p-6 shadow-apple dark:shadow-apple-dark border border-gray-200/50 dark:border-apple-gray-800/50">
            <div class="flex items-center justify-between">
                <div>
                    <p class="text-sm font-medium text-gray-600 dark:text-gray-400">Active Timetable</p>
                    <p class="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">${activeTimetable ? activeTimetable.name : 'None'}</p>
                </div>
                <div class="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-xl">
                    <svg class="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                    </svg>
                </div>
            </div>
        </div>
        
        <div class="bg-white/70 dark:bg-apple-gray-900/70 backdrop-blur-xl rounded-2xl p-4 sm:p-6 shadow-apple dark:shadow-apple-dark border border-gray-200/50 dark:border-apple-gray-800/50">
            <div class="flex items-center justify-between">
                <div>
                    <p class="text-sm font-medium text-gray-600 dark:text-gray-400">Average Attendance</p>
                    <p class="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">${avgAttendance}%</p>
                </div>
                <div class="p-3 bg-green-100 dark:bg-green-900/30 rounded-xl">
                    <svg class="w-6 h-6 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 00-2 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z"></path>
                    </svg>
                </div>
            </div>
        </div>
        
        <div class="bg-white/70 dark:bg-apple-gray-900/70 backdrop-blur-xl rounded-2xl p-4 sm:p-6 shadow-apple dark:shadow-apple-dark border border-gray-200/50 dark:border-apple-gray-800/50">
            <div class="flex items-center justify-between">
                <div>
                    <p class="text-sm font-medium text-gray-600 dark:text-gray-400">Above Threshold</p>
                    <p class="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">${aboveThreshold}/${totalSubjects}</p>
                </div>
                <div class="p-3 bg-purple-100 dark:bg-purple-900/30 rounded-xl">
                    <svg class="w-6 h-6 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                    </svg>
                </div>
            </div>
        </div>
        
        <div class="bg-white/70 dark:bg-apple-gray-900/70 backdrop-blur-xl rounded-2xl p-4 sm:p-6 shadow-apple dark:shadow-apple-dark border border-gray-200/50 dark:border-apple-gray-800/50">
            <div class="flex items-center justify-between">
                <div>
                    <p class="text-sm font-medium text-gray-600 dark:text-gray-400">Status</p>
                    <p class="text-lg sm:text-xl font-bold ${userProfile.attendance_paused ? 'text-orange-600 dark:text-orange-400' : 'text-green-600 dark:text-green-400'}">${userProfile.attendance_paused ? 'Paused' : 'Active'}</p>
                </div>
                <div class="p-3 ${userProfile.attendance_paused ? 'bg-orange-100 dark:bg-orange-900/30' : 'bg-green-100 dark:bg-green-900/30'} rounded-xl">
                    <svg class="w-6 h-6 ${userProfile.attendance_paused ? 'text-orange-600 dark:text-orange-400' : 'text-green-600 dark:text-green-400'}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        ${userProfile.attendance_paused ? 
                            '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>' :
                            '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h8m-9 5a9 9 0 1118 0 9 9 0 01-18 0z"></path>'
                        }
                    </svg>
                </div>
            </div>
        </div>
    `;
}

async function renderAttendanceTracker(activeTimetable) {
    if (!activeTimetable) {
        return `
            <div class="bg-white/70 dark:bg-apple-gray-900/70 backdrop-blur-xl rounded-2xl p-6 sm:p-8 shadow-apple dark:shadow-apple-dark border border-gray-200/50 dark:border-apple-gray-800/50">
                <h3 class="text-xl font-bold text-gray-800 dark:text-white mb-4">Attendance Tracker</h3>
                <div class="text-center py-8">
                    <p class="text-gray-600 dark:text-gray-400 mb-4">No active timetable for today</p>
                    <button onclick="openTimetableModal()" class="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-semibold py-2 px-4 rounded-xl transition-all duration-200">
                        Create Timetable
                    </button>
                </div>
            </div>
        `;
    }
    
    const dayName = new Date(currentDate).toLocaleDateString('en-US', { weekday: 'long' });
    const todaysClasses = activeTimetable.schedule[dayName] || [];
    const attendanceRecords = await getTodaysAttendance(currentDate);
    
    return `
        <div class="bg-white/70 dark:bg-apple-gray-900/70 backdrop-blur-xl rounded-2xl p-4 sm:p-6 shadow-apple dark:shadow-apple-dark border border-gray-200/50 dark:border-apple-gray-800/50">
            <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
                <h3 class="text-xl font-bold text-gray-800 dark:text-white">Attendance Tracker</h3>
                <div class="flex items-center gap-3">
                    <input type="date" id="attendance-date" value="${currentDate}" 
                           class="px-3 py-2 bg-gray-50/80 dark:bg-apple-gray-800/80 border border-gray-200/50 dark:border-apple-gray-700/50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 dark:text-white">
                    <button onclick="saveAttendance()" id="save-attendance-btn" 
                            class="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-semibold py-2 px-4 rounded-lg transition-all duration-200 text-sm">
                        Save Changes
                    </button>
                </div>
            </div>
            
            <div class="space-y-3">
                ${todaysClasses.length === 0 ? 
                    '<p class="text-gray-600 dark:text-gray-400 text-center py-8">No classes scheduled for ' + dayName + '</p>' :
                    todaysClasses.map(subject => {
                        const lastSpaceIndex = subject.lastIndexOf(' ');
                        const subjectName = lastSpaceIndex === -1 ? subject : subject.slice(0, lastSpaceIndex);
                        const category = lastSpaceIndex === -1 ? '' : subject.slice(lastSpaceIndex + 1);
                        const fullSubjectName = subjectName + ' ' + category;
                        const record = attendanceRecords.find(r => r.subject_name === subjectName && r.category === category);
                        const status = record ? record.status : 'Not Marked';

                        // Build a stable key for DOM updates and escape values for inline handlers
                        const dataKey = encodeURIComponent(`${subjectName}___${category}`);
                        const safeSubjectName = subjectName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                        const safeCategory = category.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                        
                        return `
                            <div class="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-gray-50/50 dark:bg-apple-gray-850/50 rounded-xl border border-gray-200/30 dark:border-apple-gray-800/30 gap-3" data-key="${dataKey}">
                                <div class="flex-grow">
                                    <h4 class="font-semibold text-gray-800 dark:text-white">${fullSubjectName}</h4>
                                    <p class="text-sm text-gray-600 dark:text-gray-400">Weight: ${activeTimetable.subjectWeights[fullSubjectName] || 1}</p>
                                </div>
                                <div class="flex gap-2">
                                    <button data-status="Attended" onclick="markAttendance('${safeSubjectName}', '${safeCategory}', 'Attended')" 
                                            class="attendance-btn px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${status === 'Attended' ? 'bg-green-500 text-white' : 'bg-gray-200 dark:bg-apple-gray-700 text-gray-700 dark:text-gray-300 hover:bg-green-100 dark:hover:bg-green-900/30'}">
                                        Present
                                    </button>
                                    <button data-status="Missed" onclick="markAttendance('${safeSubjectName}', '${safeCategory}', 'Missed')" 
                                            class="attendance-btn px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${status === 'Missed' ? 'bg-red-500 text-white' : 'bg-gray-200 dark:bg-apple-gray-700 text-gray-700 dark:text-gray-300 hover:bg-red-100 dark:hover:bg-red-900/30'}">
                                        Absent
                                    </button>
                                    <button data-status="Holiday" onclick="markAttendance('${safeSubjectName}', '${safeCategory}', 'Holiday')" 
                                            class="attendance-btn px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${status === 'Holiday' ? 'bg-blue-500 text-white' : 'bg-gray-200 dark:bg-apple-gray-700 text-gray-700 dark:text-gray-300 hover:bg-blue-100 dark:hover:bg-blue-900/30'}">
                                        Holiday
                                    </button>
                                </div>
                            </div>
                        `;
                    }).join('')
                }
            </div>
        </div>
    `;
}

function renderAttendanceSummary(attendanceData) {
    return `
        <div class="bg-white/70 dark:bg-apple-gray-900/70 backdrop-blur-xl rounded-2xl p-4 sm:p-6 shadow-apple dark:shadow-apple-dark border border-gray-200/50 dark:border-apple-gray-800/50">
            <h3 class="text-lg font-bold text-gray-800 dark:text-white mb-4">Attendance Summary</h3>
            <div class="space-y-3">
                ${attendanceData.length === 0 ? 
                    '<p class="text-gray-600 dark:text-gray-400 text-center py-4">No attendance data yet</p>' :
                    attendanceData.map(item => `
                        <div class="flex items-center justify-between p-3 bg-gray-50/50 dark:bg-apple-gray-850/50 rounded-xl">
                            <div class="flex-grow min-w-0">
                                <h4 class="font-medium text-gray-800 dark:text-white text-sm truncate">${item.subject}</h4>
                                <p class="text-xs text-gray-600 dark:text-gray-400">${item.attended}/${item.held} classes</p>
                            </div>
                            <div class="flex items-center gap-2">
                                <span class="text-sm font-bold ${item.percentage >= userProfile.attendance_threshold ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}">
                                    ${item.percentage.toFixed(1)}%
                                </span>
                                <div class="w-2 h-2 rounded-full ${item.percentage >= userProfile.attendance_threshold ? 'bg-green-500' : 'bg-red-500'}"></div>
                            </div>
                        </div>
                    `).join('')
                }
            </div>
        </div>
    `;
}

function renderQuickActions() {
    return `
        <div class="bg-white/70 dark:bg-apple-gray-900/70 backdrop-blur-xl rounded-2xl p-4 sm:p-6 shadow-apple dark:shadow-apple-dark border border-gray-200/50 dark:border-apple-gray-800/50">
            <h3 class="text-lg font-bold text-gray-800 dark:text-white mb-4">Quick Actions</h3>
            <div class="space-y-3">
                <button onclick="openTimetableModal()" class="w-full bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-semibold py-2.5 px-4 rounded-xl transition-all duration-200 text-sm">
                    Add New Timetable
                </button>
                <button onclick="openExtraDayModal()" class="w-full bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white font-semibold py-2.5 px-4 rounded-xl transition-all duration-200 text-sm">
                    Add Extra Day
                </button>
                <button onclick="toggleAttendancePause()" class="w-full bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white font-semibold py-2.5 px-4 rounded-xl transition-all duration-200 text-sm">
                    ${userProfile.attendance_paused ? 'Resume' : 'Pause'} Attendance
                </button>
                <button onclick="openAssistant()" class="w-full bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white font-semibold py-2.5 px-4 rounded-xl transition-all duration-200 text-sm">
                    Smart Bunking Assistant
                </button>
            </div>
        </div>
    `;
}

function renderSettings() {
    return `
        <div class="bg-white/70 dark:bg-apple-gray-900/70 backdrop-blur-xl rounded-2xl p-4 sm:p-6 shadow-apple dark:shadow-apple-dark border border-gray-200/50 dark:border-apple-gray-800/50">
            <h3 class="text-xl font-bold text-gray-800 dark:text-white mb-6">Settings & Management</h3>
            
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div>
                    <h4 class="font-semibold text-gray-800 dark:text-white mb-3">Attendance Settings</h4>
                    <div class="space-y-3">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Minimum Attendance Threshold (%)</label>
                            <input type="number" id="attendance-threshold" value="${userProfile.attendance_threshold}" min="1" max="100" 
                                   class="w-full px-3 py-2 bg-gray-50/80 dark:bg-apple-gray-800/80 border border-gray-200/50 dark:border-apple-gray-700/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/50 dark:text-white">
                        </div>
                        <button onclick="updateAttendanceThreshold()" class="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-semibold py-2 px-4 rounded-lg transition-all duration-200 text-sm">
                            Update Threshold
                        </button>
                    </div>
                </div>
                
                <div>
                    <h4 class="font-semibold text-gray-800 dark:text-white mb-3">Timetable Management</h4>
                    <div class="space-y-2 max-h-48 overflow-y-auto">
                        ${userProfile.timetables.map(timetable => `
                            <div class="flex items-center justify-between p-3 bg-gray-50/50 dark:bg-apple-gray-850/50 rounded-lg">
                                <div class="flex-grow min-w-0">
                                    <h5 class="font-medium text-gray-800 dark:text-white text-sm truncate">${timetable.name}</h5>
                                    <p class="text-xs text-gray-600 dark:text-gray-400">${timetable.type || 'normal'} • ${timetable.startDate} to ${timetable.endDate}</p>
                                </div>
                                <div class="flex gap-1">
                                    <button onclick="openTimetableModal('${timetable.id}')" class="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors">
                                        Edit
                                    </button>
                                    ${timetable.type === 'special' ? `
                                        <button onclick="toggleTimetableActive('${timetable.id}')" class="px-2 py-1 text-xs rounded ${timetable.isActive ? 'bg-green-500 text-white' : 'bg-gray-300 dark:bg-apple-gray-700 text-gray-700 dark:text-gray-300'}">
                                            ${timetable.isActive ? 'Active' : 'Inactive'}
                                        </button>
                                    ` : ''}
                                    <button onclick="deleteTimetable('${timetable.id}')" class="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 transition-colors">
                                        Delete
                                    </button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        </div>
    `;
}

function setupDashboardEventListeners() {
    // Date picker change
    const dateInput = document.getElementById('attendance-date');
    if (dateInput) {
        dateInput.addEventListener('change', async (e) => {
            currentDate = e.target.value;
            await renderMainDashboard();
        });
    }
}

// Attendance functions
let pendingAttendanceChanges = {};

function markAttendance(subjectName, category, status) {
    const key = `${subjectName}___${category}`;
    pendingAttendanceChanges[key] = { subjectName, category, status };

    // Update only the relevant row
    const dataKey = encodeURIComponent(key);
    const row = document.querySelector(`[data-key="${dataKey}"]`);
    if (!row) return;

    const buttons = row.querySelectorAll('.attendance-btn');
    buttons.forEach(btn => {
        const btnStatus = btn.dataset.status;
        if (!btnStatus) return;

        // Reset base classes
        btn.classList.remove('bg-green-500', 'bg-red-500', 'bg-blue-500', 'text-white');
        btn.classList.add('bg-gray-200', 'dark:bg-apple-gray-700', 'text-gray-700', 'dark:text-gray-300');

        // Apply selected styling
        if (btnStatus === status) {
            btn.classList.remove('bg-gray-200', 'dark:bg-apple-gray-700', 'text-gray-700', 'dark:text-gray-300');
            if (status === 'Attended') {
                btn.classList.add('bg-green-500', 'text-white');
            } else if (status === 'Missed') {
                btn.classList.add('bg-red-500', 'text-white');
            } else if (status === 'Holiday') {
                btn.classList.add('bg-blue-500', 'text-white');
            }
        }
    });
}

async function saveAttendance() {
    if (Object.keys(pendingAttendanceChanges).length === 0) {
        showError('No changes to save');
        return;
    }
    
    try {
        showLoading('Saving attendance...');
        
        for (const change of Object.values(pendingAttendanceChanges)) {
            const { error } = await supabase
                .from('attendance_log')
                .upsert({
                    user_id: currentUser.id,
                    date: currentDate,
                    subject_name: change.subjectName,
                    category: change.category,
                    status: change.status
                }, {
                    onConflict: 'user_id,date,subject_name,category'
                });
            
            if (error) throw error;
        }
        
        pendingAttendanceChanges = {};
        await renderMainDashboard();
        showSuccess('Attendance saved successfully!');
        
    } catch (error) {
        console.error('Save attendance error:', error);
        showError('Failed to save attendance: ' + error.message);
    } finally {
        hideLoading();
    }
}

async function getTodaysAttendance(date) {
    try {
        const { data, error } = await supabase
            .from('attendance_log')
            .select('*')
            .eq('user_id', currentUser.id)
            .eq('date', date);
        
        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error('Get attendance error:', error);
        return [];
    }
}

async function getAttendanceData() {
    try {
        const { data, error } = await supabase
            .from('attendance_log')
            .select('*')
            .eq('user_id', currentUser.id);

        if (error) throw error;

        const attendanceMap = {};

        (data || []).forEach(record => {
            // Determine active timetable and subject weight for the record's date
            const timetableForDate = getActiveTimetable(record.date);

            // If attendance is paused and the active timetable is not special, skip counting
            if (userProfile.attendance_paused && (!timetableForDate || timetableForDate.type !== 'special')) {
                return;
            }

            const fullSubjectName = `${record.subject_name} ${record.category}`;
            const weight = timetableForDate && timetableForDate.subjectWeights
                ? (timetableForDate.subjectWeights[fullSubjectName] || 1)
                : 1;

            if (!attendanceMap[fullSubjectName]) {
                attendanceMap[fullSubjectName] = { attended: 0, held: 0, subject: fullSubjectName };
            }

            if (record.status === 'Attended' || record.status === 'Missed') {
                attendanceMap[fullSubjectName].held += weight;
                if (record.status === 'Attended') {
                    attendanceMap[fullSubjectName].attended += weight;
                }
            }
        });

        return Object.values(attendanceMap).map(item => ({
            ...item,
            // Cast to integers for display consistency
            attended: Math.round(item.attended),
            held: Math.round(item.held),
            percentage: item.held > 0 ? (item.attended / item.held) * 100 : 0
        }));

    } catch (error) {
        console.error('Get attendance data error:', error);
        return [];
    }
}

// Auto backfill attendance logs based on timetable
async function backfillAttendanceLogs() {
    try {
        if (!userProfile || !Array.isArray(userProfile.timetables) || userProfile.timetables.length === 0) return;

        const today = new Date();
        const earliestStart = userProfile.timetables.reduce((min, t) => {
            const d = new Date(t.startDate);
            return isNaN(d) ? min : (min ? (d < min ? d : min) : d);
        }, null);

        if (!earliestStart) return;

        const startDate = userProfile.last_log_date ? new Date(userProfile.last_log_date) : earliestStart;
        // Continue from next day after last_log_date
        if (userProfile.last_log_date) startDate.setDate(startDate.getDate() + 1);

        const endDate = new Date(today);

        // Nothing to backfill
        if (startDate > endDate) return;

        const rowsToInsert = [];
        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().split('T')[0];
            const timetable = getActiveTimetable(dateStr);
            if (!timetable) continue;
            const dayName = d.toLocaleDateString('en-US', { weekday: 'long' });
            const subjects = (timetable.schedule && timetable.schedule[dayName]) || [];
            for (const subject of subjects) {
                const { subjectName, category } = splitSubjectAndCategory(subject);
                if (!subjectName || !category) continue;
                rowsToInsert.push({
                    user_id: currentUser.id,
                    date: dateStr,
                    subject_name: subjectName,
                    category,
                    status: 'Not Marked'
                });
            }
        }

        if (rowsToInsert.length > 0) {
            // Insert without overwriting existing records
            const { error } = await supabase
                .from('attendance_log')
                .insert(rowsToInsert, { onConflict: 'user_id,date,subject_name,category', ignoreDuplicates: true });
            if (error) {
                // Some Supabase versions use upsert with ignoreDuplicates
                const { error: fallbackError } = await supabase
                    .from('attendance_log')
                    .upsert(rowsToInsert, { onConflict: 'user_id,date,subject_name,category', ignoreDuplicates: true });
                if (fallbackError) throw fallbackError;
            }
        }

        // Update last_log_date to endDate
        const { error: profileErr } = await supabase
            .from('profiles')
            .update({ last_log_date: endDate.toISOString().split('T')[0] })
            .eq('id', currentUser.id);
        if (profileErr) throw profileErr;

        userProfile.last_log_date = endDate.toISOString().split('T')[0];
    } catch (error) {
        console.error('Backfill error:', error);
        // Non-fatal
    }
}

// Timetable functions
function getActiveTimetable(date) {
    if (!userProfile.timetables || userProfile.timetables.length === 0) return null;
    
    const checkDate = new Date(date);
    
    // First check for active special timetables
    for (const timetable of userProfile.timetables) {
        if (timetable.type === 'special' && timetable.isActive) {
            const startDate = new Date(timetable.startDate);
            const endDate = new Date(timetable.endDate);
            if (checkDate >= startDate && checkDate <= endDate) {
                return timetable;
            }
        }
    }
    
    // Then check for normal timetables
    for (const timetable of userProfile.timetables) {
        if (timetable.type !== 'special') {
            const startDate = new Date(timetable.startDate);
            const endDate = new Date(timetable.endDate || '2030-12-31');
            if (checkDate >= startDate && checkDate <= endDate) {
                return timetable;
            }
        }
    }
    
    return null;
}

// Modal functions
function openTimetableModal(timetableId = null) {
    const modal = document.getElementById('timetable-modal');
    const form = document.getElementById('timetable-form');
    const title = document.getElementById('timetable-modal-title');
    
    if (timetableId) {
        title.textContent = 'Edit Timetable';
        // Load existing timetable data
        const timetable = userProfile.timetables.find(t => t.id === timetableId);
        if (timetable) {
            document.getElementById('timetable-name').value = timetable.name;
            document.getElementById('timetable-type').value = timetable.type || 'normal';
            document.getElementById('timetable-start-date').value = timetable.startDate;
            document.getElementById('timetable-end-date').value = timetable.endDate;
            document.getElementById('timetable-min-attendance').value = userProfile.attendance_threshold;
        }
    } else {
        title.textContent = 'Add New Timetable';
        form.reset();
        document.getElementById('timetable-min-attendance').value = userProfile.attendance_threshold;
    }
    
    setupTimetableModal();
    modal.style.display = 'flex';
}

function setupTimetableModal() {
    const form = document.getElementById('timetable-form');
    const addSubjectBtn = document.getElementById('timetable-add-subject-btn');
    const subjectMasterList = document.getElementById('timetable-subject-master-list');
    const gridContainer = document.getElementById('timetable-grid-container');
    
    let subjects = [];
    
    // Add subject functionality
    addSubjectBtn.onclick = () => {
        const nameInput = document.getElementById('timetable-subject-name');
        const categorySelect = document.getElementById('timetable-subject-category');
        const weightInput = document.getElementById('timetable-subject-weight');
        
        const name = nameInput.value.trim();
        const category = categorySelect.value;
        const weight = parseInt(weightInput.value);
        
        if (!name) {
            showError('Please enter a subject name');
            return;
        }
        
        const fullName = `${name} ${category}`;
        if (subjects.find(s => s.fullName === fullName)) {
            showError('Subject already exists');
            return;
        }
        
        subjects.push({ name, category, fullName, weight });
        
        // Clear inputs
        nameInput.value = '';
        weightInput.value = 1;
        
        renderSubjectList();
        renderTimetableGrid();
    };
    
    function renderSubjectList() {
        subjectMasterList.innerHTML = subjects.map((subject, index) => `
            <li class="flex items-center justify-between p-3 bg-white/80 dark:bg-apple-gray-800/80 rounded-lg">
                <span class="text-gray-800 dark:text-white">${subject.fullName} (Weight: ${subject.weight})</span>
                <button type="button" onclick="removeSubject(${index})" class="text-red-500 hover:text-red-700 font-medium">Remove</button>
            </li>
        `).join('');
    }
    
    function renderTimetableGrid() {
        const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
        gridContainer.innerHTML = days.map(day => `
            <div class="day-column">
                <h4 class="font-semibold text-gray-800 dark:text-white mb-3 text-center">${day}</h4>
                <div id="day-${day}" class="space-y-2 min-h-[150px] p-3 bg-white/50 dark:bg-apple-gray-800/50 rounded-lg border-2 border-dashed border-gray-300 dark:border-apple-gray-600">
                    <!-- Subjects will be added here -->
                </div>
                <select onchange="addSubjectToDay('${day}', this.value); this.value='';" class="w-full mt-2 px-3 py-2 bg-white/80 dark:bg-apple-gray-800/80 border border-gray-200/50 dark:border-apple-gray-700/50 rounded-lg text-sm dark:text-white">
                    <option value="">Add subject...</option>
                    ${subjects.map(s => `<option value="${s.fullName}">${s.fullName}</option>`).join('')}
                </select>
            </div>
        `).join('');
    }
    
    // Make functions global for onclick handlers
    window.removeSubject = (index) => {
        subjects.splice(index, 1);
        renderSubjectList();
        renderTimetableGrid();
    };
    
    window.addSubjectToDay = (day, subjectName) => {
        if (!subjectName) return;
        
        const dayContainer = document.getElementById(`day-${day}`);
        const subjectDiv = document.createElement('div');
        subjectDiv.className = 'flex items-center justify-between p-2 bg-blue-100 dark:bg-blue-900/30 rounded text-sm';
        subjectDiv.innerHTML = `
            <span class="text-gray-800 dark:text-white">${subjectName}</span>
            <button type="button" onclick="this.parentElement.remove()" class="text-red-500 hover:text-red-700 text-xs">×</button>
        `;
        dayContainer.appendChild(subjectDiv);
    };
    
    // Form submission
    form.onsubmit = async (e) => {
        e.preventDefault();
        await saveTimetable(subjects);
    };
    
    renderSubjectList();
    renderTimetableGrid();
}

async function saveTimetable(subjects) {
    try {
        showLoading('Saving timetable...');
        
        const formData = new FormData(document.getElementById('timetable-form'));
        const name = formData.get('timetable-name');
        const type = formData.get('timetable-type');
        const startDate = formData.get('timetable-start-date');
        const endDate = formData.get('timetable-end-date') || '2030-12-31';
        const threshold = parseInt(formData.get('timetable-min-attendance'));
        
        // Build schedule from grid
        const schedule = {};
        const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
        
        days.forEach(day => {
            const dayContainer = document.getElementById(`day-${day}`);
            const subjectElements = dayContainer.querySelectorAll('div span');
            schedule[day] = Array.from(subjectElements).map(el => el.textContent);
        });
        
        // Build subject weights
        const subjectWeights = {};
        subjects.forEach(subject => {
            subjectWeights[subject.fullName] = subject.weight;
        });
        
        const newTimetable = {
            id: crypto.randomUUID(),
            name,
            type,
            startDate,
            endDate,
            schedule,
            subjectWeights,
            isActive: type === 'special' ? false : true
        };
        
        userProfile.timetables.push(newTimetable);
        userProfile.attendance_threshold = threshold;
        
        const { error } = await supabase
            .from('profiles')
            .update({
                timetables: userProfile.timetables,
                attendance_threshold: userProfile.attendance_threshold
            })
            .eq('id', currentUser.id);
        
        if (error) throw error;
        
        closeAllModals();
        await renderDashboard();
        showSuccess('Timetable saved successfully!');
        
    } catch (error) {
        console.error('Save timetable error:', error);
        showError('Failed to save timetable: ' + error.message);
    } finally {
        hideLoading();
    }
}

async function deleteTimetable(timetableId) {
    if (!confirm('Are you sure you want to delete this timetable?')) return;
    
    try {
        showLoading('Deleting timetable...');
        
        userProfile.timetables = userProfile.timetables.filter(t => t.id !== timetableId);
        
        const { error } = await supabase
            .from('profiles')
            .update({ timetables: userProfile.timetables })
            .eq('id', currentUser.id);
        
        if (error) throw error;
        
        await renderDashboard();
        showSuccess('Timetable deleted successfully!');
        
    } catch (error) {
        console.error('Delete timetable error:', error);
        showError('Failed to delete timetable: ' + error.message);
    } finally {
        hideLoading();
    }
}

async function toggleTimetableActive(timetableId) {
    try {
        const timetable = userProfile.timetables.find(t => t.id === timetableId);
        if (!timetable) return;
        
        timetable.isActive = !timetable.isActive;
        
        const { error } = await supabase
            .from('profiles')
            .update({ timetables: userProfile.timetables })
            .eq('id', currentUser.id);
        
        if (error) throw error;
        
        await renderDashboard();
        showSuccess(`Timetable ${timetable.isActive ? 'activated' : 'deactivated'} successfully!`);
        
    } catch (error) {
        console.error('Toggle timetable error:', error);
        showError('Failed to toggle timetable: ' + error.message);
    }
}

async function toggleAttendancePause() {
    try {
        userProfile.attendance_paused = !userProfile.attendance_paused;
        
        const { error } = await supabase
            .from('profiles')
            .update({ attendance_paused: userProfile.attendance_paused })
            .eq('id', currentUser.id);
        
        if (error) throw error;
        
        await renderDashboard();
        showSuccess(`Attendance ${userProfile.attendance_paused ? 'paused' : 'resumed'} successfully!`);
        
    } catch (error) {
        console.error('Toggle pause error:', error);
        showError('Failed to toggle attendance pause: ' + error.message);
    }
}

async function updateAttendanceThreshold() {
    try {
        const threshold = parseInt(document.getElementById('attendance-threshold').value);
        if (threshold < 1 || threshold > 100) {
            showError('Threshold must be between 1 and 100');
            return;
        }
        
        userProfile.attendance_threshold = threshold;
        
        const { error } = await supabase
            .from('profiles')
            .update({ attendance_threshold: threshold })
            .eq('id', currentUser.id);
        
        if (error) throw error;
        
        await renderDashboard();
        showSuccess('Attendance threshold updated successfully!');
        
    } catch (error) {
        console.error('Update threshold error:', error);
        showError('Failed to update threshold: ' + error.message);
    }
}

// Extra day modal functions
function openExtraDayModal() {
    document.getElementById('extra-day-modal').style.display = 'flex';
}

async function saveExtraWorkingDay() {
    try {
        showLoading('Adding extra day...');
        const dateInput = document.getElementById('extra-day-date');
        const weekdaySelect = document.getElementById('weekday-to-follow');
        const pickedDate = dateInput.value;
        const weekdayToFollow = weekdaySelect.value;

        if (!pickedDate || !weekdayToFollow) {
            showError('Please select a date and weekday to follow.');
            return;
        }

        // Find a base timetable to copy from
        const baseTimetable = getActiveTimetable(pickedDate) || userProfile.timetables.find(t => t.type !== 'special') || userProfile.timetables[0];
        if (!baseTimetable) {
            showError('No timetable available to copy from.');
            return;
        }

        const actualDayName = new Date(pickedDate).toLocaleDateString('en-US', { weekday: 'long' });
        const subjectsToCopy = (baseTimetable.schedule && baseTimetable.schedule[weekdayToFollow]) || [];

        const schedule = {};
        schedule[actualDayName] = subjectsToCopy.slice();

        const newTimetable = {
            id: crypto.randomUUID(),
            name: `Extra Day (${pickedDate})`,
            type: 'special',
            startDate: pickedDate,
            endDate: pickedDate,
            schedule,
            subjectWeights: { ...(baseTimetable.subjectWeights || {}) },
            isActive: true
        };

        userProfile.timetables.push(newTimetable);

        const { error } = await supabase
            .from('profiles')
            .update({ timetables: userProfile.timetables })
            .eq('id', currentUser.id);
        if (error) throw error;

        closeAllModals();
        await renderDashboard();
        showSuccess('Extra working day added!');
    } catch (error) {
        console.error('Extra day error:', error);
        showError('Failed to add extra day: ' + error.message);
    } finally {
        hideLoading();
    }
}

// Assistant
function openAssistant() {
    if (!assistantModal) return;
    const content = document.getElementById('assistant-content');
    const activeTimetable = getActiveTimetable(currentDate);
    if (!activeTimetable) {
        content.innerHTML = '<p class="text-gray-700 dark:text-gray-300">No active timetable for today.</p>';
        assistantModal.style.display = 'flex';
        return;
    }

    // Build a simple guidance list based on current summary
    getAttendanceData().then(summary => {
        if (summary.length === 0) {
            content.innerHTML = '<p class="text-gray-700 dark:text-gray-300">No attendance data yet. Start marking today to get guidance.</p>';
            assistantModal.style.display = 'flex';
            return;
        }

        const t = userProfile.attendance_threshold / 100;
        const lines = summary.map(item => {
            const subject = item.subject; // "Name Category"
            const remaining = countRemainingWeighted(subject, currentDate);
            const A = item.attended; // weighted so far
            const H = item.held;     // weighted so far
            const R = remaining.totalWeighted;

            // Minimum weighted units to attend from remaining to reach threshold
            const needWeighted = Math.max(0, Math.ceil(t * (H + R) - A));

            // Maximum weighted units you can miss and still stay >= threshold
            const maxMissWeighted = Math.max(0, Math.floor(Math.min(
                R,
                (A - t * H) + (1 - t) * R
            )));

            // Approximate sessions using the typical weight for this subject on active timetable
            const typicalWeight = remaining.typicalWeight || 1;
            const needSessions = Math.ceil(needWeighted / typicalWeight);
            const canMissSessions = Math.floor(maxMissWeighted / typicalWeight);

            // If impossible to reach threshold even by attending all
            const unreachable = needWeighted > R;

            return `
                <div class="p-3 bg-gray-50/50 dark:bg-apple-gray-850/50 rounded-lg border border-gray-200/40 dark:border-apple-gray-800/40">
                    <div class="flex items-center justify-between">
                        <span class="font-medium text-gray-800 dark:text-white text-sm">${subject}</span>
                        <span class="text-xs text-gray-600 dark:text-gray-400">${item.percentage.toFixed(1)}%</span>
                    </div>
                    ${unreachable
                        ? `<p class=\"text-xs text-gray-600 dark:text-gray-400 mt-1\">Even if you attend all remaining (${R} weighted), you will not reach ${userProfile.attendance_threshold}%. Attend everything to maximize your percentage.</p>`
                        : `<p class=\"text-xs text-gray-600 dark:text-gray-400 mt-1\">Attend at least <strong>${needWeighted}</strong> weighted (${needSessions} session${needSessions===1?'':'s'} approx) to reach ${userProfile.attendance_threshold}%.</p>`}
                    <p class="text-xs text-gray-600 dark:text-gray-400">You can safely miss about <strong>${maxMissWeighted}</strong> weighted (${canMissSessions} session${canMissSessions===1?'':'s'} approx) and remain at target.</p>
                </div>
            `;
        }).join('');

        content.innerHTML = lines || '<p class="text-gray-700 dark:text-gray-300">No guidance available.</p>';
        assistantModal.style.display = 'flex';
    }).catch(() => {
        content.innerHTML = '<p class="text-gray-700 dark:text-gray-300">Failed to load guidance.</p>';
        assistantModal.style.display = 'flex';
    });
}

// Utility functions
function closeAllModals() {
    document.querySelectorAll('[id$="-modal"]').forEach(modal => {
        modal.style.display = 'none';
    });
}

function showLoading(text = 'Loading...') {
    isLoading = true;
    loadingText.textContent = text;
    loadingOverlay.style.display = 'flex';
}

function hideLoading() {
    isLoading = false;
    loadingOverlay.style.display = 'none';
}

function showError(message) {
    console.error(message);
    showToast('Error', message, 'error');
}

function showSuccess(message) {
    console.log(message);
    showToast('Success', message, 'success');
}

// Make functions globally available
window.openTimetableModal = openTimetableModal;
window.openExtraDayModal = openExtraDayModal;
window.openAssistant = openAssistant;
window.markAttendance = markAttendance;
window.saveAttendance = saveAttendance;
window.deleteTimetable = deleteTimetable;
window.toggleTimetableActive = toggleTimetableActive;
window.toggleAttendancePause = toggleAttendancePause;
window.updateAttendanceThreshold = updateAttendanceThreshold;
window.saveExtraWorkingDay = saveExtraWorkingDay;

// Helpers
function splitSubjectAndCategory(subject) {
    const lastSpaceIndex = subject.lastIndexOf(' ');
    return {
        subjectName: lastSpaceIndex === -1 ? subject : subject.slice(0, lastSpaceIndex),
        category: lastSpaceIndex === -1 ? '' : subject.slice(lastSpaceIndex + 1)
    };
}

// Toasts
function showToast(title, message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const id = 't' + Math.random().toString(36).slice(2);
    const base = document.createElement('div');
    base.id = id;
    base.className = `flex items-start gap-3 p-4 rounded-xl shadow-apple dark:shadow-apple-dark border animate-fade-in ${
        type === 'success' ? 'bg-green-50/90 dark:bg-green-900/30 border-green-200/50 dark:border-green-800/50 text-green-800 dark:text-green-200' :
        type === 'error' ? 'bg-red-50/90 dark:bg-red-900/30 border-red-200/50 dark:border-red-800/50 text-red-800 dark:text-red-200' :
        'bg-gray-50/90 dark:bg-apple-gray-900/60 border-gray-200/50 dark:border-apple-gray-800/50 text-gray-800 dark:text-gray-200'
    }`;

    base.innerHTML = `
        <div class="flex-1">
            <p class="font-semibold">${title}</p>
            <p class="text-sm opacity-90">${message}</p>
        </div>
        <button class="px-2 py-1 text-sm rounded-lg bg-black/5 dark:bg-white/10" aria-label="Close">✕</button>
    `;

    const remove = () => {
        base.style.opacity = '0';
        base.style.transform = 'translateY(4px)';
        setTimeout(() => base.remove(), 200);
    };
    base.querySelector('button')?.addEventListener('click', remove);
    container.appendChild(base);
    setTimeout(remove, 3000);
}

// Compute remaining weighted units and a typical weight for a subject between currentDate and end-date of active timetables
function countRemainingWeighted(subjectFullName, fromDateStr) {
    const [subjectName, ...rest] = subjectFullName.split(' ');
    const category = rest.join(' ');

    let totalWeighted = 0;
    const weights = [];

    const fromDate = new Date(fromDateStr);
    const horizon = new Date();
    horizon.setMonth(horizon.getMonth() + 6); // 6 months lookahead max to avoid runaway

    // Gather all future dates covered by any timetable for this subject
    for (const timetable of userProfile.timetables || []) {
        const start = new Date(timetable.startDate);
        const end = new Date(timetable.endDate || '2030-12-31');
        let d = new Date(Math.max(fromDate, start));

        for (; d <= end && d <= horizon; d.setDate(d.getDate() + 1)) {
            const dayName = d.toLocaleDateString('en-US', { weekday: 'long' });
            const list = (timetable.schedule && timetable.schedule[dayName]) || [];
            for (const s of list) {
                const { subjectName: n, category: c } = splitSubjectAndCategory(s);
                if (n === subjectName && c === category) {
                    const weight = (timetable.subjectWeights && timetable.subjectWeights[subjectFullName]) || 1;
                    totalWeighted += weight;
                    weights.push(weight);
                }
            }
        }
    }

    const typicalWeight = weights.length > 0 ? Math.round(weights.reduce((a, b) => a + b, 0) / weights.length) : 1;
    return { totalWeighted, typicalWeight };
}