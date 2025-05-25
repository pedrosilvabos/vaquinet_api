import 'dotenv/config';
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import cors from 'cors';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
app.use(express.json()); // Required to parse JSON body
const port = process.env.PORT || 10001;

app.use(cors());


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static files from /public
app.use(express.static(path.join(__dirname, 'public')));


const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);
// Serve index.html on root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});



// 🐮 Get all cows
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

// 🐮 Get one cow by ID
app.get('/cows/:id', async (req, res) => {
  const id = req.params.id;
  const { data, error } = await supabase.from('cows').select('*').eq('id', id).single();
  if (error) return res.status(404).json({ error: 'Cow not found', details: error.message });
  res.json(data);
});

// 🐮 Create a new cow
app.post('/cows', async (req, res) => {
  console.log('Incoming cow data:', req.body); // 👈 Log this

  const cowData = req.body;

  if (!cowData.name) {
    return res.status(400).json({ error: 'Missing name in request' });
  }

  const { data, error } = await supabase
    .from('cows')
    .insert([cowData])
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});


// 🐮 Update a cow by ID
app.put('/cows/:id', async (req, res) => {
  const id = req.params.id;
  const updates = req.body;
  const { data, error } = await supabase.from('cows').update(updates).eq('id', id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// 🐮 Delete a cow by ID
app.delete('/cows/:id', async (req, res) => {
  const id = req.params.id;
  const { error } = await supabase.from('cows').delete().eq('id', id);
  if (error) return res.status(400).json({ error: error.message });
  res.status(204).send(); // No Content
});

app.listen(port, () => {
  console.log(`API running on http://localhost:${port}`);
});
 