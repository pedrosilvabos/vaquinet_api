import { getOpastorServiceDb } from '../../config/supabase.js';

const TABLE = 'base_collar_registry';
const MAX_DELTA_ROWS = 128;

function baseIdOf(req) {
  return String(req.params.baseId ?? '').trim();
}

function collarIdOf(value) {
  return String(value ?? '').trim().toUpperCase();
}

function parseSince(value) {
  if (value === undefined || value === null || value === '') return 0;
  if (!/^\d+$/.test(String(value))) return null;
  return Number(value);
}

function publicRow(row) {
  return {
    collar_id: row.collar_id,
    cow_id: row.cow_id,
    slot: Number(row.slot),
    active: row.active === true,
    revision: Number(row.revision),
  };
}

function slotOf(value) {
  if (value === undefined || value === null || value === '') return null;
  if (!/^\d+$/.test(String(value))) return undefined;
  const slot = Number(value);
  return Number.isInteger(slot) && slot >= 0 && slot <= 31 ? slot : undefined;
}

async function currentRevision(baseId) {
  const { data, error } = await getOpastorServiceDb()
    .from(TABLE)
    .select('revision')
    .eq('base_id', baseId)
    .order('revision', { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0]?.revision ? Number(data[0].revision) : 0;
}

async function rowsFor(baseId, since) {
  let query = getOpastorServiceDb()
    .from(TABLE)
    .select('collar_id,cow_id,slot,active,revision')
    .eq('base_id', baseId)
    .order('revision', { ascending: true });
  if (since > 0) query = query.gt('revision', since).limit(MAX_DELTA_ROWS + 1);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getRegistry(req, res) {
  const baseId = baseIdOf(req);
  const since = parseSince(req.query.since_revision);
  if (!baseId) return res.status(400).json({ error: 'base_id_required' });
  if (since === null) return res.status(400).json({ error: 'invalid_since_revision' });

  try {
    const revision = await currentRevision(baseId);
    const requested = await rowsFor(baseId, since);
    // A truncated delta is intentionally replaced by a complete snapshot.
    const needsSnapshot = since === 0 || requested.length > MAX_DELTA_ROWS;
    const rows = needsSnapshot ? await rowsFor(baseId, 0) : requested;
    return res.json({
      base_id: baseId,
      current_revision: revision,
      mode: needsSnapshot ? 'snapshot' : 'delta',
      records: rows.map(publicRow),
    });
  } catch (error) {
    console.error('[COLLAR_REGISTRY] get failed', error);
    return res.status(500).json({ error: 'registry_read_failed' });
  }
}

// Minimal protected provisioning surface; no farmer UI is introduced in Phase 1.
export async function putRegistryEntry(req, res) {
  const baseId = baseIdOf(req);
  const collarId = collarIdOf(req.body?.collar_id);
  const cowId = String(req.body?.cow_id ?? '').trim();
  const slot = slotOf(req.body?.slot);
  const active = req.body?.active !== false;
  if (!baseId || !/^[0-9A-F]{12}$/.test(collarId) || !cowId) {
    return res.status(400).json({ error: 'base_id_collar_id_and_cow_id_required' });
  }
  if (slot === undefined) {
    return res.status(400).json({ error: 'slot_must_be_an_integer_between_0_and_31' });
  }

  try {
    const { data, error } = await getOpastorServiceDb().rpc('upsert_base_collar_registry_entry', {
      p_base_id: baseId,
      p_collar_id: collarId,
      p_cow_id: cowId,
      p_active: active,
      p_slot: slot,
    });
    if (error) throw error;
    return res.status(200).json({ record: publicRow(data?.[0] ?? {}) });
  } catch (error) {
    console.error('[COLLAR_REGISTRY] write failed', error);
    return res.status(409).json({ error: 'registry_write_rejected', detail: error.message });
  }
}

// Kept deliberately small so the request boundary can be exercised without a
// live Supabase instance. Database revision ordering is covered by the SQL RPC.
export const __test = { collarIdOf, parseSince, publicRow, slotOf };
