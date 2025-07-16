import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// These variables will be populated by the netlify.js file generated during the build
const supabaseUrl = window.SUPABASE_URL;
const supabaseKey = window.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Supabase credentials not found. Make sure the netlify.js file is being generated correctly by the Netlify build command.");
    // Display a user-friendly message on the page
    const authForm = document.getElementById('auth-form');
    if (authForm) {
        authForm.innerHTML = `<p class="error-message">Configuration Error: The application cannot connect to the backend. Please contact the site administrator.</p>`;
    }
}

export const supabase = createClient(supabaseUrl, supabaseKey);