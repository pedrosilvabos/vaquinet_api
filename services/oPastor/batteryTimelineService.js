const SUPPORTED_BATTERY_TIMELINE_RANGES = ['6h', '24h', '3d', '7d'];

const RANGE_MS = {
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

function normalizeRange(rawRange) {
  const range = typeof rawRange === 'string' && rawRange.trim()
    ? rawRange.trim()
    : '24h';

  if (!SUPPORTED_BATTERY_TIMELINE_RANGES.includes(range)) {
    return { ok: false, range };
  }

  return { ok: true, range, rangeMs: RANGE_MS[range] };
}

function timelineWindow(rawRange, now = new Date()) {
  const normalized = normalizeRange(rawRange);
  if (!normalized.ok) return normalized;

  return {
    ok: true,
    range: normalized.range,
    rangeStart: new Date(now.getTime() - normalized.rangeMs),
    rangeEnd: now,
  };
}

function eventDataOf(event) {
  return event?.event_data && typeof event.event_data === 'object'
    ? event.event_data
    : {};
}

function asNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeVoltage(rawValue) {
  const value = asNumber(rawValue);
  if (value === null || value <= 0) return null;
  return value > 100 ? value / 1000 : value;
}

function extractBatteryVoltage(event) {
  const data = eventDataOf(event);
  return normalizeVoltage(
    data.node_battery_voltage ??
      data.batteryVoltage ??
      data.node_battery ??
      data.battery,
  );
}

export function buildBatteryTimeline(events, rawRange, now = new Date()) {
  const window = timelineWindow(rawRange, now);
  if (!window.ok) {
    return {
      ok: false,
      error: 'unsupported_range',
      supported_ranges: SUPPORTED_BATTERY_TIMELINE_RANGES,
    };
  }

  const items = [];
  let minVoltage = null;
  let maxVoltage = null;

  for (const event of events ?? []) {
    const voltage = extractBatteryVoltage(event);
    if (voltage === null) continue;

    const timestamp = new Date(event.created_at);
    if (Number.isNaN(timestamp.getTime())) continue;

    items.push({
      timestamp: timestamp.toISOString(),
      voltage: Number(voltage.toFixed(3)),
      node_event_id: event.id?.toString() ?? null,
    });

    minVoltage = minVoltage === null ? voltage : Math.min(minVoltage, voltage);
    maxVoltage = maxVoltage === null ? voltage : Math.max(maxVoltage, voltage);
  }

  const latestVoltage = items.isNotEmpty ? items[items.length - 1].voltage : null;
  const firstVoltage = items.isNotEmpty ? items.first.voltage : null;
  const voltageDrop =
    firstVoltage !== null && latestVoltage !== null
      ? Number((firstVoltage - latestVoltage).toFixed(3))
      : null;

  return {
    ok: true,
    node_id: events?.[0]?.node_id?.toString() ?? '',
    range: window.range,
    items,
    meta: {
      events_read: Array.isArray(events) ? events.length : 0,
      points_returned: items.length,
      min_voltage: minVoltage !== null ? Number(minVoltage.toFixed(3)) : null,
      max_voltage: maxVoltage !== null ? Number(maxVoltage.toFixed(3)) : null,
      latest_voltage: latestVoltage,
      voltage_drop: voltageDrop,
      range_start: window.rangeStart.toISOString(),
      range_end: window.rangeEnd.toISOString(),
      last_report_at: items.isNotEmpty ? items[items.length - 1].timestamp : null,
    },
  };
}

export { SUPPORTED_BATTERY_TIMELINE_RANGES, timelineWindow };
