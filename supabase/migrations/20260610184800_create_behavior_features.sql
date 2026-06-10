create table if not exists public.behavior_features (
  id uuid primary key default gen_random_uuid(),
  node_event_id text not null references public.node_events(id) on delete cascade,
  node_id text,
  base_id text,
  feature_version text not null default 'phase1_v1',
  sample_count integer,
  valid_count integer,
  sample_quality text,
  count_mismatch boolean not null default false,
  score_min integer,
  score_max integer,
  score_avg numeric,
  score_range integer,
  score_stddev numeric,
  quiet_ratio numeric,
  active_ratio numeric,
  spike_count integer,
  movement_mode text,
  inactivity_candidate boolean not null default false,
  abnormal_activity_candidate boolean not null default false,
  created_at timestamptz not null default timezone('utc'::text, now()),

  constraint behavior_features_node_event_feature_version_key
    unique (node_event_id, feature_version)
);

create index if not exists behavior_features_node_event_id_idx
  on public.behavior_features (node_event_id);

create index if not exists behavior_features_node_id_created_at_idx
  on public.behavior_features (node_id, created_at desc);

create index if not exists behavior_features_created_at_idx
  on public.behavior_features (created_at desc);

create index if not exists behavior_features_movement_mode_idx
  on public.behavior_features (movement_mode);
