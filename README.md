# oPastor API

Node/Express API for the oPastor/Vaquinet cattle monitoring system.

This service sits between:

- base station firmware posting telemetry/status
- Supabase persistence
- FCM/push services
- the Flutter app operational overview

The current server entrypoint is `index.js`.

---

## Quick start

```bash
npm install
npm start
```

Default port:

```text
10001
```

Health check:

```http
GET /health
```

Expected response:

```json
{
  "ok": true,
  "service": "opastor-api"
}
```

---

## Endpoint documentation

See:

- [`ENDPOINTS.md`](./ENDPOINTS.md) - route structure, auth expectations, and example requests/responses
- `../contracts/telemetry_v1.md` - telemetry field contract and naming source of truth

The most important app endpoint is:

```http
GET /farm/overview
```

It returns all nodes, latest telemetry, backend-derived cow status, last coordinates, and base summaries in one request.

---

## Authentication model

Read routes are currently public.

Write routes require:

```http
Authorization: Bearer <API_TOKEN>
```

Tokens are validated by `middleware/auth.js` against configured API token storage.

Do not commit tokens, service accounts, or `.env` files.

---

## Environment variables

Firebase service account values are loaded from environment variables, not checked-in JSON files:

```text
FIREBASE_PROJECT_ID
FIREBASE_CLIENT_EMAIL
FIREBASE_PRIVATE_KEY
```

Useful test/dev variables:

```text
PORT=10001
TEST_FCM_TOKEN=<local test token>
```

---

## Current architecture notes

- `/farm/overview` is the app's primary operational read path.
- Telemetry ingestion writes extra v1 fields into JSON `event_data`; no schema change required.
- `/opastor/nodes/:id/activity` is read-only and derives compact timeline items from `node_events`.
- Backend-derived cow status is generated in `services/oPastor/farmService.js` from latest telemetry plus recent `node_events` behavior.
- Phase 1 behavior analytics stores derived motion features in `behavior_features`; raw telemetry remains immutable in `node_events`.
- Existing legacy aliases are preserved where already supported.

---

## Phase 1 Behavior Analytics

Telemetry with `event_data.motion_window.scores_hex` is still persisted as raw telemetry in `node_events`. After a successful `node_events` insert, `services/oPastor/telemetryService.js` calls `analyzeNodeEvent({ id, node_id, base_id, event_data })` from `services/oPastor/behavior/behaviorAnalysisService.js`.

The behavior hook is non-blocking for ingestion: analysis errors are logged lightly and must not fail telemetry persistence, MQTT publishing, push flow, or the API response. No alerts are created by Phase 1 behavior analysis.

Derived features are stored in `public.behavior_features` with `feature_version = phase1_v1`. This table is analytics/derived data, not raw truth. `behavior_features.node_event_id` is text, references `public.node_events(id)` with `ON DELETE CASCADE`, and is unique together with `feature_version`.

The current field data comes from a restricted, roughly 3-week-old calf moving within about a 10m radius. Treat it as restricted-mobility baseline data, not normal herd behavior. Current behavior outputs are for calibration and analysis only; they are not animal-health diagnosis.

Older telemetry rows may not have behavior rows unless they were ingested after the hook was added or are backfilled later. Backfill is intentionally not implemented yet.

### Operational verification queries

Each query returns one copyable text field.

Count motion-window telemetry since the first linked behavior row:

```sql
with first_linked as (
  select min(ne.created_at) as first_created_at
  from public.behavior_features bf
  join public.node_events ne on ne.id = bf.node_event_id
)
select
  'motion_window_events_since_first_linked_event=' ||
  count(*)::text as result
from public.node_events ne
cross join first_linked fl
where fl.first_created_at is not null
  and ne.created_at >= fl.first_created_at
  and ne.event_data ? 'motion_window';
```

Count behavior rows since the first linked behavior row:

```sql
with first_linked as (
  select min(ne.created_at) as first_created_at
  from public.behavior_features bf
  join public.node_events ne on ne.id = bf.node_event_id
)
select
  'behavior_rows_since_first_linked_event=' ||
  count(*)::text as result
from public.behavior_features bf
join public.node_events ne on ne.id = bf.node_event_id
cross join first_linked fl
where fl.first_created_at is not null
  and ne.created_at >= fl.first_created_at;
```

Count missing behavior rows since the first linked behavior row:

```sql
with first_linked as (
  select min(ne.created_at) as first_created_at
  from public.behavior_features bf
  join public.node_events ne on ne.id = bf.node_event_id
)
select
  'missing_behavior_rows_since_first_linked_event=' ||
  count(*)::text as result
from public.node_events ne
cross join first_linked fl
left join public.behavior_features bf on bf.node_event_id = ne.id
where fl.first_created_at is not null
  and ne.created_at >= fl.first_created_at
  and ne.event_data ? 'motion_window'
  and bf.id is null;
```

Latest verified live-pipeline check:

```text
motion_window_events_since_first_linked_event=2
behavior_rows_since_first_linked_event=2
missing_behavior_rows_since_first_linked_event=0
```

---

## Validation commands

Syntax check a service file:

```bash
node --check services/oPastor/farmService.js
```

Run locally on alternate port:

```bash
PORT=10141 node index.js
```

Probe overview:

```bash
node -e "fetch('http://127.0.0.1:10141/farm/overview').then(r=>r.json()).then(j=>console.log(JSON.stringify(j.nodes?.[0], null, 2)))"
```

---

## Safety rules

- No database schema changes unless explicitly planned.
- Keep write routes authenticated.
- Keep secrets in env/local ignored files only.
- Prefer additive response fields over breaking existing app contracts.
