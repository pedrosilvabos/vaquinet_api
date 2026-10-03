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

function eventDataOf(event) {
  return event?.event_data && typeof event.event_data === "object"
    ? event.event_data
    : {};
}

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

function directFarmId(node, latestObservation) {
  const eventData = eventDataOf(latestObservation?.event);
  return (
    node?.farm_id ??
    latestObservation?.event?.farm_id ??
    eventData.farm_id ??
    process.env.DEFAULT_FARM_ID ??
    null
  );
}

async function resolveFarmScope({ supabase, node, latestObservation }) {
  const directId = directFarmId(node, latestObservation);
  if (directId) {
    return { farmId: directId, source: "node_or_event" };
  }

  const baseId = latestObservation?.event?.base_id ?? node?.base_id ?? null;
  if (baseId) {
    const { data: base, error } = await supabase
      .from("bases")
      .select("id,farm_id")
      .eq("id", baseId)
      .maybeSingle();
    if (error) throw error;
    if (base?.farm_id) {
      return { farmId: base.farm_id, source: "base_farm" };
    }
  }

  if (process.env.DEFAULT_FARM_ID) {
    return { farmId: process.env.DEFAULT_FARM_ID, source: "configured_default" };
  }

  return { farmId: null, source: "unresolved" };
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

        const farmScope = await resolveFarmScope({
          supabase,
          node,
          latestObservation,
        });
        const farmId = farmScope.farmId;
        if (!farmId) {
          console.warn("[GET] Farm scope unavailable", {
            nodeId: animalId,
            baseId: latestObservation?.event?.base_id ?? node?.base_id ?? null,
            farmScopeSource: farmScope.source,
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
            resolvedFarmId: farmId,
            farmScopeSource: farmScope.source,
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
          resolvedFarmId: farmId,
          farmScopeSource: farmScope.source,
          areaStatus: result.areaStatus,
          fenceCount: areas.filter(areaIsEnabled).length,
        });
        return res.status(200).json(result);
      } catch (error) {
        console.error("[GET] Failed to resolve animal area status:", error?.message ?? error);
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
