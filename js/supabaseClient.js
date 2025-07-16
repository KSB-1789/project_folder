import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// These variables will be populated by Netlify's environment variables
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

// For local development, you can uncomment and hardcode your keys here.
// REMEMBER to comment this out before pushing to production.
// const supabaseUrl = 'YOUR_SUPABASE_URL';
// const supabaseKey = 'YOUR_SUPABASE_ANON_KEY';


if (!supabaseUrl || !supabaseKey) {
    console.error("Supabase URL and Key are required. Make sure to set them as environment variables on your hosting provider (e.g., Netlify).");
}

export const supabase = createClient(supabaseUrl, supabaseKey);