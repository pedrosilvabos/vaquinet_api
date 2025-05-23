const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Vaquinet API is running!');
});

app.get('/cows', (req, res) => {
  res.json([
    {
      id: '1',
      name: 'Luna',
      temperature: 38.5,
      location: 'Field A'
    },
    {
      id: '2',
      name: 'Bella',
      temperature: 39.0,
      location: 'Field B'
    }
  ]);
});
app.get('/cows', async (req, res) => {
  const { data, error } = await supabase
    .from('cows')
    .select('*');

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});


app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});
