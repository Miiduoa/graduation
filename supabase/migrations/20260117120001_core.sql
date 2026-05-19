-- Core: profiles, courses, members, materials, announcements, storage buckets & policies

create extension if not exists "pgcrypto";

-- Profiles (1:1 with auth.users)
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  role text not null default 'student' check (role in ('student', 'teacher', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(coalesce(new.email, ''), '@', 1)),
    'student'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Courses
create table public.courses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  owner_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.course_members (
  course_id uuid not null references public.courses (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('teacher', 'student', 'assistant')),
  joined_at timestamptz not null default now(),
  primary key (course_id, user_id)
);

create or replace function public.add_owner_as_course_teacher()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.course_members (course_id, user_id, role)
  values (new.id, new.owner_id, 'teacher')
  on conflict do nothing;
  return new;
end;
$$;

create trigger courses_owner_membership
  after insert on public.courses
  for each row execute function public.add_owner_as_course_teacher();

create table public.course_materials (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  title text not null,
  storage_path text,
  external_url text,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  author_id uuid not null references public.profiles (id),
  title text not null,
  body text not null default '',
  created_at timestamptz not null default now()
);

-- Membership helpers (SECURITY DEFINER: reads membership regardless of caller RLS recursion)
create or replace function public.is_course_member(p_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.course_members cm
    where cm.course_id = p_course_id
      and cm.user_id = auth.uid()
  );
$$;

create or replace function public.is_course_teacher(p_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.course_members cm
    where cm.course_id = p_course_id
      and cm.user_id = auth.uid()
      and cm.role = 'teacher'
  );
$$;

alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.course_members enable row level security;
alter table public.course_materials enable row level security;
alter table public.announcements enable row level security;

create policy profiles_select_self on public.profiles
  for select using (id = auth.uid());

create policy profiles_update_self on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy profiles_select_course_peers on public.profiles
  for select using (
    exists (
      select 1 from public.course_members m1
      join public.course_members m2 on m1.course_id = m2.course_id
      where m1.user_id = auth.uid()
        and m2.user_id = profiles.id
    )
  );

create policy courses_select_member on public.courses
  for select using (public.is_course_member(id));

create policy courses_insert_owner on public.courses
  for insert with check (owner_id = auth.uid());

create policy courses_update_owner on public.courses
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy courses_delete_owner on public.courses
  for delete using (owner_id = auth.uid());

create policy course_members_select on public.course_members
  for select using (public.is_course_member(course_id));

create policy course_members_manage_teacher on public.course_members
  for all using (public.is_course_teacher(course_id))
  with check (public.is_course_teacher(course_id));

create policy course_members_insert_self_student on public.course_members
  for insert with check (
    user_id = auth.uid()
    and role = 'student'
    and exists (
      select 1 from public.courses c
      where c.id = course_id
    )
  );

create policy materials_select on public.course_materials
  for select using (public.is_course_member(course_id));

create policy materials_write_teacher on public.course_materials
  for insert with check (
    public.is_course_teacher(course_id)
    and created_by = auth.uid()
  );

create policy materials_update_teacher on public.course_materials
  for update using (public.is_course_teacher(course_id))
  with check (public.is_course_teacher(course_id));

create policy materials_delete_teacher on public.course_materials
  for delete using (public.is_course_teacher(course_id));

create policy announcements_select on public.announcements
  for select using (public.is_course_member(course_id));

create policy announcements_insert on public.announcements
  for insert with check (
    public.is_course_teacher(course_id)
    and author_id = auth.uid()
  );

create policy announcements_update on public.announcements
  for update using (
    public.is_course_teacher(course_id)
    and (author_id = auth.uid() or public.is_course_teacher(course_id))
  )
  with check (public.is_course_teacher(course_id));

create policy announcements_delete on public.announcements
  for delete using (
    public.is_course_teacher(course_id)
    and (author_id = auth.uid() or public.is_course_teacher(course_id))
  );

-- Storage
insert into storage.buckets (id, name, public)
values ('materials', 'materials', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('submissions', 'submissions', false)
on conflict (id) do nothing;

-- Path: {course_id}/...
create policy materials_bucket_select on storage.objects
  for select using (
    bucket_id = 'materials'
    and public.is_course_member((split_part(name, '/', 1))::uuid)
  );

create policy materials_bucket_insert on storage.objects
  for insert with check (
    bucket_id = 'materials'
    and public.is_course_teacher((split_part(name, '/', 1))::uuid)
  );

create policy materials_bucket_update on storage.objects
  for update using (
    bucket_id = 'materials'
    and public.is_course_teacher((split_part(name, '/', 1))::uuid)
  );

create policy materials_bucket_delete on storage.objects
  for delete using (
    bucket_id = 'materials'
    and public.is_course_teacher((split_part(name, '/', 1))::uuid)
  );

-- Path: {course_id}/{assignment_id}/{student_id}/...
create policy submissions_bucket_select on storage.objects
  for select using (
    bucket_id = 'submissions'
    and (
      (
        split_part(name, '/', 4) <> ''
        and auth.uid() = (split_part(name, '/', 3))::uuid
      )
      or public.is_course_teacher((split_part(name, '/', 1))::uuid)
    )
  );

create policy submissions_bucket_insert on storage.objects
  for insert with check (
    bucket_id = 'submissions'
    and public.is_course_member((split_part(name, '/', 1))::uuid)
    and auth.uid() = (split_part(name, '/', 3))::uuid
  );

create policy submissions_bucket_update on storage.objects
  for update using (
    bucket_id = 'submissions'
    and (
      auth.uid() = (split_part(name, '/', 3))::uuid
      or public.is_course_teacher((split_part(name, '/', 1))::uuid)
    )
  );

create policy submissions_bucket_delete on storage.objects
  for delete using (
    bucket_id = 'submissions'
    and (
      auth.uid() = (split_part(name, '/', 3))::uuid
      or public.is_course_teacher((split_part(name, '/', 1))::uuid)
    )
  );
