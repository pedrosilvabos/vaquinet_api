const EARTH_RADIUS_METERS = 6_371_000;
const DEFAULT_STEP_MINUTES = 30;
const DEFAULT_SEED = "opastor-demo";
const MOVEMENT_PROFILES = [
  { mode: "grazing", speedMetersPerMinute: 0.35, motionState: 1 },
  { mode: "walking", speedMetersPerMinute: 1.1, motionState: 2 },
  { mode: "still", speedMetersPerMinute: 0, motionState: 0 },
  { mode: "active", speedMetersPerMinute: 1.7, motionState: 3 },
  { mode: "grazing", speedMetersPerMinute: 0.45, motionState: 1 },
];

function hashString(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomUnit(seed) {
  let value = hashString(seed) || 1;
  value = Math.imul(value ^ (value >>> 16), 2246822519);
  value = Math.imul(value ^ (value >>> 13), 3266489917);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function numberInRange(seed, minimum, maximum) {
  return minimum + (randomUnit(seed) * (maximum - minimum));
}

function radians(value) {
  return value * (Math.PI / 180);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function validCoordinate(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${name} must be a number`);
  return number;
}

function movementProfile(index, step) {
  const profile = MOVEMENT_PROFILES[index % MOVEMENT_PROFILES.length];
  const phase = Math.floor(step / 8);
  if (index % 4 === 3 && phase % 3 === 2) {
    return { mode: "grazing", speedMetersPerMinute: 0.5, motionState: 1 };
  }
  return profile;
}

function pointAtStep({ centerLat, centerLon, radiusMeters, seed, index, step, stepMinutes }) {
  const profile = movementProfile(index, step);
  const orbitRadius = radiusMeters * (0.28 + (randomUnit(`${seed}:radius:${index}`) * 0.38));
  const initialAngle = numberInRange(`${seed}:angle:${index}`, 0, Math.PI * 2);
  const circumference = Math.max(orbitRadius * 2 * Math.PI, 1);
  const direction = index % 2 === 0 ? 1 : -1;
  const angle = initialAngle + direction * ((profile.speedMetersPerMinute * step * stepMinutes) / circumference) * Math.PI * 2;
  const eastMeters = Math.cos(angle) * orbitRadius;
  const northMeters = Math.sin(angle) * orbitRadius;
  const latitude = centerLat + (northMeters / EARTH_RADIUS_METERS) * (180 / Math.PI);
  const longitude = centerLon + (eastMeters / (EARTH_RADIUS_METERS * Math.cos(radians(centerLat)))) * (180 / Math.PI);

  return {
    latitude: Number(latitude.toFixed(7)),
    longitude: Number(longitude.toFixed(7)),
    heading: Number((((angle * 180) / Math.PI + (direction > 0 ? 90 : 270)) % 360).toFixed(1)),
    speedMetersPerSecond: Number((profile.speedMetersPerMinute / 60).toFixed(3)),
    mode: profile.mode,
    motionState: profile.motionState,
  };
}

function motionScores({ seed, index, step, mode }) {
  const base = mode === "still" ? 4 : mode === "active" ? 52 : mode === "walking" ? 28 : 16;
  return Array.from({ length: 30 }, (_, sample) => {
    const variation = Math.floor(randomUnit(`${seed}:motion:${index}:${step}:${sample}`) * (mode === "still" ? 5 : 22));
    const spike = mode === "active" && sample === 17 ? 35 : 0;
    return clamp(base + variation + spike, 0, 255);
  });
}

function toScoresHex(scores) {
  return scores.map((score) => score.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function cowCount(value) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    throw new Error("DEMO_COW_COUNT must be an integer between 1 and 100");
  }
  return count;
}

export function parseSimulatorConfig(env = process.env) {
  if (String(env.DEMO_SIMULATOR_ENABLED).toLowerCase() !== "true") {
    throw new Error("DEMO_SIMULATOR_ENABLED must be explicitly true");
  }

  const apiUrl = String(env.DEMO_API_URL || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(apiUrl)) throw new Error("DEMO_API_URL must be an http(s) URL");
  if (!String(env.DEMO_API_TOKEN || "").trim()) throw new Error("DEMO_API_TOKEN is required");

  const centerLat = validCoordinate(env.DEMO_CENTER_LAT, "DEMO_CENTER_LAT");
  const centerLon = validCoordinate(env.DEMO_CENTER_LON, "DEMO_CENTER_LON");
  if (centerLat < -90 || centerLat > 90) throw new Error("DEMO_CENTER_LAT is outside -90..90");
  if (centerLon < -180 || centerLon > 180) throw new Error("DEMO_CENTER_LON is outside -180..180");

  const radiusMeters = validCoordinate(env.DEMO_RADIUS_METERS, "DEMO_RADIUS_METERS");
  if (radiusMeters <= 0) throw new Error("DEMO_RADIUS_METERS must be greater than zero");

  const stepMinutes = env.DEMO_STEP_MINUTES == null ? DEFAULT_STEP_MINUTES : Number(env.DEMO_STEP_MINUTES);
  if (!Number.isFinite(stepMinutes) || stepMinutes <= 0) throw new Error("DEMO_STEP_MINUTES must be greater than zero");

  return {
    apiUrl,
    apiToken: String(env.DEMO_API_TOKEN).trim(),
    baseId: String(env.DEMO_BASE_ID || "demo-base-001").trim() || "demo-base-001",
    cowCount: cowCount(env.DEMO_COW_COUNT ?? 10),
    centerLat,
    centerLon,
    radiusMeters,
    stepMinutes,
    seed: String(env.DEMO_SEED || DEFAULT_SEED),
  };
}

export function simulationStepFor(date, stepMinutes = DEFAULT_STEP_MINUTES) {
  return Math.floor(date.getTime() / (stepMinutes * 60_000));
}

export function simulationStepKey(seed, step) {
  return `${seed}:${step}`;
}

export function buildSimulationBatch({
  cowCount = 10,
  baseId = "demo-base-001",
  centerLat,
  centerLon,
  radiusMeters,
  stepMinutes = DEFAULT_STEP_MINUTES,
  seed = DEFAULT_SEED,
  now = new Date(),
}) {
  const step = simulationStepFor(now, stepMinutes);
  const stepKey = simulationStepKey(seed, step);

  return Array.from({ length: cowCount }, (_, index) => {
    const nodeId = `demo-cow-${String(index + 1).padStart(2, "0")}`;
    const point = pointAtStep({ centerLat, centerLon, radiusMeters, seed, index, step, stepMinutes });
    const scores = motionScores({ seed, index, step, mode: point.mode });
    const motionScore = Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
    const batteryVoltage = Number((4.08 - ((step + index * 19) % 1800) * 0.00012).toFixed(3));
    const isGpsValid = index !== 8;

    return {
      node_id: nodeId,
      base_id: baseId,
      name: `Demo Cow ${String(index + 1).padStart(2, "0")}`,
      tag_id: `DEMO-TAG-${String(index + 1).padStart(2, "0")}`,
      event_type: "STATUS",
      event_data: {
        simulation_step_key: stepKey,
        latitude: isGpsValid ? point.latitude : null,
        longitude: isGpsValid ? point.longitude : null,
        node_gps_course: point.heading,
        node_gps_speed: point.speedMetersPerSecond,
        sat_count: isGpsValid ? 8 + (index % 4) : 0,
        gps_fix_success: isGpsValid,
        gps_result: isGpsValid ? "FIX" : "TIMEOUT",
        gps_best_hdop: isGpsValid ? 110 + (index % 5) * 12 : null,
        gps_max_satellites: isGpsValid ? 8 + (index % 4) : 0,
        gps_first_nmea_ms: 210,
        gps_nmea_chars: isGpsValid ? 12500 + index * 180 : 11200,
        last_gps_attempt_at: now.toISOString(),
        last_gps_fix_at: isGpsValid ? now.toISOString() : null,
        gps_fix_age_minutes: isGpsValid ? 0 : null,
        gps_attempt_duration_ms: isGpsValid ? 12000 + index * 700 : 40000,
        motion_state: point.motionState,
        motion_score: motionScore,
        motion_samples: scores.length,
        motion_window: {
          interval_s: 60,
          count: scores.length,
          valid: scores.length,
          avg: motionScore,
          min: Math.min(...scores),
          max: Math.max(...scores),
          spikes: scores.filter((score) => score > 80).length,
          scores_hex: toScoresHex(scores),
        },
        node_battery_voltage: batteryVoltage,
        node_vbus: 0,
        telemetry_flags: 0,
      },
    };
  });
}

export function isStepAlreadyApplied(latestEvent, stepKey) {
  return latestEvent?.event_data?.simulation_step_key === stepKey;
}

