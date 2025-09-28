import supabase from '../utils/supabaseClient.js';
import { publish, TOPICS } from './mqttService.js';

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

function getAlertLabel(type) {
  return AlertTypes[type] || 'UNKNOWN_ALERT';
}

export async function batchTelemetry(req, res) {
  const { data } = req.body;

  if (!Array.isArray(data)) {
    return res.status(400).json({ error: 'Invalid payload: expected array in `data`' });
  }

  const results = [];

  for (const cow of data) {
    const cowId = cow.cow_id;
    const baseId = cow.base_id || null;
    const eventType = cow.event_type || 'telemetry';
    const eventData = cow.event_data;

    if (!cowId) {
      results.push({ status: 'skipped', reason: 'missing cow_id' });
      continue;
    }

    if (!eventData || typeof eventData !== 'object') {
      results.push({ cowId, status: 'skipped', reason: 'invalid or missing event_data' });
      continue;
    }

    try {
      // ⚙️ 1. Update or insert cow metadata
      const cleanUpdate = {
        name: cow.name ?? null,
        tag_id: cow.tag_id ?? null,
        birth_date: cow.birth_date ?? null,
        breed: cow.breed ?? null,
      };

      const { data: existingCow, error: fetchError } = await supabase
        .from('cows')
        .select('id')
        .eq('id', cowId)
        .maybeSingle();

      if (fetchError) throw fetchError;

      if (existingCow) {
        const { error: updateError } = await supabase
          .from('cows')
          .update(cleanUpdate)
          .eq('id', cowId);

        if (updateError) {
          console.warn(`⚠️ Failed to update cow ${cowId}:`, updateError.message);
        }
      } else {
        const insertCow = {
          id: cowId,
          ...cleanUpdate,
        };

        const { error: insertError } = await supabase
          .from('cows')
          .insert([insertCow]);

        if (insertError) {
          console.warn(`⚠️ Failed to insert cow ${cowId}:`, insertError.message);
        }
      }
        console.warn(`⚠️ eventData: `, eventData);
   // 📦 2. Insert telemetry event
    const eventPayload = {
      cow_id: cowId,
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
        operatorName: eventData.operatorName ?? null,
        ratName: eventData.ratName ?? null,
        signalPercent: eventData.signalPercent ?? null,
      },
    };


      console.log(`📦 Inserting event for ${cowId}:`, eventPayload);

      const { data: insertedEvents, error: eventError } = await supabase
        .from('cow_events')
        .insert([eventPayload])
        .select('id')
        .single();

      if (eventError) {
        results.push({ cowId, status: 'error', error: eventError.message });
        continue;
      }
      console.log('telemtry!')
      publish(TOPICS.TELEMETRY, data);
      // 🚨 3. Insert alert if triggered
      if (eventPayload.event_data.isAlerted && eventPayload.event_data.alertType != null) {
        const typeId = eventPayload.event_data.alertType;
        const alertPayload = {
          cow_id: cowId,
          base_id: baseId,
          type: typeId,
          source_event_id: insertedEvents.id,
          latitude: eventData.latitude,
          longitude: eventData.longitude,
          node_battery: eventData.node_battery_percent,
          temperature: eventData.temperature,
        };

        console.log(`🚨 Alert triggered [${typeId} - ${getAlertLabel(typeId)}] for ${cowId}:`, alertPayload);

        // TODO: severe alerts → SMS or call via SIM7600
        const { error: alertError } = await supabase
          .from('alerts')
          .insert([alertPayload]);

        if (alertError) {
          results.push({
            cowId,
            status: 'partial',
            warning: 'Event inserted but alert failed',
            alertError: alertError.message,
          });
          continue;
        }
      }

      results.push({ cowId, status: 'ok' });

    } catch (err) {
      results.push({ cowId, status: 'error', error: err.message });
    }
  }

  return res.status(200).json({ message: 'Telemetry data processed', results });
}
