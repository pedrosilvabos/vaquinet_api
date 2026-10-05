import test from "node:test";
import assert from "node:assert/strict";

import {
  farmLocalTwoHourBucket,
  isValidIanaTimezone,
  resolveAssignmentForEvent,
} from "../services/oPastor/animalIdentityService.js";

test("IANA timezone validation accepts real zones and rejects fixed/invalid values", () => {
  assert.equal(isValidIanaTimezone("Atlantic/Azores"), true);
  assert.equal(isValidIanaTimezone("Europe/Lisbon"), true);
  assert.equal(isValidIanaTimezone("UTC+0"), false);
  assert.equal(isValidIanaTimezone("Not/A-Timezone"), false);
});

test("farm-local two-hour buckets use the farm timezone, not server time", () => {
  const bucket = farmLocalTwoHourBucket(
    "2026-10-04T23:30:00.000Z",
    "Atlantic/Azores",
  );

  assert.deepEqual(bucket, {
    localDate: "2026-10-04",
    bucket: "22:00-00:00",
    timeZone: "Atlantic/Azores",
  });
});

test("event-time assignment keeps historical collar ownership after replacement", () => {
  const assignments = [
    {
      animal_id: "animal-a",
      node_id: "node-1",
      assigned_at: "2026-01-01T00:00:00Z",
      unassigned_at: "2026-04-18T12:00:00Z",
    },
    {
      animal_id: "animal-a",
      node_id: "node-2",
      assigned_at: "2026-04-18T12:00:00Z",
      unassigned_at: null,
    },
    {
      animal_id: "animal-b",
      node_id: "node-1",
      assigned_at: "2026-05-01T00:00:00Z",
      unassigned_at: null,
    },
  ];

  assert.equal(
    resolveAssignmentForEvent(assignments, "node-1", "2026-03-10T00:00:00Z")
      ?.animal_id,
    "animal-a",
  );
  assert.equal(
    resolveAssignmentForEvent(assignments, "node-2", "2026-04-20T00:00:00Z")
      ?.animal_id,
    "animal-a",
  );
  assert.equal(
    resolveAssignmentForEvent(assignments, "node-1", "2026-05-02T00:00:00Z")
      ?.animal_id,
    "animal-b",
  );
  assert.equal(
    resolveAssignmentForEvent(assignments, "node-1", "2025-12-31T00:00:00Z"),
    null,
  );
});
