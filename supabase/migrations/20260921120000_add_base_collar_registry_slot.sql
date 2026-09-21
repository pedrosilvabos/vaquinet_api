-- Radio slots are provisioning data, never an interpretation of cow_id text.
alter table public.base_collar_registry
  add column if not exists slot integer;

-- Existing rows predate explicit slot assignment. Give each Base a stable,
-- deterministic slot based on its already-persisted registry order; future
-- allocations are made by the provisioning RPC below.
with numbered as (
  select base_id,
         collar_id,
         row_number() over (
           partition by base_id
           order by created_at asc, collar_id asc
         ) - 1 as assigned_slot
  from public.base_collar_registry
  where slot is null
)
update public.base_collar_registry registry
set slot = numbered.assigned_slot
from numbered
where registry.base_id = numbered.base_id
  and registry.collar_id = numbered.collar_id;

alter table public.base_collar_registry
  alter column slot set not null,
  add constraint base_collar_registry_slot_check check (slot between 0 and 31);

create unique index if not exists base_collar_registry_active_slot_uidx
  on public.base_collar_registry (base_id, slot)
  where active;

-- New overload preserves the old four-argument function for any older server
-- callers. When no slot is supplied, the server assigns the lowest free slot;
-- the resulting explicit slot is returned and replicated to the Base.
create or replace function public.upsert_base_collar_registry_entry(
  p_base_id text,
  p_collar_id text,
  p_cow_id text,
  p_active boolean,
  p_slot integer
)
returns setof public.base_collar_registry
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revision bigint;
  v_slot integer;
begin
  if p_base_id is null or length(trim(p_base_id)) = 0 then
    raise exception 'base_id is required';
  end if;
  if p_collar_id is null or p_collar_id !~ '^[0-9A-F]{12}$' then
    raise exception 'collar_id must be a 12-character uppercase NRF device address';
  end if;
  if p_cow_id is null or length(trim(p_cow_id)) = 0 then
    raise exception 'cow_id is required';
  end if;
  if p_slot is not null and p_slot not between 0 and 31 then
    raise exception 'slot must be between 0 and 31';
  end if;

  select slot into v_slot
    from public.base_collar_registry
    where base_id = trim(p_base_id) and collar_id = p_collar_id;

  if p_slot is not null then
    v_slot := p_slot;
  elsif v_slot is null then
    select candidate.slot into v_slot
      from generate_series(0, 31) as candidate(slot)
      where not exists (
        select 1
          from public.base_collar_registry existing
         where existing.base_id = trim(p_base_id)
           and existing.active
           and existing.slot = candidate.slot
      )
      order by candidate.slot
      limit 1;
    if v_slot is null then
      raise exception 'no free radio slot for base %', trim(p_base_id);
    end if;
  end if;

  select nextval('public.base_collar_registry_revision_seq') into v_revision;

  return query
  insert into public.base_collar_registry (
    base_id, collar_id, cow_id, slot, active, revision
  ) values (
    trim(p_base_id), p_collar_id, trim(p_cow_id), v_slot, p_active, v_revision
  )
  on conflict (base_id, collar_id)
  do update set
    cow_id = excluded.cow_id,
    slot = excluded.slot,
    active = excluded.active,
    revision = v_revision,
    updated_at = timezone('utc'::text, now())
  returning *;
end;
$$;

revoke all on function public.upsert_base_collar_registry_entry(text, text, text, boolean, integer) from public;
revoke all on function public.upsert_base_collar_registry_entry(text, text, text, boolean, integer) from anon;
revoke all on function public.upsert_base_collar_registry_entry(text, text, text, boolean, integer) from authenticated;
grant execute on function public.upsert_base_collar_registry_entry(text, text, text, boolean, integer) to service_role;

-- Preserve older trusted callers while ensuring they also receive an explicit
-- server-assigned slot instead of reverting to identity-text inference.
create or replace function public.upsert_base_collar_registry_entry(
  p_base_id text,
  p_collar_id text,
  p_cow_id text,
  p_active boolean
)
returns setof public.base_collar_registry
language sql
security definer
set search_path = ''
as $$
  select * from public.upsert_base_collar_registry_entry(
    p_base_id, p_collar_id, p_cow_id, p_active, null
  );
$$;
