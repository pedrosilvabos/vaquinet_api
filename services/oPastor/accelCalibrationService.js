import { opastorDb as supabase } from '../../config/supabase.js';

const MAX_SAMPLES_PER_CHUNK = 1000;
const DEFAULT_DIAGNOSTICS_LIMIT = 20;
const MAX_DIAGNOSTICS_LIMIT = 100;
const LARGE_SAMPLE_GAP_MS = 2000;

function requiredString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function optionalString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asNullableNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDiagnosticsLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DIAGNOSTICS_LIMIT;
  return Math.min(parsed, MAX_DIAGNOSTICS_LIMIT);
}

function validateBatch(body) {
  const sessionKey = requiredString(body?.session_key);
  const nodeId = requiredString(body?.node_id);
  const chunk = body?.chunk;
  const samples = chunk?.payload?.samples;

  if (!sessionKey) return 'session_key is required';
  if (!nodeId) return 'node_id is required';
  if (!chunk || typeof chunk !== 'object') return 'chunk is required';
  if (!Array.isArray(samples)) return 'chunk.payload.samples must be an array';
  if (samples.length === 0) return 'chunk.payload.samples must not be empty';
  if (samples.length > MAX_SAMPLES_PER_CHUNK) {
    return `chunk.payload.samples exceeds max ${MAX_SAMPLES_PER_CHUNK}`;
  }

  return null;
}

async function findOrCreateSession(body) {
  const sessionKey = requiredString(body.session_key);

  const existing = await supabase
    .from('accel_calibration_sessions')
    .select('id')
    .eq('session_key', sessionKey)
    .maybeSingle();

  if (existing.error) throw existing.error;
  if (existing.data?.id) return existing.data.id;

  const inserted = await supabase
    .from('accel_calibration_sessions')
    .insert([
      {
        session_key: sessionKey,
        node_id: requiredString(body.node_id),
        base_id: optionalString(body.base_id),
        sample_hz: asNullableNumber(body.sample_hz),
        frame_samples: asNullableNumber(body.frame_samples),
        firmware_version: optionalString(body.firmware_version),
        label: optionalString(body.label),
        notes: optionalString(body.notes),
      },
    ])
    .select('id')
    .single();

  if (inserted.error) throw inserted.error;
  return inserted.data.id;
}

function columnIndex(columns, name) {
  const index = Array.isArray(columns) ? columns.indexOf(name) : -1;
  return index >= 0 ? index : null;
}

function sampleValue(sample, indexes, name) {
  const index = indexes[name];
  if (index === null || index === undefined || !Array.isArray(sample)) return null;
  return asNullableNumber(sample[index]);
}

function expandSamples(payload) {
  const samples = Array.isArray(payload?.samples) ? payload.samples : [];
  const columns = Array.isArray(payload?.columns) ? payload.columns : [];
  const indexes = {
    base_ms: columnIndex(columns, 'base_ms'),
    node_ms: columnIndex(columns, 'node_ms'),
    seq: columnIndex(columns, 'seq'),
    idx: columnIndex(columns, 'idx'),
    x: columnIndex(columns, 'x'),
    y: columnIndex(columns, 'y'),
    z: columnIndex(columns, 'z'),
    battery_mv: columnIndex(columns, 'battery_mv'),
    rssi: columnIndex(columns, 'rssi'),
    snr: columnIndex(columns, 'snr'),
  };

  return samples.map((sample, originalOrder) => ({
    originalOrder,
    base_ms: sampleValue(sample, indexes, 'base_ms'),
    node_ms: sampleValue(sample, indexes, 'node_ms'),
    seq: sampleValue(sample, indexes, 'seq'),
    idx: sampleValue(sample, indexes, 'idx'),
    x: sampleValue(sample, indexes, 'x'),
    y: sampleValue(sample, indexes, 'y'),
    z: sampleValue(sample, indexes, 'z'),
    battery_mv: sampleValue(sample, indexes, 'battery_mv'),
    rssi: sampleValue(sample, indexes, 'rssi'),
    snr: sampleValue(sample, indexes, 'snr'),
  }));
}

function compareNullableNumber(a, b) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

function sortSamplesInsideChunk(samples) {
  return [...samples].sort((a, b) => (
    compareNullableNumber(a.node_ms, b.node_ms)
    || compareNullableNumber(a.seq, b.seq)
    || compareNullableNumber(a.idx, b.idx)
    || a.originalOrder - b.originalOrder
  ));
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (valid.length === 0) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function roundNullable(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function latestNumber(samples, field) {
  for (let i = samples.length - 1; i >= 0; i -= 1) {
    const value = samples[i]?.[field];
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function classifyMotion(avgDelta, maxDelta, validDeltaCount) {
  if (validDeltaCount < 3 || !Number.isFinite(avgDelta) || !Number.isFinite(maxDelta)) {
    return 'INSUFFICIENT_DATA';
  }
  if (avgDelta < 100 && maxDelta < 250) return 'STILL';
  if (avgDelta < 180 && maxDelta < 500) return 'LOW_MOVE';
  if (avgDelta < 450) return 'MOVE';
  if (avgDelta < 900) return 'STRONG_MOVE';
  return 'VERY_STRONG_MOVE';
}

function analyzeChunk(row) {
  const expanded = expandSamples(row.payload);
  const ordered = sortSamplesInsideChunk(expanded);
  const seqValues = new Set();
  const deltas = [];
  const gaps = [];
  let hasSeqReset = false;
  let prev = null;
  let minNodeMs = null;
  let maxNodeMs = null;
  let minSeq = null;
  let maxSeq = null;

  for (const sample of ordered) {
    if (Number.isFinite(sample.node_ms)) {
      minNodeMs = minNodeMs === null ? sample.node_ms : Math.min(minNodeMs, sample.node_ms);
      maxNodeMs = maxNodeMs === null ? sample.node_ms : Math.max(maxNodeMs, sample.node_ms);
    }
    if (Number.isFinite(sample.seq)) {
      seqValues.add(sample.seq);
      minSeq = minSeq === null ? sample.seq : Math.min(minSeq, sample.seq);
      maxSeq = maxSeq === null ? sample.seq : Math.max(maxSeq, sample.seq);
    }

    if (prev) {
      if (Number.isFinite(sample.seq) && Number.isFinite(prev.seq) && sample.seq < prev.seq) {
        hasSeqReset = true;
      }

      if (Number.isFinite(sample.node_ms) && Number.isFinite(prev.node_ms)) {
        const gap = sample.node_ms - prev.node_ms;
        gaps.push(gap);

        const hasAxes = [sample.x, sample.y, sample.z, prev.x, prev.y, prev.z].every(Number.isFinite);
        if (hasAxes && gap >= 0 && gap <= LARGE_SAMPLE_GAP_MS) {
          deltas.push(Math.abs(sample.x - prev.x) + Math.abs(sample.y - prev.y) + Math.abs(sample.z - prev.z));
        }
      }
    }

    prev = sample;
  }

  const avgDelta = average(deltas);
  const maxDelta = deltas.length > 0 ? Math.max(...deltas) : null;
  const maxGapMs = gaps.length > 0 ? Math.max(...gaps) : null;
  const avgRssi = average(ordered.map((sample) => sample.rssi));
  const avgSnr = average(ordered.map((sample) => sample.snr));
  const batteryMv = latestNumber(ordered, 'battery_mv');

  return {
    chunk_id: row.id,
    created_at: row.created_at,
    motion_class: classifyMotion(avgDelta, maxDelta, deltas.length),
    samples: ordered.length,
    frames: seqValues.size,
    avg_delta: roundNullable(avgDelta, 2),
    max_delta: roundNullable(maxDelta, 2),
    avg_rssi: roundNullable(avgRssi, 2),
    avg_snr: roundNullable(avgSnr, 2),
    battery_mv: Number.isFinite(batteryMv) ? Math.round(batteryMv) : null,
    max_gap_ms: Number.isFinite(maxGapMs) ? Math.round(maxGapMs) : null,
    has_node_time_overlap: false,
    has_seq_reset: hasSeqReset,
    has_large_gap: Number.isFinite(maxGapMs) && maxGapMs > LARGE_SAMPLE_GAP_MS,
    _node_ms_min: minNodeMs,
    _node_ms_max: maxNodeMs,
    _seq_min: minSeq,
    _seq_max: maxSeq,
  };
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  if (![aStart, aEnd, bStart, bEnd].every(Number.isFinite)) return false;
  return aStart <= bEnd && bStart <= aEnd;
}

function createdAtClearlyDifferent(a, b) {
  const aTime = Date.parse(a);
  const bTime = Date.parse(b);
  if (!Number.isFinite(aTime) || !Number.isFinite(bTime)) return a !== b;
  return Math.abs(aTime - bTime) > 1000;
}

function seqRangesClearlyDifferent(a, b) {
  if (![a._seq_min, a._seq_max, b._seq_min, b._seq_max].every(Number.isFinite)) return false;
  return a._seq_max < b._seq_min || b._seq_max < a._seq_min;
}

function markOverlapsAndBuildWarnings(windows) {
  const warnings = new Set();
  if (windows.length === 0) warnings.add('EMPTY_DATA');

  for (const window of windows) {
    if (window.has_large_gap) warnings.add('LARGE_SAMPLE_GAP');
    if (window.has_seq_reset) warnings.add('SEQ_RESET');
  }

  for (let i = 0; i < windows.length; i += 1) {
    for (let j = i + 1; j < windows.length; j += 1) {
      const a = windows[i];
      const b = windows[j];
      if (rangesOverlap(a._node_ms_min, a._node_ms_max, b._node_ms_min, b._node_ms_max)) {
        a.has_node_time_overlap = true;
        b.has_node_time_overlap = true;
        warnings.add('NODE_TIME_OVERLAP');

        if (createdAtClearlyDifferent(a.created_at, b.created_at) || seqRangesClearlyDifferent(a, b)) {
          warnings.add('MIXED_CAPTURE_SUSPECTED');
        }
      }
    }
  }

  return [...warnings];
}

function statusFromLastSeen(lastSeenAt) {
  if (!lastSeenAt) return 'NONE';
  const ageMs = Date.now() - Date.parse(lastSeenAt);
  if (!Number.isFinite(ageMs)) return 'NONE';
  if (ageMs < 30_000) return 'ACTIVE';
  if (ageMs <= 120_000) return 'STALE';
  return 'OFFLINE';
}

function publicWindow(window) {
  const {
    _node_ms_min,
    _node_ms_max,
    _seq_min,
    _seq_max,
    ...publicFields
  } = window;
  return publicFields;
}

const accelCalibrationService = {
  async getAccelerometerDiagnostics(req, res) {
    try {
      const animalId = requiredString(req.query?.animalId);
      if (!animalId) {
        return res.status(400).json({ error: 'animalId is required' });
      }

      const limit = parseDiagnosticsLimit(req.query?.limit);
      const result = await supabase
        .from('accel_calibration_chunks')
        .select('id, session_id, node_id, created_at, payload, node_ms_start, node_ms_end, seq_start, seq_end, sample_count')
        .eq('node_id', animalId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (result.error) throw result.error;

      const rows = result.data || [];
      const windows = rows.map(analyzeChunk);
      const warnings = markOverlapsAndBuildWarnings(windows);
      const lastSeenAt = windows[0]?.created_at || null;

      return res.status(200).json({
        animal_id: animalId,
        session_id: rows[0]?.session_id || null,
        last_seen_at: lastSeenAt,
        status: statusFromLastSeen(lastSeenAt),
        warnings,
        windows: windows.map(publicWindow),
      });
    } catch (err) {
      console.error('[ACC_CAL] diagnostics failed:', err.message);
      return res.status(500).json({ error: 'Failed to load accelerometer diagnostics', details: err.message });
    }
  },

  async postAccelerometerBatch(req, res) {
    try {
      const body = req.body || {};
      const validationError = validateBatch(body);
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }

      const sessionId = await findOrCreateSession(body);
      const chunk = body.chunk;
      const samples = chunk.payload.samples;

      const insertedChunk = await supabase
        .from('accel_calibration_chunks')
        .insert([
          {
            session_id: sessionId,
            node_id: requiredString(body.node_id),
            base_id: optionalString(body.base_id),
            seq_start: asNullableNumber(chunk.seq_start),
            seq_end: asNullableNumber(chunk.seq_end),
            base_ms_start: asNullableNumber(chunk.base_ms_start),
            base_ms_end: asNullableNumber(chunk.base_ms_end),
            node_ms_start: asNullableNumber(chunk.node_ms_start),
            node_ms_end: asNullableNumber(chunk.node_ms_end),
            sample_count: asNullableNumber(chunk.sample_count) ?? samples.length,
            sample_hz: asNullableNumber(chunk.sample_hz ?? body.sample_hz),
            payload: chunk.payload,
          },
        ])
        .select('id')
        .single();

      if (insertedChunk.error) throw insertedChunk.error;

      return res.status(201).json({
        ok: true,
        session_id: sessionId,
        chunk_id: insertedChunk.data.id,
        sample_count: samples.length,
      });
    } catch (err) {
      console.error('[ACC_CAL] batch insert failed:', err.message);
      return res.status(500).json({ error: 'Failed to insert accelerometer calibration chunk', details: err.message });
    }
  },
};

export default accelCalibrationService;
