-- Canonical animal identity is separate from the physical collar/node.
-- Existing node-centric telemetry remains valid; attribution is added when an
-- assignment was provable at the event timestamp.

create table if not exists public.animals (
  id text primary key,
  farm_id uuid not null references public.farms(id) on delete restrict,
  name text,
  tag_id text,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  unique (id, farm_id)
);

create index if not exists animals_farm_id_idx
  on public.animals (farm_id);

create unique index if not exists animals_farm_tag_uidx
  on public.animals (farm_id, tag_id)
  where tag_id is not null;

create table if not exists public.animal_node_assignments (
  id uuid primary key default gen_random_uuid(),
  animal_id text not null,
  node_id text not null references public.nodes(id) on delete restrict,
  farm_id uuid not null references public.farms(id) on delete restrict,
  assigned_at timestamptz not null default timezone('utc'::text, now()),
  unassigned_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now()),

  constraint animal_node_assignments_animal_farm_fk
    foreign key (animal_id, farm_id)
    references public.animals(id, farm_id)
    on delete restrict,
  constraint animal_node_assignments_time_check
    check (unassigned_at is null or unassigned_at >= assigned_at)
);

create unique index if not exists animal_node_assignments_active_animal_uidx
  on public.animal_node_assignments (animal_id)
  where unassigned_at is null;

create unique index if not exists animal_node_assignments_active_node_uidx
  on public.animal_node_assignments (node_id)
  where unassigned_at is null;

create index if not exists animal_node_assignments_node_time_idx
  on public.animal_node_assignments (node_id, assigned_at, unassigned_at);

create index if not exists animal_node_assignments_animal_time_idx
  on public.animal_node_assignments (animal_id, assigned_at desc);

create index if not exists animal_node_assignments_farm_idx
  on public.animal_node_assignments (farm_id, assigned_at desc);

-- The server is the only writer. Read access is also kept service-role-only so
-- the public API cannot enumerate ownership assignments directly.
alter table public.animals disable row level security;
alter table public.animal_node_assignments disable row level security;
revoke all on table public.animals from public, anon, authenticated;
revoke all on table public.animal_node_assignments from public, anon, authenticated;
grant select, insert, update on table public.animals to service_role;
grant select, insert, update on table public.animal_node_assignments to service_role;

alter table public.farms
  add column if not exists timezone text;

alter table public.farms
  add constraint farms_timezone_nonempty_check
  check (timezone is null or length(trim(timezone)) > 0);

alter table public.node_events
  add column if not exists animal_id text references public.animals(id) on delete set null;

create index if not exists node_events_animal_created_idx
  on public.node_events (animal_id, created_at desc);

alter table public.behavior_features
  add column if not exists animal_id text references public.animals(id) on delete set null;

create index if not exists behavior_features_animal_created_idx
  on public.behavior_features (animal_id, created_at desc);

-- Resolve ownership at event time. The current assignment is intentionally not
-- used for historical rows: a reused collar must retain its old animal's data.
create or replace function public.attribute_node_event_animal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.animal_id is null and new.node_id is not null then
    select assignment.animal_id
      into new.animal_id
    from public.animal_node_assignments as assignment
    where assignment.node_id = new.node_id
      and assignment.assigned_at <= new.created_at
      and (
        assignment.unassigned_at is null
        or new.created_at < assignment.unassigned_at
      )
    order by assignment.assigned_at desc, assignment.created_at desc
    limit 1;
  end if;

  return new;
end;
$$;

drop trigger if exists node_events_attribute_animal on public.node_events;
create trigger node_events_attribute_animal
before insert on public.node_events
for each row execute function public.attribute_node_event_animal();

-- The assignment operation validates the node's farm through the same
-- node-event -> base -> farm ownership path used by area-status. It closes
-- active assignments before creating the replacement in one transaction.
create or replace function public.replace_animal_node_assignment(
  p_animal_id text,
  p_node_id text,
  p_farm_id uuid,
  p_assigned_at timestamptz default timezone('utc'::text, now())
)
returns setof public.animal_node_assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_animal_farm uuid;
  v_node_farm uuid;
  v_existing public.animal_node_assignments;
  v_assignment public.animal_node_assignments;
begin
  if nullif(trim(p_animal_id), '') is null then
    raise exception 'animal_id is required' using errcode = '22023';
  end if;
  if nullif(trim(p_node_id), '') is null then
    raise exception 'node_id is required' using errcode = '22023';
  end if;
  if p_farm_id is null then
    raise exception 'farm_id is required' using errcode = '22023';
  end if;

  select farm_id
    into v_animal_farm
  from public.animals
  where id = trim(p_animal_id);

  if v_animal_farm is null then
    raise exception 'animal_not_found' using errcode = '23503';
  end if;
  if v_animal_farm <> p_farm_id then
    raise exception 'animal_farm_mismatch' using errcode = '23514';
  end if;

  if not exists (select 1 from public.nodes where id = trim(p_node_id)) then
    raise exception 'node_not_found' using errcode = '23503';
  end if;

  select base.farm_id
    into v_node_farm
  from public.node_events as event
  join public.bases as base on base.id = event.base_id
  where event.node_id = trim(p_node_id)
    and event.created_at <= p_assigned_at
    and base.farm_id is not null
  order by event.created_at desc, event.id desc
  limit 1;

  if v_node_farm is null then
    raise exception 'node_farm_unresolved' using errcode = '23503';
  end if;
  if v_node_farm <> p_farm_id then
    raise exception 'node_farm_mismatch' using errcode = '23514';
  end if;

  select *
    into v_existing
  from public.animal_node_assignments
  where animal_id = trim(p_animal_id)
    and node_id = trim(p_node_id)
    and unassigned_at is null
  for update;

  if v_existing.id is not null then
    return next v_existing;
    return;
  end if;

  update public.animal_node_assignments
  set unassigned_at = p_assigned_at
  where (animal_id = trim(p_animal_id) or node_id = trim(p_node_id))
    and unassigned_at is null;

  insert into public.animal_node_assignments (
    animal_id,
    node_id,
    farm_id,
    assigned_at
  ) values (
    trim(p_animal_id),
    trim(p_node_id),
    p_farm_id,
    p_assigned_at
  )
  returning * into v_assignment;

  return next v_assignment;
end;
$$;

revoke all on function public.replace_animal_node_assignment(text, text, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.replace_animal_node_assignment(text, text, uuid, timestamptz)
  to service_role;

-- Backfill only the deterministic demo mapping. Unknown historical nodes stay
-- unresolved rather than being guessed from their display names.
with demo_nodes as (
  select
    event.node_id,
    min(event.created_at) as first_event_at,
    max(base.farm_id) as farm_id,
    max(node.name) as node_name,
    regexp_replace(event.node_id, '^demo-cow-', 'demo-animal-') as animal_id
  from public.node_events as event
  join public.bases as base on base.id = event.base_id
  join public.nodes as node on node.id = event.node_id
  where event.node_id ~ '^demo-cow-[0-9]{2}$'
    and base.farm_id is not null
  group by event.node_id
  having count(distinct base.farm_id) = 1
)
insert into public.animals (id, farm_id, name, tag_id)
select animal_id, farm_id, node_name, upper(replace(animal_id, 'demo-animal-', 'DEMO-TAG-'))
from demo_nodes
on conflict (id) do nothing;

with demo_nodes as (
  select
    event.node_id,
    min(event.created_at) as first_event_at,
    max(base.farm_id) as farm_id,
    regexp_replace(event.node_id, '^demo-cow-', 'demo-animal-') as animal_id
  from public.node_events as event
  join public.bases as base on base.id = event.base_id
  where event.node_id ~ '^demo-cow-[0-9]{2}$'
    and base.farm_id is not null
  group by event.node_id
  having count(distinct base.farm_id) = 1
)
insert into public.animal_node_assignments (animal_id, node_id, farm_id, assigned_at)
select animal_id, node_id, farm_id, first_event_at
from demo_nodes
on conflict do nothing;

update public.node_events as event
set animal_id = assignment.animal_id
from public.animal_node_assignments as assignment
where event.animal_id is null
  and event.node_id = assignment.node_id
  and assignment.assigned_at <= event.created_at
  and (assignment.unassigned_at is null or event.created_at < assignment.unassigned_at);

update public.behavior_features as feature
set animal_id = event.animal_id
from public.node_events as event
where feature.animal_id is null
  and feature.node_event_id = event.id
  and event.animal_id is not null;

-- The demo coordinates and existing farm name identify the demo farm as the
-- Terceira/Azores environment. Do not assign a timezone to arbitrary farms.
update public.farms as farm
set timezone = 'Atlantic/Azores'
where farm.timezone is null
  and lower(coalesce(farm.name, '')) = 'terceira farm'
  and exists (
    select 1
    from public.animal_node_assignments as assignment
    where assignment.farm_id = farm.id
      and assignment.node_id ~ '^demo-cow-[0-9]{2}$'
  );

-- Preserve the existing latest_node_events contract and append animal_id.
-- The view is deliberately latest-by-node; event-time attribution itself is
-- persisted on node_events by the trigger above.
create or replace view public.latest_node_events as
select latest.id,
       latest.node_id,
       latest.node_name,
       latest.base_id,
       latest.event_type,
       latest.event_data,
       latest.created_at,
       latest.animal_id
from (
  select event.id,
         event.node_id,
         node.name as node_name,
         event.base_id,
         event.event_type,
         event.event_data,
         event.created_at,
         event.animal_id,
         row_number() over (
           partition by event.node_id
           order by event.created_at desc, event.id desc
         ) as row_number
  from public.node_events as event
  left join public.nodes as node on node.id = event.node_id
) as latest
where latest.row_number = 1;

-- Append stable identity to the existing behavior view without changing the
-- existing node-centric columns consumed by current clients.
create or replace view public.latest_node_behavior as
select
  lne.id as node_event_id,
  lne.node_id,
  lne.node_name,
  lne.base_id,
  lne.event_type,
  lne.event_data,
  lne.created_at as event_created_at,
  bf.id as behavior_feature_id,
  bf.created_at as behavior_created_at,
  bf.feature_version,
  bf.movement_mode,
  bf.sample_quality,
  bf.sample_count,
  bf.valid_count,
  bf.count_mismatch,
  bf.score_min,
  bf.score_max,
  bf.score_avg,
  bf.score_range,
  bf.score_stddev,
  bf.quiet_ratio,
  bf.active_ratio,
  bf.spike_count,
  bf.inactivity_candidate,
  bf.abnormal_activity_candidate,
  bf.animal_id
from public.latest_node_events lne
left join public.behavior_features bf
  on bf.node_event_id = lne.id
  and bf.feature_version = 'phase1_v1';
