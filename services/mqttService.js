// File: services/mqttService.js
import mqtt from 'mqtt';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const MQTT_BROKER_URL = 'mqtts://728ab5952b9d48ab9865b395f89aec0f.s1.eu.hivemq.cloud:8883';
const MQTT_OPTIONS = {
  username: 'vakinet',
  password: 'Vakinet1',
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

// ✅ Load and validate Supabase config
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) {
  throw new Error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env');
}
const supabase = createClient(supabaseUrl, supabaseKey);

// ✅ Connect to MQTT broker
export const client = mqtt.connect(MQTT_BROKER_URL, MQTT_OPTIONS);

client.on('connect', () => {
  console.log('✅ MQTT connected');
  client.subscribe('cows/#', (err) => {
    if (err) console.error('❌ MQTT subscription error:', err);
    else console.log('📡 Subscribed to cows/#');
  });
});

client.on('error', (err) => {
  console.error('❌ MQTT connection error:', err.message);
});

// ✅ Publish a message to a topic
export function publish(topic, payload) {
  if (!client.connected) {
    console.warn('⚠️ MQTT not connected. Skipping publish to', topic);
    return;
  }

  const message = typeof payload === 'string' ? payload : JSON.stringify(payload);
  client.publish(topic, message, { qos: 1 }, (err) => {
    if (err) console.error(`❌ Failed to publish to ${topic}:`, err.message);
    else console.log(`📤 Published to ${topic}`);
  });
}

// ✅ Listen for MQTT messages
export function onMessage(callback) {
  client.on('message', (topic, message) => {
    try {
      const parsed = JSON.parse(message.toString());
      callback(topic, parsed);
    } catch (err) {
      console.error(`❌ Failed to parse MQTT message on ${topic}:`, err.message);
    }
  });
}

// ✅ Publish all cows from DB to MQTT
export async function publishCowList() {
  const { data, error } = await supabase.from('cows').select('*');
  if (error) {
    console.error('❌ Failed to fetch all cows for MQTT publish:', error.message);
    return;
  }
  publish(TOPICS.ALL, data);
}
