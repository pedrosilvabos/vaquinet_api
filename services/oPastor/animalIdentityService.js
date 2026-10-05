import { opastorDb as supabase, getOpastorServiceDb } from "../../config/supabase.js";

export function isValidIanaTimezone(value) {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function localTimeParts(instant, timeZone) {
  if (!isValidIanaTimezone(timeZone)) {
    throw new Error("invalid_iana_timezone");
  }

  const date = instant instanceof Date ? instant : new Date(instant);
  if (!Number.isFinite(date.getTime())) throw new Error("invalid_timestamp");

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    date: `${values.year}-${values.month}-${values.day}`,
  };
}

export function farmLocalTwoHourBucket(instant, timeZone) {
  const local = localTimeParts(instant, timeZone);
  const startHour = Math.floor(local.hour / 2) * 2;
  const pad = (value) => String(value).padStart(2, "0");
  return {
    localDate: local.date,
    bucket: `${pad(startHour)}:00-${pad((startHour + 2) % 24)}:00`,
    timeZone,
  };
}

export function resolveAssignmentForEvent(assignments, nodeId, eventTimestamp) {
  const timestamp = new Date(eventTimestamp).getTime();
  if (!nodeId || !Number.isFinite(timestamp)) return null;

  return (assignments || [])
    .filter((assignment) => {
      const assignedAt = new Date(assignment.assigned_at).getTime();
      const unassignedAt = assignment.unassigned_at
        ? new Date(assignment.unassigned_at).getTime()
        : null;
      return (
        assignment.node_id === nodeId &&
        Number.isFinite(assignedAt) &&
        assignedAt <= timestamp &&
        (unassignedAt === null || timestamp < unassignedAt)
      );
    })
    .sort(
      (left, right) =>
        new Date(right.assigned_at).getTime() -
        new Date(left.assigned_at).getTime(),
    )[0] ?? null;
}

export async function getFarmTimezone(farmId, db = supabase) {
  if (!farmId) return { status: "unresolved", farmId: null, timezone: null };

  const { data, error } = await db
    .from("farms")
    .select("id,timezone")
    .eq("id", farmId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { status: "not_found", farmId, timezone: null };
  if (!data.timezone) return { status: "unconfigured", farmId, timezone: null };
  if (!isValidIanaTimezone(data.timezone)) {
    return { status: "invalid", farmId, timezone: data.timezone };
  }
  return { status: "resolved", farmId, timezone: data.timezone };
}

function assignmentErrorStatus(error) {
  const code = error?.code;
  if (["23503", "23514", "23505", "22023"].includes(code)) return 409;
  return 500;
}

const animalIdentityService = {
  async getCurrentNodeAssignment(req, res) {
    const animalId = req.params.animalId?.trim();
    if (!animalId) return res.status(400).json({ error: "animal_id_required" });

    try {
      const db = getOpastorServiceDb();
      const { data, error } = await db
        .from("animal_node_assignments")
        .select("id,animal_id,node_id,farm_id,assigned_at,unassigned_at")
        .eq("animal_id", animalId)
        .is("unassigned_at", null)
        .maybeSingle();
      if (error) throw error;
      return res.json({ assignment: data ?? null });
    } catch (error) {
      console.error("[GET] Current animal assignment failed", {
        animalId,
        error: error?.message ?? String(error),
      });
      return res.status(500).json({ error: "animal_assignment_lookup_failed" });
    }
  },

  async getFarmTimezone(req, res) {
    try {
      const result = await getFarmTimezone(req.params.farmId);
      if (result.status === "not_found") {
        return res.status(404).json({ error: "farm_not_found" });
      }
      if (result.status === "unconfigured" || result.status === "invalid") {
        return res.status(409).json({
          error: "farm_timezone_unavailable",
          farm_id: result.farmId,
          timezone: result.timezone,
        });
      }
      return res.json({ farm_id: result.farmId, timezone: result.timezone });
    } catch (error) {
      console.error("[GET] Farm timezone lookup failed", {
        farmId: req.params.farmId,
        error: error?.message ?? String(error),
      });
      return res.status(500).json({ error: "farm_timezone_lookup_failed" });
    }
  },

  async setFarmTimezone(req, res) {
    const farmId = req.params.farmId?.trim();
    const timezone = req.body?.timezone?.trim();
    if (!farmId || !timezone) {
      return res.status(400).json({ error: "farm_id_and_timezone_required" });
    }
    if (!isValidIanaTimezone(timezone)) {
      return res.status(400).json({ error: "invalid_iana_timezone" });
    }

    try {
      const db = getOpastorServiceDb();
      const { data, error } = await db
        .from("farms")
        .update({ timezone })
        .eq("id", farmId)
        .select("id,timezone")
        .maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: "farm_not_found" });
      return res.json({ farm_id: data.id, timezone: data.timezone });
    } catch (error) {
      console.error("[PUT] Farm timezone update failed", {
        farmId,
        error: error?.message ?? String(error),
      });
      return res.status(500).json({ error: "farm_timezone_update_failed" });
    }
  },

  async replaceNodeAssignment(req, res) {
    const animalId = req.params.animalId?.trim();
    const nodeId = req.body?.node_id?.trim();
    const farmId = req.body?.farm_id?.trim();
    const assignedAt = req.body?.assigned_at || undefined;

    if (!animalId || !nodeId || !farmId) {
      return res.status(400).json({
        error: "animal_id_node_id_and_farm_id_required",
      });
    }

    if (assignedAt && !Number.isFinite(new Date(assignedAt).getTime())) {
      return res.status(400).json({ error: "invalid_assigned_at" });
    }

    try {
      const db = getOpastorServiceDb();
      const { data, error } = await db.rpc("replace_animal_node_assignment", {
        p_animal_id: animalId,
        p_node_id: nodeId,
        p_farm_id: farmId,
        ...(assignedAt ? { p_assigned_at: new Date(assignedAt).toISOString() } : {}),
      });
      if (error) throw error;
      return res.status(200).json({ assignment: Array.isArray(data) ? data[0] : data });
    } catch (error) {
      console.error("[POST] Animal/node assignment failed", {
        animalId,
        nodeId,
        farmId,
        reason: error?.message ?? String(error),
        code: error?.code ?? null,
      });
      return res.status(assignmentErrorStatus(error)).json({
        error: error?.message || "animal_node_assignment_failed",
      });
    }
  },
};

export default animalIdentityService;
