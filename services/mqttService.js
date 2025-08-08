// File: services/mqttService.js
import mqtt from 'mqtt';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL;

const MQTT_OPTIONS = {
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD,
  protocol: 'mqtts',
  port: 8883,
  reconnectPeriod: 5000,  // Retry every 5s if disconnected
  connectTimeout: 10_000, // 10s timeout for DNS/connect
};

export const TOPICS = {
  SENSOR: 'cows/sensors',
  UPDATE: 'cows/update',
  DELETE: 'cows/delete',
  NEW: 'cows/new',
  ALL: 'cows/all',
  DETAILS: 'cows/details',
  TELEMETRY: 'cows/telemetry',
};

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) {
  throw new Error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env');
}
const supabase = createClient(supabaseUrl, supabaseKey);

export const client = mqtt.connect(MQTT_BROKER_URL, MQTT_OPTIONS);

// ✅ MQTT lifecycle
client.on('connect', () => {
  console.log('✅ MQTT connected');
  client.subscribe('cows/#', (err) => {
    if (err) console.error('❌ Subscription error:', err.message);
    else console.log('📡 Subscribed to cows/#');
  });
});

client.on('reconnect', () => {
  console.log('🔁 MQTT reconnecting...');
});

client.on('close', () => {
  console.warn('⚠️ MQTT connection closed');
});

client.on('offline', () => {
  console.warn('⚠️ MQTT went offline');
});

client.on('error', (err) => {
  console.error('❌ MQTT error:', err.message);
});

client.on('end', () => {
  console.warn('⚠️ MQTT client ended');
});

// ✅ Publish
export function publish(topic, payload) {
  if (!client.connected) {
    console.warn('⚠️ MQTT not connected. Dropping publish to:', topic);
    return;
  }

  const message = typeof payload === 'string' ? payload : JSON.stringify(payload);
  console.log(`[MQTT ➜] ${topic}: ${message}`);

  client.publish(topic, message, { qos: 1 }, (err) => {
    if (err) {
      console.error(`❌ MQTT publish to ${topic} failed:`, err.message);
    }
  });
}

// ✅ Subscribe handler
export function onMessage(callback) {
  client.on('message', (topic, message) => {
    try {
      const parsed = JSON.parse(message.toString());
      callback(topic, parsed);
    } catch (err) {
      console.error(`❌ Failed to parse MQTT msg on ${topic}:`, err.message);
    }
  });
}

// ✅ Push all cows to MQTT
export async function publishCowList() {
  const { data, error } = await supabase.from('cows').select('*');
  if (error) {
    console.error('❌ Failed to fetch cows:', error.message);
    return;
  }
  publish(TOPICS.ALL, data);
}
