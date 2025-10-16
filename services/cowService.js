import supabase from '../utils/supabaseClient.js';
import { publish, publishCowList, TOPICS } from './mqttService.js';
import { getDistance } from '../utils/geoUtils.js';

const cowService = {
  async getAllCows(req, res) {
    console.log("[GET] Fetching all cows");
    try {
      const { data, error } = await supabase.from('cows').select('*');
      if (error) throw error;
      res.json(data);
    } catch (err) {
      console.error("[GET] Error fetching cows:", err.message);
      res.status(500).json({ error: 'Failed to fetch cows', details: err.message });
    }
  },

  async getCowById(req, res) {
    const { id } = req.params;
    try {
      const { data, error } = await supabase.from('cows').select('*').eq('id', id).single();
      if (error) throw error;
      publish(TOPICS.DETAILS, data);
      res.json(data);
    } catch (err) {
      console.warn(`[GET] Cow not found: ${id}`, err.message);
      res.status(404).json({ error: 'Cow not found', details: err.message });
    }
  },

  async createCow(req, res) {
    const cleanCow = {
      id: req.body.id,
      name: req.body.name,
      tag_id: req.body.tag_id || null,
      birth_date: req.body.birth_date || null,
      breed: req.body.breed || null
    };
    console.log("[POST] Creating cow:", cleanCow);
    try {
      const { data, error } = await supabase.from('cows').insert([cleanCow]).select().single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (err) {
      console.error("[POST] Cow creation failed:", err.message);
      res.status(400).json({ error: err.message });
    }
  },

  async updateCow(req, res) {
    const { id } = req.params;
    const cleanUpdate = {
      name: req.body.name,
      tag_id: req.body.tag_id || null,
      birth_date: req.body.birth_date || null,
      breed: req.body.breed || null
    };
    try {
      const { data, error } = await supabase.from('cows').update(cleanUpdate).eq('id', id).select().single();
      if (error) throw error;
      publish(TOPICS.UPDATE, data);
      await publishCowList();
      res.json(data);
    } catch (err) {
      console.error(`[PUT] Error updating cow ${id}:`, err.message);
      res.status(400).json({ error: err.message });
    }
  },

  async deleteCow(req, res) {
    const { id } = req.params;
    try {
      const { error } = await supabase.from('cows').delete().eq('id', id);
      if (error) throw error;
      publish(TOPICS.DELETE, { id });
      await publishCowList();
      res.status(204).send();
    } catch (err) {
      console.error(`[DELETE] Failed to remove cow ${id}:`, err.message);
      res.status(400).json({ error: err.message });
    }
  },

async getLatestCowEventById(req, res) {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: 'Missing cow ID in request parameters' });
  }

  try {
    const { data, error } = await supabase
      .from('latest_cow_events')
      .select('*')
      .eq('cow_id', id)
      .single(); // ensures only one row is returned

    if (error) {
      console.error(`[GET] Error fetching latest event for cow ${id}:`, error.message);
      return res.status(500).json({ error: 'Failed to fetch latest cow event', details: error.message });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error(`[GET] Unexpected error fetching latest cow event for ${id}:`, err.message);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
},


  async getCowEventsById(req, res) {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'Missing cow ID in request parameters' });
    }

    try {
      const { data, error } = await supabase
        .from('cow_events')
        .select('*')
        .eq('cow_id', id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error(`[GET] Error fetching events for cow ${id}:`, error.message);
        return res.status(500).json({ error: 'Failed to fetch cow events', details: error.message });
      }

      return res.status(200).json(data);
    } catch (err) {
      console.error(`[GET] Unexpected error fetching cow events for ${id}:`, err.message);
      return res.status(500).json({ error: 'Internal server error', details: err.message });
    }
  },


  async batchInsertCows(req, res) {
    const { data } = req.body;
    if (!Array.isArray(data)) {
      return res.status(400).json({ error: 'Missing or invalid data array' });
    }

    const sanitized = data.map((cow, index) => ({
      id: cow.id || `cow_${index}`,
      name: cow.name || `Unnamed-${index}`,
      tag_id: cow.tag_id || null,
      birth_date: cow.birth_date || null,
      breed: cow.breed || null
    }));

    try {
      const { error } = await supabase.from('cows').insert(sanitized);
      if (error) throw error;
      res.status(201).json({ message: 'Batch insert successful', count: sanitized.length });
    } catch (err) {
      console.error('[BATCH] Insert failed:', err.message);
      res.status(500).json({ error: 'Batch insert failed', details: err.message });
    }
  },

  async getCowById(req, res) {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'Missing cow ID in request parameters' });
    }

    try {
      const { data, error } = await supabase
        .from('cows')
        .select('*')
        .eq('id', id)
        .single();

      if (error || !data) {
        console.warn(`[GET] Cow not found or error for ID: ${id}`, error?.message);
        return res.status(404).json({ error: 'Cow not found', details: error?.message });
      }
     publish(TOPICS.DETAILS, data);
      return res.status(200).json(data);
    } catch (err) {
      console.error(`[GET] Unexpected error fetching cow by ID ${id}:`, err.message);
      return res.status(500).json({ error: 'Internal server error', details: err.message });
    }
  },


  async processSensorData(req, res) {
    const payload = req.body;
    if (!Array.isArray(payload)) {
      return res.status(400).json({ error: 'Expected an array of cow objects' });
    }

    const results = [];

    for (const cow of payload) {
      const cowId = cow.id;
      if (!cow || !cowId) {
        console.warn("[SENSOR] Skipping invalid cow:", cow);
        continue;
      }

      try {
        const { data: exists } = await supabase.from('cows').select('id').eq('id', cowId).maybeSingle();
        if (!exists) {
          await supabase.from('cows').insert([{ id: cowId, name: cow.name || 'Unnamed' }]);
        }

        const { data: lastEvent } = await supabase
          .from('cow_events')
          .select('*')
          .eq('cow_id', cowId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const moved = cow.latitude && cow.longitude && lastEvent?.event_data?.latitude
          ? getDistance(cow.latitude, cow.longitude, lastEvent.event_data.latitude, lastEvent.event_data.longitude) > 10
          : false;

        const abnormalTemp = cow.temperature > 39 || cow.temperature < 36;
        const changes = [];
        if (abnormalTemp) changes.push('temperature');
        if (moved) changes.push('location');

        await supabase.from('cow_events').insert([{
          cow_id: cowId,
          base_id: cow.base_id || null,
          event_type: changes[0] || 'telemetry',
          event_data: {
            temperature: cow.temperature,
            latitude: cow.latitude,
            longitude: cow.longitude,
            node_battery: cow.batteryVoltage,
            node_battery_percent: cow.batteryPercent,
            base_battery: cow.baseBatteryVoltage,
            base_battery_percent: cow.baseBatteryPercent,
            node_temperature: cow.event_data.temperature
          }
        }]);

        results.push({ cowId, status: 'ok' });
      } catch (err) {
        console.error(`[SENSOR] Error with cow ${cowId}:`, err.message);
        results.push({ cowId, status: 'error', error: err.message });
      }
    }

    res.status(200).json({ message: 'Sensor data processed', results });
  }
};

export default cowService;
