import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessActivityBaseline,
  applyPersistence,
  baselineStatistics,
  classifyRobustDeviation,
  median,
  medianAbsoluteDeviation,
} from '../services/oPastor/activityBaselineService.js';

function row(day, score, overrides = {}) {
  return {
    created_at: `2026-10-${String(day).padStart(2, '0')}T08:30:00Z`,
    sample_quality: 'ok',
    count_mismatch: false,
    valid_count: 30,
    score_avg: score,
    ...overrides,
  };
}

test('median and MAD support odd and even samples', () => {
  assert.equal(median([1, 3, 9]), 3);
  assert.equal(median([1, 3, 9, 11]), 6);
  assert.equal(medianAbsoluteDeviation([1, 3, 9]), 2);
  assert.deepEqual(baselineStatistics([10, 10, 10]), {
    expected: 10,
    mad: 0,
    scale: 2,
  });
});

test('readiness counts distinct local days and excludes invalid evidence', () => {
  const current = row(20, 7);
  const history = [
    row(6, 18), row(6, 19), row(7, 18), row(8, 20),
    row(9, 19), row(10, 18), row(11, 17), row(12, 20),
    row(12, 20, { sample_quality: 'invalid' }),
  ];
  const result = assessActivityBaseline({
    current,
    historyRows: history,
    timezone: 'Atlantic/Azores',
    evaluatedAt: '2026-10-20T09:00:00Z',
  });
  assert.equal(result.status, 'baseline_ready');
  assert.equal(result.sample_days, 7);
  assert.equal(result.sample_count, 8);
});

test('ready baseline classifies a significant deviation without changing movement mode', () => {
  const current = row(20, 7);
  const history = [6, 7, 8, 9, 10, 11, 12].map((day) => row(day, 20));
  const result = assessActivityBaseline({
    current,
    historyRows: history,
    timezone: 'Atlantic/Azores',
    evaluatedAt: '2026-10-20T09:00:00Z',
  });
  assert.equal(result.assessment, 'significantly_below_baseline');
  assert.equal(classifyRobustDeviation(result.robust_z), 'significantly_below_baseline');
  assert.equal(result.expected_score_avg, 20);
});

test('one anomaly is a candidate and three valid windows persist it', () => {
  const make = (time, candidate, robustZ) => ({
    status: 'baseline_ready',
    assessment: 'normal',
    candidate_assessment: candidate,
    robust_z: robustZ,
    observed_at: time,
    current_score_avg: 7,
  });
  const first = applyPersistence({
    assessment: make('2026-10-05T08:00:00Z', 'below_baseline', -2.2),
  });
  const second = applyPersistence({
    assessment: make('2026-10-05T08:30:00Z', 'below_baseline', -2.4),
    previous: first,
  });
  const third = applyPersistence({
    assessment: make('2026-10-05T09:00:00Z', 'below_baseline', -2.5),
    previous: second,
  });
  assert.equal(first.assessment, 'normal');
  assert.equal(second.assessment, 'normal');
  assert.equal(third.assessment, 'below_baseline');
  assert.equal(third.consecutive_anomalous_windows, 3);
});

test('two recovery windows clear a persisted anomaly', () => {
  const anomaly = {
    status: 'baseline_ready',
    assessment: 'significantly_below_baseline',
    candidate_assessment: 'significantly_below_baseline',
    robust_z: -3,
    observed_at: '2026-10-05T09:00:00Z',
    anomaly_since: '2026-10-05T08:00:00Z',
    consecutive_anomalous_windows: 3,
    duration_minutes: 90,
  };
  const recovery1 = applyPersistence({
    assessment: {
      status: 'baseline_ready', candidate_assessment: 'normal', assessment: 'normal',
      robust_z: -1, observed_at: '2026-10-05T09:30:00Z',
    },
    previous: anomaly,
  });
  const recovery2 = applyPersistence({
    assessment: {
      status: 'baseline_ready', candidate_assessment: 'normal', assessment: 'normal',
      robust_z: -0.5, observed_at: '2026-10-05T10:00:00Z',
    },
    previous: recovery1,
  });
  assert.equal(recovery1.assessment, 'significantly_below_baseline');
  assert.equal(recovery2.assessment, 'normal');
});

test('near-zero expected activity keeps percentage unavailable', () => {
  const current = row(20, 3);
  const history = [8, 9, 10, 11, 12, 13, 14].map((day) => row(day, 2));
  const result = assessActivityBaseline({
    current,
    historyRows: history,
    timezone: 'Atlantic/Azores',
    evaluatedAt: '2026-10-20T09:00:00Z',
  });
  assert.equal(result.status, 'baseline_ready');
  assert.equal(result.deviation_percent, null);
  assert.equal(result.expected_score_avg, 2);
});

test('large evidence gaps restart anomaly persistence', () => {
  const previous = {
    status: 'baseline_ready',
    assessment: 'below_baseline',
    candidate_assessment: 'below_baseline',
    robust_z: -2.2,
    observed_at: '2026-10-05T08:00:00Z',
    consecutive_anomalous_windows: 2,
    duration_minutes: 30,
  };
  const next = applyPersistence({
    assessment: {
      status: 'baseline_ready',
      assessment: 'normal',
      candidate_assessment: 'below_baseline',
      robust_z: -2.3,
      observed_at: '2026-10-06T08:00:00Z',
    },
    previous,
  });
  assert.equal(next.consecutive_anomalous_windows, 1);
  assert.equal(next.assessment, 'normal');
});
