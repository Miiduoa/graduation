-- Wave 8: 學術結構（學期／系所／班次／先修）+ 課程目錄／邀請碼／旁聽

-- ============================================================
-- 1. academic_terms（學年學期）
-- ============================================================
create table if not exists public.academic_terms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  display_name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.academic_terms enable row level security;

drop policy if exists academic_terms_select on public.academic_terms;
create policy academic_terms_select on public.academic_terms
  for select using (true);

drop policy if exists academic_terms_admin_write on public.academic_terms;
create policy academic_terms_admin_write on public.academic_terms
  for all using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- ============================================================
-- 2. departments（系所）
-- ============================================================
create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  parent_id uuid references public.departments (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.departments enable row level security;

drop policy if exists departments_select on public.departments;
create policy departments_select on public.departments
  for select using (true);

drop policy if exists departments_admin_write on public.departments;
create policy departments_admin_write on public.departments
  for all using (public.is_platform_admin())
  with check (public.is_platform_admin());

alter table public.courses
  add column if not exists term_id uuid references public.academic_terms (id) on delete set null,
  add column if not exists department_id uuid references public.departments (id) on delete set null,
  add column if not exists credit_hours numeric default 0 check (credit_hours >= 0),
  add column if not exists is_archived boolean not null default false;

create index if not exists courses_term_idx on public.courses (term_id) where term_id is not null;
create index if not exists courses_dept_idx on public.courses (department_id) where department_id is not null;

alter table public.profiles
  add column if not exists department_id uuid references public.departments (id) on delete set null,
  add column if not exists student_no text;

-- ============================================================
-- 3. course_sections（同課程的多個班次／梯次）
-- ============================================================
create table if not exists public.course_sections (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  section_code text not null,
  capacity integer,
  instructor_id uuid references public.profiles (id) on delete set null,
  meeting_time text,
  classroom text,
  created_at timestamptz not null default now(),
  unique (course_id, section_code)
);

alter table public.course_sections enable row level security;

drop policy if exists course_sections_select on public.course_sections;
create policy course_sections_select on public.course_sections
  for select using (public.is_course_member(course_id) or public.is_platform_admin());

drop policy if exists course_sections_write_staff on public.course_sections;
create policy course_sections_write_staff on public.course_sections
  for all using (public.is_course_staff(course_id))
  with check (public.is_course_staff(course_id));

alter table public.course_members
  add column if not exists section_id uuid references public.course_sections (id) on delete set null;

-- ============================================================
-- 4. course_prerequisites（先修課程）
-- ============================================================
create table if not exists public.course_prerequisites (
  course_id uuid not null references public.courses (id) on delete cascade,
  prerequisite_course_id uuid not null references public.courses (id) on delete cascade,
  min_weighted_percent numeric default 60 check (min_weighted_percent is null or min_weighted_percent between 0 and 100),
  is_required boolean not null default true,
  primary key (course_id, prerequisite_course_id),
  check (course_id <> prerequisite_course_id)
);

alter table public.course_prerequisites enable row level security;

drop policy if exists course_prerequisites_select on public.course_prerequisites;
create policy course_prerequisites_select on public.course_prerequisites
  for select using (true);

drop policy if exists course_prerequisites_admin_write on public.course_prerequisites;
create policy course_prerequisites_admin_write on public.course_prerequisites
  for all using (
    public.is_platform_admin() or public.is_course_teacher(course_id)
  )
  with check (
    public.is_platform_admin() or public.is_course_teacher(course_id)
  );

-- 檢查使用者是否滿足某課之所有 prerequisite
create or replace function public.user_meets_course_prerequisites(p_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1
    from public.course_prerequisites cp
    where cp.course_id = p_course_id
      and cp.is_required = true
      and not exists (
        select 1
        from public.course_grade_rollups r
        where r.course_id = cp.prerequisite_course_id
          and r.student_id = auth.uid()
          and coalesce(r.weighted_percent, 0) >= coalesce(cp.min_weighted_percent, 0)
      )
  );
$$;

grant execute on function public.user_meets_course_prerequisites(uuid) to authenticated;

-- ============================================================
-- 5. 課程目錄（catalog flag）＋邀請碼（enrollment code）＋旁聽（subscriptions）
-- ============================================================
alter table public.courses
  add column if not exists is_catalog_public boolean not null default false,
  add column if not exists catalog_summary text default '',
  add column if not exists enrollment_code text;

create unique index if not exists courses_enrollment_code_uidx
  on public.courses (enrollment_code) where enrollment_code is not null;

-- 旁聽訂閱（不是 course_members；無寫權限，僅追蹤更新）
create table if not exists public.course_subscriptions (
  course_id uuid not null references public.courses (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  subscribed_at timestamptz not null default now(),
  primary key (course_id, user_id)
);

alter table public.course_subscriptions enable row level security;

drop policy if exists course_subscriptions_self_select on public.course_subscriptions;
create policy course_subscriptions_self_select on public.course_subscriptions
  for select using (
    user_id = auth.uid()
    or public.is_course_staff(course_id)
    or public.is_platform_admin()
  );

drop policy if exists course_subscriptions_self_insert on public.course_subscriptions;
create policy course_subscriptions_self_insert on public.course_subscriptions
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.courses c
      where c.id = course_id and c.is_catalog_public = true
    )
  );

drop policy if exists course_subscriptions_self_delete on public.course_subscriptions;
create policy course_subscriptions_self_delete on public.course_subscriptions
  for delete using (user_id = auth.uid());

-- 邀請碼自助加入 RPC（先檢查 prerequisites）
create or replace function public.enroll_by_code(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course uuid;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  if p_code is null or length(trim(p_code)) < 3 then raise exception 'invalid code'; end if;

  select id into v_course from public.courses where enrollment_code = trim(p_code) and is_archived = false;
  if v_course is null then raise exception 'invalid or archived code'; end if;

  if not public.user_meets_course_prerequisites(v_course) then
    raise exception '尚未滿足先修課程要求';
  end if;

  insert into public.course_members (course_id, user_id, role)
  values (v_course, auth.uid(), 'student')
  on conflict (course_id, user_id) do nothing;

  return v_course;
end;
$$;

grant execute on function public.enroll_by_code(text) to authenticated;

-- 課程目錄公開查詢（is_catalog_public=true 的列任何人皆可看 metadata）
create or replace view public.public_course_catalog as
select
  c.id,
  c.title,
  c.description,
  c.catalog_summary,
  c.credit_hours,
  c.term_id,
  c.department_id,
  c.is_archived
from public.courses c
where c.is_catalog_public = true and c.is_archived = false;

comment on view public.public_course_catalog is
  '公開課程目錄；非機敏欄位，未登入亦可查';

grant select on public.public_course_catalog to anon, authenticated;
