-- Management context for a known herd/animal move between existing farm fences.
-- This deliberately does not alter baseline identity or baseline calculations.

create table if not exists public.animal_management_events (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete restrict,
  event_type text not null default 'field_change',
  from_field_id uuid references public.fences(id) on delete restrict,
  to_field_id uuid not null references public.fences(id) on delete restrict,
  started_at timestamptz not null,
  transition_until timestamptz not null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  created_by text,
  metadata jsonb not null default '{}'::jsonb,
  constraint animal_management_events_type_check
    check (event_type = 'field_change'),
  constraint animal_management_events_window_check
    check (transition_until > started_at)
);

create table if not exists public.animal_management_event_animals (
  event_id uuid not null references public.animal_management_events(id) on delete cascade,
  animal_id text not null references public.animals(id) on delete cascade,
  primary key (event_id, animal_id)
);

create index if not exists animal_management_events_farm_started_idx
  on public.animal_management_events (farm_id, started_at desc);

create index if not exists animal_management_events_active_idx
  on public.animal_management_events (transition_until, started_at desc);

create index if not exists animal_management_event_animals_animal_idx
  on public.animal_management_event_animals (animal_id, event_id);

alter table public.animal_management_events disable row level security;
alter table public.animal_management_event_animals disable row level security;
revoke all on table public.animal_management_events from public, anon, authenticated;
revoke all on table public.animal_management_event_animals from public, anon, authenticated;
grant select, insert on table public.animal_management_events to service_role;
grant select, insert on table public.animal_management_event_animals to service_role;
