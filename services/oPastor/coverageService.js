import { opastorDb as defaultSupabase } from "../../config/supabase.js";

export const COVERAGE_METRICS = Object.freeze({
  rssi: "rssi",
  snr: "snr",
  density: "density",
});

export const COVERAGE_WINDOWS = Object.freeze({
  "1w": "1w",
  "1m": "1m",
  "6m": "6m",
});

export const COVERAGE_ANCHORS = Object.freeze({
  latest: "latest",
});

const DEFAULT_LIMIT = 2000;
const MAX_LIMIT = 5000;
const DEFAULT_RANGE_DAYS = 7;
const LATEST_GPS_BATCH_SIZE = 500;
const COVERAGE_FETCH_BATCH_SIZE = 1000;

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

function parseWindow(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return Object.prototype.hasOwnProperty.call(COVERAGE_WINDOWS, normalized)
    ? normalized
    : null;
}

function parseAnchor(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return Object.values(COVERAGE_ANCHORS).includes(normalized)
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

export function resolveCoverageQuery(query, now = new Date()) {
  const hasExplicitFrom = query?.from != null && query.from !== "";
  const hasExplicitTo = query?.to != null && query.to !== "";
  const hasWindow = query?.window != null && query.window !== "";
  const hasAnchor = query?.anchor != null && query.anchor !== "";

  if ((hasExplicitFrom || hasExplicitTo) && (hasWindow || hasAnchor)) {
    return { error: "conflicting_range_parameters" };
  }

  if (hasExplicitFrom || hasExplicitTo) {
    const range = resolveDateRange(query?.from, query?.to, now);
    if ("error" in range) {
      return range;
    }
    return {
      mode: "explicit",
      from: range.from,
      to: range.to,
      window: null,
      anchor: null,
    };
  }

  if (hasWindow || hasAnchor) {
    const window = parseWindow(query?.window);
    const anchor = parseAnchor(query?.anchor);

    if (!window) {
      return {
        error: "invalid_window",
        supported_windows: Object.keys(COVERAGE_WINDOWS),
      };
    }
    if (!anchor) {
      return {
        error: "invalid_anchor",
        supported_anchors: Object.values(COVERAGE_ANCHORS),
      };
    }

    return {
      mode: "latest-window",
      window,
      anchor,
    };
  }

  const range = resolveDateRange(query?.from, query?.to, now);
  if ("error" in range) {
    return range;
  }

  return {
    mode: "default",
    from: range.from,
    to: range.to,
    window: null,
    anchor: null,
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

export function filterCoveragePoints(points) {
  return points;
}

function subtractUtcCalendarMonths(date, months) {
  const to = new Date(date);
  const from = new Date(to);
  const originalDay = from.getUTCDate();

  from.setUTCDate(1);
  from.setUTCMonth(from.getUTCMonth() - months);

  const lastDayOfTargetMonth = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0),
  ).getUTCDate();
  from.setUTCDate(Math.min(originalDay, lastDayOfTargetMonth));

  return from;
}

function resolveLatestWindowRange(latestObservationAt, window) {
  const to = new Date(latestObservationAt);

  switch (window) {
    case "1w":
      return {
        from: new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000),
        to,
      };
    case "1m":
      return {
        from: subtractUtcCalendarMonths(to, 1),
        to,
      };
    case "6m":
      return {
        from: subtractUtcCalendarMonths(to, 6),
        to,
      };
    default:
      throw new Error(`Unsupported coverage window: ${window}`);
  }
}

async function findLatestValidGpsObservation(supabase, animalId) {
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("node_events")
      .select("node_id,event_data,created_at")
      .eq("node_id", animalId)
      .order("created_at", { ascending: false })
      .range(offset, offset + LATEST_GPS_BATCH_SIZE - 1);

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      return null;
    }

    for (const event of data) {
      const point = mapCoveragePoint(event);
      if (point) {
        return {
          event,
          point,
          timestamp: new Date(String(event.created_at)),
        };
      }
    }

    if (data.length < LATEST_GPS_BATCH_SIZE) {
      return null;
    }

    offset += LATEST_GPS_BATCH_SIZE;
  }
}

async function fetchCoveragePoints(
  supabase,
  animalId,
  range,
  limit,
  { endExclusive = false } = {},
) {
  const collectedPoints = [];
  let offset = 0;

  while (collectedPoints.length < limit) {
    let query = supabase
      .from("node_events")
      .select("node_id,event_data,created_at")
      .eq("node_id", animalId)
      .gte("created_at", range.from.toISOString());

    query = endExclusive
      ? query.lt("created_at", range.to.toISOString())
      : query.lte("created_at", range.to.toISOString());

    const { data, error } = await query
      .order("created_at", { ascending: false })
      .range(offset, offset + COVERAGE_FETCH_BATCH_SIZE - 1);

    if (error) {
      throw error;
    }

    const events = data ?? [];
    for (const event of events) {
      const point = mapCoveragePoint(event);
      if (!point) {
        continue;
      }
      collectedPoints.push(point);
      if (collectedPoints.length >= limit) {
        break;
      }
    }

    if (events.length < COVERAGE_FETCH_BATCH_SIZE) {
      break;
    }

    offset += COVERAGE_FETCH_BATCH_SIZE;
  }

  return filterCoveragePoints(collectedPoints.reverse());
}

function buildCoverageResponse({
  animalId,
  metric,
  range,
  points,
  window = null,
  anchor = null,
  latestObservationAt = null,
}) {
  return {
    animalId,
    metric,
    from: range?.from?.toISOString() ?? null,
    to: range?.to?.toISOString() ?? null,
    window,
    anchor,
    latestObservationAt,
    points,
  };
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

      const queryResolution = resolveCoverageQuery(req.query ?? {}, new Date());
      if ("error" in queryResolution) {
        const body = { error: queryResolution.error };
        if (queryResolution.supported_windows) {
          body.supported_windows = queryResolution.supported_windows;
        }
        if (queryResolution.supported_anchors) {
          body.supported_anchors = queryResolution.supported_anchors;
        }
        return res.status(400).json(body);
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

        const latestObservation = await findLatestValidGpsObservation(
          supabase,
          animalId,
        );
        let range = queryResolution.mode === "latest-window" ? null : {
          from: queryResolution.from,
          to: queryResolution.to,
        };
        let latestObservationAt =
          latestObservation?.timestamp?.toISOString() ?? null;

        if (queryResolution.mode === "latest-window") {
          if (!latestObservation) {
            return res.status(200).json(
              buildCoverageResponse({
                animalId,
                metric,
                range: null,
                points: [],
                window: queryResolution.window,
                anchor: queryResolution.anchor,
                latestObservationAt: null,
              }),
            );
          }

          range = resolveLatestWindowRange(
            latestObservation.timestamp,
            queryResolution.window,
          );
        }

        const points = await fetchCoveragePoints(
          supabase,
          animalId,
          range,
          limit,
          { endExclusive: queryResolution.mode === "explicit" },
        );

        return res.status(200).json(
          buildCoverageResponse({
            animalId,
            metric,
            range,
            points,
            window: queryResolution.window,
            anchor: queryResolution.anchor,
            latestObservationAt,
          }),
        );
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
