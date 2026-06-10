# oPastor API Endpoints

Base URL:

- Local default: `http://localhost:10001`
- Production example: `https://vaquinet-api.onrender.com`

All JSON write routes require:

```http
Authorization: Bearer <API_TOKEN>
Content-Type: application/json
```

Read routes are currently public unless explicitly noted otherwise. Do not put secrets in this file.

---

## Health

### `GET /health`

Simple process check.

Example response:

```json
{
  "ok": true,
  "service": "opastor-api"
}
```

---

## Farm overview

### `GET /farm/overview`

Primary operational read endpoint for the mobile app. Returns all nodes with latest telemetry, nullable Phase 1 behavior analytics, last known coordinates, backend-derived status, and latest base statuses.

Example response:

```json
{
  "nodes": [
    {
      "id": "ESPCOW_cow_0",
      "name": "Cow 0",
      "tag_id": "cow_0",
      "birth_date": null,
      "breed": null,
      "status": "active",
      "created_at": "2026-04-29T10:00:00.000Z",
      "latest_event": {
        "id": "event_uuid",
        "node_id": "ESPCOW_cow_0",
        "base_id": "base_001",
        "event_type": "telemetry",
        "created_at": "2026-04-29T20:30:00.000Z",
        "event_data": {
          "telemetry_flags": 3,
          "latitude": 37.741,
          "longitude": -25.675,
          "motion_state": 2,
          "node_battery_voltage": 3.92,
          "isAlerted": false
        }
      },
      "derived_status": {
        "label": "Normal",
        "severity": "normal",
        "reason": null
      },
      "behavior": {
        "node_event_id": "event_uuid",
        "behavior_feature_id": "feature_uuid",
        "behavior_created_at": "2026-06-10T20:00:00.000Z",
        "movement_mode": "active_local",
        "sample_quality": "ok",
        "sample_count": 14,
        "valid_count": 14,
        "count_mismatch": false,
        "score_min": 30,
        "score_max": 55,
        "score_avg": 43.57142857142857,
        "score_range": 25,
        "score_stddev": 8.4,
        "quiet_ratio": 0,
        "active_ratio": 1,
        "spike_count": 0,
        "inactivity_candidate": false,
        "abnormal_activity_candidate": false
      },
      "last_lat": 37.741,
      "last_lng": -25.675
    }
  ],
  "bases": [
    {
      "base_id": "base_001",
      "status_type": "heartbeat",
      "created_at": "2026-04-29T20:30:00.000Z",
      "status_data": {
        "backhaul_name": "MEO",
        "backhaul_signal_percent": "80",
        "base_battery_percent": 92
      }
    }
  ]
}
```

### `derived_status` rules

Priority order:

1. `Offline` / `offline`
   - no latest event
   - or latest event older than the configured offline threshold
2. `Alerta` / `alert`
   - latest or recent event has explicit alert flag (`isAlerted`, `is_alerted`, `alertType`, `alert_type`)
3. `Atenção` / `attention`
   - node battery below `3.6V`
   - GPS expected by telemetry flags but latest fix is invalid/missing
   - `motion_state == 3` repeated in recent behavior window
   - repeated stillness in recent behavior window
4. `Normal` / `normal`
   - none of the above

Recent behavior is fetched in bulk from `node_events` for all nodes to avoid N+1 queries.

### `behavior` object

`behavior` is a nullable Phase 1 analytics object from `public.latest_node_behavior`. It is read-only display support for calibration and analysis, not diagnosis, prediction, or alerting. If the latest event has no matching behavior row yet, `behavior` is `null`.

Example REST probe:

```bash
curl http://localhost:10001/farm/overview
```

---

## Nodes

Mounted under `/opastor/nodes`.

### `GET /opastor/nodes`

List nodes.

### `GET /opastor/nodes/:id`

Get one node by id.

### `GET /opastor/nodes/latest/:id`

Get latest node event.

### `GET /opastor/nodes/:id/events`

Get event history for a node.

### `GET /opastor/nodes/:id/activity?limit=20&include_gps=false`

Read-only compact activity timeline derived from existing `node_events.event_data`.

Query params:

- `limit`: default `20`, max `100`
- `include_gps`: default `false`; set `true` or `1` to include noisy `GPS fix` items

Example response:

```json
{
  "node_id": "ESPCOW_cow_0",
  "items": [
    {
      "type": "motion",
      "label": "Walking",
      "severity": "normal",
      "created_at": "2026-04-29T20:30:00.000Z"
    },
    {
      "type": "battery",
      "label": "Low battery",
      "severity": "attention",
      "created_at": "2026-04-29T20:20:00.000Z"
    }
  ]
}
```

### `POST /opastor/nodes` 🔒

Create node.

Example body:

```json
{
  "id": "ESPCOW_cow_0",
  "name": "Cow 0",
  "tag_id": "cow_0",
  "birth_date": null,
  "breed": "Holstein",
  "status": "active"
}
```

### `PUT /opastor/nodes/:id` 🔒

Update node metadata.

### `DELETE /opastor/nodes/:id` 🔒

Delete node.

### `POST /opastor/nodes/batch` 🔒

Batch insert nodes.

Example body:

```json
{
  "data": [
    {
      "id": "ESPCOW_cow_0",
      "name": "Cow 0",
      "tag_id": "cow_0"
    }
  ]
}
```

### `POST /opastor/nodes/sensors` 🔒

Legacy sensor ingestion route. Keep for compatibility.

### `POST /opastor/nodes/telemetry/batch` 🔒

Base station telemetry ingestion. Persists canonical telemetry fields inside `event_data` without schema changes.

When a telemetry event includes `event_data.motion_window`, Phase 1 behavior analytics decodes `motion_window.scores_hex` and stores derived features in `public.behavior_features` after the raw `node_events` row is inserted. Raw `node_events` remains the source of truth; `behavior_features` is derived analytics data.

Behavior analysis is non-blocking. If feature extraction or insert fails, telemetry ingestion, MQTT publishing, push flow, and the HTTP response should continue. Phase 1 behavior analytics does not create alerts and does not change app-facing status.

`public.latest_node_behavior` is the read-only latest-node behavior display view. It joins `public.latest_node_events` to `public.behavior_features` for `feature_version = phase1_v1`, keeping latest node events visible even when behavior fields are still `null`.

Older motion-window telemetry may not have `behavior_features` rows unless it was ingested after the hook was added or a backfill is implemented later. Backfill is intentionally not implemented yet.

Example body:

```json
{
  "base_id": "base_001",
  "events": [
    {
      "node_id": "ESPCOW_cow_0",
      "event_type": "telemetry",
      "event_data": {
        "telemetry_flags": 3,
        "latitude": 37.741,
        "longitude": -25.675,
        "motion_state": 2,
        "motion_score": 61,
        "motion_window": {
          "avg": 45,
          "max": 163,
          "min": 3,
          "count": 14,
          "valid": 14,
          "spikes": 0,
          "interval_s": 60,
          "scores_hex": "1E161B111C1A11300352A3153965"
        },
        "lora_rssi": "-92",
        "lora_snr": "7.5",
        "node_battery_voltage": 3.92,
        "node_vbus": 1,
        "isAlerted": false
      }
    }
  ]
}
```

---

## Bases

Mounted under `/opastor/bases`.

### `POST /opastor/bases/status` 🔒

Base heartbeat/status ingestion.

Example body:

```json
{
  "base_id": "base_001",
  "status_type": "heartbeat",
  "status_data": {
    "backhaul_name": "MEO",
    "backhaul_signal_percent": "80",
    "base_battery_percent": 92,
    "base_vbus": true
  }
}
```

---

## Alerts

Mounted under `/opastor/alerts`.

- `GET /opastor/alerts` - list alerts
- `POST /opastor/alerts` 🔒 - create alert
- `PATCH /opastor/alerts/:id/sent` 🔒 - mark alert sent

---

## Fences

Mounted under `/opastor/fences`.

- `GET /opastor/fences` - list fences
- `GET /opastor/fences/check` - check point against fences
- `GET /opastor/fences/:id` - get fence by UUID
- `POST /opastor/fences` 🔒 - create fence
- `PUT /opastor/fences/:id` 🔒 - update fence
- `DELETE /opastor/fences/:id` 🔒 - delete fence

Example create body:

```json
{
  "name": "North field",
  "points": [
    { "lat": 37.741, "lng": -25.675 },
    { "lat": 37.742, "lng": -25.676 },
    { "lat": 37.743, "lng": -25.674 }
  ]
}
```

---

## Config

Mounted under `/opastor/config`.

- `GET /opastor/config/:key` - read config key
- `POST /opastor/config` 🔒 - set config key
- `GET /opastor/config/fcm/token` - latest FCM token
- `POST /opastor/config/fcm/token` 🔒 - save FCM token

---

## Orders

Mounted under `/opastor/orders`.

- `GET /opastor/orders` - list orders
- `POST /opastor/orders` 🔒 - create order
- `GET /opastor/orders/mark/:id` - legacy mark complete route
- `GET /opastor/orders/mark-delivered/:odeId` - legacy mark delivered by node route

---

## Phonebook

Mounted under `/opastor/phonebook`.

- `GET /opastor/phonebook` - list contacts
- `POST /opastor/phonebook` 🔒 - add contact
- `DELETE /opastor/phonebook/:id` 🔒 - delete contact

---

## Trails

Mounted under `/trails`.

This route exists for compatibility. Check `routes/trails/` before extending it; current oPastor mobile work does not depend on it.

---

## Notes for implementers

- Do not change database schema casually; current telemetry extensions live in JSON fields.
- Keep `/farm/overview` as the app's primary operational read endpoint.
- Keep activity history read-only and derived from `node_events`.
- Keep behavior analysis out of routes; Phase 1 runs after telemetry persistence through `services/oPastor/behavior/behaviorAnalysisService.js`.
- Keep behavior analytics non-blocking. It must not break raw telemetry ingestion.
- Use `public.latest_node_behavior` for read-only latest telemetry plus Phase 1 behavior display data.
- Treat Phase 1 behavior outputs as calibration/analysis only, not animal-health diagnosis.
- Prefer adding fields over breaking existing response shape.
- Keep writes behind bearer auth.
