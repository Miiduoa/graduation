-- Wave 8：預警系統 + 參與度打分 + 群組作業 + late penalty + 監考 + 教材排程

-- ============================================================
-- 6. 預警系統（at-risk students view）
-- ============================================================
create or replace view public.reporting_at_risk_students as
with engagement as (
  select cm.course_id, cm.user_id,
    (select count(*) from public.live_attendance la
     join public.live_sessions ls on ls.id = la.session_id
     where ls.course_id = cm.course_id and la.user_id = cm.user_id
       and la.recorded_at >= now() - interval '21 days') as recent_attendances,
    (select count(*) from public.forum_posts fp
     join public.forum_topics ft on ft.id = fp.topic_id
     where ft.course_id = cm.course_id and fp.author_id = cm.user_id
       and fp.created_at >= now() - interval '21 days') as recent_forum_posts,
    (select count(*) from public.quiz_attempts qa
     join public.quizzes q on q.id = qa.quiz_id
     where q.course_id = cm.course_id and qa.student_id = cm.user_id
       and qa.submitted_at >= now() - interval '21 days') as recent_quiz_attempts,
    (select count(*) from public.submissions s
     join public.assignments a on a.id = s.assignment_id
     where a.course_id = cm.course_id and s.student_id = cm.user_id
       and a.due_at < now() and s.id is null) as missing_assignments
  from public.course_members cm
  where cm.role = 'student'
),
rollups as (
  select course_id, student_id, weighted_percent
  from public.course_grade_rollups
)
select
  e.course_id,
  e.user_id as student_id,
  coalesce(r.weighted_percent, 0) as weighted_percent,
  e.recent_attendances,
  e.recent_forum_posts,
  e.recent_quiz_attempts,
  e.missing_assignments,
  case
    when coalesce(r.weighted_percent, 0) < 50 then 'critical'
    when coalesce(r.weighted_percent, 0) < 60 then 'warn'
    when (e.recent_attendances + e.recent_forum_posts + e.recent_quiz_attempts) = 0
         and coalesce(r.weighted_percent, 0) < 70 then 'warn'
    else 'ok'
  end as risk_level
from engagement e
left join rollups r on r.course_id = e.course_id and r.student_id = e.user_id;

comment on view public.reporting_at_risk_students is
  '學員預警：成績、近 3 週活動、缺繳作業 → critical/warn/ok；RLS 由底層強制';

grant select on public.reporting_at_risk_students to authenticated;

-- ============================================================
-- 7. 參與度打分（reporting_participation_score view）
-- ============================================================
create or replace view public.reporting_participation_score as
select
  cm.course_id,
  cm.user_id as student_id,
  (
    coalesce((select count(*) from public.forum_posts fp
              join public.forum_topics ft on ft.id = fp.topic_id
              where ft.course_id = cm.course_id and fp.author_id = cm.user_id), 0) * 2
    + coalesce((select count(*) from public.live_attendance la
                 join public.live_sessions ls on ls.id = la.session_id
                 where ls.course_id = cm.course_id and la.user_id = cm.user_id), 0) * 3
    + coalesce((select count(*) from public.quiz_attempts qa
                 join public.quizzes q on q.id = qa.quiz_id
                 where q.course_id = cm.course_id and qa.student_id = cm.user_id
                   and qa.submitted_at is not null), 0) * 1
    + coalesce((select count(*) from public.material_progress mp
                 join public.course_materials cmat on cmat.id = mp.material_id
                 where cmat.course_id = cm.course_id and mp.user_id = cm.user_id), 0) * 1
  ) as participation_points
from public.course_members cm
where cm.role = 'student';

comment on view public.reporting_participation_score is
  '加權打分（forum*2 + attendance*3 + quiz_submitted*1 + material_progress*1）';

grant select on public.reporting_participation_score to authenticated;

-- ============================================================
-- 8. 群組作業（submissions.group_id；同組共用一份）
-- ============================================================
alter table public.assignments
  add column if not exists is_group_submission boolean not null default false;

alter table public.submissions
  add column if not exists group_id uuid references public.course_groups (id) on delete set null;

create index if not exists submissions_group_idx on public.submissions (group_id)
  where group_id is not null;

-- ============================================================
-- 9. Late penalty（按日扣分）
-- ============================================================
alter table public.assignments
  add column if not exists late_penalty_pct_per_day numeric default 0
    check (late_penalty_pct_per_day is null or late_penalty_pct_per_day between 0 and 100),
  add column if not exists max_late_days integer default 7
    check (max_late_days is null or max_late_days >= 0);

create or replace function public.apply_late_penalty(p_submission_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grade numeric;
  v_due timestamptz;
  v_pct numeric;
  v_max_days integer;
  v_submitted timestamptz;
  v_days_late integer;
  v_penalty numeric;
  v_final numeric;
begin
  select s.grade, a.due_at, a.late_penalty_pct_per_day, a.max_late_days, s.submitted_at
    into v_grade, v_due, v_pct, v_max_days, v_submitted
  from public.submissions s
  join public.assignments a on a.id = s.assignment_id
  where s.id = p_submission_id;

  if v_grade is null then return null; end if;
  if v_due is null or v_pct is null or v_pct = 0 then return v_grade; end if;
  if v_submitted <= v_due then return v_grade; end if;

  v_days_late := ceil(extract(epoch from (v_submitted - v_due)) / 86400)::integer;
  if v_max_days is not null and v_days_late > v_max_days then
    v_days_late := v_max_days;
  end if;

  v_penalty := least(v_grade * v_pct / 100 * v_days_late, v_grade);
  v_final := greatest(v_grade - v_penalty, 0);
  return v_final;
end;
$$;

grant execute on function public.apply_late_penalty(uuid) to authenticated;

-- ============================================================
-- 10. 監考設定（quiz_proctor_settings）
-- ============================================================
create table if not exists public.quiz_proctor_settings (
  quiz_id uuid primary key references public.quizzes (id) on delete cascade,
  require_webcam boolean not null default false,
  require_lockdown boolean not null default false,
  allow_tab_switch boolean not null default true,
  max_tab_switches integer default 3,
  ip_allowlist text[],
  proctor_provider text check (proctor_provider is null or proctor_provider in (
    'manual', 'honorlock', 'proctorio', 'respondus', 'custom'
  )),
  proctor_metadata jsonb not null default '{}'::jsonb
);

alter table public.quiz_proctor_settings enable row level security;

drop policy if exists quiz_proctor_settings_select on public.quiz_proctor_settings;
create policy quiz_proctor_settings_select on public.quiz_proctor_settings
  for select using (
    exists (
      select 1 from public.quizzes q
      where q.id = quiz_proctor_settings.quiz_id
        and (public.is_course_member(q.course_id) or public.is_platform_admin())
    )
  );

drop policy if exists quiz_proctor_settings_write_staff on public.quiz_proctor_settings;
create policy quiz_proctor_settings_write_staff on public.quiz_proctor_settings
  for all using (
    exists (
      select 1 from public.quizzes q
      where q.id = quiz_proctor_settings.quiz_id
        and public.course_member_has_capability(q.course_id, 'quiz.author_structure'::text)
    )
  )
  with check (
    exists (
      select 1 from public.quizzes q
      where q.id = quiz_id
        and public.course_member_has_capability(q.course_id, 'quiz.author_structure'::text)
    )
  );

-- 監考事件記錄（tab switch / IP mismatch）
create table if not exists public.quiz_proctor_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.quiz_attempts (id) on delete cascade,
  event_kind text not null check (event_kind in (
    'tab_switch', 'ip_mismatch', 'webcam_lost', 'lockdown_violation', 'flagged_by_proctor'
  )),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists quiz_proctor_events_attempt_idx on public.quiz_proctor_events (attempt_id);

alter table public.quiz_proctor_events enable row level security;

drop policy if exists quiz_proctor_events_select on public.quiz_proctor_events;
create policy quiz_proctor_events_select on public.quiz_proctor_events
  for select using (
    exists (
      select 1 from public.quiz_attempts qa
      join public.quizzes q on q.id = qa.quiz_id
      where qa.id = quiz_proctor_events.attempt_id
        and (qa.student_id = auth.uid() or public.is_course_staff(q.course_id))
    )
    or public.is_platform_admin()
  );

drop policy if exists quiz_proctor_events_insert_self on public.quiz_proctor_events;
create policy quiz_proctor_events_insert_self on public.quiz_proctor_events
  for insert with check (
    exists (
      select 1 from public.quiz_attempts qa
      where qa.id = attempt_id and qa.student_id = auth.uid()
    )
  );

-- ============================================================
-- 11. 教材排程發布（publish_at）
-- ============================================================
alter table public.course_materials
  add column if not exists publish_at timestamptz,
  add column if not exists is_published boolean not null default true;

-- 學生只能看到 publish_at IS NULL OR <= now()，且 is_published=true
drop policy if exists materials_select on public.course_materials;
create policy materials_select on public.course_materials
  for select using (
    (
      public.is_course_member(course_id)
      and is_published = true
      and (publish_at is null or publish_at <= now())
    )
    or public.is_course_staff(course_id)
    or public.is_platform_admin()
  );
