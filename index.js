import 'dotenv/config';
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import cors from 'cors';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';
import mqtt from 'mqtt';

const app = express();
app.use(express.json());
const port = process.env.PORT || 10001;

app.use(cors());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, 'public')));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// --- In-memory alerts store for demo ---
const alerts = [];

// --- MQTT Setup ---
const mqttClient = mqtt.connect('mqtts://728ab5952b9d48ab9865b395f89aec0f.s1.eu.hivemq.cloud:8883', {
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD,
});

mqttClient.on('connect', () => {
  console.log('✅ MQTT connected');
  mqttClient.subscribe('cows/#', (err) => {
    if (err) {
      console.error('❌ MQTT subscription error:', err);
    } else {
      console.log('📡 Subscribed to cows/#');
    }
  });
});

mqttClient.on('message', async (topic, message) => {
  const msgStr = message.toString();
  console.log(`📥 MQTT Message on topic "${topic}": ${msgStr}`);

  try {
    if (topic.startsWith('cows/')) {
      const payload = JSON.parse(msgStr);
      if (Array.isArray(payload)) {
        payload.forEach(async (cow) => {
          if (!cow || typeof cow !== 'object') return;

          // --- Uncomment this logic to enable alerts ---
          // if (cow.temperature && (cow.temperature > 39 || cow.temperature < 36)) {
          //   const alert = {
          //     cow_id: cow.id || cow.deviceId || null,
          //     name: cow.name || 'Unknown',
          //     type: 'temperature',
          //     value: cow.temperature,
          //     message: `Abnormal temperature: ${cow.temperature}°C`,
          //     location: cow.location,
          //     latitude: cow.latitude,
          //     longitude: cow.longitude,
          //     timestamp: new Date().toISOString()
          //   };

          //   const { error } = await supabase.from('alerts').insert(alert);
          //   if (error) {
          //     console.error('❌ Error inserting alert:', error.message);
          //   } else {
          //     console.log('🚨 Alert saved to Supabase:', alert);
          //     alerts.push(alert);
          //   }
          // }
        });
      }
    }
  } catch (err) {
    console.error('Error processing MQTT message:', err);
  }
});

mqttClient.on('error', (err) => {
  console.error('❌ MQTT connection error:', err);
});

// --- Utility ---
async function publishCowList() {
  const { data: allCows, error } = await supabase.from('cows').select('*');
  if (!error) {
    mqttClient.publish('cows/all', JSON.stringify(allCows));
  } else {
    console.error('Failed to fetch all cows for MQTT publish:', error.message);
  }
}

// --- API Endpoints ---

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/cows', async (req, res) => {
  try {
    const { data, error } = await supabase.from('cows').select('*');
    if (error) return res.status(500).json({ error: 'Supabase query failed', details: error });

    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: 'Unexpected server error', details: err.message });
  }
});

app.get('/cows/:id', async (req, res) => {
  const { id } = req.params;
  const { data: cow, error } = await supabase.from('cows').select('*').eq('id', id).single();
  if (error) return res.status(404).json({ error: 'Cow not found', details: error.message });

  mqttClient.publish('cows/details', JSON.stringify(cow));
  res.json(cow);
});

app.post('/cows', async (req, res) => {
  const cowData = req.body;
  if (!cowData.name) return res.status(400).json({ error: 'Missing name in request' });

  const { data, error } = await supabase.from('cows').insert([cowData]).select().single();
  if (error) return res.status(400).json({ error: error.message });

  mqttClient.publish('cows/new', JSON.stringify(data));
  await publishCowList();
  res.status(201).json(data);
});

app.put('/cows/:id', async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  const { data, error } = await supabase.from('cows').update(updates).eq('id', id).select().single();
  if (error) return res.status(400).json({ error: error.message });

  mqttClient.publish('cows/update', JSON.stringify(data));
  await publishCowList();
  res.json(data);
});

app.delete('/cows/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('cows').delete().eq('id', id);
  if (error) return res.status(400).json({ error: error.message });

  mqttClient.publish('cows/delete', JSON.stringify({ success: true, id }));
  await publishCowList();
  res.status(204).send();
});

app.post('/esp/data', async (req, res) => {
  let sensorData = req.body;

  // if (!Array.isArray(sensorData) || sensorData.length === 0 || !sensorData[0]) {
  //   console.warn('⚠️ Invalid or empty sensor data array');
  //   return res.status(400).json({ error: 'Expected non-empty array with one object' });
  // }

  const single = sensorData[0];
  if (typeof single !== 'object' || single === null) {
    return res.status(400).json({ error: 'Malformed object in sensor array' });
  }

  try {
    const payload = JSON.stringify(sensorData); // keep it in array if MQTT expects it
    mqttClient.publish('cows/sensors', payload, (err) => {
      if (err) {
        console.error('❌ MQTT publish error:', err);
        return res.status(500).json({ error: 'Failed to publish MQTT message' });
      }
      console.log('✅ Sensor data published to MQTT:', payload);
      res.status(200).json({ message: 'Data received and published to MQTT' });
    });
  } catch (err) {
    console.error('❌ Error handling /esp/data:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});


app.get('/alerts', (req, res) => {
  res.json(alerts);
});

app.get('/analytics/summary', async (req, res) => {
  try {
    const { data: cows, error } = await supabase.from('cows').select('*');
    if (error) return res.status(500).json({ error: 'Failed to get cows data', details: error });

    res.json({
      totalCows: cows.length,
      totalAlerts: alerts.length,
      lastAlert: alerts.length > 0 ? alerts[alerts.length - 1] : null,
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

app.get('/external/weather', async (req, res) => {
  try {
    const location = req.query.location || 'Terceira, Azores';
    const response = await fetch(`https://api.weatherapi.com/v1/current.json?key=YOUR_API_KEY&q=${encodeURIComponent(location)}`);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch weather data', details: err.message });
  }
});

app.get('/docs', (req, res) => {
  res.json({
    '/': { method: 'GET', description: 'Serve index.html' },
    '/cows': { method: 'GET/POST', description: 'List or create cows' },
    '/cows/:id': { method: 'GET/PUT/DELETE', description: 'Get, update, or delete cow' },
    '/alerts': { method: 'GET', description: 'View alerts (in-memory)' },
    '/analytics/summary': { method: 'GET', description: 'Cows + alerts summary' },
    '/external/weather': { method: 'GET', description: 'Weather API passthrough' },
    '/esp/data': { method: 'POST', description: 'Receive and publish ESP sensor data' }
  });
});

// --- Start Server ---
app.listen(port, () => {
  console.log(`🚀 Server listening on http://localhost:${port}`);
});
