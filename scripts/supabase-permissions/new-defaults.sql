-- TEST FIXTURE ONLY. Apply before application migrations in a disposable DB.
-- Reproduce the October 30 platform change, not a blanket grant workaround.
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated, service_role;
