import test from 'node:test';
import assert from 'node:assert/strict';

import {
  correlateHerdActivity,
  HERD_ACTIVITY_WINDOW_MINUTES,
} from '../services/oPastor/herdActivityCorrelationService.js';

const row = (animal_id, assessment, minutes, overrides = {}) => ({
  animal_id,
  status: 'baseline_ready',
  assessment,
  data_quality: 'ok',
  observed_at: new Date(Date.parse('2026-10-05T02:00:00Z') + minutes * 60 * 1000).toISOString(),
  ...overrides,
});

const evaluatedAt = '2026-10-05T04:00:00Z';

test('correlates persistent high activity in a bounded shared window', () => {
  const result = correlateHerdActivity([
    row('a-1', 'above_baseline', 0),
    row('a-2', 'significantly_above_baseline', 20),
    row('a-3', 'above_baseline', HERD_ACTIVITY_WINDOW_MINUTES),
    row('a-4', 'normal', 20),
  ], { evaluatedAt });

  assert.equal(result.status, 'active');
  assert.equal(result.assessment, 'herd_unusually_active');
  assert.equal(result.direction, 'above');
  assert.equal(result.eligible_count, 4);
  assert.equal(result.participating_count, 3);
  assert.deepEqual(result.participating_animal_ids, ['a-1', 'a-2', 'a-3']);
});

test('correlates low activity separately and does not merge opposite directions', () => {
  const low = correlateHerdActivity([
    row('a-1', 'below_baseline', 0),
    row('a-2', 'significantly_below_baseline', 10),
    row('a-3', 'below_baseline', 30),
    row('a-4', 'above_baseline', 30),
  ], { evaluatedAt });
  assert.equal(low.assessment, 'herd_unusually_quiet');
  assert.equal(low.direction, 'below');
  assert.equal(low.participating_count, 3);
});

test('learning, stale, poor-quality, and missing animals are excluded from eligibility', () => {
  const result = correlateHerdActivity([
    row('a-1', 'above_baseline', 0),
    row('a-2', 'above_baseline', 10, { status: 'learning' }),
    row('a-3', 'above_baseline', 20, { data_quality: 'current_observation_stale' }),
    row('a-4', 'above_baseline', 30, { observed_at: '2026-10-04T00:00:00Z' }),
    row('a-5', 'normal', 30),
  ], { evaluatedAt });

  assert.equal(result.status, 'none');
  assert.equal(result.eligible_count, 2);
  assert.deepEqual(result.participating_animal_ids, []);
});

test('a single individual anomaly remains an individual assessment, not a herd event', () => {
  const result = correlateHerdActivity([
    row('a-1', 'significantly_below_baseline', 0),
    row('a-2', 'normal', 5),
    row('a-3', 'normal', 10),
  ], { evaluatedAt });
  assert.equal(result.status, 'none');
  assert.equal(result.eligible_count, 3);
  assert.equal(result.participating_count, 0);
});
