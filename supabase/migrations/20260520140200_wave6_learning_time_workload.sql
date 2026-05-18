-- Wave 6: 學習時數統計 + 教師工作量分析

-- ============================================================
-- 10. learning_time_entries（系所匯出用：每段教材／活動的學習時數）
-- ============================================================
create table if not exists public.learning_time_entries (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  activity_kind text not null check (activity_kind in (
    'material_view', 'quiz_attempt', 'forum_post', 'live_attendance',
    'scorm_attempt', 'survey_response', 'peer_review', 'meeting', 'misc'
  )),
  ref_id uuid,
  duration_seconds integer not null check (duration_seconds >= 0),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create index if not exists learning_time_entries_user_idx
  on public.learning_time_entries (user_id, course_id, started_at desc);

alter table public.learning_time_entries enable row level security;

drop policy if exists learning_time_entries_select on public.learning_time_entries;
create policy learning_time_entries_select on public.learning_time_entries
  for select using (
    user_id = auth.uid()
    or public.is_course_staff(course_id)
    or public.is_platform_admin()
  );

drop policy if exists learning_time_entries_insert_self on public.learning_time_entries;
create policy learning_time_entries_insert_self on public.learning_time_entries
  for insert with check (user_id = auth.uid() and public.is_course_member(course_id));

revoke update, delete on public.learning_time_entries from authenticated;

-- 寫入 RPC（節流／activity 自動 sniff）
create or replace function public.record_learning_time(
  p_course_id uuid,
  p_activity_kind text,
  p_ref_id uuid,
  p_duration_seconds integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  if not public.is_course_member(p_course_id) then raise exception 'not a course member'; end if;
  if p_duration_seconds is null or p_duration_seconds < 0 then
    raise exception 'duration must be >= 0';
  end if;
  if p_duration_seconds > 14400 then
    -- 4 小時上限：避免單筆把整天混進去
    p_duration_seconds := 14400;
  end if;

  insert into public.learning_time_entries (
    course_id, user_id, activity_kind, ref_id, duration_seconds, started_at, ended_at
  ) values (
    p_course_id, auth.uid(), coalesce(p_activity_kind, 'misc'), p_ref_id,
    p_duration_seconds, now() - make_interval(secs => p_duration_seconds), now()
  )
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.record_learning_time(uuid, text, uuid, integer) to authenticated;

-- 學期／月份彙整視圖
create or replace view public.reporting_learning_time_monthly as
select
  course_id,
  user_id,
  date_trunc('month', started_at) as month_bucket,
  activity_kind,
  sum(duration_seconds)::bigint as total_seconds,
  count(*) as entry_count
from public.learning_time_entries
group by 1, 2, 3, 4;

comment on view public.reporting_learning_time_monthly is
  '學員每月累積學習時數（按活動類別）；RLS 由底層 entries 強制';

grant select on public.reporting_learning_time_monthly to authenticated;

-- ============================================================
-- 11. 教師工作量分析（reporting_teacher_workload view）
-- ============================================================
create or replace view public.reporting_teacher_workload as
with teacher_courses as (
  select cm.course_id, cm.user_id as teacher_id
  from public.course_members cm
  where cm.role in ('teacher', 'assistant', 'moderator')
)
select
  tc.teacher_id,
  tc.course_id,
  (select count(*) from public.announcements a
    where a.course_id = tc.course_id and a.author_id = tc.teacher_id) as announcements_authored,
  (select count(*) from public.forum_posts fp
    join public.forum_topics ft on ft.id = fp.topic_id
    where ft.course_id = tc.course_id and fp.author_id = tc.teacher_id) as forum_posts_authored,
  (select count(distinct s.id) from public.submissions s
    join public.assignments a on a.id = s.assignment_id
    where a.course_id = tc.course_id
      and (s.grade is not null or s.feedback is not null)
      and s.graded_by = tc.teacher_id) as submissions_graded,
  (select count(distinct (qa.attempt_id, qa.question_id)) from public.quiz_answers qa
    join public.quiz_attempts qat on qat.id = qa.attempt_id
    join public.quizzes q on q.id = qat.quiz_id
    where q.course_id = tc.course_id and qa.manual_score is not null) as essay_manual_scored,
  (select count(*) from public.live_sessions ls
    where ls.course_id = tc.course_id and ls.host_id = tc.teacher_id) as live_sessions_hosted
from teacher_courses tc;

comment on view public.reporting_teacher_workload is
  '教師／助教／仲裁工作量：公告、論壇貼文、批改作業數、複閱、主持 live session';

grant select on public.reporting_teacher_workload to authenticated;

create or replace function public.admin_teacher_workload()
returns table (
  teacher_id uuid,
  course_id uuid,
  announcements_authored bigint,
  forum_posts_authored bigint,
  submissions_graded bigint,
  essay_manual_scored bigint,
  live_sessions_hosted bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select v.*
  from public.reporting_teacher_workload v
  where public.is_platform_admin()
  order by (
    coalesce(v.announcements_authored, 0)
    + coalesce(v.forum_posts_authored, 0)
    + coalesce(v.submissions_graded, 0)
    + coalesce(v.essay_manual_scored, 0)
    + coalesce(v.live_sessions_hosted, 0)
  ) desc;
$$;

revoke execute on function public.admin_teacher_workload() from public;
grant execute on function public.admin_teacher_workload() to authenticated;
