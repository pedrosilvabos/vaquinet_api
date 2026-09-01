import test from 'node:test';
import assert from 'node:assert/strict';
import { __test } from '../services/oPastor/collarRegistryService.js';

test('registry cursor accepts only non-negative integer revisions', () => {
  assert.equal(__test.parseSince(undefined), 0);
  assert.equal(__test.parseSince('0'), 0);
  assert.equal(__test.parseSince('42'), 42);
  assert.equal(__test.parseSince('-1'), null);
  assert.equal(__test.parseSince('4.2'), null);
  assert.equal(__test.parseSince('revision-42'), null);
});

test('registry rows normalize the physical collar identity and public shape', () => {
  assert.equal(__test.collarIdOf(' 7c91ab03e821 '), '7C91AB03E821');
  assert.deepEqual(
    __test.publicRow({ collar_id: '7C91AB03E821', cow_id: 'cow_7', active: true, revision: '51' }),
    { collar_id: '7C91AB03E821', cow_id: 'cow_7', active: true, revision: 51 },
  );
});
