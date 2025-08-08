import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import ordersRoutes from './routes/ordersRoutes.js';



import * as mqttService from './services/mqttService.js';

import cowRoutes from './routes/cowRoutes.js';
import alertRoutes from './routes/alertRoutes.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();
const app = express();
const port = process.env.PORT || 10001;

app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/cows', cowRoutes);
app.use('/alerts', alertRoutes);
app.use('/orders', ordersRoutes);
// MQTT
mqttService.onMessage((topic, message) => {
  console.log(`[MQTT] ${topic}: ${message.toString()}`);
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Server listening on http://0.0.0.0:${port}`);
});

