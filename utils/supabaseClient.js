

// File: /utils/supabaseClient.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://nzavorpoosmaonbevcmb.supabase.co'; // your real URL
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im56YXZvcnBvb3NtYW9uYmV2Y21iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgwMDQ5MjgsImV4cCI6MjA2MzU4MDkyOH0.F8i58PrdUWYBblz_qjzJcEnNTbdXzbxtKKBJizSpAqE'; // replace with your anon key


const supabase = createClient(supabaseUrl, supabaseKey);

export default supabase;