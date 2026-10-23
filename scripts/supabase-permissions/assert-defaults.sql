-- A new object proves the default-privilege fixture survived a reset. Roll back
-- so this probe never becomes part of the application's schema or ACL inventory.
begin;
create table public.permission_defaults_probe (id serial primary key);
alter table public.permission_defaults_probe enable row level security;
do $$
declare
  test_role text;
  privilege text;
begin
  foreach test_role in array array['anon', 'authenticated', 'service_role'] loop
    foreach privilege in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      if has_table_privilege(test_role, 'public.permission_defaults_probe', privilege) then
        raise exception 'Default grant unexpectedly enabled: role %, privilege %', test_role, privilege;
      end if;
    end loop;
    if has_sequence_privilege(test_role, 'public.permission_defaults_probe_id_seq', 'USAGE')
       or has_sequence_privilege(test_role, 'public.permission_defaults_probe_id_seq', 'SELECT') then
      raise exception 'Default sequence grant unexpectedly enabled for %', test_role;
    end if;
  end loop;
end $$;
rollback;
