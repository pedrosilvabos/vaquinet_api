import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalEvent, createTelemetryV1Handler, eventDigest } from "../services/oPastor/telemetryV1Service.js";

const event = { node_id: "node-1", base_id: "base-1", event_type: "telemetry", event_data: { motion_score: 4, latitude: 1 } };
const body = () => ({ protocol_version: 1, producer_namespace: "base-001", event_key: "base-001/1", payload_digest: eventDigest(event), event });
function response() { return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } }; }
function dbMock({ existing = null, inserted = null, error = null } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      assert.equal(table, "node_events");
      const state = { mode: "upsert" };
      return {
        upsert(rows, options) { calls.push({ method: "upsert", rows, options }); return this; },
        select() { return this; },
        maybeSingle: async () => state.mode === "upsert"
          ? { data: inserted, error }
          : { data: existing, error },
        eq(_field, _value) { state.mode = "lookup"; return this; },
      };
    },
  };
}
function run(db, options = {}) { const res = response(); return createTelemetryV1Handler({ db, analyze: options.analyze || (async () => ({ ok: true })) })({ body: body() }, res).then(() => res); }
const insertedRow = { id: "event-1", ...event, animal_id: null, created_at: "2026-10-13T00:00:00Z", payload_digest: eventDigest(event) };

test("fresh v1 event returns stored receipt and one raw insert", async () => {
  const db = dbMock({ inserted: insertedRow });
  const res = await run(db);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.storage.status, "stored");
  assert.equal(db.calls.length, 1);
});

test("identical replay returns the same row as already_stored", async () => {
  const db = dbMock({ existing: insertedRow });
  const res = await run(db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.storage.status, "already_stored");
  assert.equal(res.body.storage.event_id, "event-1");
});

test("concurrent same-key requests resolve to one effective row", async () => {
  let calls = 0;
  const db = {
    from() {
      const state = { mode: "upsert" };
      return {
        upsert() { calls += 1; return this; },
        select() { return this; },
        maybeSingle: async () => state.mode === "upsert"
          ? (state.mode = "lookup", calls === 1 ? { data: insertedRow, error: null } : { data: null, error: null })
          : { data: insertedRow, error: null },
        eq() { state.mode = "lookup"; return this; },
      };
    },
  };
  const [first, second] = await Promise.all([run(db), run(db)]);
  assert.deepEqual([first.statusCode, second.statusCode].sort(), [200, 201]);
  assert.equal(first.body.storage.event_id, "event-1");
  assert.equal(second.body.storage.event_id, "event-1");
});

test("same key with different digest is rejected before storage", async () => {
  const db = dbMock({ existing: { ...insertedRow, payload_digest: "sha256:" + "0".repeat(64) } });
  const conflicting = body();
  conflicting.event = { ...event, event_data: { ...event.event_data, motion_score: 9 } };
  conflicting.payload_digest = eventDigest(conflicting.event);
  const res = response();
  await createTelemetryV1Handler({ db })({ body: conflicting }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, "event_key_conflict");
});

test("missing identity, unsupported version and batch shapes are rejected", async () => {
  for (const mutate of [b => { delete b.event_key; }, b => { b.protocol_version = 2; }, b => { b.data = [b.event]; }]) {
    const b = body(); mutate(b); const res = response();
    await createTelemetryV1Handler({ db: dbMock() })({ body: b }, res);
    assert.equal(res.statusCode, 400);
  }
});

test("raw storage success is retained when analytics fails", async () => {
  const db = dbMock({ inserted: insertedRow });
  const res = await run(db, { analyze: async () => { throw new Error("analysis down"); } });
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.storage.status, "stored");
  assert.equal(res.body.analysis.status, "failed");
});

test("canonical digest is stable across object key order", () => {
  assert.equal(eventDigest(event), eventDigest({ ...event, event_data: { latitude: 1, motion_score: 4 } }));
  assert.deepEqual(canonicalEvent(event).event_data, { latitude: 1, motion_score: 4 });
});

test("idempotency migration uses a non-partial inferable conflict index", () => {
  const migrationPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../supabase/migrations/20261013120000_add_node_event_idempotency.sql");
  const migration = fs.readFileSync(migrationPath, "utf8");
  assert.match(migration, /create unique index node_events_producer_event_key_uidx[\s\S]*on public\.node_events \(producer_namespace, event_key\);/i);
  assert.doesNotMatch(migration, /where producer_namespace is not null/i);
});
