-- Wave 8：AI 對話歷史 + AI 教材摘要 + 全文搜尋 + 推播偏好 + 收藏 + Email digest + 學習成果 + Office hour

-- ============================================================
-- 12. AI 助教對話歷史
-- ============================================================
create table if not exists public.ai_chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  course_id uuid references public.courses (id) on delete cascade,
  title text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_chat_threads_user_idx on public.ai_chat_threads (user_id, updated_at desc);

alter table public.ai_chat_threads enable row level security;

drop policy if exists ai_chat_threads_self_all on public.ai_chat_threads;
create policy ai_chat_threads_self_all on public.ai_chat_threads
  for all using (user_id = auth.uid() or public.is_platform_admin())
  with check (user_id = auth.uid());

create trigger ai_chat_threads_touch
  before update on public.ai_chat_threads
  for each row execute function public.set_updated_at();

create table if not exists public.ai_chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.ai_chat_threads (id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content text not null,
  tokens_in integer,
  tokens_out integer,
  model_used text,
  created_at timestamptz not null default now()
);

create index if not exists ai_chat_messages_thread_idx
  on public.ai_chat_messages (thread_id, created_at);

alter table public.ai_chat_messages enable row level security;

drop policy if exists ai_chat_messages_self_all on public.ai_chat_messages;
create policy ai_chat_messages_self_all on public.ai_chat_messages
  for all using (
    exists (
      select 1 from public.ai_chat_threads t
      where t.id = ai_chat_messages.thread_id and t.user_id = auth.uid()
    )
    or public.is_platform_admin()
  )
  with check (
    exists (
      select 1 from public.ai_chat_threads t
      where t.id = thread_id and t.user_id = auth.uid()
    )
  );

-- ============================================================
-- 13. AI 教材摘要（單一教材重點 TLDR）
-- ============================================================
create table if not exists public.material_ai_summary (
  material_id uuid primary key references public.course_materials (id) on delete cascade,
  summary_md text not null,
  key_points jsonb not null default '[]'::jsonb,
  reading_time_minutes integer,
  model_used text,
  generated_at timestamptz not null default now()
);

alter table public.material_ai_summary enable row level security;

drop policy if exists material_ai_summary_select on public.material_ai_summary;
create policy material_ai_summary_select on public.material_ai_summary
  for select using (
    exists (
      select 1 from public.course_materials cm
      where cm.id = material_ai_summary.material_id
        and (public.is_course_member(cm.course_id) or public.is_platform_admin())
    )
  );

revoke insert, update, delete on public.material_ai_summary from authenticated;

-- ============================================================
-- 14. 全文搜尋（pg_trgm + tsvector）
-- ============================================================
create extension if not exists pg_trgm;

-- 統一搜尋視圖：教材／公告／論壇
create or replace view public.course_search_index as
select
  'material'::text as kind,
  cm.id as record_id,
  cm.course_id,
  cm.title as title,
  coalesce(cm.description_html, cm.external_url, '') as body,
  cm.created_at as touched_at
from public.course_materials cm
union all
select
  'announcement'::text as kind,
  a.id as record_id,
  a.course_id,
  a.title as title,
  coalesce(a.body_html, a.body, '') as body,
  a.created_at as touched_at
from public.announcements a
union all
select
  'forum_topic'::text as kind,
  ft.id as record_id,
  ft.course_id,
  ft.title as title,
  '' as body,
  ft.created_at as touched_at
from public.forum_topics ft;

comment on view public.course_search_index is
  '統一搜尋視圖（material/announcement/forum_topic）；RLS 由底層強制';

grant select on public.course_search_index to authenticated;

-- 簡單搜尋 RPC（用 plainto_tsquery 寬鬆解析）
create or replace function public.search_course(p_course_id uuid, p_query text)
returns table (kind text, record_id uuid, title text, snippet text, touched_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.kind, s.record_id, s.title,
    left(coalesce(s.body, ''), 200) as snippet,
    s.touched_at
  from public.course_search_index s
  where s.course_id = p_course_id
    and public.is_course_member(s.course_id)
    and (
      s.title ilike '%' || p_query || '%'
      or s.body ilike '%' || p_query || '%'
    )
  order by s.touched_at desc
  limit 50;
$$;

grant execute on function public.search_course(uuid, text) to authenticated;

-- ============================================================
-- 15. 推播偏好（per-channel）
-- ============================================================
create table if not exists public.push_notification_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  push_announcements boolean not null default true,
  push_assignments boolean not null default true,
  push_grades boolean not null default true,
  push_forum boolean not null default true,
  push_live boolean not null default true,
  push_messages boolean not null default true,
  quiet_hours_start time,
  quiet_hours_end time,
  updated_at timestamptz not null default now()
);

alter table public.push_notification_preferences enable row level security;

drop policy if exists push_notification_preferences_self on public.push_notification_preferences;
create policy push_notification_preferences_self on public.push_notification_preferences
  for all using (user_id = auth.uid() or public.is_platform_admin())
  with check (user_id = auth.uid());

create trigger push_notification_preferences_touch
  before update on public.push_notification_preferences
  for each row execute function public.set_updated_at();

-- ============================================================
-- 16. 收藏／我的最愛
-- ============================================================
create table if not exists public.user_favorites (
  user_id uuid not null references public.profiles (id) on delete cascade,
  target_kind text not null check (target_kind in (
    'course', 'material', 'assignment', 'quiz', 'forum_topic', 'announcement'
  )),
  target_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, target_kind, target_id)
);

create index if not exists user_favorites_user_idx
  on public.user_favorites (user_id, target_kind);

alter table public.user_favorites enable row level security;

drop policy if exists user_favorites_self on public.user_favorites;
create policy user_favorites_self on public.user_favorites
  for all using (user_id = auth.uid() or public.is_platform_admin())
  with check (user_id = auth.uid());

-- ============================================================
-- 17. Email digest（每日／每週摘要訂閱）
-- ============================================================
create table if not exists public.email_digest_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  frequency text not null default 'weekly' check (frequency in ('off', 'daily', 'weekly')),
  last_sent_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.email_digest_preferences enable row level security;

drop policy if exists email_digest_preferences_self on public.email_digest_preferences;
create policy email_digest_preferences_self on public.email_digest_preferences
  for all using (user_id = auth.uid() or public.is_platform_admin())
  with check (user_id = auth.uid());

create trigger email_digest_preferences_touch
  before update on public.email_digest_preferences
  for each row execute function public.set_updated_at();

-- ============================================================
-- 18. 學習成果 PLO / CLO
-- ============================================================
create table if not exists public.program_outcomes (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id) on delete cascade,
  code text not null,
  description text not null default '',
  bloom_level text check (bloom_level is null or bloom_level in (
    'remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'
  )),
  unique (department_id, code)
);

alter table public.program_outcomes enable row level security;

drop policy if exists program_outcomes_select on public.program_outcomes;
create policy program_outcomes_select on public.program_outcomes
  for select using (true);

drop policy if exists program_outcomes_admin_write on public.program_outcomes;
create policy program_outcomes_admin_write on public.program_outcomes
  for all using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- 課程目標（CLO）
create table if not exists public.course_outcomes (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  code text not null,
  description text not null default '',
  maps_to_plo_id uuid references public.program_outcomes (id) on delete set null,
  unique (course_id, code)
);

alter table public.course_outcomes enable row level security;

drop policy if exists course_outcomes_select on public.course_outcomes;
create policy course_outcomes_select on public.course_outcomes
  for select using (public.is_course_member(course_id) or public.is_platform_admin());

drop policy if exists course_outcomes_write_staff on public.course_outcomes;
create policy course_outcomes_write_staff on public.course_outcomes
  for all using (public.is_course_teacher(course_id))
  with check (public.is_course_teacher(course_id));

-- 評分項目對應 CLO
create table if not exists public.outcome_item_map (
  outcome_id uuid not null references public.course_outcomes (id) on delete cascade,
  grade_item_id uuid not null references public.grade_items (id) on delete cascade,
  weight numeric not null default 1 check (weight >= 0),
  primary key (outcome_id, grade_item_id)
);

alter table public.outcome_item_map enable row level security;

drop policy if exists outcome_item_map_select on public.outcome_item_map;
create policy outcome_item_map_select on public.outcome_item_map
  for select using (
    exists (
      select 1 from public.course_outcomes co
      where co.id = outcome_item_map.outcome_id
        and (public.is_course_member(co.course_id) or public.is_platform_admin())
    )
  );

drop policy if exists outcome_item_map_write_staff on public.outcome_item_map;
create policy outcome_item_map_write_staff on public.outcome_item_map
  for all using (
    exists (
      select 1 from public.course_outcomes co
      where co.id = outcome_item_map.outcome_id and public.is_course_teacher(co.course_id)
    )
  )
  with check (
    exists (
      select 1 from public.course_outcomes co
      where co.id = outcome_id and public.is_course_teacher(co.course_id)
    )
  );

-- ============================================================
-- 19. Office hour booking（教師可預約時段）
-- ============================================================
create table if not exists public.teacher_office_hours (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  course_id uuid references public.courses (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  location text,
  meeting_url text,
  max_concurrent integer not null default 1 check (max_concurrent > 0),
  created_at timestamptz not null default now()
);

create index if not exists teacher_office_hours_teacher_idx
  on public.teacher_office_hours (teacher_id, starts_at);

alter table public.teacher_office_hours enable row level security;

drop policy if exists teacher_office_hours_select on public.teacher_office_hours;
create policy teacher_office_hours_select on public.teacher_office_hours
  for select using (
    teacher_id = auth.uid()
    or (course_id is not null and public.is_course_member(course_id))
    or public.is_platform_admin()
  );

drop policy if exists teacher_office_hours_write_owner on public.teacher_office_hours;
create policy teacher_office_hours_write_owner on public.teacher_office_hours
  for all using (teacher_id = auth.uid() or public.is_platform_admin())
  with check (teacher_id = auth.uid());

create table if not exists public.office_hour_bookings (
  id uuid primary key default gen_random_uuid(),
  office_hour_id uuid not null references public.teacher_office_hours (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  topic text not null default '',
  status text not null default 'booked' check (status in ('booked', 'attended', 'cancelled', 'no_show')),
  created_at timestamptz not null default now(),
  unique (office_hour_id, student_id)
);

alter table public.office_hour_bookings enable row level security;

drop policy if exists office_hour_bookings_select on public.office_hour_bookings;
create policy office_hour_bookings_select on public.office_hour_bookings
  for select using (
    student_id = auth.uid()
    or exists (
      select 1 from public.teacher_office_hours oh
      where oh.id = office_hour_bookings.office_hour_id and oh.teacher_id = auth.uid()
    )
    or public.is_platform_admin()
  );

drop policy if exists office_hour_bookings_insert_self on public.office_hour_bookings;
create policy office_hour_bookings_insert_self on public.office_hour_bookings
  for insert with check (
    student_id = auth.uid()
    and exists (
      select 1 from public.teacher_office_hours oh
      where oh.id = office_hour_id
        and oh.starts_at > now()
        and (
          select count(*) from public.office_hour_bookings b
          where b.office_hour_id = oh.id and b.status = 'booked'
        ) < oh.max_concurrent
    )
  );

drop policy if exists office_hour_bookings_update on public.office_hour_bookings;
create policy office_hour_bookings_update on public.office_hour_bookings
  for update using (
    student_id = auth.uid()
    or exists (
      select 1 from public.teacher_office_hours oh
      where oh.id = office_hour_bookings.office_hour_id and oh.teacher_id = auth.uid()
    )
  )
  with check (
    student_id = auth.uid()
    or exists (
      select 1 from public.teacher_office_hours oh
      where oh.id = office_hour_id and oh.teacher_id = auth.uid()
    )
  );
