// server.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import * as mqttService from './utils/mqttService.js';
import opastorRouter from './routes/oPastor/index.js';
import trailsRouter from './routes/trails/index.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 10001;

app.use(express.json({ limit: '2mb' }));
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Domain mounting
app.use('/opastor', opastorRouter);
app.use('/trails', trailsRouter);

// MQTT logging
mqttService.onMessage((topic, message) => {
  try {
    const payload = JSON.parse(message.toString());
    console.log(`[MQTT] ${topic}:`, payload);
  } catch (e) {
    console.log(`[MQTT] ${topic}: ${message.toString()}`);
  }
});

// Root
app.get('/', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html')),
);

// 404 + error
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Server listening on http://0.0.0.0:${port}`);
});
