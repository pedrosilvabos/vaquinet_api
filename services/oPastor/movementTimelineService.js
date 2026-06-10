import { decodeMotionWindowScores } from './behavior/motionWindowDecoder.js';

export const SUPPORTED_MOVEMENT_TIMELINE_RANGES = ['1h', '3h', '12h', '24h'];

const RANGE_MS = {
  '1h': 60 * 60 * 1000,
  '3h': 3 * 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
};

const BUFFER_MS = 2 * 60 * 60 * 1000;

function eventDataOf(event) {
  return event?.event_data && typeof event.event_data === 'object'
    ? event.event_data
    : {};
}

function asPositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeRange(rawRange) {
  const range = typeof rawRange === 'string' && rawRange.trim()
    ? rawRange.trim()
    : '1h';

  if (!SUPPORTED_MOVEMENT_TIMELINE_RANGES.includes(range)) {
    return { ok: false, range };
  }

  return { ok: true, range, rangeMs: RANGE_MS[range] };
}

function buildTimelineWindow(rawRange, now = new Date()) {
  const parsed = normalizeRange(rawRange);
  if (!parsed.ok) return parsed;

  const rangeEnd = now;
  const rangeStart = new Date(rangeEnd.getTime() - parsed.rangeMs);
  const bufferStart = new Date(rangeStart.getTime() - BUFFER_MS);

  return {
    ok: true,
    range: parsed.range,
    rangeStart,
    rangeEnd,
    bufferStart,
  };
}

function motionWindowOf(event) {
  const motionWindow = eventDataOf(event).motion_window;
  return motionWindow && typeof motionWindow === 'object' ? motionWindow : null;
}

function upsertPoint(pointByTimestamp, point) {
  const existing = pointByTimestamp.get(point.timestamp);
  if (!existing) {
    pointByTimestamp.set(point.timestamp, point);
    return false;
  }

  if (point.event_created_at >= existing.event_created_at) {
    pointByTimestamp.set(point.timestamp, point);
    return true;
  }

  return false;
}

export function buildMovementTimeline(events, rawRange, now = new Date()) {
  const window = buildTimelineWindow(rawRange, now);
  if (!window.ok) {
    return {
      ok: false,
      error: 'unsupported_range',
      supported_ranges: SUPPORTED_MOVEMENT_TIMELINE_RANGES,
    };
  }

  const pointByTimestamp = new Map();
  const meta = {
    events_read: Array.isArray(events) ? events.length : 0,
    events_with_motion_window: 0,
    events_skipped: 0,
    points_returned: 0,
    deduped_points: 0,
    range_start: window.rangeStart.toISOString(),
    range_end: window.rangeEnd.toISOString(),
    buffer_start: window.bufferStart.toISOString(),
  };

  for (const event of events ?? []) {
    const motionWindow = motionWindowOf(event);
    if (!motionWindow?.scores_hex) continue;

    meta.events_with_motion_window += 1;

    const intervalS = asPositiveNumber(motionWindow.interval_s);
    if (intervalS === null) {
      meta.events_skipped += 1;
      continue;
    }

    const eventCreatedAt = new Date(event.created_at);
    if (Number.isNaN(eventCreatedAt.getTime())) {
      meta.events_skipped += 1;
      continue;
    }

    const decoded = decodeMotionWindowScores(motionWindow);
    const scores = decoded.decodedScores;
    if (!Array.isArray(scores) || scores.length === 0) {
      meta.events_skipped += 1;
      continue;
    }

    const intervalMs = intervalS * 1000;
    const firstSampleAt = eventCreatedAt.getTime() - ((scores.length - 1) * intervalMs);

    for (let index = 0; index < scores.length; index += 1) {
      const sampleAt = new Date(firstSampleAt + (index * intervalMs));
      if (sampleAt < window.rangeStart || sampleAt > window.rangeEnd) continue;

      const replaced = upsertPoint(pointByTimestamp, {
        timestamp: sampleAt.toISOString(),
        score: scores[index],
        node_event_id: event.id,
        interval_s: intervalS,
        sample_quality: decoded.sampleQuality,
        count_mismatch: decoded.countMismatch,
        event_created_at: eventCreatedAt.toISOString(),
      });

      if (replaced) meta.deduped_points += 1;
    }
  }

  const items = [...pointByTimestamp.values()]
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .map(({ event_created_at: _eventCreatedAt, ...item }) => item);

  const intervals_s = [...new Set(items.map((item) => item.interval_s))].sort((a, b) => a - b);
  meta.points_returned = items.length;

  return {
    ok: true,
    range: window.range,
    interval_s: intervals_s.length === 1 ? intervals_s[0] : null,
    intervals_s,
    items,
    meta,
  };
}

export function movementTimelineBufferStartIso(rawRange, now = new Date()) {
  const window = buildTimelineWindow(rawRange, now);
  return window.ok ? window.bufferStart.toISOString() : null;
}
