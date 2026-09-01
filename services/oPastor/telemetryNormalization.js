export function normalizeOptionalGpsTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    // INT32_MAX is the known Node signed-time saturation sentinel, not a
    // trusted GPS time. Reject it instead of persisting 2038-01-19.
    return value >= 1600000000 && value !== 2147483647
      ? new Date(value * 1000).toISOString()
      : null;
  }
  if (value == null) return null;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed === "2147483647") return null;
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeGpsQualityCheckpoints(value) {
  if (!Array.isArray(value)) return null;
  return value.slice(0, 4).map((checkpoint) => ({
    at_ms: normalizeOptionalInteger(checkpoint?.at_ms),
    satellites: normalizeOptionalInteger(checkpoint?.satellites),
    hdop_x100: normalizeOptionalInteger(checkpoint?.hdop_x100),
  }));
}

function normalizeOptionalInteger(value) {
  if (value == null) return null;
  const num = Number(value);
  return Number.isInteger(num) ? num : null;
}
