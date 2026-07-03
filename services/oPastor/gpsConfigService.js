import { opastorDb as supabase } from "../../config/supabase.js";

const GPS_CONFIG_TABLE = "node_gps_config";
const GPS_CONFIG_DEFAULT = Object.freeze({
  gps_profile: "off",
  gps_enabled: false,
  gps_attempt_interval_minutes: null,
  gps_max_acquire_seconds: 0,
  locate_boost_until_epoch: 0,
  locate_boost_interval_minutes: 0,
  locate_boost_max_acquire_seconds: 0,
  gps_config_version: 0,
  updated_at: null,
});
const ALLOWED_GPS_PROFILES = new Set([
  "off",
  "occasional",
  "balanced",
  "frequent",
]);
const MAX_GPS_ACQUIRE_SECONDS = 40;
const MIN_NORMAL_ATTEMPT_INTERVAL_MINUTES = 30;

function normalizeText(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeInteger(value) {
  if (typeof value === "number") {
    return Number.isInteger(value) ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
  }
  return null;
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") {
      return true;
    }
    if (normalized === "false" || normalized === "0") {
      return false;
    }
  }
  return null;
}

function mapRowToResponse(row, nodeId) {
  if (!row) {
    return {
      node_id: nodeId,
      ...GPS_CONFIG_DEFAULT,
    };
  }

  return {
    node_id: nodeId,
    gps_profile: row.gps_profile,
    gps_enabled: row.gps_enabled,
    gps_attempt_interval_minutes: row.gps_attempt_interval_minutes,
    gps_max_acquire_seconds: row.gps_max_acquire_seconds,
    locate_boost_until_epoch: row.locate_boost_until_epoch ?? 0,
    locate_boost_interval_minutes: row.locate_boost_interval_minutes ?? 0,
    locate_boost_max_acquire_seconds: row.locate_boost_max_acquire_seconds ?? 0,
    gps_config_version: row.gps_config_version,
    updated_at: row.updated_at ?? null,
  };
}

async function loadNodeOrNull(nodeId) {
  const { data, error } = await supabase
    .from("nodes")
    .select("id")
    .eq("id", nodeId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data;
}

function validateAndNormalizePayload(body) {
  const profile = normalizeText(
    body?.gps_profile ?? body?.profile,
  )?.toLowerCase();
  const gpsEnabled = normalizeBoolean(body?.gps_enabled ?? body?.enabled);
  const attemptIntervalMinutes = normalizeInteger(
    body?.gps_attempt_interval_minutes ?? body?.attempt_interval_minutes,
  );
  const maxAcquireSeconds = normalizeInteger(
    body?.gps_max_acquire_seconds ?? body?.max_acquire_seconds,
  );
  const locateBoostUntilEpoch = normalizeInteger(
    body?.locate_boost_until_epoch ?? body?.boost_until_epoch,
  );
  const locateBoostIntervalMinutes = normalizeInteger(
    body?.locate_boost_interval_minutes ?? body?.boost_interval_minutes,
  );
  const locateBoostMaxAcquireSeconds = normalizeInteger(
    body?.locate_boost_max_acquire_seconds ?? body?.boost_max_acquire_seconds,
  );

  if (!profile || !ALLOWED_GPS_PROFILES.has(profile)) {
    return {
      error: "gps_profile must be one of off, occasional, balanced, frequent",
    };
  }

  if (locateBoostUntilEpoch != null && locateBoostUntilEpoch !== 0) {
    return {
      error:
        "locate_boost_until_epoch must stay 0 until a future phase enables boost",
    };
  }
  if (locateBoostIntervalMinutes != null && locateBoostIntervalMinutes !== 0) {
    return {
      error:
        "locate_boost_interval_minutes must stay 0 until a future phase enables boost",
    };
  }
  if (
    locateBoostMaxAcquireSeconds != null &&
    locateBoostMaxAcquireSeconds !== 0
  ) {
    return {
      error:
        "locate_boost_max_acquire_seconds must stay 0 until a future phase enables boost",
    };
  }

  if (profile === "off") {
    return {
      value: {
        gps_profile: "off",
        gps_enabled: false,
        gps_attempt_interval_minutes: null,
        gps_max_acquire_seconds: 0,
        locate_boost_until_epoch: 0,
        locate_boost_interval_minutes: 0,
        locate_boost_max_acquire_seconds: 0,
      },
    };
  }

  if (gpsEnabled !== true) {
    return {
      error:
        "gps_enabled must be true for occasional, balanced, or frequent profiles",
    };
  }
  if (attemptIntervalMinutes == null) {
    return {
      error: "gps_attempt_interval_minutes is required for non-off profiles",
    };
  }
  if (attemptIntervalMinutes < MIN_NORMAL_ATTEMPT_INTERVAL_MINUTES) {
    return {
      error: `gps_attempt_interval_minutes must be at least ${MIN_NORMAL_ATTEMPT_INTERVAL_MINUTES}`,
    };
  }
  if (maxAcquireSeconds == null) {
    return {
      error: "gps_max_acquire_seconds is required for non-off profiles",
    };
  }
  if (maxAcquireSeconds < 1 || maxAcquireSeconds > MAX_GPS_ACQUIRE_SECONDS) {
    return {
      error: `gps_max_acquire_seconds must be between 1 and ${MAX_GPS_ACQUIRE_SECONDS}`,
    };
  }

  return {
    value: {
      gps_profile: profile,
      gps_enabled: true,
      gps_attempt_interval_minutes: attemptIntervalMinutes,
      gps_max_acquire_seconds: maxAcquireSeconds,
      locate_boost_until_epoch: 0,
      locate_boost_interval_minutes: 0,
      locate_boost_max_acquire_seconds: 0,
    },
  };
}

const gpsConfigService = {
  async getNodeGpsConfig(req, res) {
    const nodeId = req.params.id;

    try {
      const node = await loadNodeOrNull(nodeId);
      if (!node) {
        return res.status(404).json({ error: "Node not found" });
      }

      const { data, error } = await supabase
        .from(GPS_CONFIG_TABLE)
        .select(
          "node_id,gps_profile,gps_enabled,gps_attempt_interval_minutes,gps_max_acquire_seconds,locate_boost_until_epoch,locate_boost_interval_minutes,locate_boost_max_acquire_seconds,gps_config_version,updated_at",
        )
        .eq("node_id", nodeId)
        .maybeSingle();
      if (error) {
        throw error;
      }

      return res.json(mapRowToResponse(data, nodeId));
    } catch (error) {
      return res.status(500).json({
        error: "Failed to read node GPS config",
        details: error.message,
      });
    }
  },

  async putNodeGpsConfig(req, res) {
    const nodeId = req.params.id;
    const parsedPayload = validateAndNormalizePayload(req.body);

    if (parsedPayload.error) {
      return res.status(400).json({ error: parsedPayload.error });
    }

    try {
      const node = await loadNodeOrNull(nodeId);
      if (!node) {
        return res.status(404).json({ error: "Node not found" });
      }

      const { data, error } = await supabase.rpc("upsert_node_gps_config", {
        p_node_id: nodeId,
        p_gps_profile: parsedPayload.value.gps_profile,
        p_gps_enabled: parsedPayload.value.gps_enabled,
        p_gps_attempt_interval_minutes:
          parsedPayload.value.gps_attempt_interval_minutes,
        p_gps_max_acquire_seconds: parsedPayload.value.gps_max_acquire_seconds,
        p_locate_boost_until_epoch:
          parsedPayload.value.locate_boost_until_epoch,
        p_locate_boost_interval_minutes:
          parsedPayload.value.locate_boost_interval_minutes,
        p_locate_boost_max_acquire_seconds:
          parsedPayload.value.locate_boost_max_acquire_seconds,
      });
      if (error) {
        throw error;
      }

      const row = Array.isArray(data) ? data[0] : data;
      return res.json(mapRowToResponse(row, nodeId));
    } catch (error) {
      return res.status(500).json({
        error: "Failed to write node GPS config",
        details: error.message,
      });
    }
  },
};

export default gpsConfigService;
