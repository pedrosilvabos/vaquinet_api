export const HERD_ACTIVITY_CORRELATION_VERSION = 'herd_activity_correlation_v1';
export const HERD_ACTIVITY_WINDOW_MINUTES = 90;
export const HERD_ACTIVITY_MIN_ELIGIBLE = 3;
export const HERD_ACTIVITY_MIN_PROPORTION = 0.6;
export const HERD_ACTIVITY_MAX_AGE_MINUTES = 180;

const ANOMALOUS_ASSESSMENTS = new Set([
  'below_baseline',
  'significantly_below_baseline',
  'above_baseline',
  'significantly_above_baseline',
]);

function directionOf(value) {
  if (typeof value !== 'string') return null;
  if (value.includes('below')) return 'below';
  if (value.includes('above')) return 'above';
  return null;
}

function parsedTime(value) {
  const time = Date.parse(value ?? '');
  return Number.isFinite(time) ? time : null;
}

function freshReadyRows(rows, evaluatedAt) {
  const now = parsedTime(evaluatedAt) ?? Date.now();
  return (rows || []).filter((row) => {
    const observedAt = parsedTime(row.observed_at);
    return Boolean(
      row?.animal_id &&
      row.status === 'baseline_ready' &&
      row.data_quality === 'ok' &&
      observedAt !== null &&
      observedAt <= now &&
      now - observedAt <= HERD_ACTIVITY_MAX_AGE_MINUTES * 60 * 1000,
    );
  });
}

function bestCluster(rows) {
  const sorted = [...rows].sort((left, right) => parsedTime(left.observed_at) - parsedTime(right.observed_at));
  let best = [];
  for (let start = 0; start < sorted.length; start += 1) {
    const cluster = [];
    for (let index = start; index < sorted.length; index += 1) {
      if (parsedTime(sorted[index].observed_at) - parsedTime(sorted[start].observed_at) > HERD_ACTIVITY_WINDOW_MINUTES * 60 * 1000) break;
      cluster.push(sorted[index]);
    }
    if (cluster.length > best.length) best = cluster;
  }
  return best;
}

export function correlateHerdActivity(rows = [], { evaluatedAt } = {}) {
  const eligible = freshReadyRows(rows, evaluatedAt);
  const result = {
    version: HERD_ACTIVITY_CORRELATION_VERSION,
    status: 'none',
    assessment: null,
    direction: null,
    eligible_count: eligible.length,
    participating_count: 0,
    proportion: 0,
    participating_animal_ids: [],
    window_start: null,
    window_end: null,
  };

  if (eligible.length < HERD_ACTIVITY_MIN_ELIGIBLE) return result;

  const directions = ['above', 'below'];
  const candidates = directions.map((direction) => {
    const cluster = bestCluster(
      eligible.filter((row) =>
        ANOMALOUS_ASSESSMENTS.has(row.assessment) && directionOf(row.assessment) === direction,
      ),
    );
    return { direction, cluster, proportion: cluster.length / eligible.length };
  }).filter((candidate) =>
    candidate.cluster.length >= HERD_ACTIVITY_MIN_ELIGIBLE &&
    candidate.proportion >= HERD_ACTIVITY_MIN_PROPORTION,
  ).sort((left, right) => right.cluster.length - left.cluster.length);

  const winner = candidates[0];
  if (!winner) return result;

  const timestamps = winner.cluster.map((row) => parsedTime(row.observed_at)).sort((a, b) => a - b);
  return {
    ...result,
    status: 'active',
    assessment: winner.direction === 'above' ? 'herd_unusually_active' : 'herd_unusually_quiet',
    direction: winner.direction,
    participating_count: winner.cluster.length,
    proportion: winner.proportion,
    participating_animal_ids: winner.cluster.map((row) => row.animal_id),
    window_start: new Date(timestamps[0]).toISOString(),
    window_end: new Date(timestamps[timestamps.length - 1]).toISOString(),
  };
}

export default { correlateHerdActivity, HERD_ACTIVITY_CORRELATION_VERSION };
