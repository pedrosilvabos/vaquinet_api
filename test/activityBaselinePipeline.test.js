import test from 'node:test';
import assert from 'node:assert/strict';

import { getOverview } from '../services/oPastor/farmService.js';
import activityBaselineService, {
  processBehaviorFeature,
} from '../services/oPastor/activityBaselineService.js';

function query(data, error = null) {
  const chain = {
    select() { return chain; },
    eq() { return chain; },
    gte() { return chain; },
    lt() { return chain; },
    order() { return chain; },
    limit() { return chain; },
    is() { return chain; },
    in() { return chain; },
    maybeSingle() { return Promise.resolve({ data, error }); },
    single() { return Promise.resolve({ data, error }); },
    then(resolve, reject) { return Promise.resolve({ data, error }).then(resolve, reject); },
  };
  return chain;
}

function baselineDb({ history = [], previous = null, baselineError = null } = {}) {
  const writes = [];
  const db = {
    writes,
    from(table) {
      if (table === 'animals') return query({ id: 'animal-1', farm_id: 'farm-1' });
      if (table === 'farms') return query({ id: 'farm-1', timezone: 'Atlantic/Azores' });
      if (table === 'behavior_features') return query(history);
      if (table === 'activity_baselines') {
        return {
          upsert(payload) {
            writes.push({ table, payload });
            return Promise.resolve({ data: payload, error: baselineError });
          },
        };
      }
      if (table === 'activity_baseline_assessments') {
        const builder = query(previous);
        builder.upsert = (payload) => {
          writes.push({ table, payload });
          return {
            select() {
              return {
                single() {
                  return Promise.resolve({ data: { id: 'assessment-1', ...payload }, error: baselineError });
                },
              };
            },
          };
        };
        return builder;
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
  return db;
}

test('first valid quality-approved feature persists insufficient_data with no history', async () => {
  const db = baselineDb();
  const result = await processBehaviorFeature({
    id: 'feature-1',
    node_event_id: 'event-1',
    animal_id: 'animal-1',
    created_at: '2026-10-05T12:00:00.000Z',
    sample_quality: 'ok',
    count_mismatch: false,
    valid_count: 30,
    score_avg: 18,
  }, { db, evaluatedAt: '2026-10-05T12:00:00.000Z' });

  assert.equal(result.status, 'persisted');
  assert.equal(result.assessment.status, 'insufficient_data');
  assert.equal(result.assessment.assessment, 'insufficient_data');
  assert.equal(result.assessment.sample_days, 0);
  assert.equal(db.writes.length, 2);
  assert.equal(db.writes[1].payload.animal_id, 'animal-1');
});

test('baseline query failure is not converted into a missing-history result', async () => {
  const db = baselineDb();
  db.from = (table) => {
    if (table === 'animals') return query({ id: 'animal-1', farm_id: 'farm-1' });
    if (table === 'farms') return query({ id: 'farm-1', timezone: 'Atlantic/Azores' });
    if (table === 'behavior_features') return query(null, { message: 'history query failed', code: '42501' });
    throw new Error(`Unexpected table: ${table}`);
  };

  await assert.rejects(
    processBehaviorFeature({
      id: 'feature-1',
      node_event_id: 'event-1',
      animal_id: 'animal-1',
      created_at: '2026-10-05T12:00:00.000Z',
      sample_quality: 'ok',
      count_mismatch: false,
      valid_count: 30,
      score_avg: 18,
    }, { db, evaluatedAt: '2026-10-05T12:00:00.000Z' }),
    (error) => error?.message === 'history query failed',
  );
});

function overviewDb({ baseline = [], baselineError = null } = {}) {
  const publicResults = {
    nodes: [{ id: 'node-1', name: 'Demo Cow 01', created_at: '2026-10-01T00:00:00Z' }],
    node_gps_config: [],
    latest_node_events: [{
      id: 'event-1', node_id: 'node-1', base_id: 'base-1', event_type: 'STATUS',
      event_data: {}, created_at: '2026-10-05T12:00:00Z', animal_id: 'animal-1',
    }],
    latest_node_behavior: [],
    base_status: [],
    node_events: [],
  };
  return {
    from(table) {
      if (table === 'latest_animal_activity_baseline') return query(baseline, baselineError);
      if (table === 'animal_node_assignments') return query([]);
      return query(publicResults[table] ?? []);
    },
  };
}

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('farm overview keeps animals and returns 200 when no baseline row exists', async () => {
  const res = response();
  await getOverview({}, res, {
    publicDb: overviewDb(),
    privilegedDb: overviewDb(),
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.nodes.length, 1);
  assert.equal(res.body.nodes[0].activity_baseline, null);
  assert.equal(res.body.nodes[0].activity_interpretation.state, 'unavailable');
  assert.equal(res.body.herd_activity, null);
});

test('farm overview preserves operational failure when baseline lookup errors', async () => {
  const res = response();
  await getOverview({}, res, {
    publicDb: overviewDb(),
    privilegedDb: overviewDb({ baselineError: { message: 'baseline permission failed' } }),
  });

  assert.equal(res.statusCode, 500);
  assert.match(res.body.details, /baseline permission failed/);
});

test('farm overview exposes semantic activity interpretation alongside the raw baseline', async () => {
  const res = response();
  await getOverview({}, res, {
    publicDb: overviewDb(),
    privilegedDb: overviewDb({
      baseline: [{
        animal_id: 'animal-1',
        farm_id: 'farm-1',
        status: 'learning',
        assessment: 'insufficient_data',
        candidate_assessment: null,
        data_quality: 'ok',
        time_bucket: '12:00-14:00',
        timezone: 'Atlantic/Azores',
        observed_at: '2026-10-05T12:00:00Z',
      }],
    }),
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.nodes[0].activity_baseline.status, 'learning');
  assert.equal(res.body.nodes[0].activity_interpretation.state, 'learning');
  assert.equal(res.body.nodes[0].activity_interpretation.action, 'none');
});

test('dedicated baseline endpoint returns a valid empty state', async () => {
  const res = response();
  await activityBaselineService.getAnimalBaseline(
    { params: { animalId: 'animal-1' } },
    res,
    { db: { from: () => query(null) } },
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.animal_id, 'animal-1');
  assert.equal(res.body.activity_baseline, null);
  assert.equal(res.body.activity_interpretation.state, 'unavailable');
});
