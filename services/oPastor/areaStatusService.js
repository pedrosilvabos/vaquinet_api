import { opastorDb as defaultSupabase } from "../../config/supabase.js";
import { findLatestValidGpsObservationDetails } from "./coverageService.js";

export const AREA_STATUS = Object.freeze({
  INSIDE_KNOWN_AREA: "inside_known_area",
  OUTSIDE_KNOWN_AREAS: "outside_known_areas",
  NO_VALID_POSITION: "no_valid_position",
  NO_AREAS_CONFIGURED: "no_areas_configured",
  MULTIPLE_MATCHING_AREAS: "multiple_matching_areas",
  FARM_SCOPE_UNAVAILABLE: "farm_scope_unavailable",
});

function areaIsEnabled(area) {
  if (!area || typeof area !== "object") return false;
  const props = area.props && typeof area.props === "object" ? area.props : {};
  return (
    area.enabled !== false &&
    area.active !== false &&
    area.is_active !== false &&
    area.disabled !== true &&
    props.enabled !== false &&
    props.active !== false &&
    props.is_active !== false &&
    props.disabled !== true
  );
}

function areaFromHit(hit) {
  return {
    id: hit?.fence_id ?? hit?.id ?? null,
    name: hit?.name ?? null,
  };
}

function lookupDataShape(data, error) {
  if (error) return "error";
  if (data === null) return "null";
  if (Array.isArray(data)) {
    return data.length === 0 ? "empty_array" : "array";
  }
  if (typeof data === "object") return "object";
  return typeof data;
}

async function resolveFarmScope({ supabase, animalId }) {
  const latestEventLookup = await supabase
    .from("latest_node_events")
    .select("id,node_id,base_id,created_at")
    .eq("node_id", animalId)
    .maybeSingle();

  const { data: latestEventData, error: latestEventError } = latestEventLookup;
  console.info("[GET] Area-status latest event farm lookup", {
    nodeId: animalId,
    dataShape: lookupDataShape(latestEventData, latestEventError),
    latestEventId: latestEventData?.id ?? null,
    baseId: latestEventData?.base_id ?? null,
    errorCode: latestEventError?.code ?? null,
    errorMessage: latestEventError?.message ?? null,
  });

  if (latestEventError) {
    latestEventError.farmScopeReason = "latest_event_query_error";
    throw latestEventError;
  }

  if (Array.isArray(latestEventData) && latestEventData.length > 1) {
    const resultShapeError = new Error("latest_node_events returned multiple rows");
    resultShapeError.farmScopeReason = "latest_event_result_shape";
    throw resultShapeError;
  }

  const latestEvent = Array.isArray(latestEventData)
    ? latestEventData[0] ?? null
    : latestEventData;
  if (!latestEvent) {
    return {
      farmId: null,
      source: "latest_event",
      reason: "no_latest_event",
      latestEvent: null,
      baseId: null,
    };
  }

  if (!latestEvent.base_id) {
    return {
      farmId: null,
      source: "latest_event",
      reason: "missing_base_id",
      latestEvent,
      baseId: null,
    };
  }

  const { data: base, error: baseError } = await supabase
    .from("bases")
    .select("id,farm_id")
    .eq("id", latestEvent.base_id)
    .maybeSingle();

  if (baseError) throw baseError;
  if (!base) {
    return {
      farmId: null,
      source: "latest_event_base",
      reason: "base_not_found",
      latestEvent,
      baseId: latestEvent.base_id,
    };
  }

  if (!base.farm_id) {
    return {
      farmId: null,
      source: "latest_event_base",
      reason: "missing_farm_id",
      latestEvent,
      baseId: base.id,
    };
  }

  return {
    farmId: base.farm_id,
    source: "latest_event_base",
    reason: null,
    latestEvent,
    baseId: base.id,
  };
}

function positionFrom(latestObservation) {
  if (!latestObservation?.point) return null;
  return {
    latitude: latestObservation.point.latitude,
    longitude: latestObservation.point.longitude,
    timestamp: latestObservation.timestamp?.toISOString?.() ?? latestObservation.point.timestamp ?? null,
  };
}

export function buildAreaStatus({ animalId, position, configuredAreas, matchingAreas, farmId }) {
  const areas = (configuredAreas ?? []).filter(areaIsEnabled);
  const matches = (matchingAreas ?? []).filter((row) => row?.inside === true).map(areaFromHit);

  if (!farmId) {
    return {
      animalId,
      areaStatus: AREA_STATUS.FARM_SCOPE_UNAVAILABLE,
      position,
      area: null,
      areas: [],
    };
  }

  if (areas.length === 0) {
    return {
      animalId,
      areaStatus: AREA_STATUS.NO_AREAS_CONFIGURED,
      position,
      area: null,
    };
  }

  if (matches.length > 1) {
    return {
      animalId,
      areaStatus: AREA_STATUS.MULTIPLE_MATCHING_AREAS,
      position,
      area: null,
      areas: matches,
    };
  }

  if (matches.length === 1) {
    return {
      animalId,
      areaStatus: AREA_STATUS.INSIDE_KNOWN_AREA,
      position,
      area: matches[0],
    };
  }

  return {
    animalId,
    areaStatus: AREA_STATUS.OUTSIDE_KNOWN_AREAS,
    position,
    area: null,
  };
}

export function makeAreaStatusService({
  supabase = defaultSupabase,
  latestLocationFinder = findLatestValidGpsObservationDetails,
} = {}) {
  return {
    async getNodeAreaStatus(req, res) {
      const animalId = req.params?.id?.trim();
      if (!animalId) {
        return res.status(400).json({ error: "missing_animal_id" });
      }

      try {
        const { data: node, error: nodeError } = await supabase
          .from("nodes")
          .select("*")
          .eq("id", animalId)
          .maybeSingle();

        if (nodeError) throw nodeError;
        if (!node) return res.status(404).json({ error: "animal_not_found" });

        const latestObservation = await latestLocationFinder(supabase, animalId);
        const position = positionFrom(latestObservation);
        if (!position) {
          return res.status(200).json({
            animalId,
            areaStatus: AREA_STATUS.NO_VALID_POSITION,
            position: null,
            area: null,
          });
        }

        const farmScope = await resolveFarmScope({ supabase, animalId });
        const farmId = farmScope.farmId;
        if (!farmId) {
          console.warn("[GET] Farm scope unavailable", {
            nodeId: animalId,
            latestEventId: farmScope.latestEvent?.id ?? null,
            baseId: farmScope.baseId,
            farmId: null,
            farmScopeSource: farmScope.source,
            farmScopeResolved: false,
            reason: farmScope.reason,
            areaStatus: AREA_STATUS.FARM_SCOPE_UNAVAILABLE,
            fenceCount: 0,
          });
          return res.status(200).json(
            buildAreaStatus({ animalId, position, configuredAreas: [], matchingAreas: [], farmId }),
          );
        }

        const { data: configuredAreas, error: areasError } = await supabase.rpc(
          "get_fences_geojson",
          { p_farm_id: farmId },
        );
        if (areasError) throw areasError;

        const areas = Array.isArray(configuredAreas) ? configuredAreas : [];
        if (areas.filter(areaIsEnabled).length === 0) {
          console.info("[GET] Area status resolved", {
            nodeId: animalId,
            latestEventId: farmScope.latestEvent?.id ?? null,
            baseId: farmScope.baseId,
            resolvedFarmId: farmId,
            farmScopeSource: farmScope.source,
            farmScopeResolved: true,
            areaStatus: AREA_STATUS.NO_AREAS_CONFIGURED,
            fenceCount: 0,
          });
          return res.status(200).json(
            buildAreaStatus({ animalId, position, configuredAreas: areas, matchingAreas: [], farmId }),
          );
        }

        const { data: matchingAreas, error: membershipError } = await supabase.rpc(
          "is_inside_fence",
          {
            p_farm_id: farmId,
            p_lat: position.latitude,
            p_lon: position.longitude,
          },
        );
        if (membershipError) throw membershipError;

        const result = buildAreaStatus({
            animalId,
            position,
            configuredAreas: areas,
            matchingAreas: Array.isArray(matchingAreas) ? matchingAreas : [],
            farmId,
          });
        console.info("[GET] Area status resolved", {
          nodeId: animalId,
          latestEventId: farmScope.latestEvent?.id ?? null,
          baseId: farmScope.baseId,
          resolvedFarmId: farmId,
          farmScopeSource: farmScope.source,
          farmScopeResolved: true,
          areaStatus: result.areaStatus,
          fenceCount: areas.filter(areaIsEnabled).length,
        });
        return res.status(200).json(result);
      } catch (error) {
        console.error("[GET] Failed to resolve animal area status", {
          nodeId: animalId,
          reason: error?.farmScopeReason ?? "area_status_query_or_geometry_error",
          errorCode: error?.code ?? null,
          errorMessage: error?.message ?? String(error),
        });
        return res.status(500).json({
          error: "failed_to_resolve_area_status",
          details: error?.message ?? String(error),
        });
      }
    },
  };
}

const areaStatusService = makeAreaStatusService();

export default areaStatusService;
