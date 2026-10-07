export const ACTIVITY_INTERPRETATION_VERSION = 'activity_interpretation_v1';

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

function isAnomalous(value) {
  return ANOMALOUS_ASSESSMENTS.has(value);
}

function farmerStateFor(baseline) {
  if (!baseline) return 'unavailable';
  if (baseline.status === 'unknown') return 'unavailable';
  if (baseline.status === 'insufficient_data') return 'insufficient_data';
  if (baseline.status === 'learning') return 'learning';
  if (baseline.status !== 'baseline_ready') return 'unavailable';

  const assessment = baseline.assessment;
  const candidate = baseline.candidate_assessment;
  const recovering = isAnomalous(assessment) &&
    candidate === 'normal' &&
    Number(baseline.consecutive_recovery_windows || 0) > 0;
  if (recovering) return 'recovering';

  if (assessment === 'below_baseline' || assessment === 'significantly_below_baseline') {
    return 'persistent_low_activity';
  }
  if (assessment === 'above_baseline' || assessment === 'significantly_above_baseline') {
    return 'persistent_high_activity';
  }
  if (candidate === 'below_baseline' || candidate === 'significantly_below_baseline') {
    return 'unusually_quiet';
  }
  if (candidate === 'above_baseline' || candidate === 'significantly_above_baseline') {
    return 'unusually_active';
  }
  if (assessment === 'normal') return 'normal';
  return 'unavailable';
}

function actionFor(state) {
  if (state === 'persistent_low_activity' || state === 'persistent_high_activity') {
    return 'consider_checking';
  }
  if (state === 'unusually_quiet' || state === 'unusually_active' || state === 'recovering') {
    return 'monitor';
  }
  return 'none';
}

export function interpretActivity({
  baseline = null,
  behavior = null,
  herdContext = null,
  fieldTransition = null,
} = {}) {
  const underlyingState = farmerStateFor(baseline);
  const inTransition = fieldTransition?.status === 'active';
  const canContextualize = inTransition &&
    ['unusually_quiet', 'unusually_active'].includes(underlyingState);
  const state = canContextualize ? 'field_transition' : underlyingState;
  const direction = directionOf(baseline?.candidate_assessment ?? baseline?.assessment);
  const participating = Boolean(
    herdContext?.status === 'active' &&
    herdContext.participating_animal_ids?.includes(baseline?.animal_id),
  );

  return {
    version: ACTIVITY_INTERPRETATION_VERSION,
    state,
    action: canContextualize ? 'monitor' : actionFor(underlyingState),
    underlying_state: state === underlyingState ? null : underlyingState,
    direction,
    movement_mode: behavior?.movement_mode ?? null,
    time_bucket: baseline?.time_bucket ?? null,
    timezone: baseline?.timezone ?? null,
    context: inTransition ? fieldTransition : null,
    herd_context: participating
      ? {
          status: 'participating',
          event: herdContext.assessment,
          direction: herdContext.direction,
        }
      : {
          status: herdContext?.status === 'active' ? 'not_participating' : 'none',
          event: null,
          direction: null,
        },
  };
}

export default { interpretActivity, ACTIVITY_INTERPRETATION_VERSION };
