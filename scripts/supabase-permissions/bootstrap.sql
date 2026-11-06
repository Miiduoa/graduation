-- Minimal local PostgreSQL fixture, never a production migration.
-- This implements the auth/storage objects referenced by this repository. It does
-- not replace integration tests against the real Supabase local stack.
\set ON_ERROR_STOP on

do $$
begin
  if current_user <> 'postgres'
     or current_database() !~ '^campus_permissions_test(_[a-z0-9]+)?$'
     or inet_server_addr() not in ('127.0.0.1'::inet, '::1'::inet) then
    raise exception 'Refusing to bootstrap anything except the local disposable test database';
  end if;
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit password 'isolated-test-only';
  end if;
  if exists (
    select from pg_roles
    where rolname in ('anon', 'authenticated', 'authenticator')
      and (rolsuper or rolbypassrls or rolinherit)
  ) then
    raise exception 'Existing API roles do not match the isolated non-privileged test roles';
  end if;
  if not exists (select from pg_roles where rolname = 'service_role' and rolbypassrls and not rolsuper) then
    raise exception 'service_role must bypass RLS without being a superuser';
  end if;
end $$;

grant anon, authenticated, service_role to authenticator;
create schema auth;
create schema storage;
create schema extensions;
grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key,
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
$$;

create function auth.role() returns text
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );
$$;

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  created_at timestamptz not null default now()
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated;
grant select, insert, update, delete on storage.buckets to service_role;

-- Reproduce legacy Supabase defaults before selecting a test scenario.
alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on functions to anon, authenticated, service_role;
