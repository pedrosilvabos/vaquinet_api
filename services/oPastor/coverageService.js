import { opastorDb as defaultSupabase } from "../../config/supabase.js";

export const COVERAGE_METRICS = Object.freeze({
  rssi: "rssi",
  snr: "snr",
  density: "density",
});

const DEFAULT_LIMIT = 2000;
const MAX_LIMIT = 5000;
const DEFAULT_RANGE_DAYS = 7;

function asNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function eventDataOf(event) {
  return event?.event_data && typeof event.event_data === "object"
    ? event.event_data
    : {};
}

function isValidLatLng(latitude, longitude) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180 &&
    !(latitude === 0 && longitude === 0)
  );
}

function parseMetric(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return Object.values(COVERAGE_METRICS).includes(normalized)
    ? normalized
    : null;
}

function parseLimit(value) {
  if (value == null || value === "") {
    return DEFAULT_LIMIT;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.min(parsed, MAX_LIMIT);
}

function parseDate(value) {
  if (value == null || value === "") {
    return null;
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function resolveDateRange(fromRaw, toRaw, now = new Date()) {
  const from = parseDate(fromRaw);
  const to = parseDate(toRaw);

  if ((fromRaw != null && fromRaw !== "" && !from) || (toRaw != null && toRaw !== "" && !to)) {
    return { error: "invalid_date_range" };
  }

  const rangeEnd = to ?? now;
  const rangeStart =
    from ?? new Date(rangeEnd.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);

  if (rangeStart.getTime() > rangeEnd.getTime()) {
    return { error: "invalid_date_range" };
  }

  return {
    from: rangeStart,
    to: rangeEnd,
  };
}

export function mapCoveragePoint(event) {
  const eventData = eventDataOf(event);
  const latitude = asNumber(
    eventData.latitude ?? eventData.node_latitude ?? eventData.lat,
  );
  const longitude = asNumber(
    eventData.longitude ??
      eventData.node_longitude ??
      eventData.lon ??
      eventData.lng,
  );

  if (!isValidLatLng(latitude, longitude)) {
    return null;
  }

  const rssi = asNumber(eventData.lora_rssi ?? eventData.rssi);
  const snr = asNumber(eventData.lora_snr ?? eventData.snr);

  return {
    latitude,
    longitude,
    rssi,
    snr,
    timestamp: event?.created_at ?? null,
  };
}

export function filterCoveragePoints(points, metric) {
  if (metric === COVERAGE_METRICS.density) {
    return points;
  }
  if (metric === COVERAGE_METRICS.rssi) {
    return points.filter((point) => point.rssi !== null);
  }
  if (metric === COVERAGE_METRICS.snr) {
    return points.filter((point) => point.snr !== null);
  }
  return points;
}

export function makeCoverageService({ supabase = defaultSupabase } = {}) {
  return {
    async getNodeCoverage(req, res) {
      const animalId = req.params?.id?.trim();
      if (!animalId) {
        return res.status(400).json({ error: "missing_animal_id" });
      }

      const metric = parseMetric(req.query?.metric ?? COVERAGE_METRICS.rssi);
      if (!metric) {
        return res.status(400).json({
          error: "invalid_metric",
          supported_metrics: Object.values(COVERAGE_METRICS),
        });
      }

      const limit = parseLimit(req.query?.limit);
      if (limit === null) {
        return res.status(400).json({
          error: "invalid_limit",
          max_limit: MAX_LIMIT,
        });
      }

      const range = resolveDateRange(req.query?.from, req.query?.to, new Date());
      if ("error" in range) {
        return res.status(400).json({ error: range.error });
      }

      try {
        const { data: node, error: nodeError } = await supabase
          .from("nodes")
          .select("id")
          .eq("id", animalId)
          .maybeSingle();

        if (nodeError) {
          throw nodeError;
        }
        if (!node) {
          return res.status(404).json({ error: "animal_not_found" });
        }

        const { data, error } = await supabase
          .from("node_events")
          .select("node_id,event_data,created_at")
          .eq("node_id", animalId)
          .gte("created_at", range.from.toISOString())
          .lte("created_at", range.to.toISOString())
          .order("created_at", { ascending: true })
          .limit(limit);

        if (error) {
          throw error;
        }

        const mappedPoints = (data ?? [])
          .map((event) => mapCoveragePoint(event))
          .filter((point) => point !== null);
        const points = filterCoveragePoints(mappedPoints, metric);

        return res.status(200).json({
          animalId,
          metric,
          from: range.from.toISOString(),
          to: range.to.toISOString(),
          points,
        });
      } catch (error) {
        return res.status(500).json({
          error: "failed_to_load_coverage",
          details: error?.message ?? String(error),
        });
      }
    },
  };
}

const coverageService = makeCoverageService();

export default coverageService;
