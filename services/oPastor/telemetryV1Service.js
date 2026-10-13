import crypto from "node:crypto";
import { opastorDb as defaultDb } from "../../config/supabase.js";
import { analyzeNodeEvent as defaultAnalyzeNodeEvent } from "./behavior/behaviorAnalysisService.js";

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

export function canonicalEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new Error("event must be an object");
  }
  const nodeId = typeof event.node_id === "string" ? event.node_id.trim() : "";
  const eventType = typeof event.event_type === "string" ? event.event_type.trim() : "";
  const baseId = event.base_id == null ? null : String(event.base_id).trim() || null;
  if (!nodeId || !eventType || !event.event_data || typeof event.event_data !== "object" || Array.isArray(event.event_data)) {
    throw new Error("event requires node_id, base_id, event_type and object event_data");
  }
  return {
    node_id: nodeId,
    base_id: baseId,
    event_type: eventType,
    event_data: stableValue(event.event_data),
  };
}

export function eventDigest(event) {
  const canonical = canonicalEvent(event);
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex")}`;
}

function validateRequest(body) {
  if (!body || body.protocol_version !== 1) {
    return "unsupported protocol_version";
  }
  if (typeof body.producer_namespace !== "string" || !body.producer_namespace.trim()) {
    return "missing producer_namespace";
  }
  if (typeof body.event_key !== "string" || !body.event_key.trim()) {
    return "missing event_key";
  }
  if (typeof body.payload_digest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(body.payload_digest)) {
    return "invalid payload_digest";
  }
  if (body.data !== undefined || body.events !== undefined) {
    return "v1 requires one event object, not a batch array";
  }
  try {
    const event = canonicalEvent(body.event);
    if (eventDigest(event) !== body.payload_digest) return "payload_digest mismatch";
  } catch (error) {
    return error.message;
  }
  return null;
}

const eventSelect = "id,node_id,base_id,animal_id,event_data,created_at,producer_namespace,event_key,payload_digest";

async function storeOrResolve(db, event, body) {
  const row = {
    ...event,
    producer_namespace: body.producer_namespace.trim(),
    event_key: body.event_key.trim(),
    payload_digest: body.payload_digest,
  };
  const result = await db
    .from("node_events")
    .upsert([row], { onConflict: "producer_namespace,event_key", ignoreDuplicates: true })
    .select(eventSelect)
    .maybeSingle();
  if (result.error) throw result.error;
  if (result.data) return { status: "stored", row: result.data };

  const replay = await db
    .from("node_events")
    .select(eventSelect)
    .eq("producer_namespace", row.producer_namespace)
    .eq("event_key", row.event_key)
    .maybeSingle();
  if (replay.error) throw replay.error;
  if (!replay.data) throw new Error("idempotency lookup returned no row");
  if (replay.data.payload_digest !== row.payload_digest) {
    const conflict = new Error("event_key_conflict");
    conflict.code = "event_key_conflict";
    throw conflict;
  }
  return { status: "already_stored", row: replay.data };
}

export function createTelemetryV1Handler({ db = defaultDb, analyze = defaultAnalyzeNodeEvent } = {}) {
  return async function telemetryV1(req, res) {
    const validationError = validateRequest(req.body);
    if (validationError) return res.status(400).json({ error: validationError });

    const body = req.body;
    const event = canonicalEvent(body.event);
    let stored;
    try {
      stored = await storeOrResolve(db, event, body);
    } catch (error) {
      if (error.code === "event_key_conflict") {
        return res.status(409).json({ protocol_version: 1, event_key: body.event_key, error: "event_key_conflict" });
      }
      console.error("[telemetry-v1] raw storage failed:", error?.message || error);
      return res.status(503).json({ protocol_version: 1, event_key: body.event_key, error: "raw_storage_unavailable", retryable: true });
    }

    let analysis = { status: "pending" };
    if (stored.status === "stored") {
      try {
        const result = await analyze({
          id: stored.row.id,
          node_id: stored.row.node_id,
          animal_id: stored.row.animal_id,
          base_id: stored.row.base_id,
          event_data: stored.row.event_data,
          created_at: stored.row.created_at,
        });
        analysis = { status: result?.ok === false ? "failed" : "complete" };
      } catch (error) {
        console.warn("[telemetry-v1] analysis failed after raw storage:", error?.message || error);
        analysis = { status: "failed" };
      }
    }

    return res.status(stored.status === "stored" ? 201 : 200).json({
      protocol_version: 1,
      event_key: body.event_key,
      payload_digest: body.payload_digest,
      storage: { status: stored.status, event_id: stored.row.id },
      analysis,
      retryable: false,
    });
  };
}

export const telemetryV1 = createTelemetryV1Handler();
