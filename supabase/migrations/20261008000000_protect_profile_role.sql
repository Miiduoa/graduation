-- Profile owners may edit ordinary profile fields, but never grant themselves a privileged role.
create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' and new.role is not distinct from old.role then
    return new;
  end if;
  if tg_op = 'INSERT' and new.role = 'student' then
    return new;
  end if;

  if auth.role() = 'service_role'
     or (auth.uid() is null and session_user in ('postgres', 'supabase_admin'))
     or public.is_platform_admin() then
    return new;
  end if;

  raise exception 'Profile role changes require an authorized administrator'
    using errcode = '42501';
end;
$$;

revoke all on function public.protect_profile_role() from public;

drop trigger if exists profiles_protect_role on public.profiles;
create trigger profiles_protect_role
  before insert or update of role on public.profiles
  for each row execute function public.protect_profile_role();
