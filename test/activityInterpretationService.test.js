import test from 'node:test';
import assert from 'node:assert/strict';

import { interpretActivity } from '../services/oPastor/activityInterpretationService.js';

const baseline = (overrides = {}) => ({
  animal_id: 'animal-1',
  status: 'baseline_ready',
  assessment: 'normal',
  candidate_assessment: 'normal',
  consecutive_recovery_windows: 0,
  time_bucket: '14:00-16:00',
  timezone: 'Atlantic/Azores',
  ...overrides,
});

test('learning and insufficient states stay useful without exposing a numeric interpretation', () => {
  assert.equal(interpretActivity({ baseline: null }).state, 'unavailable');
  assert.equal(interpretActivity({ baseline: baseline({ status: 'insufficient_data', assessment: 'insufficient_data' }) }).state, 'insufficient_data');
  assert.equal(interpretActivity({ baseline: baseline({ status: 'learning', assessment: 'insufficient_data' }) }).state, 'learning');
});

test('persistent and transient personal deviations map to farmer states', () => {
  assert.equal(interpretActivity({ baseline: baseline({ assessment: 'normal', candidate_assessment: 'below_baseline' }) }).state, 'unusually_quiet');
  assert.equal(interpretActivity({ baseline: baseline({ assessment: 'significantly_below_baseline', candidate_assessment: 'significantly_below_baseline' }) }).state, 'persistent_low_activity');
  assert.equal(interpretActivity({ baseline: baseline({ assessment: 'above_baseline', candidate_assessment: 'above_baseline' }) }).state, 'persistent_high_activity');
  assert.equal(interpretActivity({ baseline: baseline({ assessment: 'significantly_below_baseline', candidate_assessment: 'normal', consecutive_recovery_windows: 1 }) }).state, 'recovering');
});

test('interpretation keeps movement mode and marks herd participation separately', () => {
  const result = interpretActivity({
    baseline: baseline({ assessment: 'above_baseline', candidate_assessment: 'above_baseline' }),
    behavior: { movement_mode: 'active_local' },
    herdContext: {
      status: 'active',
      assessment: 'herd_unusually_active',
      direction: 'above',
      participating_animal_ids: ['animal-1'],
    },
  });
  assert.equal(result.state, 'persistent_high_activity');
  assert.equal(result.movement_mode, 'active_local');
  assert.deepEqual(result.herd_context, {
    status: 'participating',
    event: 'herd_unusually_active',
    direction: 'above',
  });
});
