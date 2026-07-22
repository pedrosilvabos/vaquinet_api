const OFFLINE_THRESHOLD_MS = 6 * 60 * 60 * 1000;
const MIN_INACTIVITY_OBSERVATIONS = 3;
const DEFAULT_EXPECTED_CADENCE_MINUTES = 8;

function parseIsoDate(value) {
  const parsed = new Date(String(value ?? ""));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function compareNumbersAscending(a, b) {
  return a - b;
}

function median(numbers) {
  if (!Array.isArray(numbers) || numbers.length === 0) return null;
  const sorted = [...numbers].sort(compareNumbersAscending);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function average(numbers) {
  if (!Array.isArray(numbers) || numbers.length === 0) return null;
  const sum = numbers.reduce((acc, value) => acc + value, 0);
  return sum / numbers.length;
}

function roundTo(value, digits = 3) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function motionModeOfBehaviorRow(row) {
  return typeof row?.movement_mode === "string" ? row.movement_mode : null;
}

function scoreAvgOfBehaviorRow(row) {
  const value = row?.score_avg;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function intervalMinutesBetween(from, to) {
  return (to.getTime() - from.getTime()) / 60000;
}

function timelineGapsMinutes(rows) {
  const gaps = [];
  for (let index = 1; index < rows.length; index += 1) {
    const previousAt = parseIsoDate(rows[index - 1]?.created_at);
    const currentAt = parseIsoDate(rows[index]?.created_at);
    if (!previousAt || !currentAt) continue;
    gaps.push(intervalMinutesBetween(previousAt, currentAt));
  }
  return gaps;
}

export function parseBoundedInteger(value, { min, max, defaultValue }) {
  if (value == null || value === "") {
    return { ok: true, value: defaultValue };
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return {
      ok: false,
      error: "invalid_integer",
      min,
      max,
    };
  }

  return { ok: true, value: parsed };
}

export function isFreshTimestamp(date, now = new Date()) {
  return now.getTime() - date.getTime() < OFFLINE_THRESHOLD_MS;
}

export function summarizeBehaviorCoverage(rows, windowStart, windowEnd) {
  const validRows = (rows ?? [])
    .map((row) => ({ row, at: parseIsoDate(row?.created_at) }))
    .filter((item) => item.at)
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  if (validRows.length === 0) {
    return {
      observation_count: 0,
      first_observation_at: null,
      latest_observation_at: null,
      expected_cadence_minutes: DEFAULT_EXPECTED_CADENCE_MINUTES,
      max_gap_minutes: null,
      largest_gap_minutes: null,
      coverage_ratio: 0,
      has_start_coverage: false,
      has_end_coverage: false,
      has_internal_gap: false,
      data_continuous: false,
      quiet_observation_count: 0,
      quiet_proportion: null,
      active_observation_count: 0,
      stationary_duration_minutes: null,
      avg_score: null,
    };
  }

  const firstAt = validRows[0].at;
  const latestAt = validRows[validRows.length - 1].at;
  const gaps = timelineGapsMinutes(validRows.map((item) => item.row));
  const inferredCadenceMinutes =
    median(gaps.filter((gap) => Number.isFinite(gap) && gap > 0)) ??
    DEFAULT_EXPECTED_CADENCE_MINUTES;
  const expectedCadenceMinutes = Math.min(
    inferredCadenceMinutes,
    DEFAULT_EXPECTED_CADENCE_MINUTES * 2,
  );
  const maxGapMinutes = Math.max(expectedCadenceMinutes * 2.5, 15);
  const windowMinutes = Math.max(1, intervalMinutesBetween(windowStart, windowEnd));
  const observedSpanMinutes = Math.max(0, intervalMinutesBetween(firstAt, latestAt));
  const coverageRatio = Math.min(1, observedSpanMinutes / windowMinutes);
  const hasStartCoverage =
    intervalMinutesBetween(windowStart, firstAt) <= maxGapMinutes;
  const hasEndCoverage =
    intervalMinutesBetween(latestAt, windowEnd) <= maxGapMinutes;
  const largestGapMinutes = gaps.length > 0 ? Math.max(...gaps) : null;
  const hasInternalGap =
    largestGapMinutes !== null && largestGapMinutes > maxGapMinutes;

  const quietObservationCount = validRows.filter(
    ({ row }) => motionModeOfBehaviorRow(row) === "quiet",
  ).length;
  const activeObservationCount = validRows.length - quietObservationCount;
  const quietProportion = quietObservationCount / validRows.length;
  const allQuiet = quietObservationCount === validRows.length;
  const dataContinuous =
    validRows.length >= MIN_INACTIVITY_OBSERVATIONS &&
    hasStartCoverage &&
    hasEndCoverage &&
    !hasInternalGap;

  return {
    observation_count: validRows.length,
    first_observation_at: firstAt.toISOString(),
    latest_observation_at: latestAt.toISOString(),
    expected_cadence_minutes: roundTo(expectedCadenceMinutes, 2),
    max_gap_minutes: roundTo(maxGapMinutes, 2),
    largest_gap_minutes:
      largestGapMinutes !== null ? roundTo(largestGapMinutes, 2) : null,
    coverage_ratio: roundTo(coverageRatio, 3),
    has_start_coverage: hasStartCoverage,
    has_end_coverage: hasEndCoverage,
    has_internal_gap: hasInternalGap,
    data_continuous: dataContinuous,
    quiet_observation_count: quietObservationCount,
    quiet_proportion: roundTo(quietProportion, 3),
    active_observation_count: activeObservationCount,
    stationary_duration_minutes:
      dataContinuous && allQuiet ? roundTo(observedSpanMinutes, 2) : null,
    avg_score: roundTo(
      average(
        validRows
          .map(({ row }) => scoreAvgOfBehaviorRow(row))
          .filter((score) => score !== null),
      ),
      3,
    ),
  };
}

export function classifyInactiveWindow({
  latestEvent,
  behaviorRows,
  windowStart,
  windowEnd,
}) {
  const latestAt = parseIsoDate(latestEvent?.created_at);
  if (!latestAt) {
    return {
      status: "no_telemetry",
      inactive: false,
      last_communication_at: null,
      stale_or_offline: true,
      evidence: summarizeBehaviorCoverage([], windowStart, windowEnd),
    };
  }

  if (!isFreshTimestamp(latestAt, windowEnd)) {
    return {
      status: "stale_or_offline",
      inactive: false,
      last_communication_at: latestAt.toISOString(),
      stale_or_offline: true,
      evidence: summarizeBehaviorCoverage(behaviorRows, windowStart, windowEnd),
    };
  }

  const evidence = summarizeBehaviorCoverage(behaviorRows, windowStart, windowEnd);
  const coverageSufficient =
    evidence.observation_count >= MIN_INACTIVITY_OBSERVATIONS &&
    evidence.data_continuous;
  const allQuiet =
    evidence.observation_count > 0 &&
    evidence.quiet_observation_count === evidence.observation_count;
  const quietDurationSufficient =
    evidence.stationary_duration_minutes !== null &&
    evidence.stationary_duration_minutes >=
      intervalMinutesBetween(windowStart, windowEnd) - evidence.max_gap_minutes;

  if (!coverageSufficient) {
    return {
      status: "insufficient_data",
      inactive: false,
      last_communication_at: latestAt.toISOString(),
      stale_or_offline: false,
      evidence,
    };
  }

  if (!allQuiet) {
    return {
      status: "mixed_or_active",
      inactive: false,
      last_communication_at: latestAt.toISOString(),
      stale_or_offline: false,
      evidence,
    };
  }

  if (!quietDurationSufficient) {
    return {
      status: "low_activity_not_continuous_inactivity",
      inactive: false,
      last_communication_at: latestAt.toISOString(),
      stale_or_offline: false,
      evidence,
    };
  }

  return {
    status: "inactive",
    inactive: true,
    last_communication_at: latestAt.toISOString(),
    stale_or_offline: false,
    evidence,
  };
}

export function buildCompareWindowSummary(rows, windowStart, windowEnd) {
  const coverage = summarizeBehaviorCoverage(rows, windowStart, windowEnd);
  return {
    from: windowStart.toISOString(),
    to: windowEnd.toISOString(),
    observation_count: coverage.observation_count,
    first_observation_at: coverage.first_observation_at,
    latest_observation_at: coverage.latest_observation_at,
    avg_score: coverage.avg_score,
    quiet_proportion: coverage.quiet_proportion,
    data_continuous: coverage.data_continuous,
    coverage_ratio: coverage.coverage_ratio,
    stationary_duration_minutes: coverage.stationary_duration_minutes,
  };
}
