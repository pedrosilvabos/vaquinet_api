import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import ordersRoutes from './routes/ordersRoutes.js';
import cowRoutes from './routes/cowRoutes.js';
import alertRoutes from './routes/alertRoutes.js';
import fenceRoutes from './routes/fenceRoutes.js';           // ← add this
import * as mqttService from './services/mqttService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();
const app = express();
const port = process.env.PORT || 10001;


app.use(express.json({ limit: '2mb' }));                  
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/cows', cowRoutes);
app.use('/alerts', alertRoutes);
app.use('/orders', ordersRoutes);
app.use('/fences', fenceRoutes);                              // ← mount here

// MQTT
mqttService.onMessage((topic, message) => {
  console.log(`[MQTT1] ${topic}: ${message.toString()}`);
});

// Basic root
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Optional: 404 and error handler that won't leak stack traces in prod
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Server listening on http://0.0.0.0:${port}`);
});
