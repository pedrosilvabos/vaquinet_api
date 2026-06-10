export const EXTRACTOR_VERSION = 'motion_features_v1';

export const MOTION_THRESHOLDS = {
  quietMax: 15,
  activeMin: 25,
  activeMax: 60,
  spikeMinExclusive: 120,
  adjacentJumpMinExclusive: 40,
  quietStillnessRatioMin: 0.7,
  quietScoreAvgMax: 15,
  activeScoreAvgMin: 25,
  activeScoreAvgMax: 45,
  activeRatioMin: 0.4,
};

export const MOVEMENT_MODES = {
  unknown: 'unknown',
  disturbed: 'disturbed',
  quiet: 'quiet',
  activeLocal: 'active_local',
  mixed: 'mixed',
};
