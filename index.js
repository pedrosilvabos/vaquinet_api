import 'dotenv/config'; 
import express from 'express';
import { createClient } from '@supabase/supabase-js';

const app = express();
const port = process.env.PORT || 10000;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

app.get('/cows', async (req, res) => {
  console.log('Fetching cows from Supabase...');
  try {
    const { data, error } = await supabase.from('cows').select('*');
    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ error: error.message });
    }
    console.log('Data fetched:', data);
    res.json(data);
  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: 'Unexpected server error' });
  }
});

app.listen(port, () => {
  console.log(`API running on http://localhost:${port}`);
});
