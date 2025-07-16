import { supabase } from './supabaseClient.js';

// Redirect to dashboard if a user session exists
const session = await supabase.auth.getSession();
if (session.data.session) {
    window.location.href = '/dashboard.html';
}

const loginForm = document.getElementById('login-form');
const signupForm = document.getElementById('signup-form');
const authError = document.getElementById('auth-error');

const showSignup = document.getElementById('show-signup');
const showLogin = document.getElementById('show-login');
const loginContainer = document.getElementById('login-container');
const signupContainer = document.getElementById('signup-container');

// Event Listeners
showSignup.addEventListener('click', (e) => {
    e.preventDefault();
    loginContainer.style.display = 'none';
    signupContainer.style.display = 'block';
});

showLogin.addEventListener('click', (e) => {
    e.preventDefault();
    signupContainer.style.display = 'none';
    loginContainer.style.display = 'block';
});

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    authError.textContent = '';
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
    });

    if (error) {
        authError.textContent = error.message;
    } else {
        window.location.href = '/dashboard.html';
    }
});

signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    authError.textContent = '';
    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;

    const { data, error } = await supabase.auth.signUp({
        email,
        password,
    });

    if (error) {
        authError.textContent = error.message;
    } else {
        // Automatically log the user in and redirect
        await supabase.auth.signInWithPassword({ email, password });
        window.location.href = '/dashboard.html';
    }
});