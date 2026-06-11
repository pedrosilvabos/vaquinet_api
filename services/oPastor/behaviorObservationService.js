import { randomUUID } from 'crypto';
import { opastorDb as supabase } from '../../config/supabase.js';

const TABLE = 'behavior_observations';
const OBSERVATION_SOURCE = 'manual_app';
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const SUPPORTED_LABELS = [
  'grazing',
  'walking',
  'lying_down',
  'standing_still',
  'disturbed',
  'collar_handled',
  'unknown',
];

function parseLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function optionalNotes(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isSupportedLabel(label) {
  return typeof label === 'string' && SUPPORTED_LABELS.includes(label.trim());
}

function invalidLabel(res) {
  return res.status(400).json({
    ok: false,
    error: 'invalid_label',
    supported_labels: SUPPORTED_LABELS,
  });
}

async function getActiveObservationForNode(nodeId) {
  const result = await supabase
    .from(TABLE)
    .select('*')
    .eq('node_id', nodeId)
    .is('ended_at', null)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (result.error) throw result.error;
  return result.data;
}

async function createObservation(nodeId, label, notes) {
  const nowIso = new Date().toISOString();
  const result = await supabase
    .from(TABLE)
    .insert([
      {
        id: randomUUID(),
        node_id: nodeId,
        animal_id: null,
        label,
        started_at: nowIso,
        ended_at: null,
        source: OBSERVATION_SOURCE,
        notes,
        created_at: nowIso,
        updated_at: nowIso,
      },
    ])
    .select('*')
    .single();

  if (result.error) throw result.error;
  return result.data;
}

async function closeObservation(observationId, endedAtIso) {
  const result = await supabase
    .from(TABLE)
    .update({
      ended_at: endedAtIso,
      updated_at: endedAtIso,
    })
    .eq('id', observationId)
    .select('*')
    .single();

  if (result.error) throw result.error;
  return result.data;
}

async function deleteObservation(observationId) {
  const result = await supabase
    .from(TABLE)
    .delete()
    .eq('id', observationId)
    .select('*')
    .single();

  if (result.error) throw result.error;
  return result.data;
}

const behaviorObservationService = {
  async listObservations(req, res) {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ ok: false, error: 'missing_node_id' });
    }

    try {
      const limit = parseLimit(req.query.limit);
      const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .eq('node_id', id)
        .order('started_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return res.status(200).json({
        ok: true,
        node_id: id,
        items: data ?? [],
      });
    } catch (err) {
      console.error(`[BEHAVIOR_OBS] list failed for node ${id}:`, err.message);
      return res.status(500).json({ ok: false, error: 'failed_to_list_observations', details: err.message });
    }
  },

  async getActiveObservation(req, res) {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ ok: false, error: 'missing_node_id' });
    }

    try {
      const observation = await getActiveObservationForNode(id);
      return res.status(200).json({
        ok: true,
        node_id: id,
        observation: observation ?? null,
      });
    } catch (err) {
      console.error(`[BEHAVIOR_OBS] active fetch failed for node ${id}:`, err.message);
      return res.status(500).json({ ok: false, error: 'failed_to_get_active_observation', details: err.message });
    }
  },

  async startObservation(req, res) {
    const { id } = req.params;
    const label = typeof req.body?.label === 'string' ? req.body.label.trim() : null;
    const notes = optionalNotes(req.body?.notes);

    if (!isSupportedLabel(label)) {
      return invalidLabel(res);
    }

    try {
      const activeObservation = await getActiveObservationForNode(id);

      if (activeObservation?.label === label) {
        return res.status(200).json({
          ok: true,
          status: 'already_active',
          observation: activeObservation,
        });
      }

      if (activeObservation) {
        return res.status(409).json({
          ok: false,
          error: 'active_observation_exists',
          active_observation: activeObservation,
        });
      }

      const observation = await createObservation(id, label, notes);
      return res.status(200).json({
        ok: true,
        status: 'started',
        observation,
      });
    } catch (err) {
      console.error(`[BEHAVIOR_OBS] start failed for node ${id}:`, err.message);
      return res.status(500).json({ ok: false, error: 'failed_to_start_observation', details: err.message });
    }
  },

  async switchObservation(req, res) {
    const { id } = req.params;
    const label = typeof req.body?.label === 'string' ? req.body.label.trim() : null;
    const notes = optionalNotes(req.body?.notes);

    if (!isSupportedLabel(label)) {
      return invalidLabel(res);
    }

    try {
      const activeObservation = await getActiveObservationForNode(id);

      if (activeObservation?.label === label) {
        return res.status(200).json({
          ok: true,
          status: 'already_active',
          closed_observation: null,
          observation: activeObservation,
        });
      }

      let closedObservation = null;
      if (activeObservation) {
        const nowIso = new Date().toISOString();
        closedObservation = await closeObservation(activeObservation.id, nowIso);
      }

      const observation = await createObservation(id, label, notes);
      return res.status(200).json({
        ok: true,
        status: 'started',
        closed_observation: closedObservation,
        observation,
      });
    } catch (err) {
      console.error(`[BEHAVIOR_OBS] switch failed for node ${id}:`, err.message);
      return res.status(500).json({ ok: false, error: 'failed_to_switch_observation', details: err.message });
    }
  },

  async stopObservation(req, res) {
    const { id } = req.params;

    try {
      const activeObservation = await getActiveObservationForNode(id);
      if (!activeObservation) {
        return res.status(200).json({
          ok: false,
          error: 'no_active_observation',
        });
      }

      const endedAtIso = new Date().toISOString();
      const observation = await closeObservation(activeObservation.id, endedAtIso);
      return res.status(200).json({
        ok: true,
        status: 'stopped',
        observation,
      });
    } catch (err) {
      console.error(`[BEHAVIOR_OBS] stop failed for node ${id}:`, err.message);
      return res.status(500).json({ ok: false, error: 'failed_to_stop_observation', details: err.message });
    }
  },

  async cancelObservation(req, res) {
    const { id } = req.params;

    try {
      const activeObservation = await getActiveObservationForNode(id);
      if (!activeObservation) {
        return res.status(200).json({
          ok: false,
          error: 'no_active_observation',
        });
      }

      const observation = await deleteObservation(activeObservation.id);
      return res.status(200).json({
        ok: true,
        status: 'cancelled',
        observation,
      });
    } catch (err) {
      console.error(`[BEHAVIOR_OBS] cancel failed for node ${id}:`, err.message);
      return res.status(500).json({ ok: false, error: 'failed_to_cancel_observation', details: err.message });
    }
  },
};

export default behaviorObservationService;
