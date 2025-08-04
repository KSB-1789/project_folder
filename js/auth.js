import { supabase } from './supabaseClient.js';

(async () => {
    try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) {
            console.error('Session check error:', error);
        } else if (session) {
            window.location.href = '/dashboard.html';
        }
    } catch (error) {
        console.error('Failed to check session:', error);
    }
})();

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
    
    try {
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        
        if (!email || !password) {
            authError.textContent = 'Please enter both email and password.';
            return;
        }
        
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) { 
            authError.textContent = error.message; 
        } else { 
            window.location.href = '/dashboard.html'; 
        }
    } catch (error) {
        console.error('Login error:', error);
        authError.textContent = 'An unexpected error occurred. Please try again.';
    }
});

signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    authError.textContent = '';
    
    try {
        const email = document.getElementById('signup-email').value;
        const password = document.getElementById('signup-password').value;
        
        if (!email || !password) {
            authError.textContent = 'Please enter both email and password.';
            return;
        }
        
        if (password.length < 6) {
            authError.textContent = 'Password must be at least 6 characters long.';
            return;
        }
        
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) { 
            authError.textContent = error.message; 
        } else {
            const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
            if (signInError) {
                authError.textContent = signInError.message;
            } else {
                window.location.href = '/dashboard.html';
            }
        }
    } catch (error) {
        console.error('Signup error:', error);
        authError.textContent = 'An unexpected error occurred. Please try again.';
    }
});