import supabase from '../utils/supabaseClient.js';

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
      // Upsert cow
      await supabase
        .from('cows')
        .upsert([{ id: cowId, name: cow.name || `ESPCOW_${cowId}` }], { onConflict: 'id' });

      // Build event payload
      const eventPayload = {
        cow_id: cowId,
        base_id: baseId,
        event_type: eventType,
        event_data: {
          latitude: eventData.latitude ?? null,
          longitude: eventData.longitude ?? null,
          temperature: eventData.temperature ?? null,
          node_battery: eventData.node_battery ?? null,
          node_battery_percent: eventData.node_battery_percent ?? null,
          base_battery: eventData.base_battery ?? null,
          base_battery_percent: eventData.base_battery_percent ?? null,
          isAlerted: !!eventData.isAlerted,
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

      // If alert, insert into cow_alerts
      if (eventPayload.event_data.isAlerted) {
        const alertPayload = {
          cow_id: cowId,
          base_id: baseId,
          type: 'generic_alert', // Extendable later
          source_event_id: insertedEvents.id,
          latitude: eventData.latitude,
          longitude: eventData.longitude,
          node_battery: eventData.node_battery_percent,
          temperature: eventData.temperature,      
        };

        console.log(`🚨 Alert triggered for ${cowId}:`, alertPayload);

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
