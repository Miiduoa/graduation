-- Wave 5: 學習單元結構 + 行事曆（TronClass 商用核心模組）

-- ============================================================
-- 1. course_units / course_unit_items（學習地圖）
-- ============================================================
create table if not exists public.course_units (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  title text not null,
  description text not null default '',
  sort_order integer not null default 0,
  unlock_after timestamptz,
  prerequisite_unit_id uuid references public.course_units (id) on delete set null,
  is_published boolean not null default true,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists course_units_course_idx on public.course_units (course_id, sort_order);

alter table public.course_units enable row level security;

drop policy if exists course_units_select on public.course_units;
create policy course_units_select on public.course_units
  for select using (
    public.is_course_member(course_id)
    or public.is_platform_admin()
  );

drop policy if exists course_units_write_staff on public.course_units;
create policy course_units_write_staff on public.course_units
  for all using (
    public.course_member_has_capability(course_id, 'materials.publish'::text)
  )
  with check (
    public.course_member_has_capability(course_id, 'materials.publish'::text)
  );

create trigger course_units_touch
  before update on public.course_units
  for each row execute function public.set_updated_at();

-- 章節下的項目（教材／作業／測驗／問卷／徽章；統一 polymorphic）
create table if not exists public.course_unit_items (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.course_units (id) on delete cascade,
  item_type text not null check (item_type in (
    'material', 'assignment', 'quiz', 'forum_topic', 'survey', 'live_session', 'badge', 'external'
  )),
  ref_id uuid,
  external_url text,
  title text not null,
  required_for_unlock boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists course_unit_items_unit_idx on public.course_unit_items (unit_id, sort_order);

alter table public.course_unit_items enable row level security;

drop policy if exists course_unit_items_select on public.course_unit_items;
create policy course_unit_items_select on public.course_unit_items
  for select using (
    exists (
      select 1 from public.course_units u
      where u.id = course_unit_items.unit_id
        and (public.is_course_member(u.course_id) or public.is_platform_admin())
    )
  );

drop policy if exists course_unit_items_write_staff on public.course_unit_items;
create policy course_unit_items_write_staff on public.course_unit_items
  for all using (
    exists (
      select 1 from public.course_units u
      where u.id = course_unit_items.unit_id
        and public.course_member_has_capability(u.course_id, 'materials.publish'::text)
    )
  )
  with check (
    exists (
      select 1 from public.course_units u
      where u.id = unit_id
        and public.course_member_has_capability(u.course_id, 'materials.publish'::text)
    )
  );

-- 重排序 RPC（避免前端競爭 update sort_order）
create or replace function public.reorder_course_units(p_course_id uuid, p_unit_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_idx integer := 0;
  v_id uuid;
  v_n integer := 0;
begin
  if not public.course_member_has_capability(p_course_id, 'materials.publish'::text) then
    raise exception 'forbidden';
  end if;

  if p_unit_ids is null then
    return 0;
  end if;

  foreach v_id in array p_unit_ids loop
    update public.course_units
    set sort_order = v_idx, updated_at = now()
    where id = v_id and course_id = p_course_id;
    if found then
      v_n := v_n + 1;
    end if;
    v_idx := v_idx + 1;
  end loop;
  return v_n;
end;
$$;

grant execute on function public.reorder_course_units(uuid, uuid[]) to authenticated;

-- ============================================================
-- 2. calendar_events（行事曆／教學行程）
-- ============================================================
create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references public.courses (id) on delete cascade,
  scope text not null default 'course' check (scope in ('platform', 'course', 'personal')),
  owner_id uuid references public.profiles (id) on delete cascade,
  title text not null,
  description text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,
  location text,
  source_kind text check (source_kind is null or source_kind in (
    'manual', 'assignment_due', 'quiz_window', 'live_session', 'survey_window'
  )),
  source_id uuid,
  rrule text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists calendar_events_course_idx
  on public.calendar_events (course_id, starts_at);
create index if not exists calendar_events_owner_idx
  on public.calendar_events (owner_id, starts_at)
  where owner_id is not null;

alter table public.calendar_events enable row level security;

drop policy if exists calendar_events_select on public.calendar_events;
create policy calendar_events_select on public.calendar_events
  for select using (
    (scope = 'platform')
    or (scope = 'course' and course_id is not null and public.is_course_member(course_id))
    or (scope = 'personal' and owner_id = auth.uid())
    or public.is_platform_admin()
  );

drop policy if exists calendar_events_write_course on public.calendar_events;
create policy calendar_events_write_course on public.calendar_events
  for all using (
    case
      when scope = 'platform' then public.is_platform_admin()
      when scope = 'course' and course_id is not null
        then public.course_member_has_capability(course_id, 'announcements.publish'::text)
      when scope = 'personal' then owner_id = auth.uid()
      else false
    end
  )
  with check (
    case
      when scope = 'platform' then public.is_platform_admin()
      when scope = 'course' and course_id is not null
        then public.course_member_has_capability(course_id, 'announcements.publish'::text)
      when scope = 'personal' then owner_id = auth.uid()
      else false
    end
  );

create trigger calendar_events_touch
  before update on public.calendar_events
  for each row execute function public.set_updated_at();

-- 我的行事曆 RPC（給 Mobile／Admin 用）
create or replace function public.my_calendar_events(
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns setof public.calendar_events
language sql
stable
security definer
set search_path = public
as $$
  select e.*
  from public.calendar_events e
  where (
      e.scope = 'platform'
      or (e.scope = 'course' and e.course_id is not null and public.is_course_member(e.course_id))
      or (e.scope = 'personal' and e.owner_id = auth.uid())
    )
    and (p_from is null or e.starts_at >= p_from)
    and (p_to is null or e.starts_at <= p_to)
  order by e.starts_at asc
  limit 500;
$$;

grant execute on function public.my_calendar_events(timestamptz, timestamptz) to authenticated;

-- 自動：作業 due_at 寫入行事曆
create or replace function public.sync_assignment_calendar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.due_at is null then
    delete from public.calendar_events
    where source_kind = 'assignment_due' and source_id = new.id;
    return new;
  end if;

  insert into public.calendar_events (
    course_id, scope, title, starts_at, all_day, source_kind, source_id
  ) values (
    new.course_id, 'course', '作業截止：' || coalesce(new.title, ''),
    new.due_at, false, 'assignment_due', new.id
  )
  on conflict do nothing;

  update public.calendar_events
  set title = '作業截止：' || coalesce(new.title, ''),
      starts_at = new.due_at,
      updated_at = now()
  where source_kind = 'assignment_due' and source_id = new.id;

  return new;
end;
$$;

drop trigger if exists assignments_calendar_sync on public.assignments;
create trigger assignments_calendar_sync
  after insert or update of due_at, title on public.assignments
  for each row execute function public.sync_assignment_calendar();
