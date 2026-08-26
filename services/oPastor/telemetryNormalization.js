export function normalizeOptionalGpsTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value >= 1600000000 ? new Date(value * 1000).toISOString() : null;
  }
  if (value == null) return null;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
