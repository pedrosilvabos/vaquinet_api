const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Vaquinet API is running!');
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
