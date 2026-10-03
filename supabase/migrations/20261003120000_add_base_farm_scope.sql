-- A node event identifies its originating Base through base_id.  Bases need
-- an explicit farm owner before area-status can safely evaluate farm fences.
alter table public.bases
  add column if not exists farm_id uuid references public.farms(id) on delete restrict;

create index if not exists bases_farm_id_idx
  on public.bases (farm_id);

-- The current demo database has one farm and unassigned demo bases.  Backfill
-- only in that unambiguous single-farm case; never guess in a multi-farm DB.
with only_farm as (
  select id
  from public.farms
  where (select count(*) from public.farms) = 1
)
update public.bases as bases
set farm_id = only_farm.id
from only_farm
where bases.farm_id is null;
