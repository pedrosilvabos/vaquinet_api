import { opastorDb as supabase } from '../../config/supabase.js';
import { publish, TOPICS } from '../../utils/mqttService.js';
import { getDistance } from '../../utils/geoUtils.js';

export async function publishNodeList() {
  const { data, error } = await supabase.from('nodes').select('*');
  if (error) {
    console.error('❌ [opastor] Failed to fetch nodes:', error.message);
    return;
  }

  publish(TOPICS.ALL, data);
}

// Read-only activity derivation from existing node_events.event_data.
// Thresholds are intentionally simple field-test assumptions, not schema changes.
const LOW_BATTERY_VOLTAGE = 3.6;
const ACTIVITY_EVENT_LIMIT = 50;

function eventDataOf(event) {
  return event?.event_data && typeof event.event_data === 'object' ? event.event_data : {};
}

function asNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function hasValidGps(data) {
  const lat = asNumber(data.latitude ?? data.node_latitude ?? data.lat);
  const lon = asNumber(data.longitude ?? data.node_longitude ?? data.lon ?? data.lng);
  return lat !== null && lon !== null && lat !== 0 && lon !== 0;
}

function gpsWasReported(data) {
  return Object.prototype.hasOwnProperty.call(data, 'latitude') ||
    Object.prototype.hasOwnProperty.call(data, 'longitude') ||
    Object.prototype.hasOwnProperty.call(data, 'node_latitude') ||
    Object.prototype.hasOwnProperty.call(data, 'node_longitude') ||
    Object.prototype.hasOwnProperty.call(data, 'lat') ||
    Object.prototype.hasOwnProperty.call(data, 'lon') ||
    Object.prototype.hasOwnProperty.call(data, 'lng');
}

function activityItem(type, label, severity, createdAt) {
  return { type, label, severity, created_at: createdAt };
}

function motionActivity(data, createdAt) {
  const motionState = asNumber(data.motion_state);
  switch (motionState) {
    case 0:
      return activityItem('motion', 'Resting / low movement', 'normal', createdAt);
    case 1:
      return activityItem('motion', 'Walking', 'normal', createdAt);
    case 2:
      return activityItem('motion', 'Grazing', 'normal', createdAt);
    case 3:
      return activityItem('motion', 'Restless / high activity', 'attention', createdAt);
    default:
      return null;
  }
}

function deriveActivityItems(event) {
  const data = eventDataOf(event);
  const createdAt = event.created_at;
  const items = [];

  if (data.isAlerted === true || data.is_alerted === true || data.alertType || data.alert_type) {
    items.push(activityItem('alert', 'Alert', 'alert', createdAt));
  }

  const batteryVoltage = asNumber(data.node_battery_voltage ?? data.node_battery ?? data.batteryVoltage);
  if (batteryVoltage !== null && batteryVoltage > 0 && batteryVoltage < LOW_BATTERY_VOLTAGE) {
    items.push(activityItem('battery', 'Low battery', 'attention', createdAt));
  }

  const motion = motionActivity(data, createdAt);
  if (motion) items.push(motion);

  if (hasValidGps(data)) {
    items.push(activityItem('gps', 'GPS fix', 'normal', createdAt));
  } else if (gpsWasReported(data)) {
    items.push(activityItem('gps', 'GPS unavailable', 'attention', createdAt));
  }

  return items;
}

const nodeService = {
  async getAllNodes(req, res) {
    console.log("[GET] Fetching all nodes");
    try {
      const { data, error } = await supabase.from('nodes').select('*');
      if (error) throw error;
      res.json(data);
    } catch (err) {
      console.error("[GET] Error fetching nodes:", err.message);
      res.status(500).json({ error: 'Failed to fetch nodes', details: err.message });
    }
  },

  async getNodeById(req, res) {
    const { id } = req.params;
    try {
      const { data, error } = await supabase.from('nodes').select('*').eq('id', id).single();
      if (error) throw error;
      publish(TOPICS.DETAILS, data);
      res.json(data);
    } catch (err) {
      console.warn(`[GET] Node not found: ${id}`, err.message);
      res.status(404).json({ error: 'Node not found', details: err.message });
    }
  },

  async createNode(req, res) {
    const cleanNode = {
      id: req.body.id,
      name: req.body.name,
      tag_id: req.body.tag_id || null,
      birth_date: req.body.birth_date || null,
      breed: req.body.breed || null
    };
    console.log("[POST] Creating node:", cleanNode);
    try {
      const { data, error } = await supabase.from('nodes').insert([cleanNode]).select().single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (err) {
      console.error("[POST] Node creation failed:", err.message);
      res.status(400).json({ error: err.message });
    }
  },

  async updateNode(req, res) {
    const { id } = req.params;
    const cleanUpdate = {
      name: req.body.name,
      tag_id: req.body.tag_id || null,
      birth_date: req.body.birth_date || null,
      breed: req.body.breed || null
    };
    try {
      const { data, error } = await supabase.from('nodes').update(cleanUpdate).eq('id', id).select().single();
      if (error) throw error;
      publish(TOPICS.UPDATE, data);
      await publishNodeList();
      res.json(data);
    } catch (err) {
      console.error(`[PUT] Error updating node ${id}:`, err.message);
      res.status(400).json({ error: err.message });
    }
  },

  async deleteNode(req, res) {
    const { id } = req.params;
    try {
      const { error } = await supabase.from('nodes').delete().eq('id', id);
      if (error) throw error;
      publish(TOPICS.DELETE, { id });
      await publishNodeList();
      res.status(204).send();
    } catch (err) {
      console.error(`[DELETE] Failed to remove node ${id}:`, err.message);
      res.status(400).json({ error: err.message });
    }
  },

async getLatestNodeEventById(req, res) {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: 'Missing node ID in request parameters' });
  }

  try {
    const { data, error } = await supabase
      .from('latest_node_events')
      .select('*')
      .eq('node_id', id)
      .single(); // ensures only one row is returned

    if (error) {
      console.error(`[GET] Error fetching latest event for node ${id}:`, error.message);
      return res.status(500).json({ error: 'Failed to fetch latest node event', details: error.message });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error(`[GET] Unexpected error fetching latest node event for ${id}:`, err.message);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
},


  async getNodeEventsById(req, res) {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'Missing node ID in request parameters' });
    }

    try {
      const { data, error } = await supabase
        .from('node_events')
        .select('*')
        .eq('node_id', id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error(`[GET] Error fetching events for node ${id}:`, error.message);
        return res.status(500).json({ error: 'Failed to fetch node events', details: error.message });
      }

      return res.status(200).json(data);
    } catch (err) {
      console.error(`[GET] Unexpected error fetching node events for ${id}:`, err.message);
      return res.status(500).json({ error: 'Internal server error', details: err.message });
    }
  },

  async getNodeActivityById(req, res) {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'Missing node ID in request parameters' });
    }

    try {
      const { data, error } = await supabase
        .from('node_events')
        .select('node_id, event_type, event_data, created_at')
        .eq('node_id', id)
        .order('created_at', { ascending: false })
        .limit(ACTIVITY_EVENT_LIMIT);

      if (error) {
        console.error(`[GET] Error fetching activity for node ${id}:`, error.message);
        return res.status(500).json({ error: 'Failed to fetch node activity', details: error.message });
      }

      const items = (data ?? []).flatMap(deriveActivityItems);
      return res.status(200).json({ node_id: id, items });
    } catch (err) {
      console.error(`[GET] Unexpected error fetching node activity for ${id}:`, err.message);
      return res.status(500).json({ error: 'Internal server error', details: err.message });
    }
  },


  async batchInsertNodes(req, res) {
    const { data } = req.body;
    if (!Array.isArray(data)) {
      return res.status(400).json({ error: 'Missing or invalid data array' });
    }

    const sanitized = data.map((node, index) => ({
      id: node.id || `node_${index}`,
      name: node.name || `Unnamed-${index}`,
      tag_id: node.tag_id || null,
      birth_date: node.birth_date || null,
      breed: node.breed || null
    }));

    try {
      const { error } = await supabase.from('nodes').insert(sanitized);
      if (error) throw error;
      res.status(201).json({ message: 'Batch insert successful', count: sanitized.length });
    } catch (err) {
      console.error('[BATCH] Insert failed:', err.message);
      res.status(500).json({ error: 'Batch insert failed', details: err.message });
    }
  },

  async getNodeById(req, res) {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'Missing node ID in request parameters' });
    }

    try {
      const { data, error } = await supabase
        .from('nodes')
        .select('*')
        .eq('id', id)
        .single();

      if (error || !data) {
        console.warn(`[GET] Node not found or error for ID: ${id}`, error?.message);
        return res.status(404).json({ error: 'Node not found', details: error?.message });
      }
     publish(TOPICS.DETAILS, data);
      return res.status(200).json(data);
    } catch (err) {
      console.error(`[GET] Unexpected error fetching node by ID ${id}:`, err.message);
      return res.status(500).json({ error: 'Internal server error', details: err.message });
    }
  },


  async processSensorData(req, res) {
    const payload = req.body;
    if (!Array.isArray(payload)) {
      return res.status(400).json({ error: 'Expected an array of node objects' });
    }

    const results = [];

    for (const node of payload) {
      const nodeId = node.id;
      if (!node || !nodeId) {
        console.warn("[SENSOR] Skipping invalid node:", node);
        continue;
      }

      try {
        const { data: exists } = await supabase.from('nodes').select('id').eq('id', nodeId).maybeSingle();
        if (!exists) {
          await supabase.from('nodes').insert([{ id: nodeId, name: node.name || 'Unnamed' }]);
        }

        const { data: lastEvent } = await supabase
          .from('node_events')
          .select('*')
          .eq('node_id', nodeId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const moved = node.latitude && node.longitude && lastEvent?.event_data?.latitude
          ? getDistance(node.latitude, node.longitude, lastEvent.event_data.latitude, lastEvent.event_data.longitude) > 10
          : false;

        const abnormalTemp = node.temperature > 39 || node.temperature < 36;
        const changes = [];
        if (abnormalTemp) changes.push('temperature');
        if (moved) changes.push('location');

        await supabase.from('node_events').insert([{
          node_id: nodeId,
          base_id: node.base_id || null,
          event_type: changes[0] || 'telemetry',
          event_data: {
            temperature: node.temperature,
            latitude: node.latitude,
            longitude: node.longitude,
            node_battery_voltage: node.batteryVoltage,
            node_vbus: node.vbus ?? null,
            base_battery: node.baseBatteryVoltage,
            base_battery_percent: node.baseBatteryPercent,
            node_temperature: node.event_data.temperature
          }
        }]);

        results.push({ nodeId, status: 'ok' });
      } catch (err) {
        console.error(`[SENSOR] Error with node ${nodeId}:`, err.message);
        results.push({ nodeId, status: 'error', error: err.message });
      }
    }

    res.status(200).json({ message: 'Sensor data processed', results });
  }
};

export default nodeService;
