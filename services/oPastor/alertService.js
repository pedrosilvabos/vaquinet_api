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
