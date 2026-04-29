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
- Existing legacy aliases are preserved where already supported.

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
