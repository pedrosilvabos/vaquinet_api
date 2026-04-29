import { opastorDb as supabase } from '../../config/supabase.js';

// Status derivation thresholds. Keep these conservative: they are API-side
// presentation hints, not persisted animal health diagnoses.
const OFFLINE_THRESHOLD_MS = 6 * 60 * 60 * 1000; // latest telemetry older than 6h => Offline.
const RECENT_BEHAVIOR_WINDOW_MS = 3 * 60 * 60 * 1000; // bulk behavior window used for all nodes.
const LOW_BATTERY_VOLTAGE = 3.6; // below this is field-actionable attention.
const RESTLESS_REPEAT_THRESHOLD = 2; // motion_state 3 repeated 2+ times => Atenção.
const STILL_REPEAT_THRESHOLD = 6; // repeated stillness in recent window => Atenção.
const RECENT_EVENTS_BULK_LIMIT = 5000; // safety cap; avoids per-node queries.

const DERIVED_STATUS = {
  normal: { label: 'Normal', severity: 'normal', reason: null },
  attention: (reason) => ({ label: 'Atenção', severity: 'attention', reason }),
  alert: (reason) => ({ label: 'Alerta', severity: 'alert', reason }),
  offline: (reason) => ({ label: 'Offline', severity: 'offline', reason }),
};

function asNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes'].includes(normalized)) return true;
    if (['false', '0', 'no'].includes(normalized)) return false;
  }
  return null;
}

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

function eventDataOf(event) {
  return event?.event_data && typeof event.event_data === 'object' ? event.event_data : {};
}

function hasExplicitAlert(event) {
  const data = eventDataOf(event);
  const isAlerted = asBoolean(data.isAlerted ?? data.is_alerted);
  if (isAlerted === true) return true;

  const alertType = (data.alertType ?? data.alert_type)?.toString().trim().toLowerCase();
  return Boolean(alertType && !['none', 'normal', 'false', '0'].includes(alertType));
}

function gpsExpected(event) {
  const data = eventDataOf(event);
  const flags = asNumber(data.telemetry_flags ?? data.telemetry_mode);
  return flags !== null && (flags & 1) === 1;
}

function hasValidGps(event) {
  const data = eventDataOf(event);
  return isValidLatLng(asNumber(data.latitude), asNumber(data.longitude));
}

function batteryVoltage(event) {
  const data = eventDataOf(event);
  return asNumber(data.node_battery_voltage ?? data.node_battery ?? data.batteryVoltage);
}

function motionState(event) {
  return asNumber(eventDataOf(event).motion_state);
}

function groupEventsByNodeId(events) {
  const grouped = new Map();
  for (const event of events || []) {
    if (!event?.node_id) continue;
    const current = grouped.get(event.node_id) || [];
    current.push(event);
    grouped.set(event.node_id, current);
  }
  return grouped;
}

function deriveNodeStatus(latestEvent, recentEvents) {
  if (!latestEvent) {
    return DERIVED_STATUS.offline('No telemetry received');
  }

  const latestAt = Date.parse(latestEvent.created_at);
  if (!Number.isFinite(latestAt) || Date.now() - latestAt >= OFFLINE_THRESHOLD_MS) {
    return DERIVED_STATUS.offline('Latest telemetry is stale');
  }

  if (hasExplicitAlert(latestEvent) || recentEvents.some(hasExplicitAlert)) {
    return DERIVED_STATUS.alert('Explicit alert flag in recent telemetry');
  }

  const voltage = batteryVoltage(latestEvent);
  if (voltage !== null && voltage > 0 && voltage < LOW_BATTERY_VOLTAGE) {
    return DERIVED_STATUS.attention(`Low battery (${voltage.toFixed(2)}V)`);
  }

  if (gpsExpected(latestEvent) && !hasValidGps(latestEvent)) {
    return DERIVED_STATUS.attention('GPS expected but latest fix is invalid');
  }

  const motionStates = recentEvents.map(motionState).filter((state) => state !== null);
  const restlessCount = motionStates.filter((state) => state === 3).length;
  if (restlessCount >= RESTLESS_REPEAT_THRESHOLD) {
    return DERIVED_STATUS.attention('Repeated restless/high activity');
  }

  const stillCount = motionStates.filter((state) => state === 0).length;
  if (stillCount >= STILL_REPEAT_THRESHOLD) {
    return DERIVED_STATUS.attention('Repeated stillness in recent window');
  }

  return DERIVED_STATUS.normal;
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
      const recentWindowStart = new Date(Date.now() - RECENT_BEHAVIOR_WINDOW_MS).toISOString();

      const [nodesResult, latestEventsResult, baseStatusResult, recentEventsResult] = await Promise.all([
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
        supabase
          .from('node_events')
          .select('node_id,event_data,created_at')
          .gte('created_at', recentWindowStart)
          .order('created_at', { ascending: false })
          .limit(RECENT_EVENTS_BULK_LIMIT),
      ]);

      if (nodesResult.error) throw nodesResult.error;
      if (latestEventsResult.error) throw latestEventsResult.error;
      if (baseStatusResult.error) throw baseStatusResult.error;
      if (recentEventsResult.error) throw recentEventsResult.error;

      const latestByNodeId = new Map(
        (latestEventsResult.data || []).map((event) => [event.node_id, event]),
      );
      const recentByNodeId = groupEventsByNodeId(recentEventsResult.data);

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
          derived_status: deriveNodeStatus(latestEvent, recentByNodeId.get(node.id) || []),
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
