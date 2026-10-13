-- U03 Slice 1: producer identity for additive, idempotent raw-event storage.
-- Legacy rows and the existing node_events trigger/foreign keys remain intact.
alter table public.node_events
  add column producer_namespace text,
  add column event_key text,
  add column payload_digest text;

-- Keep this non-partial so PostgREST/Supabase can infer the exact
-- (producer_namespace,event_key) conflict target. PostgreSQL permits multiple
-- NULLs in a normal unique index, preserving legacy rows without identity.
create unique index node_events_producer_event_key_uidx
  on public.node_events (producer_namespace, event_key);
