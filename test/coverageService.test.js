import test from "node:test";
import assert from "node:assert/strict";

import {
  COVERAGE_METRICS,
  filterCoveragePoints,
  makeCoverageService,
  mapCoveragePoint,
} from "../services/oPastor/coverageService.js";

function createMockResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function createSupabaseMock({ node = { id: "cow_001" }, events = [], nodeError = null, eventsError = null } = {}) {
  return {
    from(tableName) {
      if (tableName === "nodes") {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          async maybeSingle() {
            return { data: node, error: nodeError };
          },
        };
      }

      if (tableName === "node_events") {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          gte() {
            return this;
          },
          lte() {
            return this;
          },
          order() {
            return this;
          },
          async limit() {
            return { data: events, error: eventsError };
          },
        };
      }

      throw new Error(`Unexpected table ${tableName}`);
    },
  };
}

test("mapCoveragePoint filters invalid coordinates and parses telemetry", () => {
  assert.equal(
    mapCoveragePoint({
      event_data: { latitude: 0, longitude: 0, lora_rssi: "-100", lora_snr: "4.5" },
      created_at: "2026-07-19T10:15:00Z",
    }),
    null,
  );

  assert.deepEqual(
    mapCoveragePoint({
      event_data: { latitude: "38.12345", longitude: "-27.12345", lora_rssi: "-100", lora_snr: "4.5" },
      created_at: "2026-07-19T10:15:00Z",
    }),
    {
      latitude: 38.12345,
      longitude: -27.12345,
      rssi: -100,
      snr: 4.5,
      timestamp: "2026-07-19T10:15:00Z",
    },
  );
});

test("filterCoveragePoints keeps only metric-specific signal rows", () => {
  const points = [
    { latitude: 1, longitude: 1, rssi: -100, snr: 4, timestamp: "2026-07-19T10:15:00Z" },
    { latitude: 2, longitude: 2, rssi: null, snr: 2, timestamp: "2026-07-19T10:16:00Z" },
    { latitude: 3, longitude: 3, rssi: -110, snr: null, timestamp: "2026-07-19T10:17:00Z" },
  ];

  assert.equal(filterCoveragePoints(points, COVERAGE_METRICS.rssi).length, 2);
  assert.equal(filterCoveragePoints(points, COVERAGE_METRICS.snr).length, 2);
  assert.equal(filterCoveragePoints(points, COVERAGE_METRICS.density).length, 3);
});

test("getNodeCoverage validates metric and date range", async () => {
  const service = makeCoverageService({
    supabase: createSupabaseMock(),
  });

  const invalidMetricResponse = createMockResponse();
  await service.getNodeCoverage(
    { params: { id: "cow_001" }, query: { metric: "bad" } },
    invalidMetricResponse,
  );
  assert.equal(invalidMetricResponse.statusCode, 400);
  assert.equal(invalidMetricResponse.body.error, "invalid_metric");

  const invalidDateResponse = createMockResponse();
  await service.getNodeCoverage(
    { params: { id: "cow_001" }, query: { from: "2026-07-20T00:00:00Z", to: "2026-07-19T00:00:00Z" } },
    invalidDateResponse,
  );
  assert.equal(invalidDateResponse.statusCode, 400);
  assert.equal(invalidDateResponse.body.error, "invalid_date_range");
});

test("getNodeCoverage returns filtered, chronological points", async () => {
  const service = makeCoverageService({
    supabase: createSupabaseMock({
      events: [
        {
          node_id: "cow_001",
          created_at: "2026-07-19T10:15:00Z",
          event_data: { latitude: "38.12345", longitude: "-27.12345", lora_rssi: "-103", lora_snr: "4.5" },
        },
        {
          node_id: "cow_001",
          created_at: "2026-07-19T10:16:00Z",
          event_data: { latitude: 0, longitude: 0, lora_rssi: "-104", lora_snr: "4.0" },
        },
        {
          node_id: "cow_001",
          created_at: "2026-07-19T10:17:00Z",
          event_data: { latitude: "38.12346", longitude: "-27.12346", lora_snr: "5.0" },
        },
      ],
    }),
  });

  const response = createMockResponse();
  await service.getNodeCoverage(
    {
      params: { id: "cow_001" },
      query: {
        metric: "rssi",
        from: "2026-07-19T00:00:00Z",
        to: "2026-07-19T23:59:59Z",
        limit: "100",
      },
    },
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.metric, "rssi");
  assert.equal(response.body.points.length, 1);
  assert.deepEqual(response.body.points[0], {
    latitude: 38.12345,
    longitude: -27.12345,
    rssi: -103,
    snr: 4.5,
    timestamp: "2026-07-19T10:15:00Z",
  });
});

test("getNodeCoverage returns 404 when animal does not exist", async () => {
  const service = makeCoverageService({
    supabase: createSupabaseMock({ node: null }),
  });

  const response = createMockResponse();
  await service.getNodeCoverage(
    { params: { id: "missing" }, query: {} },
    response,
  );

  assert.equal(response.statusCode, 404);
  assert.equal(response.body.error, "animal_not_found");
});
