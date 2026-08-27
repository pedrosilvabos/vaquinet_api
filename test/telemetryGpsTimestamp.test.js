import test from "node:test";
import assert from "node:assert/strict";

import { normalizeOptionalGpsTimestamp } from "../services/oPastor/telemetryNormalization.js";

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
