import test from "node:test";
import assert from "node:assert/strict";

import {
  COVERAGE_ANCHORS,
  COVERAGE_METRICS,
  COVERAGE_WINDOWS,
  filterCoveragePoints,
  makeCoverageService,
  mapCoveragePoint,
  resolveCoverageQuery,
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

function createSupabaseMock({
  node = { id: "cow_001" },
  ascendingEvents = [],
  descendingPages = [],
  nodeError = null,
  eventsError = null,
} = {}) {
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
          _ascending: true,
          _rangeStart: 0,
          select() {
            return this;
          },
          eq() {
            return this;
          },
          gte() {
            return this;
          },
          lt() {
            return this;
          },
          lte() {
            return this;
          },
          order(_column, options = {}) {
            this._ascending = options.ascending !== false;
            return this;
          },
          range(start) {
            this._rangeStart = start;
            const pageIndex = Math.floor(start / 500);
            return Promise.resolve({
              data: descendingPages[pageIndex] ?? [],
              error: eventsError,
            });
          },
          async limit() {
            return { data: ascendingEvents, error: eventsError };
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

test("filterCoveragePoints keeps raw GPS points for all metrics", () => {
  const points = [
    { latitude: 1, longitude: 1, rssi: -100, snr: 4, timestamp: "2026-07-19T10:15:00Z" },
    { latitude: 2, longitude: 2, rssi: null, snr: 2, timestamp: "2026-07-19T10:16:00Z" },
    { latitude: 3, longitude: 3, rssi: -110, snr: null, timestamp: "2026-07-19T10:17:00Z" },
  ];

  assert.equal(filterCoveragePoints(points, COVERAGE_METRICS.rssi).length, 3);
  assert.equal(filterCoveragePoints(points, COVERAGE_METRICS.snr).length, 3);
  assert.equal(filterCoveragePoints(points, COVERAGE_METRICS.density).length, 3);
});

test("resolveCoverageQuery validates explicit and preset range modes", () => {
  const explicitRange = resolveCoverageQuery({
    from: "2026-07-18T00:00:00Z",
    to: "2026-07-19T00:00:00Z",
  });
  assert.equal(explicitRange.mode, "explicit");

  const latestWindow = resolveCoverageQuery({
    window: "1w",
    anchor: "latest",
  });
  assert.equal(latestWindow.mode, "latest-window");
  assert.equal(latestWindow.window, "1w");
  assert.equal(latestWindow.anchor, "latest");

  assert.deepEqual(resolveCoverageQuery({ window: "2h", anchor: "latest" }), {
    error: "invalid_window",
    supported_windows: Object.keys(COVERAGE_WINDOWS),
  });

  assert.deepEqual(resolveCoverageQuery({ window: "1w", anchor: "now" }), {
    error: "invalid_anchor",
    supported_anchors: Object.values(COVERAGE_ANCHORS),
  });

  assert.deepEqual(
    resolveCoverageQuery({
      from: "2026-07-18T00:00:00Z",
      to: "2026-07-19T00:00:00Z",
      window: "1w",
      anchor: "latest",
    }),
    {
      error: "conflicting_range_parameters",
    },
  );
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

test("getNodeCoverage anchors preset windows to the latest valid GPS observation", async () => {
  const service = makeCoverageService({
    supabase: createSupabaseMock({
      descendingPages: [
        [
          {
            node_id: "cow_001",
            created_at: "2026-07-19T15:37:00Z",
            event_data: { latitude: 0, longitude: 0, lora_rssi: "-90", lora_snr: "8" },
          },
          {
            node_id: "cow_001",
            created_at: "2026-07-19T15:35:00Z",
            event_data: { latitude: "38.12345", longitude: "-27.12345", lora_rssi: "-103", lora_snr: "4.5" },
          },
        ],
      ],
      ascendingEvents: [
        {
          node_id: "cow_001",
          created_at: "2026-07-19T14:40:00Z",
          event_data: { latitude: "38.12344", longitude: "-27.12344", lora_rssi: "-101", lora_snr: "5.0" },
        },
        {
          node_id: "cow_001",
          created_at: "2026-07-19T15:35:00Z",
          event_data: { latitude: "38.12345", longitude: "-27.12345", lora_rssi: "-103", lora_snr: "4.5" },
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
        window: "1w",
        anchor: "latest",
      },
    },
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.window, "1w");
  assert.equal(response.body.anchor, "latest");
  assert.equal(response.body.latestObservationAt, "2026-07-19T15:35:00.000Z");
  assert.equal(response.body.from, "2026-07-12T15:35:00.000Z");
  assert.equal(response.body.to, "2026-07-19T15:35:00.000Z");
  assert.equal(response.body.points.length, 2);
});

test("getNodeCoverage returns empty preset results only when no valid GPS observation exists", async () => {
  const service = makeCoverageService({
    supabase: createSupabaseMock({
      descendingPages: [
        [
          {
            node_id: "cow_001",
            created_at: "2026-07-19T15:37:00Z",
            event_data: { latitude: 0, longitude: 0, lora_rssi: "-90", lora_snr: "8" },
          },
        ],
      ],
    }),
  });

  const response = createMockResponse();
  await service.getNodeCoverage(
    {
      params: { id: "cow_001" },
      query: {
        metric: "density",
        window: "1m",
        anchor: "latest",
      },
    },
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.latestObservationAt, null);
  assert.deepEqual(response.body.points, []);
});

test("getNodeCoverage returns chronological points and preserves explicit from/to", async () => {
  const service = makeCoverageService({
    supabase: createSupabaseMock({
      ascendingEvents: [
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
  assert.equal(response.body.from, "2026-07-19T00:00:00.000Z");
  assert.equal(response.body.to, "2026-07-19T23:59:59.000Z");
  assert.equal(response.body.latestObservationAt, null);
  assert.equal(response.body.points.length, 2);
  assert.deepEqual(response.body.points[0], {
    latitude: 38.12345,
    longitude: -27.12345,
    rssi: -103,
    snr: 4.5,
    timestamp: "2026-07-19T10:15:00Z",
  });
  assert.deepEqual(response.body.points[1], {
    latitude: 38.12346,
    longitude: -27.12346,
    rssi: null,
    snr: 5,
    timestamp: "2026-07-19T10:17:00Z",
  });
});

test("getNodeCoverage keeps latestObservationAt for explicit empty custom ranges", async () => {
  const service = makeCoverageService({
    supabase: createSupabaseMock({
      descendingPages: [
        [
          {
            node_id: "cow_001",
            created_at: "2026-07-08T15:37:00Z",
            event_data: { latitude: "38.12345", longitude: "-27.12345", lora_rssi: "-103", lora_snr: "4.5" },
          },
        ],
      ],
      ascendingEvents: [],
    }),
  });

  const response = createMockResponse();
  await service.getNodeCoverage(
    {
      params: { id: "cow_001" },
      query: {
        metric: "density",
        from: "2026-07-05T00:00:00.000Z",
        to: "2026-07-09T00:00:00.000Z",
      },
    },
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.latestObservationAt, "2026-07-08T15:37:00.000Z");
  assert.deepEqual(response.body.points, []);
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
