import { opastorDb as supabase } from '../../config/supabase.js';
import { publish, TOPICS } from '../../utils/mqttService.js';
import { createFenceBreachOrder } from './ordersService.js';
import { sendToTopic } from '../../fcm.js';

const AlertTypes = {
  1: 'LOW_BATTERY',
  2: 'NO_GPS_FIX',
  3: 'DEVICE_DISCONNECTED',
  4: 'CHARGING_ANOMALY',
  5: 'SENSOR_FAILURE',
  10: 'UNUSUAL_MOVEMENT',
  11: 'PROLONGED_INACTIVITY',
  12: 'GEOFENCE_BREACH',
  13: 'CALVING_DETECTED',
  14: 'AGGRESSION_EVENT',
  50: 'POSSIBLE_DEATH',
  51: 'FALL_DETECTED',
  52: 'TEMPERATURE_CRITICAL',
  53: 'VIOLENT_BEHAVIOR_ALERT',
};

const DEFAULT_FARM_ID = process.env.DEFAULT_FARM_ID || null;
const lastAlertAt = new Map(); // node_id -> ts
const ALERT_COOLDOWN_MS = 10 * 60 * 1000;

function getAlertLabel(type) {
  return AlertTypes[type] || 'UNKNOWN_ALERT';
}

function shouldNotify(nodeId) {
  const now = Date.now();
  const prev = lastAlertAt.get(nodeId) || 0;
  //if (now - prev < ALERT_COOLDOWN_MS) return false;
  lastAlertAt.set(nodeId, now);
  return true;
}

async function isInsideFence({ farmId, lat, lon }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return true; // no coords → treat as inside
  if (!farmId) return true; // require a farm scope to evaluate
  const { data, error } = await supabase
    .rpc('is_inside_fence', { p_farm_id: farmId, p_lat: lat, p_lon: lon });
  if (error) throw error;
  return Boolean(data?.some(r => r.inside === true));
}

export async function batchTelemetry(req, res) {
  const { data } = req.body;
  if (!Array.isArray(data)) {
    return res.status(400).json({ error: 'Invalid payload: expected array in `data`' });
  }

  const results = [];

  for (const node of data) {
    const nodeId = node.node_id;
    const baseId = node.base_id || null;
    const farmId = '9d97817a-4c54-4c1b-9f83-92df8fa1737a';
    const eventType = node.event_type || 'telemetry';
    const eventData = node.event_data;

    if (!nodeId) { results.push({ status: 'skipped', reason: 'missing node_id' }); continue; }
    if (!eventData || typeof eventData !== 'object') {
      results.push({ nodeId, status: 'skipped', reason: 'invalid or missing event_data' });
      continue;
    }

    try {
      // 1) upsert node metadata
 const cleanUpdate = {
   name:        node.name        ?? null,
   tag_id:      node.tag_id      ?? null,
   birth_date:  node.birth_date  ?? null,
   breed:       node.breed       ?? null,
 };
 console.log('incoming node event_data keys:', ...new Set(data.flatMap(d => Object.keys(d?.event_data || {}))));

      const { data: existingNode, error: fetchError } = await supabase
        .from('nodes').select('id').eq('id', nodeId).maybeSingle();
      if (fetchError) throw fetchError;

      if (existingNode) {
        const { error: updateError } = await supabase.from('nodes').update(cleanUpdate).eq('id', nodeId);
        if (updateError) console.warn(`⚠️ Failed to update node ${nodeId}:`, updateError.message);
      } else {
        const { error: insertError } = await supabase.from('nodes').insert([{ id: nodeId, ...cleanUpdate }]);
        if (insertError) console.warn(`⚠️ Failed to insert node ${nodeId}:`, insertError.message);
      }

      // 2) insert telemetry event
      const eventPayload = {
        node_id: nodeId,
        base_id: baseId,
        event_type: eventType,
        event_data: {
          latitude: eventData.latitude ?? null,
          longitude: eventData.longitude ?? null,
          temperature: eventData.node_temperature ?? null,
          node_battery: eventData.node_battery ?? null,
          node_battery_percent: eventData.node_battery_percent ?? null,
          base_battery: eventData.base_battery ?? null,
          base_battery_percent: eventData.base_battery_percent ?? null,
          base_latitude: eventData.base_latitude ?? null,
          base_longitude: eventData.base_longitude ?? null,
          isAlerted: !!eventData.isAlerted,
          alertType: eventData.alertType ?? 'UNKNOWN_ALERT',
          node_vbus: eventData.node_vbus ?? null,
          node_has_battery: eventData.node_has_battery ?? null,
          base_vbus: eventData.base_vbus ?? null,
          node_satCount: eventData.node_satCount ?? null,
          node_gpsFix: eventData.node_gpsFix ?? null,
          node_gpsCourse: eventData.node_gpsCourse ?? null,
          node_gpsAltitude: eventData.node_gpsAltitude ?? null,
          node_gpsCourse: eventData.node_gpsSpeed ?? null,
          operatorName: eventData.operatorName ?? null,
          ratName: eventData.ratName ?? null,
          signalPercent: eventData.signalPercent ?? null,
          lteSignalQuality: eventData.lteSignalQuality ?? null,          
          lora_rssi: eventData.lora_rssi ?? null,
          lora_snr: eventData.lora_snr ?? null,
        },
      };

      const { data: insertedEvents, error: eventError } = await supabase
        .from('node_events').insert([eventPayload]).select('id').single();
      if (eventError) { results.push({ nodeId, status: 'error', error: eventError.message }); continue; }

      publish(TOPICS.TELEMETRY, data);

      // 3) explicit alert rows
      if (eventPayload.event_data.isAlerted && eventPayload.event_data.alertType != null) {
        const typeId = eventPayload.event_data.alertType;
        const alertPayload = {
          node_id: nodeId,
          base_id: baseId,
          type: typeId,
          source_event_id: insertedEvents.id,
          latitude: eventData.latitude,
          longitude: eventData.longitude,
          node_battery: eventData.node_battery_percent,
          temperature: eventData.temperature,
        };
        const { error: alertError } = await supabase.from('alerts').insert([alertPayload]);
        if (alertError) {
          results.push({ nodeId, status: 'partial', warning: 'Event inserted but alert failed', alertError: alertError.message });
          continue;
        }
      }
// 4) geofence check → push to topic if OUTSIDE
const latRaw = eventPayload.event_data.latitude;
const lonRaw = eventPayload.event_data.longitude;
const lat = Number(latRaw);
const lon = Number(lonRaw);

// temp debug
console.log('GEOF params:', {
  latRaw, lonRaw, lat, lon, farmId,
  types: { latRaw: typeof latRaw, lonRaw: typeof lonRaw }
});

if (Number.isFinite(lat) && Number.isFinite(lon) && typeof farmId === 'string' && farmId.length === 36) {
  try {
    const inside = await isInsideFence({ farmId, lat, lon });
    if (!inside && shouldNotify(nodeId)) {
      // push notification (existing)
      await sendToTopic('alerts_all', 'oPastor Alerta', `Marta saiu do pasto!`);

      // create order (command) for fence breach
      await createFenceBreachOrder({
        nodeId,
        farmId,
        phone: '+351969773385',
      });
    }
  } catch (e) {
    console.warn('Geofence check failed:', e?.message || e);
  }
} else {
  console.warn('Geofence skipped. Bad params:', { lat, lon, farmId });
}


      results.push({ nodeId, status: 'ok' });
    } catch (err) {
      results.push({ nodeId, status: 'error', error: err.message });
    }
  }

  return res.status(200).json({
  message: 'Telemetry data processed',
  seen_event_data_keys: [...new Set(data.flatMap(d => Object.keys(d?.event_data || {})))],
  results
});
}
