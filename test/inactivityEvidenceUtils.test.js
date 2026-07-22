import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCompareWindowSummary,
  classifyInactiveWindow,
  parseBoundedInteger,
} from "../services/oPastor/inactivityEvidenceUtils.js";

test("parseBoundedInteger validates inactivity parameters", () => {
  assert.deepEqual(
    parseBoundedInteger("", { min: 15, max: 60, defaultValue: 30 }),
    { ok: true, value: 30 },
  );

  assert.deepEqual(
    parseBoundedInteger("10", { min: 15, max: 60, defaultValue: 30 }),
    { ok: false, error: "invalid_integer", min: 15, max: 60 },
  );

  assert.deepEqual(
    parseBoundedInteger("45", { min: 15, max: 60, defaultValue: 30 }),
    { ok: true, value: 45 },
  );
});

test("classifyInactiveWindow marks continuous quiet coverage as inactive", () => {
  const windowStart = new Date("2026-07-22T10:00:00Z");
  const windowEnd = new Date("2026-07-22T11:00:00Z");
  const latestEvent = { created_at: "2026-07-22T11:00:00Z" };
  const behaviorRows = [
    { created_at: "2026-07-22T10:00:00Z", movement_mode: "quiet", score_avg: 0 },
    { created_at: "2026-07-22T10:15:00Z", movement_mode: "quiet", score_avg: 0 },
    { created_at: "2026-07-22T10:30:00Z", movement_mode: "quiet", score_avg: 0 },
    { created_at: "2026-07-22T10:45:00Z", movement_mode: "quiet", score_avg: 0 },
    { created_at: "2026-07-22T11:00:00Z", movement_mode: "quiet", score_avg: 0 },
  ];

  const result = classifyInactiveWindow({
    latestEvent,
    behaviorRows,
    windowStart,
    windowEnd,
  });

  assert.equal(result.inactive, true);
  assert.equal(result.status, "inactive");
  assert.equal(result.stale_or_offline, false);
  assert.equal(result.evidence.observation_count, 5);
  assert.equal(result.evidence.quiet_proportion, 1);
  assert.equal(result.evidence.stationary_duration_minutes, 60);
});

test("classifyInactiveWindow rejects mixed activity and telemetry gaps", () => {
  const windowStart = new Date("2026-07-22T10:00:00Z");
  const windowEnd = new Date("2026-07-22T11:00:00Z");

  const mixed = classifyInactiveWindow({
    latestEvent: { created_at: "2026-07-22T11:00:00Z" },
    behaviorRows: [
      { created_at: "2026-07-22T10:00:00Z", movement_mode: "quiet", score_avg: 0 },
      { created_at: "2026-07-22T10:20:00Z", movement_mode: "mixed", score_avg: 12 },
      { created_at: "2026-07-22T10:40:00Z", movement_mode: "quiet", score_avg: 0 },
      { created_at: "2026-07-22T11:00:00Z", movement_mode: "quiet", score_avg: 0 },
    ],
    windowStart,
    windowEnd,
  });

  assert.equal(mixed.inactive, false);
  assert.equal(mixed.status, "mixed_or_active");

  const stale = classifyInactiveWindow({
    latestEvent: { created_at: "2026-07-22T02:00:00Z" },
    behaviorRows: [
      { created_at: "2026-07-22T10:00:00Z", movement_mode: "quiet", score_avg: 0 },
      { created_at: "2026-07-22T10:15:00Z", movement_mode: "quiet", score_avg: 0 },
      { created_at: "2026-07-22T10:30:00Z", movement_mode: "quiet", score_avg: 0 },
    ],
    windowStart,
    windowEnd,
  });

  assert.equal(stale.inactive, false);
  assert.equal(stale.status, "stale_or_offline");

  const gapped = classifyInactiveWindow({
    latestEvent: { created_at: "2026-07-22T11:00:00Z" },
    behaviorRows: [
      { created_at: "2026-07-22T10:00:00Z", movement_mode: "quiet", score_avg: 0 },
      { created_at: "2026-07-22T10:08:00Z", movement_mode: "quiet", score_avg: 0 },
      { created_at: "2026-07-22T10:55:00Z", movement_mode: "quiet", score_avg: 0 },
    ],
    windowStart,
    windowEnd,
  });

  assert.equal(gapped.inactive, false);
  assert.equal(gapped.status, "insufficient_data");
});

test("buildCompareWindowSummary reports explicit insufficient baseline state", () => {
  const windowStart = new Date("2026-07-22T09:00:00Z");
  const windowEnd = new Date("2026-07-22T10:00:00Z");
  const summary = buildCompareWindowSummary(
    [
      { created_at: "2026-07-22T09:15:00Z", movement_mode: "quiet", score_avg: 1 },
      { created_at: "2026-07-22T09:30:00Z", movement_mode: "quiet", score_avg: 2 },
    ],
    windowStart,
    windowEnd,
  );

  assert.equal(summary.observation_count, 2);
  assert.equal(summary.avg_score, 1.5);
  assert.equal(summary.data_continuous, false);
  assert.equal(summary.stationary_duration_minutes, null);
});
