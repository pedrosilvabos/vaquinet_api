-- The API reads protected identity/baseline relations through its
-- server-only service-role client.  The baseline view is a view rather than
-- a table, so the table grants in the original baseline migration do not
-- grant access to it.
grant select on public.latest_animal_activity_baseline to service_role;

