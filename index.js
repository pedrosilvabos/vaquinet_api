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

app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});
