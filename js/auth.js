import { supabase } from './supabaseClient.js';

const { data: { session } } = await supabase.auth.getSession();
if (session) {
    window.location.href = '/dashboard.html';
}

const loginForm = document.getElementById('login-form');
const signupForm = document.getElementById('signup-form');
const authError = document.getElementById('auth-error');
const showSignup = document.getElementById('show-signup');
const showLogin = document.getElementById('show-login');
const loginContainer = document.getElementById('login-container');
const signupContainer = document.getElementById('signup-container');

showSignup.addEventListener('click', (e) => {
    e.preventDefault();
    authError.textContent = '';
    loginContainer.style.display = 'none';
    signupContainer.style.display = 'block';
});

showLogin.addEventListener('click', (e) => {
    e.preventDefault();
    authError.textContent = '';
    signupContainer.style.display = 'none';
    loginContainer.style.display = 'block';
});

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    authError.textContent = '';
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { authError.textContent = error.message; }
    else { window.location.href = '/dashboard.html'; }
});

signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    authError.textContent = '';
    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) { authError.textContent = error.message; }
    else {
        await supabase.auth.signInWithPassword({ email, password });
        window.location.href = '/dashboard.html';
    }
});