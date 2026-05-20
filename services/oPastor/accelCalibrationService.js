import { opastorDb as supabase } from '../../config/supabase.js';

const MAX_SAMPLES_PER_CHUNK = 1000;

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

const accelCalibrationService = {
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
