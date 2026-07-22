import { opastorDb as supabase } from '../../config/supabase.js';
import { publish, TOPICS } from '../../utils/mqttService.js';
import { getDistance } from '../../utils/geoUtils.js';
import {
  buildMovementTimeline,
  movementTimelineBufferStartIso,
  SUPPORTED_MOVEMENT_TIMELINE_RANGES,
} from './movementTimelineService.js';
import {
  buildBatteryTimeline,
  SUPPORTED_BATTERY_TIMELINE_RANGES,
  timelineWindow as batteryTimelineWindow,
} from './batteryTimelineService.js';
import {
  buildCompareWindowSummary,
  classifyInactiveWindow as classifyInactiveBehaviorWindow,
  isFreshTimestamp as isFreshTelemetryTimestamp,
  parseBoundedInteger as parseBoundedIntegerValue,
} from './inactivityEvidenceUtils.js';

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
const DEFAULT_ACTIVITY_LIMIT = 20;
const MAX_ACTIVITY_LIMIT = 100;
const OFFLINE_THRESHOLD_MS = 6 * 60 * 60 * 1000;
const DEFAULT_INACTIVITY_WINDOW_MINUTES = 60;
const MIN_INACTIVITY_WINDOW_MINUTES = 15;
const MAX_INACTIVITY_WINDOW_MINUTES = 24 * 60;
const MIN_INACTIVITY_OBSERVATIONS = 3;
const DEFAULT_EXPECTED_CADENCE_MINUTES = 8;
const MAX_RECENT_BEHAVIOR_ROWS = 10000;
const DEFAULT_EVIDENCE_COMPARISON_MINUTES = 60;
const MIN_EVIDENCE_COMPARISON_MINUTES = 15;
const MAX_EVIDENCE_COMPARISON_MINUTES = 12 * 60;
const DEFAULT_EVIDENCE_BASELINE_HOURS = 24;
const MIN_EVIDENCE_BASELINE_HOURS = 6;
const MAX_EVIDENCE_BASELINE_HOURS = 24 * 7;

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

function parseActivityLimit(rawLimit) {
  const parsed = Number.parseInt(rawLimit, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_ACTIVITY_LIMIT;
  return Math.min(parsed, MAX_ACTIVITY_LIMIT);
}

function includeGpsFix(rawIncludeGps) {
  return rawIncludeGps === 'true' || rawIncludeGps === '1';
}

function deriveActivityItems(event, options = {}) {
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
    if (options.includeGps) {
      items.push(activityItem('gps', 'GPS fix', 'normal', createdAt));
    }
  } else if (gpsWasReported(data)) {
    items.push(activityItem('gps', 'GPS unavailable', 'attention', createdAt));
  }

  return items;
}

function parseBoundedInteger(value, { min, max, defaultValue }) {
  if (value == null || value === '') {
    return { ok: true, value: defaultValue };
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return {
      ok: false,
      error: 'invalid_integer',
      min,
      max,
    };
  }

  return { ok: true, value: parsed };
}

function parseIsoDate(value) {
  const parsed = new Date(String(value ?? ''));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isFreshTimestamp(date, now = new Date()) {
  return now.getTime() - date.getTime() < OFFLINE_THRESHOLD_MS;
}

function eventTimestampOf(event) {
  return parseIsoDate(event?.created_at);
}

function batteryVoltageOfEvent(event) {
  const data = eventDataOf(event);
  return asNumber(
    data.node_battery_voltage ?? data.node_battery ?? data.batteryVoltage,
  );
}

function compareNumbersAscending(a, b) {
  return a - b;
}

function median(numbers) {
  if (!Array.isArray(numbers) || numbers.length === 0) return null;
  const sorted = [...numbers].sort(compareNumbersAscending);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function average(numbers) {
  if (!Array.isArray(numbers) || numbers.length === 0) return null;
  const sum = numbers.reduce((acc, value) => acc + value, 0);
  return sum / numbers.length;
}

function roundTo(value, digits = 3) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function groupRowsByNodeId(rows) {
  const grouped = new Map();
  for (const row of rows ?? []) {
    if (!row?.node_id) continue;
    const items = grouped.get(row.node_id) || [];
    items.push(row);
    grouped.set(row.node_id, items);
  }
  return grouped;
}

function motionModeOfBehaviorRow(row) {
  return typeof row?.movement_mode === 'string' ? row.movement_mode : null;
}

function scoreAvgOfBehaviorRow(row) {
  return asNumber(row?.score_avg);
}

function intervalMinutesBetween(from, to) {
  return (to.getTime() - from.getTime()) / 60000;
}

function timelineGapsMinutes(rows) {
  const gaps = [];
  for (let index = 1; index < rows.length; index += 1) {
    const previousAt = parseIsoDate(rows[index - 1]?.created_at);
    const currentAt = parseIsoDate(rows[index]?.created_at);
    if (!previousAt || !currentAt) continue;
    gaps.push(intervalMinutesBetween(previousAt, currentAt));
  }
  return gaps;
}

function summarizeBehaviorCoverage(rows, windowStart, windowEnd) {
  const validRows = (rows ?? [])
    .map((row) => ({ row, at: parseIsoDate(row?.created_at) }))
    .filter((item) => item.at)
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  if (validRows.length === 0) {
    return {
      observation_count: 0,
      first_observation_at: null,
      latest_observation_at: null,
      expected_cadence_minutes: DEFAULT_EXPECTED_CADENCE_MINUTES,
      max_gap_minutes: null,
      largest_gap_minutes: null,
      coverage_ratio: 0,
      has_start_coverage: false,
      has_end_coverage: false,
      has_internal_gap: false,
      data_continuous: false,
      quiet_observation_count: 0,
      quiet_proportion: null,
      active_observation_count: 0,
      stationary_duration_minutes: null,
      avg_score: null,
    };
  }

  const firstAt = validRows[0].at;
  const latestAt = validRows[validRows.length - 1].at;
  const gaps = timelineGapsMinutes(validRows.map((item) => item.row));
  const expectedCadenceMinutes =
    median(gaps.filter((gap) => Number.isFinite(gap) && gap > 0)) ??
    DEFAULT_EXPECTED_CADENCE_MINUTES;
  const maxGapMinutes = Math.max(expectedCadenceMinutes * 2.5, 15);
  const windowMinutes = Math.max(1, intervalMinutesBetween(windowStart, windowEnd));
  const observedSpanMinutes = Math.max(0, intervalMinutesBetween(firstAt, latestAt));
  const coverageRatio = Math.min(1, observedSpanMinutes / windowMinutes);
  const hasStartCoverage =
    intervalMinutesBetween(windowStart, firstAt) <= maxGapMinutes;
  const hasEndCoverage =
    intervalMinutesBetween(latestAt, windowEnd) <= maxGapMinutes;
  const largestGapMinutes = gaps.length > 0 ? Math.max(...gaps) : null;
  const hasInternalGap =
    largestGapMinutes !== null && largestGapMinutes > maxGapMinutes;

  const quietObservationCount = validRows.filter(
    ({ row }) => motionModeOfBehaviorRow(row) === 'quiet',
  ).length;
  const activeObservationCount = validRows.length - quietObservationCount;
  const quietProportion = quietObservationCount / validRows.length;
  const allQuiet = quietObservationCount === validRows.length;
  const dataContinuous =
    validRows.length >= MIN_INACTIVITY_OBSERVATIONS &&
    hasStartCoverage &&
    hasEndCoverage &&
    !hasInternalGap;

  return {
    observation_count: validRows.length,
    first_observation_at: firstAt.toISOString(),
    latest_observation_at: latestAt.toISOString(),
    expected_cadence_minutes: roundTo(expectedCadenceMinutes, 2),
    max_gap_minutes: roundTo(maxGapMinutes, 2),
    largest_gap_minutes:
      largestGapMinutes !== null ? roundTo(largestGapMinutes, 2) : null,
    coverage_ratio: roundTo(coverageRatio, 3),
    has_start_coverage: hasStartCoverage,
    has_end_coverage: hasEndCoverage,
    has_internal_gap: hasInternalGap,
    data_continuous: dataContinuous,
    quiet_observation_count: quietObservationCount,
    quiet_proportion: roundTo(quietProportion, 3),
    active_observation_count: activeObservationCount,
    stationary_duration_minutes:
      dataContinuous && allQuiet ? roundTo(observedSpanMinutes, 2) : null,
    avg_score: roundTo(
      average(
        validRows
          .map(({ row }) => scoreAvgOfBehaviorRow(row))
          .filter((score) => score !== null),
      ),
      3,
    ),
  };
}

export function classifyInactiveWindow({
  latestEvent,
  behaviorRows,
  windowStart,
  windowEnd,
}) {
  const latestAt = eventTimestampOf(latestEvent);
  if (!latestAt) {
    return {
      status: 'no_telemetry',
      inactive: false,
      last_communication_at: null,
      stale_or_offline: true,
      evidence: summarizeBehaviorCoverage([], windowStart, windowEnd),
    };
  }

  if (!isFreshTimestamp(latestAt, windowEnd)) {
    return {
      status: 'stale_or_offline',
      inactive: false,
      last_communication_at: latestAt.toISOString(),
      stale_or_offline: true,
      evidence: summarizeBehaviorCoverage(behaviorRows, windowStart, windowEnd),
    };
  }

  const evidence = summarizeBehaviorCoverage(behaviorRows, windowStart, windowEnd);
  const coverageSufficient =
    evidence.observation_count >= MIN_INACTIVITY_OBSERVATIONS &&
    evidence.data_continuous;
  const allQuiet =
    evidence.observation_count > 0 &&
    evidence.quiet_observation_count === evidence.observation_count;
  const quietDurationSufficient =
    evidence.stationary_duration_minutes !== null &&
    evidence.stationary_duration_minutes >=
      intervalMinutesBetween(windowStart, windowEnd) - evidence.max_gap_minutes;

  if (!coverageSufficient) {
    return {
      status: 'insufficient_data',
      inactive: false,
      last_communication_at: latestAt.toISOString(),
      stale_or_offline: false,
      evidence,
    };
  }

  if (!allQuiet) {
    return {
      status: 'mixed_or_active',
      inactive: false,
      last_communication_at: latestAt.toISOString(),
      stale_or_offline: false,
      evidence,
    };
  }

  if (!quietDurationSufficient) {
    return {
      status: 'low_activity_not_continuous_inactivity',
      inactive: false,
      last_communication_at: latestAt.toISOString(),
      stale_or_offline: false,
      evidence,
    };
  }

  return {
    status: 'inactive',
    inactive: true,
    last_communication_at: latestAt.toISOString(),
    stale_or_offline: false,
    evidence,
  };
}

function compareWindowRows(rows, windowStart, windowEnd) {
  const coverage = summarizeBehaviorCoverage(rows, windowStart, windowEnd);
  return {
    from: windowStart.toISOString(),
    to: windowEnd.toISOString(),
    observation_count: coverage.observation_count,
    first_observation_at: coverage.first_observation_at,
    latest_observation_at: coverage.latest_observation_at,
    avg_score: coverage.avg_score,
    quiet_proportion: coverage.quiet_proportion,
    data_continuous: coverage.data_continuous,
    coverage_ratio: coverage.coverage_ratio,
    stationary_duration_minutes: coverage.stationary_duration_minutes,
  };
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
      const limit = parseActivityLimit(req.query.limit);
      const includeGps = includeGpsFix(req.query.include_gps);

      const { data, error } = await supabase
        .from('node_events')
        .select('node_id, event_type, event_data, created_at')
        .eq('node_id', id)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error(`[GET] Error fetching activity for node ${id}:`, error.message);
        return res.status(500).json({ error: 'Failed to fetch node activity', details: error.message });
      }

      const items = (data ?? []).flatMap((event) => deriveActivityItems(event, { includeGps }));
      return res.status(200).json({ node_id: id, items });
    } catch (err) {
      console.error(`[GET] Unexpected error fetching node activity for ${id}:`, err.message);
      return res.status(500).json({ error: 'Internal server error', details: err.message });
    }
  },

  async getNodeMovementTimelineById(req, res) {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'Missing node ID in request parameters' });
    }

    try {
      const range = typeof req.query.range === 'string' && req.query.range.trim()
        ? req.query.range.trim()
        : '1h';
      const bufferStartIso = movementTimelineBufferStartIso(range);

      if (!bufferStartIso) {
        return res.status(400).json({
          ok: false,
          error: 'unsupported_range',
          supported_ranges: SUPPORTED_MOVEMENT_TIMELINE_RANGES,
        });
      }

      const rangeEndIso = new Date().toISOString();
      const { data, error } = await supabase
        .from('node_events')
        .select('id,node_id,event_data,created_at')
        .eq('node_id', id)
        .gte('created_at', bufferStartIso)
        .lte('created_at', rangeEndIso)
        .order('created_at', { ascending: true });

      if (error) {
        console.error(`[GET] Error fetching movement timeline for node ${id}:`, error.message);
        return res.status(500).json({ error: 'Failed to fetch node movement timeline', details: error.message });
      }

      const timeline = buildMovementTimeline(data ?? [], range, new Date(rangeEndIso));
      return res.status(200).json({
        ok: true,
        node_id: id,
        range: timeline.range,
        interval_s: timeline.interval_s,
        intervals_s: timeline.intervals_s,
        items: timeline.items,
        meta: timeline.meta,
      });
    } catch (err) {
      console.error(`[GET] Unexpected error fetching movement timeline for ${id}:`, err.message);
      return res.status(500).json({ error: 'Internal server error', details: err.message });
    }
  },

  async getNodeBatteryTimelineById(req, res) {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'Missing node ID in request parameters' });
    }

    try {
      const range = typeof req.query.range === 'string' && req.query.range.trim()
        ? req.query.range.trim()
        : '24h';
      const window = batteryTimelineWindow(range);

      if (!window.ok) {
        return res.status(400).json({
          ok: false,
          error: 'unsupported_range',
          supported_ranges: SUPPORTED_BATTERY_TIMELINE_RANGES,
        });
      }

      const { data, error } = await supabase
        .from('node_events')
        .select('id,node_id,event_data,created_at')
        .eq('node_id', id)
        .gte('created_at', window.rangeStart.toISOString())
        .lte('created_at', window.rangeEnd.toISOString())
        .order('created_at', { ascending: true });

      if (error) {
        console.error(`[GET] Error fetching battery timeline for node ${id}:`, error.message);
        return res.status(500).json({ error: 'Failed to fetch node battery timeline', details: error.message });
      }

      const timeline = buildBatteryTimeline(data ?? [], range, window.rangeEnd);
      return res.status(200).json({
        ok: true,
        node_id: id,
        range: timeline.range,
        items: timeline.items,
        meta: timeline.meta,
      });
    } catch (err) {
      console.error(`[GET] Unexpected error fetching battery timeline for ${id}:`, err.message);
      return res.status(500).json({ error: 'Internal server error', details: err.message });
    }
  },

  async getInactiveNodes(req, res) {
    const parsedMinutes = parseBoundedIntegerValue(req.query.minutes, {
      min: MIN_INACTIVITY_WINDOW_MINUTES,
      max: MAX_INACTIVITY_WINDOW_MINUTES,
      defaultValue: DEFAULT_INACTIVITY_WINDOW_MINUTES,
    });

    if (!parsedMinutes.ok) {
      return res.status(400).json({
        error: 'invalid_minutes',
        min_minutes: MIN_INACTIVITY_WINDOW_MINUTES,
        max_minutes: MAX_INACTIVITY_WINDOW_MINUTES,
      });
    }

    const now = new Date();
    const windowEnd = now;
    const windowStart = new Date(
      now.getTime() - parsedMinutes.value * 60 * 1000,
    );

    try {
      const [nodesResult, latestEventsResult, behaviorResult] = await Promise.all([
        supabase.from('nodes').select('id,name,tag_id'),
        supabase
          .from('latest_node_events')
          .select('node_id,created_at,event_data')
          .limit(1000),
        supabase
          .from('behavior_features')
          .select(
            'node_id,created_at,movement_mode,score_avg,quiet_ratio,active_ratio',
          )
          .gte('created_at', windowStart.toISOString())
          .lte('created_at', windowEnd.toISOString())
          .order('created_at', { ascending: true })
          .limit(MAX_RECENT_BEHAVIOR_ROWS),
      ]);

      if (nodesResult.error) throw nodesResult.error;
      if (latestEventsResult.error) throw latestEventsResult.error;
      if (behaviorResult.error) throw behaviorResult.error;

      const latestByNodeId = new Map(
        (latestEventsResult.data ?? []).map((event) => [event.node_id, event]),
      );
      const behaviorByNodeId = groupRowsByNodeId(behaviorResult.data);

      const items = [];

      for (const node of nodesResult.data ?? []) {
        const latestEvent = latestByNodeId.get(node.id) ?? null;
        const classification = classifyInactiveBehaviorWindow({
          latestEvent,
          behaviorRows: behaviorByNodeId.get(node.id) ?? [],
          windowStart,
          windowEnd,
        });

        if (!classification.inactive) {
          continue;
        }

        items.push({
          node_id: node.id,
          name: node.name ?? null,
          tag_id: node.tag_id ?? null,
          classification: classification.status,
          requested_window_minutes: parsedMinutes.value,
          last_communication_at: classification.last_communication_at,
          stale_or_offline: classification.stale_or_offline,
          latest_battery_voltage: batteryVoltageOfEvent(latestEvent),
          evidence: classification.evidence,
        });
      }

      return res.status(200).json({
        ok: true,
        evaluated_at: windowEnd.toISOString(),
        requested_window_minutes: parsedMinutes.value,
        items,
      });
    } catch (err) {
      console.error('[GET] Error fetching inactive nodes:', err.message);
      return res.status(500).json({
        error: 'Failed to fetch inactive nodes',
        details: err.message,
      });
    }
  },

  async getNodeAnomalyEvidenceById(req, res) {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'Missing node ID in request parameters' });
    }

    const parsedComparisonMinutes = parseBoundedIntegerValue(
      req.query.comparison_minutes,
      {
        min: MIN_EVIDENCE_COMPARISON_MINUTES,
        max: MAX_EVIDENCE_COMPARISON_MINUTES,
        defaultValue: DEFAULT_EVIDENCE_COMPARISON_MINUTES,
      },
    );
    if (!parsedComparisonMinutes.ok) {
      return res.status(400).json({
        error: 'invalid_comparison_minutes',
        min_minutes: MIN_EVIDENCE_COMPARISON_MINUTES,
        max_minutes: MAX_EVIDENCE_COMPARISON_MINUTES,
      });
    }

    const parsedBaselineHours = parseBoundedIntegerValue(req.query.baseline_hours, {
      min: MIN_EVIDENCE_BASELINE_HOURS,
      max: MAX_EVIDENCE_BASELINE_HOURS,
      defaultValue: DEFAULT_EVIDENCE_BASELINE_HOURS,
    });
    if (!parsedBaselineHours.ok) {
      return res.status(400).json({
        error: 'invalid_baseline_hours',
        min_hours: MIN_EVIDENCE_BASELINE_HOURS,
        max_hours: MAX_EVIDENCE_BASELINE_HOURS,
      });
    }

    const now = new Date();
    const comparisonWindowEnd = now;
    const comparisonWindowStart = new Date(
      now.getTime() - parsedComparisonMinutes.value * 60 * 1000,
    );
    const baselineWindowEnd = comparisonWindowStart;
    const baselineWindowStart = new Date(
      baselineWindowEnd.getTime() - parsedBaselineHours.value * 60 * 60 * 1000,
    );

    try {
      const [latestEventResult, recentRowsResult, baselineRowsResult] =
        await Promise.all([
          supabase
            .from('latest_node_events')
            .select('node_id,created_at,event_data')
            .eq('node_id', id)
            .maybeSingle(),
          supabase
            .from('behavior_features')
            .select('node_id,created_at,movement_mode,score_avg')
            .eq('node_id', id)
            .gte('created_at', comparisonWindowStart.toISOString())
            .lte('created_at', comparisonWindowEnd.toISOString())
            .order('created_at', { ascending: true })
            .limit(1000),
          supabase
            .from('behavior_features')
            .select('node_id,created_at,movement_mode,score_avg')
            .eq('node_id', id)
            .gte('created_at', baselineWindowStart.toISOString())
            .lt('created_at', baselineWindowEnd.toISOString())
            .order('created_at', { ascending: true })
            .limit(5000),
        ]);

      if (latestEventResult.error) throw latestEventResult.error;
      if (recentRowsResult.error) throw recentRowsResult.error;
      if (baselineRowsResult.error) throw baselineRowsResult.error;

      const latestEvent = latestEventResult.data ?? null;
      const recentRows = recentRowsResult.data ?? [];
      const baselineRows = baselineRowsResult.data ?? [];
      const recentSummary = buildCompareWindowSummary(
        recentRows,
        comparisonWindowStart,
        comparisonWindowEnd,
      );
      const baselineSummary = buildCompareWindowSummary(
        baselineRows,
        baselineWindowStart,
        baselineWindowEnd,
      );
      const recentMeasure = recentSummary.avg_score;
      const baselineMeasure = baselineSummary.avg_score;
      const deviationAbsolute =
        recentMeasure !== null && baselineMeasure !== null
          ? roundTo(recentMeasure - baselineMeasure, 3)
          : null;
      const deviationPercent =
        recentMeasure !== null &&
        baselineMeasure !== null &&
        baselineMeasure > 0
          ? roundTo(((recentMeasure - baselineMeasure) / baselineMeasure) * 100, 2)
          : null;
      const dataSufficient =
        recentSummary.observation_count >= MIN_INACTIVITY_OBSERVATIONS &&
        baselineSummary.observation_count >= 6 &&
        recentSummary.data_continuous &&
        baselineSummary.observation_count > 0;

      return res.status(200).json({
        ok: true,
        node_id: id,
        comparison_window: recentSummary,
        baseline_window: baselineSummary,
        recent_activity_measure: recentMeasure,
        baseline_activity_measure: baselineMeasure,
        deviation_absolute: deviationAbsolute,
        deviation_percent: deviationPercent,
        stationary_duration_minutes: recentSummary.stationary_duration_minutes,
        data_sufficient: dataSufficient,
        insufficient_data_reason: dataSufficient
          ? null
          : 'insufficient_behavior_history',
        last_communication_at:
          latestEvent?.created_at ? new Date(latestEvent.created_at).toISOString() : null,
        stale_or_offline: latestEvent?.created_at
          ? !isFreshTelemetryTimestamp(new Date(latestEvent.created_at), comparisonWindowEnd)
          : true,
      });
    } catch (err) {
      console.error(`[GET] Error fetching anomaly evidence for node ${id}:`, err.message);
      return res.status(500).json({
        error: 'Failed to fetch anomaly evidence',
        details: err.message,
      });
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
