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

// Simple audit log function (can be extended to DB or external logs)
async function auditLog(action, data) {
  console.log(`[AUDIT] Action: ${action}`, data);
  // Could insert into a DB table for persistence
}

// --- MQTT Setup ---
const mqttClient = mqtt.connect('mqtts://728ab5952b9d48ab9865b395f89aec0f.s1.eu.hivemq.cloud:8883', {
  username: 'vakinet',
  password: 'Vakinet1',
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

// // MQTT message handler - process messages and create alerts based on simple rules
// mqttClient.on('message', async (topic, message) => {
//   const msgStr = message.toString();
//   console.log(`📥 MQTT Message on topic "${topic}": ${msgStr}`);

//   // Example: if sensor data indicates abnormal temperature, generate alert
//   try {
//   if (topic.startsWith('cows/')) {
//   const payload = JSON.parse(msgStr);
//   if (Array.isArray(payload)) {
//   payload.forEach(async (cow) => {
//     if (!cow || typeof cow !== 'object') return; // Skip null or invalid items
//     // process cow...
//   });
// }

//   // Check if payload is an array
// //   if (Array.isArray(payload)) {
// //   payload.forEach(async (cow) => {
// //     if (cow.temperature && (cow.temperature > 39 || cow.temperature < 36)) {
// //       const alert = {
// //         cow_id: cow.deviceId,
// //         name: cow.name,
// //         type: 'temperature',
// //         value: cow.temperature,
// //         message: `Abnormal temperature detected for ${cow.name}: ${cow.temperature}°C`,
// //         location: cow.location,
// //         latitude: cow.latitude,
// //         longitude: cow.longitude,
// //         timestamp: new Date().toISOString()
// //       };

// //       // Insert into Supabase
// //       const { error } = await supabase.from('alerts').insert(alert);
// //       if (error) {
// //         console.error('❌ Error inserting alert:', error.message);
// //       } else {
// //         console.log('🚨 Alert saved to Supabase:', alert);
// //       }
// //     }
// //   });
// // }
// }

//   } catch (err) {
//     console.error('Error processing MQTT message:', err);
//   }
// });

mqttClient.on('error', (err) => {
  console.error('❌ MQTT connection error:', err);
});

// --- API Routes ---

// Serve index.html on root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- CRUD cows endpoints (your original ones) ---

// Get all cows
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
  //  mqttClient.publish('cows/', JSON.stringify(data));
    res.json(data);
  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: 'Unexpected server error', details: err.message });
  }
});




// Get one cow by ID
app.get('/cows/:id', async (req, res) => {
  const { id } = req.params;

  const { data: cow, error } = await supabase
    .from('cows')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    console.error('Error fetching cow:', error.message);
    return res.status(404).json({ error: 'Cow not found', details: error.message });
  }

  console.log('Fetched cow details:', cow);

  // Publish only this cow’s data
  mqttClient.publish('cows/details', JSON.stringify(cow));

  res.json(cow);
});


// Create a new cow
app.post('/cows', async (req, res) => {
  const cowData = req.body;
  if (!cowData.name) return res.status(400).json({ error: 'Missing name in request' });

  const { data, error } = await supabase
    .from('cows')
    .insert([cowData])
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  mqttClient.publish('cows/new', JSON.stringify(data));
  await publishCowList();
  await auditLog('create_cow', data);
  res.status(201).json(data);
});


// Update a cow by ID
app.put('/cows/:id', async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  const { data, error } = await supabase
    .from('cows')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  mqttClient.publish('cows/update', JSON.stringify(data));
  await publishCowList();
  await auditLog('update_cow', { id, updates });
  res.json(data);
});

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const toRad = deg => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}



// Endpoint to receive sensor data from ESP devices and publish to MQTT
app.post('/esp/data', async (req, res) => {
  
  const payload = req.body;

  if (!payload || !Array.isArray(payload)) {
    return res.status(400).json({ error: 'Expected an array of cow objects' });
  }

  const results = [];

  for (const cow of payload) {
    const cowId = cow.deviceId;
    if (!cow || !cowId) {
      results.push({ status: 'skipped', reason: 'Missing deviceId' });
      continue;
    }


  try {
    // 1. Ensure cow exists
    const { data: existingCow, error: fetchError } = await supabase
      .from('cows')
      .select('id')
      .eq('id', cow.deviceId)
      .maybeSingle();

    if (!existingCow) {
      const { error: insertCowError } = await supabase.from('cows').insert([{
        id: cow.deviceId,
        name: cow.name || 'Unnamed',
        latitude: cow.latitude,
        longitude: cow.longitude,
        temperature: cow.temperature,
        location: cow.location || '',
      }]);
      if (insertCowError) throw new Error(`Failed to insert cow: ${insertCowError.message}`);
      console.log(`🐄 New cow inserted: ${cow.deviceId}`);
    }

    // 2. Fetch last event
    const { data: lastEvent, error: lastError } = await supabase
      .from('cow_events')
      .select('*')
      .eq('cow_id', cow.deviceId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const now = new Date();
    const last = lastEvent || {};
    const changes = [];

    // 3. Movement logic
    const moved = cow.latitude && cow.longitude && last.event_data?.latitude && last.event_data?.longitude
      ? getDistance(cow.latitude, cow.longitude, last.event_data.latitude, last.event_data.longitude) > 10
      : false;

    const timeSinceLast = last.created_at
      ? now.getTime() - new Date(last.created_at).getTime()
      : Number.MAX_SAFE_INTEGER;

    const fifteenMinutes = 15 * 60 * 1000;

    // 4. Triggers
    const batteryDrop = last.event_data?.battery && cow.battery && (last.event_data.battery - cow.battery) >= 10;
    const fallDetected = cow.status === 'fallen' && last.event_type !== 'fall';

    if (batteryDrop) changes.push('battery_drop');
    if (fallDetected) changes.push('fall');
    if (moved && timeSinceLast >= fifteenMinutes) changes.push('movement');

    // 5. Save if needed
    if (changes.length > 0) {
      const eventType = changes[0];
      const event = {
        cow_id: cow.deviceId,
        event_type: eventType,
        event_data: {
          latitude: cow.latitude,
          longitude: cow.longitude,
          battery: cow.battery,
          temperature: cow.temperature,
          status: cow.status,
        },
      };

      const { error: insertError } = await supabase.from('cow_events').insert([event]);
      if (insertError) {
        console.error('❌ Error inserting cow_event:', insertError.message);
        return res.status(500).json({ error: 'Failed to log event' });
      }

      console.log(`📥 Event recorded: ${eventType} for cow ${cow.deviceId}`);
    } else {
      console.log(`ℹ️ No event recorded for cow ${cow.deviceId}`);
    }

    // 6. Always emit via MQTT
    mqttClient.publish('cows/sensors', JSON.stringify(cow));
    res.status(200).json({ message: 'Data received and processed' });

  } catch (err) {
    console.error('❌ Error in /esp/data:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
  }

  res.status(200).json({ message: 'All cows processed', results });
});



//delete a cow by ID
app.delete('/cows/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('cows').delete().eq('id', id);

  const success = !error;
  mqttClient.publish('cows/delete', JSON.stringify({ success, id }));

  if (error) return res.status(400).json({ error: error.message });

  await publishCowList();
  await auditLog('delete_cow', { id });
  res.status(204).send();
});


// --- New Endpoint: Get Alerts ---
app.get('/alerts', (req, res) => {
  res.json(alerts);
});

// --- New Endpoint: Analytics Summary ---
// Just a demo that returns count of cows and alerts for now
app.get('/analytics/summary', async (req, res) => {
  try {
    const { data: cows, error } = await supabase.from('cows').select('*');
    if (error) {
      return res.status(500).json({ error: 'Failed to get cows data', details: error });
    }

    res.json({
      totalCows: cows.length,
      totalAlerts: alerts.length,
      lastAlert: alerts.length > 0 ? alerts[alerts.length - 1] : null,
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// --- New Endpoint: External Weather Data ---
// Just a stub example calling a weather API (replace URL and key)
app.get('/external/weather', async (req, res) => {
  try {
    const location = req.query.location || 'Terceira, Azores';
    // Replace with actual weather API call
    const response = await fetch(`https://api.weatherapi.com/v1/current.json?key=YOUR_API_KEY&q=${encodeURIComponent(location)}`);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch weather data', details: err.message });
  }
});

// --- New Endpoint: API Documentation ---

const apiDocs = {
  '/': {
    method: 'GET',
    description: 'Serve frontend index.html',
    example: 'curl http://localhost:10001/',
  },
  '/cows': {
    method: 'GET',
    description: 'Get all cows',
    example: 'curl http://localhost:10001/cows',
  },
  '/cows/:id': {
    method: 'GET',
    description: 'Get a cow by ID',
    example: 'curl http://localhost:10001/cows/123',
  },
  '/cows': {
    method: 'POST',
    description: 'Create a new cow. JSON body required: { name: string, ... }',
    example: 'curl -X POST http://localhost:10001/cows -H "Content-Type: application/json" -d \'{"name":"Bessie"}\'',
  },
  '/cows/:id': {
    method: 'PUT',
    description: 'Update a cow by ID. JSON body with fields to update',
    example: 'curl -X PUT http://localhost:10001/cows/123 -H "Content-Type: application/json" -d \'{"name":"Bella"}\'',
  },
  '/cows/:id': {
    method: 'DELETE',
    description: 'Delete a cow by ID',
    example: 'curl -X DELETE http://localhost:10001/cows/123',
  },
  '/alerts': {
    method: 'GET',
    description: 'Get all generated alerts from MQTT sensor data',
    example: 'curl http://localhost:10001/alerts',
  },
  '/analytics/summary': {
    method: 'GET',
    description: 'Get basic summary analytics about cows and alerts',
    example: 'curl http://localhost:10001/analytics/summary',
  },
  '/external/weather': {
    method: 'GET',
    description: 'Fetch external weather data (requires API key setup)',
    example: 'curl http://localhost:10001/external/weather?location=Terceira',
  },
  '/docs': {
    method: 'GET',
    description: 'API documentation with endpoints, descriptions, and examples',
    example: 'curl http://localhost:10001/docs',
  }
};

app.get('/docs', (req, res) => {
  res.json(apiDocs);
});

// --- Start server ---
app.listen(port, '0.0.0.0')
  .on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Please free the port or use another.`);
      process.exit(1);
    }
    console.error('Server error:', err);
  })
  .on('listening', () => {
    console.log(`🚀 Server listening on http://0.0.0.0:${port}`);
  }).on('message', async (topic, message) => {
  if (topic.startsWith('cows/')) {
    try {
      const msgStr = message.toString();
      const payload = JSON.parse(msgStr);

      if (Array.isArray(payload)) {
        payload.forEach(async (cow) => {
          if (cow.temperature && (cow.temperature > 39 || cow.temperature < 36)) {
            const alert = {
              cow_id: cow.deviceId,
              name: cow.name,
              type: 'temperature',
              value: cow.temperature,
              message: `Abnormal temperature detected for ${cow.name}: ${cow.temperature}°C`,
              location: cow.location,
              latitude: cow.latitude,
              longitude: cow.longitude,
              timestamp: new Date().toISOString()
            };

            const { error } = await supabase.from('alerts').insert(alert);
            if (error) {
              console.error('❌ Error inserting alert:', error.message);
            } else {
              console.log('🚨 Alert saved to Supabase:', alert);
            }
          }
        });
      }
    } catch (err) {
      console.error('❌ Failed to parse MQTT message:', err.message);
    }
  }
async function publishCowList() {
  const { data: allCows, error } = await supabase.from('cows').select('*');
  if (!error) {
    mqttClient.publish('cows/all', JSON.stringify(allCows));
  } else {
    console.error('Failed to fetch all cows for MQTT publish:', error.message);
  }
}

}


);