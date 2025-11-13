// utils/mqttService.js
import mqtt from 'mqtt';
import dotenv from 'dotenv';

dotenv.config();

const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL;

if (!MQTT_BROKER_URL) {
  throw new Error('❌ Missing MQTT_BROKER_URL in .env');
}

const MQTT_OPTIONS = {
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD,
  protocol: 'mqtts',
  port: 8883,
  reconnectPeriod: 5000,   // Retry every 5s if disconnected
  connectTimeout: 10_000,  // 10s timeout for DNS/connect
};

export const TOPICS = {
  SENSOR: 'nodes/sensors',
  UPDATE: 'nodes/update',
  DELETE: 'nodes/delete',
  NEW: 'nodes/new',
  ALL: 'nodes/all',
  DETAILS: 'nodes/details',
  TELEMETRY: 'nodes/telemetry',
};

export const client = mqtt.connect(MQTT_BROKER_URL, MQTT_OPTIONS);

// MQTT lifecycle
client.on('connect', () => {
  console.log('✅ MQTT connected');
  client.subscribe('nodes/#', (err) => {
    if (err) console.error('❌ Subscription error:', err.message);
    else console.log('📡 Subscribed to nodes/#');
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

// Publish (no DB, no JSON assumptions)
export function publish(topic, payload, options = { qos: 1 }) {
  if (!client.connected) {
    console.warn('⚠️ MQTT not connected. Dropping publish to:', topic);
    return;
  }

  const message = typeof payload === 'string' ? payload : JSON.stringify(payload);
  console.log(`[MQTT ➜] ${topic}: ${message}`);

  client.publish(topic, message, options, (err) => {
    if (err) {
      console.error(`❌ MQTT publish to ${topic} failed:`, err.message);
    }
  });
}

// Subscribe handler – give raw message to caller
export function onMessage(callback) {
  client.on('message', (topic, message) => {
    // caller decides if/when to JSON.parse
    callback(topic, message);
  });
}
