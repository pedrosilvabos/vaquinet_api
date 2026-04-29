import { opastorDb as supabase } from '../../config/supabase.js';

function isValidLatLng(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    !(lat === 0 && lng === 0) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function resolveLastPosition(event) {
  const eventData = event?.event_data || {};
  const lat = Number(eventData.latitude);
  const lng = Number(eventData.longitude);

  if (!isValidLatLng(lat, lng)) {
    return { last_lat: null, last_lng: null };
  }

  return { last_lat: lat, last_lng: lng };
}

function normalizeBaseStatus(row) {
  const statusData = row?.status_data || {};

  return {
    base_id: row.base_id,
    status_type: row.status_type,
    status_data: {
      ...statusData,
      backhaul_name: statusData.backhaul_name ?? statusData.operator_name ?? null,
      backhaul_signal_percent:
        statusData.backhaul_signal_percent ?? statusData.signal_percent ?? null,
    },
    created_at: row.created_at,
  };
}

function latestByBaseId(rows) {
  const byBase = new Map();

  for (const row of rows || []) {
    if (!row?.base_id || byBase.has(row.base_id)) continue;
    byBase.set(row.base_id, normalizeBaseStatus(row));
  }

  return [...byBase.values()];
}

const farmService = {
  async getOverview(_req, res) {
    try {
      const [nodesResult, latestEventsResult, baseStatusResult] = await Promise.all([
        supabase
          .from('nodes')
          .select('id,name,tag_id,birth_date,breed,status,created_at')
          .order('created_at', { ascending: true }),
        supabase
          .from('latest_node_events')
          .select('id,node_id,base_id,event_type,event_data,created_at'),
        supabase
          .from('base_status')
          .select('base_id,status_type,status_data,created_at')
          .order('created_at', { ascending: false })
          .limit(1000),
      ]);

      if (nodesResult.error) throw nodesResult.error;
      if (latestEventsResult.error) throw latestEventsResult.error;
      if (baseStatusResult.error) throw baseStatusResult.error;

      const latestByNodeId = new Map(
        (latestEventsResult.data || []).map((event) => [event.node_id, event]),
      );

      const nodes = (nodesResult.data || []).map((node) => {
        const latestEvent = latestByNodeId.get(node.id) || null;
        const { last_lat, last_lng } = resolveLastPosition(latestEvent);

        return {
          id: node.id,
          name: node.name,
          tag_id: node.tag_id,
          birth_date: node.birth_date,
          breed: node.breed,
          status: node.status,
          created_at: node.created_at,
          latest_event: latestEvent,
          last_lat,
          last_lng,
        };
      });

      res.json({
        nodes,
        bases: latestByBaseId(baseStatusResult.data),
      });
    } catch (err) {
      console.error('[GET] Farm overview failed:', err.message);
      res.status(500).json({ error: 'Failed to fetch farm overview', details: err.message });
    }
  },
};

export default farmService;
