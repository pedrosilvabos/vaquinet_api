import test from 'node:test';
import assert from 'node:assert/strict';

import { profileUpdateFrom } from '../services/oPastor/nodeService.js';

test('name-only profile update preserves the technical identity outside the update payload', () => {
  assert.deepEqual(profileUpdateFrom({ name: '  Mimosa  ' }), { name: 'Mimosa' });
});

test('profile update accepts Unicode names and does not invent an id field', () => {
  assert.deepEqual(profileUpdateFrom({ name: 'Estrela Áurea' }), { name: 'Estrela Áurea' });
});

test('profile update rejects blank or excessive display names', () => {
  assert.throws(() => profileUpdateFrom({ name: '   ' }), /name must not be empty/);
  assert.throws(() => profileUpdateFrom({ name: 'a'.repeat(101) }), /at most 100/);
});
