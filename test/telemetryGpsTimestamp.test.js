import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeGpsQualityCheckpoints,
  normalizeOptionalGpsTimestamp,
} from "../services/oPastor/telemetryNormalization.js";

test("normalizeOptionalGpsTimestamp converts valid Unix seconds and rejects sentinel values", () => {
  assert.equal(
    normalizeOptionalGpsTimestamp(1735689600),
    "2025-01-01T00:00:00.000Z",
  );
  assert.equal(
    normalizeOptionalGpsTimestamp(1787788800),
    "2026-08-27T00:00:00.000Z",
  );
  assert.equal(normalizeOptionalGpsTimestamp(2147483647), null);
  assert.equal(normalizeOptionalGpsTimestamp("2147483647"), null);
  assert.equal(normalizeOptionalGpsTimestamp(0), null);
});

test("normalizeGpsQualityCheckpoints preserves omitted unset checkpoints", () => {
  assert.deepEqual(
    normalizeGpsQualityCheckpoints([
      { at_ms: 20000, satellites: 0, hdop_x100: null },
      { at_ms: 30000, satellites: 0, hdop_x100: null },
    ]),
    [
      { at_ms: 20000, satellites: 0, hdop_x100: null },
      { at_ms: 30000, satellites: 0, hdop_x100: null },
    ],
  );
  assert.deepEqual(normalizeGpsQualityCheckpoints([]), []);
});

test("optional integer normalization preserves motion snapshot presence", () => {
  assert.deepEqual(
    normalizeGpsQualityCheckpoints([
      { at_ms: 20000, satellites: 4, hdop_x100: 450 },
      { at_ms: 30000, satellites: 0, hdop_x100: 0 },
      { at_ms: null, satellites: null, hdop_x100: null },
    ]),
    [
      { at_ms: 20000, satellites: 4, hdop_x100: 450 },
      { at_ms: 30000, satellites: 0, hdop_x100: 0 },
      { at_ms: null, satellites: null, hdop_x100: null },
    ],
  );
});
