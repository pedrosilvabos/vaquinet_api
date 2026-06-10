import { decodeMotionWindowScores } from './motionWindowDecoder.js';
import { MOVEMENT_MODES, MOTION_THRESHOLDS } from './behaviorFeatureDefinitions.js';

function scoresHexLengthOf(motionWindow) {
  return typeof motionWindow?.scores_hex === 'string'
    ? motionWindow.scores_hex.trim().length
    : 0;
}

function roundRatio(value) {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : null;
}

function averageOf(scores) {
  if (scores.length === 0) return null;
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

function varianceOf(scores, average) {
  if (scores.length === 0 || !Number.isFinite(average)) return null;
  const sumSquaredDiffs = scores.reduce((sum, score) => {
    const diff = score - average;
    return sum + (diff * diff);
  }, 0);
  return sumSquaredDiffs / scores.length;
}

function adjacentJumpCountOf(scores) {
  let count = 0;
  for (let i = 1; i < scores.length; i += 1) {
    if (Math.abs(scores[i] - scores[i - 1]) > MOTION_THRESHOLDS.adjacentJumpMinExclusive) {
      count += 1;
    }
  }
  return count;
}

function movementModeOf({
  sampleQuality,
  scoreCount,
  scoreAvg,
  scoreMax,
  spikeCount,
  stillnessRatio,
  activityRatio,
}) {
  if (sampleQuality !== 'ok' || scoreCount === 0) return MOVEMENT_MODES.unknown;
  if (scoreMax > MOTION_THRESHOLDS.spikeMinExclusive || spikeCount >= 1) {
    return MOVEMENT_MODES.disturbed;
  }
  if (
    stillnessRatio >= MOTION_THRESHOLDS.quietStillnessRatioMin &&
    scoreAvg <= MOTION_THRESHOLDS.quietScoreAvgMax
  ) {
    return MOVEMENT_MODES.quiet;
  }
  if (
    scoreAvg >= MOTION_THRESHOLDS.activeScoreAvgMin &&
    scoreAvg <= MOTION_THRESHOLDS.activeScoreAvgMax &&
    activityRatio >= MOTION_THRESHOLDS.activeRatioMin
  ) {
    return MOVEMENT_MODES.activeLocal;
  }
  return MOVEMENT_MODES.mixed;
}

export function extractMotionFeatures(motionWindow) {
  const {
    decodedScores,
    sampleQuality,
    countMismatch,
  } = decodeMotionWindowScores(motionWindow);

  const scoreCount = decodedScores.length;
  const scoreAvg = averageOf(decodedScores);
  const scoreMin = scoreCount > 0 ? Math.min(...decodedScores) : null;
  const scoreMax = scoreCount > 0 ? Math.max(...decodedScores) : null;
  const quietCount = decodedScores.filter((score) => score <= MOTION_THRESHOLDS.quietMax).length;
  const activeCount = decodedScores.filter((score) => (
    score >= MOTION_THRESHOLDS.activeMin &&
    score <= MOTION_THRESHOLDS.activeMax
  )).length;
  const spikeCount = decodedScores.filter((score) => score > MOTION_THRESHOLDS.spikeMinExclusive).length;
  const stillnessRatio = scoreCount > 0 ? quietCount / scoreCount : null;
  const activityRatio = scoreCount > 0 ? activeCount / scoreCount : null;
  const adjacentJumpCount = adjacentJumpCountOf(decodedScores);
  const burstScore = (spikeCount * 3) + adjacentJumpCount;
  const variance = varianceOf(decodedScores, scoreAvg);
  const movementMode = movementModeOf({
    sampleQuality,
    scoreCount,
    scoreAvg,
    scoreMax,
    spikeCount,
    stillnessRatio,
    activityRatio,
  });

  return {
    decoded_scores: decodedScores,
    score_count: scoreCount,
    score_avg: scoreAvg,
    score_min: scoreMin,
    score_max: scoreMax,
    quiet_count: quietCount,
    active_count: activeCount,
    spike_count: spikeCount,
    stillness_ratio: roundRatio(stillnessRatio),
    activity_ratio: roundRatio(activityRatio),
    burst_score: burstScore,
    variance,
    movement_mode: movementMode,
    sample_quality: sampleQuality,
    count_mismatch: countMismatch,
    scores_hex_length: scoresHexLengthOf(motionWindow),
  };
}

export default extractMotionFeatures;
