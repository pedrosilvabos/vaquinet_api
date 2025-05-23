import 'dotenv/config';
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import cors from 'cors'; // Now installed
import fetch from 'node-fetch'; // For fallback if needed

const app = express();
const port = process.env.PORT || 10000;

app.use(cors()); // Enable CORS

// Log environment variables
console.log('Supabase URL:', process.env.SUPABASE_URL);
console.log('Supabase Anon Key:', process.env.SUPABASE_ANON_KEY);

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Test Supabase client connectivity
async function testSupabaseConnection() {
  try {
    const { data, error } = await supabase.from('cows').select('*').limit(1);
    if (error) {
      console.error('Supabase test error:', error);
      return;
    }
    console.log('Supabase test data:', data);
  } catch (err) {
    console.error('Unexpected Supabase test error:', err);
  }
}
testSupabaseConnection();

app.get('/cows', async (req, res) => {
  console.log('Fetching cows from Supabase...');
  try {
    const { data, error } = await supabase.from('cows').select('*');
    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ error: 'Supabase query failed', details: error });
    }
    if (!data || data.length === 0) {
      console.log('No data returned');
      return res.status(200).json({ message: 'No data found', data: [] });
    }
    console.log('Data fetched:', data);
    res.json(data);
  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: 'Unexpected server error', details: err.message });
  }
});

app.listen(port, () => {
  console.log(`API running on http://localhost:${port}`);
});