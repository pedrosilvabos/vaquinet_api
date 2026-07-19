create table if not exists public.node_gps_config (
  id uuid primary key default gen_random_uuid(),
  node_id text not null references public.nodes(id) on delete cascade,
  gps_config_version integer not null default 1,
  gps_profile text not null,
  gps_enabled boolean not null,
  gps_attempt_interval_minutes integer,
  gps_max_acquire_seconds integer not null,
  locate_boost_until_epoch bigint,
  locate_boost_interval_minutes integer,
  locate_boost_max_acquire_seconds integer,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),

  constraint node_gps_config_profile_check
    check (gps_profile in ('off', 'occasional', 'balanced', 'frequent')),
  constraint node_gps_config_version_check
    check (gps_config_version >= 1),
  constraint node_gps_config_interval_check
    check (
      gps_attempt_interval_minutes is null
      or gps_attempt_interval_minutes >= 30
    ),
  constraint node_gps_config_acquire_check
    check (gps_max_acquire_seconds >= 0 and gps_max_acquire_seconds <= 40),
  constraint node_gps_config_locate_until_check
    check (locate_boost_until_epoch is null or locate_boost_until_epoch = 0),
  constraint node_gps_config_locate_interval_check
    check (
      locate_boost_interval_minutes is null
      or locate_boost_interval_minutes = 0
    ),
  constraint node_gps_config_locate_acquire_check
    check (
      locate_boost_max_acquire_seconds is null
      or locate_boost_max_acquire_seconds = 0
    )
);

create unique index if not exists node_gps_config_node_id_uidx
  on public.node_gps_config (node_id);

create index if not exists node_gps_config_updated_at_idx
  on public.node_gps_config (updated_at desc);

alter table public.node_gps_config disable row level security;

grant select, insert, update on public.node_gps_config
  to anon, authenticated, service_role;

create or replace function public.upsert_node_gps_config(
  p_node_id text,
  p_gps_profile text,
  p_gps_enabled boolean,
  p_gps_attempt_interval_minutes integer,
  p_gps_max_acquire_seconds integer,
  p_locate_boost_until_epoch bigint,
  p_locate_boost_interval_minutes integer,
  p_locate_boost_max_acquire_seconds integer
)
returns setof public.node_gps_config
language sql
security definer
set search_path = public
as $$
  insert into public.node_gps_config (
    node_id,
    gps_profile,
    gps_enabled,
    gps_attempt_interval_minutes,
    gps_max_acquire_seconds,
    locate_boost_until_epoch,
    locate_boost_interval_minutes,
    locate_boost_max_acquire_seconds
  )
  values (
    p_node_id,
    p_gps_profile,
    p_gps_enabled,
    p_gps_attempt_interval_minutes,
    p_gps_max_acquire_seconds,
    p_locate_boost_until_epoch,
    p_locate_boost_interval_minutes,
    p_locate_boost_max_acquire_seconds
  )
  on conflict (node_id) do update
  set
    gps_profile = excluded.gps_profile,
    gps_enabled = excluded.gps_enabled,
    gps_attempt_interval_minutes = excluded.gps_attempt_interval_minutes,
    gps_max_acquire_seconds = excluded.gps_max_acquire_seconds,
    locate_boost_until_epoch = excluded.locate_boost_until_epoch,
    locate_boost_interval_minutes = excluded.locate_boost_interval_minutes,
    locate_boost_max_acquire_seconds = excluded.locate_boost_max_acquire_seconds,
    gps_config_version = case
      when public.node_gps_config.gps_profile is distinct from excluded.gps_profile
        or public.node_gps_config.gps_enabled is distinct from excluded.gps_enabled
        or public.node_gps_config.gps_attempt_interval_minutes is distinct from excluded.gps_attempt_interval_minutes
        or public.node_gps_config.gps_max_acquire_seconds is distinct from excluded.gps_max_acquire_seconds
        or public.node_gps_config.locate_boost_until_epoch is distinct from excluded.locate_boost_until_epoch
        or public.node_gps_config.locate_boost_interval_minutes is distinct from excluded.locate_boost_interval_minutes
        or public.node_gps_config.locate_boost_max_acquire_seconds is distinct from excluded.locate_boost_max_acquire_seconds
      then public.node_gps_config.gps_config_version + 1
      else public.node_gps_config.gps_config_version
    end,
    updated_at = case
      when public.node_gps_config.gps_profile is distinct from excluded.gps_profile
        or public.node_gps_config.gps_enabled is distinct from excluded.gps_enabled
        or public.node_gps_config.gps_attempt_interval_minutes is distinct from excluded.gps_attempt_interval_minutes
        or public.node_gps_config.gps_max_acquire_seconds is distinct from excluded.gps_max_acquire_seconds
        or public.node_gps_config.locate_boost_until_epoch is distinct from excluded.locate_boost_until_epoch
        or public.node_gps_config.locate_boost_interval_minutes is distinct from excluded.locate_boost_interval_minutes
        or public.node_gps_config.locate_boost_max_acquire_seconds is distinct from excluded.locate_boost_max_acquire_seconds
      then timezone('utc'::text, now())
      else public.node_gps_config.updated_at
    end
  returning *;
$$;

grant execute on function public.upsert_node_gps_config(
  text,
  text,
  boolean,
  integer,
  integer,
  bigint,
  integer,
  integer
) to anon, authenticated, service_role;
