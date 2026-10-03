import test from "node:test";
import assert from "node:assert/strict";

import {
  AREA_STATUS,
  buildAreaStatus,
  makeAreaStatusService,
} from "../services/oPastor/areaStatusService.js";

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function latestLocation({ latitude = 38.1, longitude = -27.1 } = {}) {
  return {
    point: { latitude, longitude, timestamp: "2026-10-03T18:33:00Z" },
    timestamp: new Date("2026-10-03T18:33:00Z"),
    event: { event_data: { farm_id: "farm-a" } },
  };
}

function supabaseMock({ node = { id: "demo_cow_01", farm_id: "farm-a" }, areas = [], matches = [] } = {}) {
  return {
    from(table) {
      assert.equal(table, "nodes");
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() { return { data: node, error: null }; },
      };
    },
    async rpc(name) {
      if (name === "get_fences_geojson") return { data: areas, error: null };
      if (name === "is_inside_fence") return { data: matches, error: null };
      throw new Error(`unexpected rpc ${name}`);
    },
  };
}

test("buildAreaStatus returns inside_known_area for one matching fence", () => {
  const result = buildAreaStatus({
    animalId: "demo_cow_01",
    farmId: "farm-a",
    position: { latitude: 38.1, longitude: -27.1, timestamp: "2026-10-03T18:33:00Z" },
    configuredAreas: [{ id: "pasture-1", name: "Pasto Norte" }],
    matchingAreas: [{ inside: true, fence_id: "pasture-1", name: "Pasto Norte" }],
  });
  assert.equal(result.areaStatus, AREA_STATUS.INSIDE_KNOWN_AREA);
  assert.deepEqual(result.area, { id: "pasture-1", name: "Pasto Norte" });
});

test("buildAreaStatus returns outside_known_areas without a match", () => {
  const result = buildAreaStatus({
    animalId: "demo_cow_01",
    farmId: "farm-a",
    position: { latitude: 38.1, longitude: -27.1, timestamp: "2026-10-03T18:33:00Z" },
    configuredAreas: [{ id: "pasture-1", name: "Pasto Norte" }],
    matchingAreas: [{ inside: false, fence_id: "pasture-1", name: "Pasto Norte" }],
  });
  assert.equal(result.areaStatus, AREA_STATUS.OUTSIDE_KNOWN_AREAS);
  assert.equal(result.area, null);
});

test("area endpoint distinguishes no position and no configured areas", async () => {
  const noPositionResponse = response();
  await makeAreaStatusService({
    supabase: supabaseMock(),
    latestLocationFinder: async () => null,
  }).getNodeAreaStatus({ params: { id: "demo_cow_01" } }, noPositionResponse);
  assert.equal(noPositionResponse.body.areaStatus, AREA_STATUS.NO_VALID_POSITION);

  const noAreasResponse = response();
  await makeAreaStatusService({
    supabase: supabaseMock({ areas: [] }),
    latestLocationFinder: async () => latestLocation(),
  }).getNodeAreaStatus({ params: { id: "demo_cow_01" } }, noAreasResponse);
  assert.equal(noAreasResponse.body.areaStatus, AREA_STATUS.NO_AREAS_CONFIGURED);
});

test("area endpoint uses the animal farm scope and does not select another farm", async () => {
  const res = response();
  const calls = [];
  const supabase = supabaseMock({
    node: { id: "demo_cow_01", farm_id: "farm-a" },
    areas: [{ id: "pasture-a", name: "Farm A" }],
    matches: [],
  });
  const originalRpc = supabase.rpc;
  supabase.rpc = async (name, args) => {
    calls.push({ name, args });
    return originalRpc(name, args);
  };

  await makeAreaStatusService({
    supabase,
    latestLocationFinder: async () => latestLocation(),
  }).getNodeAreaStatus({ params: { id: "demo_cow_01" } }, res);

  assert.equal(res.body.areaStatus, AREA_STATUS.OUTSIDE_KNOWN_AREAS);
  assert.deepEqual(calls.map((call) => call.args.p_farm_id), ["farm-a", "farm-a"]);
});

test("area endpoint does not silently choose one overlapping area", async () => {
  const res = response();
  await makeAreaStatusService({
    supabase: supabaseMock({
      areas: [
        { id: "pasture-1", name: "North" },
        { id: "pasture-2", name: "North overlap" },
      ],
      matches: [
        { inside: true, fence_id: "pasture-1", name: "North" },
        { inside: true, fence_id: "pasture-2", name: "North overlap" },
      ],
    }),
    latestLocationFinder: async () => latestLocation(),
  }).getNodeAreaStatus({ params: { id: "demo_cow_01" } }, res);
  assert.equal(res.body.areaStatus, AREA_STATUS.MULTIPLE_MATCHING_AREAS);
  assert.equal(res.body.area, null);
  assert.equal(res.body.areas.length, 2);
});

test("disabled areas are not treated as configured active areas", () => {
  const result = buildAreaStatus({
    animalId: "demo_cow_01",
    farmId: "farm-a",
    position: { latitude: 38.1, longitude: -27.1, timestamp: "2026-10-03T18:33:00Z" },
    configuredAreas: [{ id: "pasture-1", name: "Disabled", enabled: false }],
    matchingAreas: [{ inside: true, fence_id: "pasture-1", name: "Disabled" }],
  });
  assert.equal(result.areaStatus, AREA_STATUS.NO_AREAS_CONFIGURED);
});

test("area endpoint forwards latitude and longitude in the API GPS order", async () => {
  const res = response();
  const calls = [];
  const supabase = supabaseMock({
    areas: [{ id: "pasture-1", name: "North" }],
    matches: [{ inside: true, fence_id: "pasture-1", name: "North" }],
  });
  const originalRpc = supabase.rpc;
  supabase.rpc = async (name, args) => {
    calls.push({ name, args });
    return originalRpc(name, args);
  };

  await makeAreaStatusService({
    supabase,
    latestLocationFinder: async () => latestLocation({ latitude: 38.123, longitude: -27.456 }),
  }).getNodeAreaStatus({ params: { id: "demo_cow_01" } }, res);

  const membershipCall = calls.find((call) => call.name === "is_inside_fence");
  assert.deepEqual(membershipCall.args, {
    p_farm_id: "farm-a",
    p_lat: 38.123,
    p_lon: -27.456,
  });
});

test("boundary and vertex membership are accepted when the geometry RPC says inside", async () => {
  for (const coordinates of [
    { latitude: 38.1, longitude: -27.1 },
    { latitude: 38.100001, longitude: -27.100001 },
  ]) {
    const res = response();
    await makeAreaStatusService({
      supabase: supabaseMock({
        areas: [{ id: "pasture-1", name: "North" }],
        matches: [{ inside: true, fence_id: "pasture-1", name: "North" }],
      }),
      latestLocationFinder: async () => latestLocation(coordinates),
    }).getNodeAreaStatus({ params: { id: "demo_cow_01" } }, res);
    assert.equal(res.body.areaStatus, AREA_STATUS.INSIDE_KNOWN_AREA);
  }
});

test("geometry RPC failures become server errors rather than false membership", async () => {
  const res = response();
  const supabase = supabaseMock({ areas: [{ id: "pasture-1", name: "North" }] });
  supabase.rpc = async (name) =>
    name === "get_fences_geojson"
      ? { data: [{ id: "pasture-1", name: "North" }], error: null }
      : { data: null, error: new Error("malformed geometry") };

  await makeAreaStatusService({
    supabase,
    latestLocationFinder: async () => latestLocation(),
  }).getNodeAreaStatus({ params: { id: "demo_cow_01" } }, res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, "failed_to_resolve_area_status");
});

test("area endpoint reports unavailable farm scope instead of querying all fences", async () => {
  const res = response();
  const supabase = supabaseMock({
    node: { id: "demo_cow_01" },
    areas: [{ id: "pasture-1", name: "North" }],
  });
  await makeAreaStatusService({
    supabase,
    latestLocationFinder: async () => ({
      ...latestLocation(),
      event: { event_data: {} },
    }),
  }).getNodeAreaStatus({ params: { id: "demo_cow_01" } }, res);
  assert.equal(res.body.areaStatus, AREA_STATUS.FARM_SCOPE_UNAVAILABLE);
});
