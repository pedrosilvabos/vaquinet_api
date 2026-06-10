import { opastorDb as supabase } from '../../../config/supabase.js';
import { decodeMotionWindowScores } from './motionWindowDecoder.js';
import { extractMotionFeatures } from './motionFeatureExtractor.js';

const FEATURE_VERSION = 'phase1_v1';
const DUPLICATE_KEY_CODE = '23505';

function eventDataOf(nodeEvent) {
  return nodeEvent?.event_data && typeof nodeEvent.event_data === 'object'
    ? nodeEvent.event_data
    : {};
}

function motionWindowOf(nodeEvent) {
  const motionWindow = eventDataOf(nodeEvent).motion_window;
  if (!motionWindow || typeof motionWindow !== 'object' || Array.isArray(motionWindow)) {
    return null;
  }
  return motionWindow;
}

function nullableInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function scoreRangeOf(features) {
  if (features.score_min === null || features.score_max === null) return null;
  return features.score_max - features.score_min;
}

function scoreStddevOf(features) {
  if (!Number.isFinite(features.variance)) return null;
  return Math.sqrt(features.variance);
}

function behaviorCandidatesOf(features) {
  return {
    inactivity_candidate: features.movement_mode === 'quiet',
    abnormal_activity_candidate: features.movement_mode === 'disturbed',
  };
}

function featureRowOf(nodeEvent, motionWindow, features) {
  return {
    node_event_id: String(nodeEvent.id),
    node_id: nodeEvent.node_id ?? null,
    base_id: nodeEvent.base_id ?? null,
    feature_version: FEATURE_VERSION,
    sample_count: features.score_count,
    valid_count: nullableInteger(motionWindow.valid),
    sample_quality: features.sample_quality,
    count_mismatch: features.count_mismatch,
    score_min: features.score_min,
    score_max: features.score_max,
    score_avg: features.score_avg,
    score_range: scoreRangeOf(features),
    score_stddev: scoreStddevOf(features),
    quiet_ratio: features.stillness_ratio,
    active_ratio: features.activity_ratio,
    spike_count: features.spike_count,
    movement_mode: features.movement_mode,
    ...behaviorCandidatesOf(features),
  };
}

function skipped(reason, extra = {}) {
  return {
    ok: true,
    status: 'skipped',
    reason,
    feature_version: FEATURE_VERSION,
    ...extra,
  };
}

export async function analyzeNodeEvent(nodeEvent) {
  try {
    if (!nodeEvent?.id) {
      return skipped('missing_node_event_id');
    }

    const motionWindow = motionWindowOf(nodeEvent);
    if (!motionWindow) {
      return skipped('missing_motion_window', {
        node_event_id: String(nodeEvent.id),
      });
    }

    const decoded = decodeMotionWindowScores(motionWindow);
    const features = extractMotionFeatures(motionWindow);
    const row = featureRowOf(nodeEvent, motionWindow, features);

    const { data, error } = await supabase
      .from('behavior_features')
      .insert([row])
      .select('id')
      .single();

    if (error) {
      if (error.code === DUPLICATE_KEY_CODE) {
        return {
          ok: true,
          status: 'already_exists',
          node_event_id: row.node_event_id,
          feature_version: FEATURE_VERSION,
        };
      }

      return {
        ok: false,
        status: 'error',
        node_event_id: row.node_event_id,
        feature_version: FEATURE_VERSION,
        error: error.message,
      };
    }

    return {
      ok: true,
      status: 'inserted',
      id: data?.id ?? null,
      node_event_id: row.node_event_id,
      feature_version: FEATURE_VERSION,
      sample_quality: decoded.sampleQuality,
      movement_mode: features.movement_mode,
    };
  } catch (error) {
    return {
      ok: false,
      status: 'error',
      feature_version: FEATURE_VERSION,
      error: error?.message || String(error),
    };
  }
}

export default analyzeNodeEvent;
