-- Personal activity is a separate signal from movement_mode and farm attention.
create table if not exists public.activity_baselines (
  animal_id text not null references public.animals(id) on delete cascade,
  farm_id uuid not null references public.farms(id) on delete restrict,
  time_bucket text not null,
  timezone text not null,
  metric text not null default 'score_avg',
  version text not null default 'activity_baseline_v1',
  history_start timestamptz not null,
  history_end timestamptz not null,
  sample_count integer not null default 0,
  sample_days integer not null default 0,
  expected_score_avg numeric,
  mad numeric,
  scale numeric,
  status text not null,
  confidence text,
  last_calculated_at timestamptz not null default timezone('utc'::text, now()),
  primary key (animal_id, farm_id, time_bucket, metric, version),
  constraint activity_baselines_status_check check (status in ('insufficient_data', 'learning', 'baseline_ready', 'unknown'))
);

create index if not exists activity_baselines_farm_status_idx
  on public.activity_baselines (farm_id, status);

create table if not exists public.activity_baseline_assessments (
  id uuid primary key default gen_random_uuid(),
  animal_id text not null references public.animals(id) on delete cascade,
  farm_id uuid not null references public.farms(id) on delete restrict,
  node_event_id text not null references public.node_events(id) on delete cascade,
  behavior_feature_id uuid references public.behavior_features(id) on delete set null,
  observed_at timestamptz not null,
  current_score_avg numeric,
  expected_score_avg numeric,
  deviation_percent numeric,
  robust_z numeric,
  assessment text not null,
  candidate_assessment text,
  anomaly_since timestamptz,
  duration_minutes integer not null default 0,
  consecutive_anomalous_windows integer not null default 0,
  consecutive_recovery_windows integer not null default 0,
  data_quality text not null,
  status text not null,
  sample_days integer not null default 0,
  sample_count integer not null default 0,
  time_bucket text,
  timezone text,
  metric text not null default 'score_avg',
  version text not null default 'activity_baseline_v1',
  created_at timestamptz not null default timezone('utc'::text, now()),
  unique (animal_id, node_event_id, version),
  constraint activity_baseline_assessment_check check (assessment in ('normal', 'below_baseline', 'significantly_below_baseline', 'above_baseline', 'significantly_above_baseline', 'insufficient_data', 'unknown'))
);

create index if not exists activity_baseline_assessments_animal_time_idx
  on public.activity_baseline_assessments (animal_id, observed_at desc);

create index if not exists activity_baseline_assessments_farm_assessment_idx
  on public.activity_baseline_assessments (farm_id, assessment, observed_at desc);

create or replace view public.latest_animal_activity_baseline as
select distinct on (assessment.animal_id)
  assessment.id,
  assessment.animal_id,
  assessment.farm_id,
  assessment.node_event_id,
  assessment.behavior_feature_id,
  assessment.observed_at,
  assessment.current_score_avg,
  assessment.expected_score_avg,
  assessment.deviation_percent,
  assessment.robust_z,
  assessment.assessment,
  assessment.candidate_assessment,
  assessment.anomaly_since,
  assessment.duration_minutes,
  assessment.consecutive_anomalous_windows,
  assessment.consecutive_recovery_windows,
  assessment.data_quality,
  assessment.status,
  assessment.sample_days,
  assessment.sample_count,
  assessment.confidence,
  assessment.time_bucket,
  assessment.timezone,
  assessment.metric,
  assessment.version,
  assessment.created_at
from public.activity_baseline_assessments as assessment
order by assessment.animal_id, assessment.observed_at desc, assessment.created_at desc;

alter table public.activity_baselines disable row level security;
alter table public.activity_baseline_assessments disable row level security;
revoke all on table public.activity_baselines from public, anon, authenticated;
revoke all on table public.activity_baseline_assessments from public, anon, authenticated;
grant select, insert, update on table public.activity_baselines to service_role;
grant select, insert, update on table public.activity_baseline_assessments to service_role;
