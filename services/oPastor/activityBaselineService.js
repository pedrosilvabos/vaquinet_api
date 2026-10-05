import { getOpastorServiceDb } from '../../config/supabase.js';
import {
  farmLocalTwoHourBucket,
  getFarmTimezone,
} from './animalIdentityService.js';

export const ACTIVITY_BASELINE_VERSION = 'activity_baseline_v1';
export const ACTIVITY_BASELINE_METRIC = 'score_avg';
export const BASELINE_HISTORY_DAYS = 14;
export const BASELINE_READY_DAYS = 7;
export const BASELINE_READY_SAMPLES = 5;
export const MAX_CURRENT_AGE_MINUTES = 180;
export const MAX_PERSISTENCE_GAP_MINUTES = 180;
export const PERSISTENCE_WINDOW_MINUTES = 90;
export const ANOMALY_WINDOWS_REQUIRED = 3;
export const RECOVERY_WINDOWS_REQUIRED = 2;
export const RECOVERY_ROBUST_Z = 1.5;

const ANOMALY_THRESHOLDS = Object.freeze({
  below: -2,
  significantlyBelow: -3,
  above: 2,
  significantlyAbove: 3,
});

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function finiteScore(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isoDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function isQualityValidObservation(row) {
  return Boolean(
    row &&
      row.sample_quality === 'ok' &&
      row.count_mismatch !== true &&
      Number(row.valid_count) > 0 &&
      finiteScore(row.score_avg) !== null &&
      isoDate(row.created_at),
  );
}

export function median(values) {
  const sorted = values
    .map(Number)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function medianAbsoluteDeviation(values, center = median(values)) {
  if (!Number.isFinite(center)) return null;
  return median(values.map((value) => Math.abs(Number(value) - center)));
}

export function baselineStatistics(values) {
  const expected = median(values);
  const mad = medianAbsoluteDeviation(values, expected);
  if (!Number.isFinite(expected) || !Number.isFinite(mad)) {
    return { expected: null, mad: null, scale: null };
  }
  return {
    expected,
    mad,
    scale: Math.max(1.4826 * mad, 2),
  };
}

export function classifyRobustDeviation(robustZ) {
  if (!Number.isFinite(robustZ)) return 'unknown';
  if (robustZ <= ANOMALY_THRESHOLDS.significantlyBelow) {
    return 'significantly_below_baseline';
  }
  if (robustZ <= ANOMALY_THRESHOLDS.below) return 'below_baseline';
  if (robustZ >= ANOMALY_THRESHOLDS.significantlyAbove) {
    return 'significantly_above_baseline';
  }
  if (robustZ >= ANOMALY_THRESHOLDS.above) return 'above_baseline';
  return 'normal';
}

function isAnomalousAssessment(value) {
  return value === 'below_baseline' ||
    value === 'significantly_below_baseline' ||
    value === 'above_baseline' ||
    value === 'significantly_above_baseline';
}

function anomalyDirection(value) {
  return value?.includes('below') ? 'below' : value?.includes('above') ? 'above' : null;
}

function localDateOf(value, timezone) {
  return farmLocalTwoHourBucket(value, timezone).localDate;
}

function historyForCurrentBucket(historyRows, current, timezone) {
  const currentDate = isoDate(current.created_at);
  if (!currentDate) return [];
  const cutoff = new Date(currentDate.getTime() - BASELINE_HISTORY_DAYS * 24 * 60 * 60 * 1000);
  const currentBucket = farmLocalTwoHourBucket(currentDate, timezone).bucket;
  return historyRows.filter((row) => {
    const createdAt = isoDate(row.created_at);
    return Boolean(
      isQualityValidObservation(row) &&
      createdAt &&
      createdAt < currentDate &&
      createdAt >= cutoff &&
      farmLocalTwoHourBucket(createdAt, timezone).bucket === currentBucket,
    );
  });
}

function currentIsFresh(current, evaluatedAt) {
  const createdAt = isoDate(current?.created_at);
  const now = isoDate(evaluatedAt) ?? new Date();
  return Boolean(
    createdAt &&
      now.getTime() - createdAt.getTime() <= MAX_CURRENT_AGE_MINUTES * 60 * 1000 &&
      now.getTime() >= createdAt.getTime(),
  );
}

export function assessActivityBaseline({ current, historyRows = [], timezone, evaluatedAt }) {
  if (!timezone) {
    return {
      status: 'unknown',
      assessment: 'unknown',
      candidate_assessment: 'unknown',
      data_quality: 'timezone_unavailable',
    };
  }
  if (!isQualityValidObservation(current)) {
    return {
      status: 'insufficient_data',
      assessment: 'insufficient_data',
      candidate_assessment: null,
      data_quality: 'current_observation_invalid',
    };
  }
  if (!currentIsFresh(current, evaluatedAt)) {
    return {
      status: 'unknown',
      assessment: 'unknown',
      candidate_assessment: null,
      data_quality: 'current_observation_stale',
    };
  }

  const history = historyForCurrentBucket(historyRows, current, timezone);
  const sampleDays = new Set(
    history.map((row) => localDateOf(row.created_at, timezone)),
  );
  const currentScore = finiteScore(current.score_avg);
  const bucket = farmLocalTwoHourBucket(current.created_at, timezone);
  const common = {
    version: ACTIVITY_BASELINE_VERSION,
    metric: ACTIVITY_BASELINE_METRIC,
    current_score_avg: currentScore,
    sample_days: sampleDays.size,
    sample_count: history.length,
    time_bucket: bucket.bucket,
    timezone,
    data_quality: 'ok',
  };

  if (sampleDays.size < 3) {
    return {
      ...common,
      status: 'insufficient_data',
      assessment: 'insufficient_data',
      candidate_assessment: null,
    };
  }
  if (sampleDays.size < BASELINE_READY_DAYS || history.length < BASELINE_READY_SAMPLES) {
    return {
      ...common,
      status: 'learning',
      assessment: 'insufficient_data',
      candidate_assessment: null,
    };
  }

  const statistics = baselineStatistics(history.map((row) => Number(row.score_avg)));
  const robustZ = (currentScore - statistics.expected) / statistics.scale;
  const deviationPercent = statistics.expected >= 10
    ? (100 * (currentScore - statistics.expected)) / Math.max(statistics.expected, 10)
    : null;
  return {
    ...common,
    status: 'baseline_ready',
    assessment: classifyRobustDeviation(robustZ),
    candidate_assessment: classifyRobustDeviation(robustZ),
    expected_score_avg: statistics.expected,
    mad: statistics.mad,
    scale: statistics.scale,
    robust_z: robustZ,
    deviation_percent: deviationPercent,
    confidence: 'sufficient',
  };
}

function minutesBetween(left, right) {
  const delta = new Date(left).getTime() - new Date(right).getTime();
  return Number.isFinite(delta) && delta >= 0 ? delta / 60000 : null;
}

export function applyPersistence({ assessment, previous = null }) {
  const candidate = assessment.candidate_assessment;
  if (!assessment || assessment.status !== 'baseline_ready' || !candidate) {
    return {
      ...assessment,
      assessment: assessment?.status === 'baseline_ready' ? 'normal' : assessment?.assessment,
      candidate_assessment: candidate ?? null,
      consecutive_anomalous_windows: 0,
      consecutive_recovery_windows: 0,
      duration_minutes: 0,
      anomaly_since: null,
    };
  }

  const previousAt = previous?.observed_at;
  const currentAt = assessment.observed_at;
  const gapMinutes = previousAt && currentAt ? minutesBetween(currentAt, previousAt) : null;
  const gapAcceptable = gapMinutes !== null && gapMinutes <= MAX_PERSISTENCE_GAP_MINUTES;
  const previousDirection = anomalyDirection(previous?.candidate_assessment ?? previous?.assessment);
  const direction = anomalyDirection(candidate);

  if (isAnomalousAssessment(candidate)) {
    const sameDirection = gapAcceptable && previousDirection === direction;
    const consecutive = sameDirection
      ? Number(previous?.consecutive_anomalous_windows || 0) + 1
      : 1;
    const duration = sameDirection
      ? Number(previous?.duration_minutes || 0) + Math.min(gapMinutes, PERSISTENCE_WINDOW_MINUTES)
      : 0;
    const persistent = consecutive >= ANOMALY_WINDOWS_REQUIRED || duration >= PERSISTENCE_WINDOW_MINUTES;
    return {
      ...assessment,
      assessment: persistent ? candidate : 'normal',
      consecutive_anomalous_windows: consecutive,
      consecutive_recovery_windows: 0,
      duration_minutes: duration,
      anomaly_since: persistent
        ? previous?.anomaly_since ?? currentAt
        : previous?.anomaly_since ?? currentAt,
    };
  }

  if (isAnomalousAssessment(previous?.assessment)) {
    const recovering = Number.isFinite(assessment.robust_z) &&
      (previousDirection === 'below'
        ? assessment.robust_z > -RECOVERY_ROBUST_Z
        : assessment.robust_z < RECOVERY_ROBUST_Z);
    const recoveryWindows = recovering && gapAcceptable
      ? Number(previous?.consecutive_recovery_windows || 0) + 1
      : 0;
    const cleared = recoveryWindows >= RECOVERY_WINDOWS_REQUIRED;
    return {
      ...assessment,
      assessment: cleared ? 'normal' : previous.assessment,
      consecutive_anomalous_windows: previous.consecutive_anomalous_windows || 0,
      consecutive_recovery_windows: recoveryWindows,
      duration_minutes: previous.duration_minutes || 0,
      anomaly_since: cleared ? null : previous.anomaly_since,
    };
  }

  return {
    ...assessment,
    assessment: 'normal',
    consecutive_anomalous_windows: 0,
    consecutive_recovery_windows: 0,
    duration_minutes: 0,
    anomaly_since: null,
  };
}

function historyStartFor(currentAt) {
  return new Date(new Date(currentAt).getTime() - BASELINE_HISTORY_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

async function animalContext(animalId, db) {
  const { data, error } = await db
    .from('animals')
    .select('id,farm_id')
    .eq('id', animalId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const timezone = await getFarmTimezone(data.farm_id, db);
  return { animalId: data.id, farmId: data.farm_id, timezone };
}

async function loadPreviousAssessment(animalId, db) {
  const { data, error } = await db
    .from('activity_baseline_assessments')
    .select('*')
    .eq('animal_id', animalId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    ...data,
    observed_at: data.observed_at ?? data.created_at,
  };
}

export async function processBehaviorFeature(feature, { db = getOpastorServiceDb(), evaluatedAt } = {}) {
  if (!feature?.animal_id || !feature?.created_at) return { status: 'skipped', reason: 'unattributed' };
  const context = await animalContext(feature.animal_id, db);
  if (!context || context.timezone.status !== 'resolved') {
    return { status: 'skipped', reason: 'farm_timezone_unavailable' };
  }

  const { data: historyRows, error: historyError } = await db
    .from('behavior_features')
    .select('id,node_event_id,animal_id,created_at,sample_quality,valid_count,count_mismatch,score_avg')
    .eq('animal_id', feature.animal_id)
    .gte('created_at', historyStartFor(feature.created_at))
    .lt('created_at', feature.created_at)
    .order('created_at', { ascending: true })
    .limit(5000);
  if (historyError) throw historyError;

  const rawAssessment = assessActivityBaseline({
    current: feature,
    historyRows: historyRows ?? [],
    timezone: context.timezone.timezone,
    evaluatedAt,
  });
  const previous = await loadPreviousAssessment(feature.animal_id, db);
  const assessment = applyPersistence({
    assessment: {
      ...rawAssessment,
      observed_at: feature.created_at,
    },
    previous,
  });
  const bucket = farmLocalTwoHourBucket(feature.created_at, context.timezone.timezone);

  await db.from('activity_baselines').upsert({
    animal_id: feature.animal_id,
    farm_id: context.farmId,
    time_bucket: bucket.bucket,
    timezone: context.timezone.timezone,
    metric: ACTIVITY_BASELINE_METRIC,
    version: ACTIVITY_BASELINE_VERSION,
    history_start: historyStartFor(feature.created_at),
    history_end: feature.created_at,
    sample_count: assessment.sample_count ?? 0,
    sample_days: assessment.sample_days ?? 0,
    expected_score_avg: assessment.expected_score_avg ?? null,
    mad: assessment.mad ?? null,
    scale: assessment.scale ?? null,
    status: assessment.status,
    confidence: assessment.confidence ?? null,
    last_calculated_at: new Date().toISOString(),
  }, { onConflict: 'animal_id,farm_id,time_bucket,metric,version' });

  const { data, error } = await db.from('activity_baseline_assessments').upsert({
    animal_id: feature.animal_id,
    farm_id: context.farmId,
    node_event_id: feature.node_event_id,
    behavior_feature_id: feature.id ?? null,
    observed_at: feature.created_at,
    current_score_avg: assessment.current_score_avg ?? null,
    expected_score_avg: assessment.expected_score_avg ?? null,
    deviation_percent: assessment.deviation_percent ?? null,
    robust_z: assessment.robust_z ?? null,
    assessment: assessment.assessment,
    candidate_assessment: assessment.candidate_assessment ?? null,
    anomaly_since: assessment.anomaly_since,
    duration_minutes: assessment.duration_minutes ?? 0,
    consecutive_anomalous_windows: assessment.consecutive_anomalous_windows ?? 0,
    consecutive_recovery_windows: assessment.consecutive_recovery_windows ?? 0,
    data_quality: assessment.data_quality ?? 'ok',
    status: assessment.status,
    sample_days: assessment.sample_days ?? 0,
    sample_count: assessment.sample_count ?? 0,
    time_bucket: bucket.bucket,
    timezone: context.timezone.timezone,
    metric: ACTIVITY_BASELINE_METRIC,
    version: ACTIVITY_BASELINE_VERSION,
  }, { onConflict: 'animal_id,node_event_id,version' }).select('*').single();
  if (error) throw error;
  return { status: 'persisted', assessment: data };
}

const activityBaselineService = {
  async getAnimalBaseline(req, res, { db = null } = {}) {
    const animalId = req.params.animalId?.trim();
    if (!animalId) return res.status(400).json({ error: 'animal_id_required' });
    try {
      const client = db ?? getOpastorServiceDb();
      const { data, error } = await client
        .from('latest_animal_activity_baseline')
        .select('*')
        .eq('animal_id', animalId)
        .maybeSingle();
      if (error) throw error;
      return res.json({ animal_id: animalId, activity_baseline: data ?? null });
    } catch (error) {
      console.error('[GET] Activity baseline failed', { animalId, error: error?.message ?? String(error) });
      return res.status(500).json({ error: 'activity_baseline_lookup_failed' });
    }
  },
};

export default activityBaselineService;
