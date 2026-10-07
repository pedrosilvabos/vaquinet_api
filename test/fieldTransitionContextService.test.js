import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isTransitionActive,
  selectActiveFieldTransition,
  transitionUntilFor,
} from '../services/oPastor/fieldTransitionContextService.js';

test('field transition window is exactly 48 hours by default', () => {
  assert.equal(
    transitionUntilFor('2026-10-07T14:00:00Z')?.toISOString(),
    '2026-10-09T14:00:00.000Z',
  );
});

test('transition is active at start and expires at transition_until', () => {
  const event = {
    started_at: '2026-10-07T14:00:00Z',
    transition_until: '2026-10-09T14:00:00Z',
  };
  assert.equal(isTransitionActive(event, '2026-10-07T14:00:00Z'), true);
  assert.equal(isTransitionActive(event, '2026-10-09T13:59:59Z'), true);
  assert.equal(isTransitionActive(event, '2026-10-09T14:00:00Z'), false);
});

test('latest active move wins when transition records overlap', () => {
  const selected = selectActiveFieldTransition([
    { id: 'older', started_at: '2026-10-07T12:00:00Z', transition_until: '2026-10-09T12:00:00Z' },
    { id: 'newer', started_at: '2026-10-07T14:00:00Z', transition_until: '2026-10-09T14:00:00Z' },
  ], '2026-10-07T15:00:00Z');
  assert.equal(selected?.id, 'newer');
});
