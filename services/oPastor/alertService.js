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
    const { cow_id, base_id, type, source_event_id } = req.body;

    if (!type) {
      return res.status(400).json({ error: 'Missing required field: type' });
    }

    const payload = {
      cow_id: cow_id ?? null,
      base_id: base_id ?? null,
      type,
      source_event_id: source_event_id ?? null,
      timestamp: new Date().toISOString(),
      sent: false
    };

    const { data, error } = await supabase
      .from('alerts')
      .insert(payload)
      .select()
      .single();

    if (error) {
      console.error('[ALERTS] Supabase insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create alert' });
    }

    res.status(201).json(data);
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

