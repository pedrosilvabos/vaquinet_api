-- Phase 1: the server is the sole writer of Base collar membership.

create sequence if not exists public.base_collar_registry_revision_seq;

create table if not exists public.base_collar_registry (
  base_id text not null,
  collar_id text not null,
  cow_id text not null references public.nodes(id) on delete restrict,
  active boolean not null default true,
  revision bigint not null default nextval('public.base_collar_registry_revision_seq'),
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),

  primary key (base_id, collar_id),

  constraint base_collar_registry_collar_id_check
    check (collar_id ~ '^[0-9A-F]{12}$')
);


-- Only one active cow assignment per Base.
create unique index if not exists base_collar_registry_active_cow_uidx
  on public.base_collar_registry (base_id, cow_id)
  where active;


-- A physical collar cannot be active on more than one Base in Phase 1.
create unique index if not exists base_collar_registry_active_collar_uidx
  on public.base_collar_registry (collar_id)
  where active;


-- Used when the Base asks for registry changes after a known revision.
create index if not exists base_collar_registry_base_revision_idx
  on public.base_collar_registry (base_id, revision);


-- This table is not exposed directly to application users.
-- Server/service-role access only.
alter table public.base_collar_registry disable row level security;

revoke all on table public.base_collar_registry from public;
revoke all on table public.base_collar_registry from anon;
revoke all on table public.base_collar_registry from authenticated;

grant select, insert, update on table public.base_collar_registry
  to service_role;


-- Revision sequence is also server-only.
revoke all on sequence public.base_collar_registry_revision_seq from public;
revoke all on sequence public.base_collar_registry_revision_seq from anon;
revoke all on sequence public.base_collar_registry_revision_seq from authenticated;

grant usage, select on sequence public.base_collar_registry_revision_seq
  to service_role;


-- Admin/service provisioning entrypoint.
--
-- Revisions are allocated inside the database transaction.
-- Callers never use wall-clock time for ordering.
create or replace function public.upsert_base_collar_registry_entry(
  p_base_id text,
  p_collar_id text,
  p_cow_id text,
  p_active boolean
)
returns setof public.base_collar_registry
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revision bigint;
begin
  if p_base_id is null or length(trim(p_base_id)) = 0 then
    raise exception 'base_id is required';
  end if;

  if p_collar_id is null or p_collar_id !~ '^[0-9A-F]{12}$' then
    raise exception
      'collar_id must be a 12-character uppercase NRF device address';
  end if;

  if p_cow_id is null or length(trim(p_cow_id)) = 0 then
    raise exception 'cow_id is required';
  end if;

  select nextval('public.base_collar_registry_revision_seq')
    into v_revision;

  return query
  insert into public.base_collar_registry (
    base_id,
    collar_id,
    cow_id,
    active,
    revision
  )
  values (
    trim(p_base_id),
    p_collar_id,
    trim(p_cow_id),
    p_active,
    v_revision
  )
  on conflict (base_id, collar_id)
  do update
  set
    cow_id = excluded.cow_id,
    active = excluded.active,
    revision = v_revision,
    updated_at = timezone('utc'::text, now())
  returning *;
end;
$$;


-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default,
-- so explicitly remove it before granting service-role access.
revoke all on function public.upsert_base_collar_registry_entry(
  text,
  text,
  text,
  boolean
) from public;

revoke all on function public.upsert_base_collar_registry_entry(
  text,
  text,
  text,
  boolean
) from anon;

revoke all on function public.upsert_base_collar_registry_entry(
  text,
  text,
  text,
  boolean
) from authenticated;

grant execute on function public.upsert_base_collar_registry_entry(
  text,
  text,
  text,
  boolean
) to service_role;