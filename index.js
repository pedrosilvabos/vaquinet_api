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

app.get('/cows', (req, res) => {
  const cows = Array.from({ length: 5 }, (_, i) => ({
    id: `${i}`,
    name: `Cow ${i}`,
    temperature: 38.5 + i * 0.2,
    location: `Pasture ${i + 1}`
  }));

  res.json(cows);
});


app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});
