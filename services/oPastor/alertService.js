// File: /services/alertService.js
import { opastorDb as supabase } from '../../config/supabase.js';

export async function getAllAlerts(req, res) {
  try {
    const { data, error } = await supabase.from('alerts').select('*').order('timestamp', { ascending: false });

    if (error) {
      console.error('[ALERTS] Supabase error:', error.message);
      return res.status(500).json({ error: 'Failed to fetch alerts' });
    }

    res.json(data);
  } catch (err) {
    console.error('[ALERTS] Server error:', err.message);
    res.status(500).json({ error: 'Unexpected server error' });
  }
}

export async function createAlert(req, res) {
  try {
    const { cow_id, base_id, type, source_event_id, message } = req.body;

    if (!type) {
      return res.status(400).json({ error: 'Missing required field: type' });
    }

    // 1️⃣ Fetch latest event for this cow (if cow_id provided)
    let latestEvent = null;
    let latestEventSlim = null;

    if (cow_id) {
      const { data: evt, error: evtErr } = await supabase
        .from('latest_node_events')   // your view name
        .select('*')
        .eq('node_id', cow_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (evtErr) {
        console.error('[ALERTS] Error fetching latest event:', evtErr.message);
      } else if (evt) {
        latestEvent = evt;

        const ed = evt.event_data || {};

        // 2️⃣ Build slim latest_event with only the fields you care about
        latestEventSlim = {
          latitude: ed.latitude ?? null,
          longitude: ed.longitude ?? null,
          lora_rssi: ed.lora_rssi ?? null,
          lora_snr: ed.lora_snr ?? null,
          node_battery: ed.node_battery ?? null,
          node_gpsCourse: ed.node_gpsCourse ?? null,
          node_battery_percent: ed.node_battery_percent ?? null
        };
      }
    }

    // 3️⃣ Build payload, persisting slim latest_event as jsonb
    const payload = {
      cow_id: cow_id ?? null,
      base_id: base_id ?? null,
      message: message ?? null,
      type,
      source_event_id: source_event_id ?? null,
      timestamp: new Date().toISOString(),
      sent: false,
      latest_event: latestEventSlim  // jsonb, already an object
    };

    // 4️⃣ Insert alert
    const { data, error } = await supabase
      .from('alerts')
      .insert(payload)
      .select()
      .single();

    if (error) {
      console.error('[ALERTS] Supabase insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create alert' });
    }

    // Optional: also return the full latestEvent if you still want it in the response
    return res.status(201).json({
      alert: data,
    });
  } catch (err) {
    console.error('[ALERTS] Server error:', err.message);
    res.status(500).json({ error: 'Unexpected server error' });
  }
}




export async function markAlertSent(req, res) {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'Missing alert id' });
    }

    const { data, error } = await supabase
      .from('alerts')
      .update({ sent: true })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[ALERTS] Update error:', error.message);
      return res.status(500).json({ error: 'Failed to update alert status' });
    }

    if (!data) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    return res.json(data);

  } catch (err) {
    console.error('[ALERTS] Server error:', err.message);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

