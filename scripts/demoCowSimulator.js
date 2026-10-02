import "dotenv/config";
import { pathToFileURL } from "node:url";

import {
  buildSimulationBatch,
  isStepAlreadyApplied,
  parseSimulatorConfig,
} from "./demoCowSimulatorState.js";

async function getLatestEvents(apiUrl) {
  const response = await fetch(`${apiUrl}/farm/overview`);
  if (!response.ok) throw new Error(`overview lookup failed: HTTP ${response.status}`);
  const overview = await response.json();
  return new Map((overview.nodes || []).map((node) => [node.id, node.latest_event]));
}

async function filterAlreadyApplied(config, batch) {
  const pending = [];
  let skipped = 0;
  const latestEvents = await getLatestEvents(config.apiUrl);

  for (const item of batch) {
    const latest = latestEvents.get(item.node_id) || null;
    if (isStepAlreadyApplied(latest, item.event_data.simulation_step_key)) {
      skipped += 1;
    } else {
      pending.push(item);
    }
  }

  return { pending, skipped };
}

export async function run(env = process.env, now = new Date()) {
  const config = parseSimulatorConfig(env);
  const batch = buildSimulationBatch({ ...config, now });
  const { pending, skipped } = await filterAlreadyApplied(config, batch);

  if (pending.length === 0) {
    console.log(`[demo-simulator] step already applied; skipped=${skipped}`);
    return { stepKey: batch[0]?.event_data.simulation_step_key, posted: 0, skipped };
  }

  const response = await fetch(`${config.apiUrl}/opastor/nodes/telemetry/batch`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ data: pending }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`telemetry batch failed: HTTP ${response.status} ${body.slice(0, 300)}`);
  }

  const result = await response.json();
  console.log(`[demo-simulator] step=${batch[0]?.event_data.simulation_step_key} posted=${pending.length} skipped=${skipped}`);
  return { stepKey: batch[0]?.event_data.simulation_step_key, posted: pending.length, skipped, result };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(`[demo-simulator] ${error.message}`);
    process.exitCode = 1;
  });
}
