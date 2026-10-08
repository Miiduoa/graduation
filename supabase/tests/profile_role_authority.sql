-- Run as the database test administrator after applying migrations. Every fixture/policy rolls back.
\set ON_ERROR_STOP on
begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email) values
  ('a8000000-0000-4000-8000-000000000001', 'student@profile-role.test'),
  ('a8000000-0000-4000-8000-000000000002', 'admin@profile-role.test'),
  ('a8000000-0000-4000-8000-000000000003', 'missing@profile-role.test');
update public.profiles set role = 'admin' where id = 'a8000000-0000-4000-8000-000000000002';
delete from public.profiles where id = 'a8000000-0000-4000-8000-000000000003';

-- Deliberately permissive test-only policies prove the trigger protects the role column itself.
create policy profile_role_test_insert on public.profiles for insert to authenticated with check (id = auth.uid());
create policy profile_role_test_admin_update on public.profiles for update to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"a8000000-0000-4000-8000-000000000001"}', true);
do $$
begin
  update public.profiles set display_name = 'Updated student' where id = auth.uid();
  if (select display_name from public.profiles where id = auth.uid()) <> 'Updated student' then
    raise exception 'ordinary profile updates must remain allowed';
  end if;
  begin
    update public.profiles set role = 'admin' where id = auth.uid();
    raise exception 'self promotion unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set role = 'teacher' where id = auth.uid();
    raise exception 'self promotion to teacher unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  if (select role from public.profiles where id = auth.uid()) <> 'student' then
    raise exception 'rejected role changes altered the row';
  end if;
end $$;

select set_config('request.jwt.claims', '{"role":"authenticated","sub":"a8000000-0000-4000-8000-000000000003"}', true);
do $$
begin
  if public.is_platform_admin() then raise exception 'missing profile must not be an administrator'; end if;
  begin
    insert into public.profiles(id, role) values (auth.uid(), 'admin');
    raise exception 'self-created administrator unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  if exists(select 1 from public.profiles where id = auth.uid()) then
    raise exception 'rejected insert left a privileged profile';
  end if;
  insert into public.profiles(id, role) values (auth.uid(), 'student');
end $$;

select set_config('request.jwt.claims', '{"role":"authenticated","sub":"a8000000-0000-4000-8000-000000000002"}', true);
do $$
begin
  update public.profiles set role = 'teacher' where id = 'a8000000-0000-4000-8000-000000000001';
  if (select role from public.profiles where id = 'a8000000-0000-4000-8000-000000000001') <> 'teacher' then
    raise exception 'authorized administrator could not change a role';
  end if;
end $$;

reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
begin
  update public.profiles set role = 'student' where id = 'a8000000-0000-4000-8000-000000000001';
  if (select role from public.profiles where id = 'a8000000-0000-4000-8000-000000000001') <> 'student' then
    raise exception 'trusted service role could not change a role';
  end if;
end $$;

rollback;
\echo 'profile role authority checks passed'
