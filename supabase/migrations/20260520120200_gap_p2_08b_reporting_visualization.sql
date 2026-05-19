-- GAP_P2_08b: 大量報表／視覺化進階
-- 對齊：scripts/tronclass-parity-matrix.txt 將 GAP_P2_08b 由「擴充中」昇為「彙整視圖＋匯出任務完成」。

-- ── 1. Quiz attempts 統計視圖（按試卷彙整：人次、平均、最高、最低、繳交率） ─
create or replace view public.reporting_quiz_overview as
select
  q.course_id,
  q.id as quiz_id,
  q.title as quiz_title,
  q.max_attempts,
  count(distinct qa.student_id) filter (where qa.submitted_at is not null) as submitted_students,
  count(qa.id) as total_attempts,
  count(qa.id) filter (where qa.submitted_at is not null) as submitted_attempts,
  avg(qa.score) filter (where qa.submitted_at is not null)::numeric(10,2) as avg_score,
  max(qa.score) filter (where qa.submitted_at is not null) as max_score,
  min(qa.score) filter (where qa.submitted_at is not null) as min_score
from public.quizzes q
left join public.quiz_attempts qa on qa.quiz_id = q.id
group by q.course_id, q.id, q.title, q.max_attempts;

comment on view public.reporting_quiz_overview is
  '試卷層級彙整：人次、平均、最高、最低；RLS 由底層 quiz_attempts 政策限制';

grant select on public.reporting_quiz_overview to authenticated;

-- ── 2. 互動課堂 attendance 統計視圖（按 session：總人次、遲到、按時） ──────
create or replace view public.reporting_live_attendance_overview as
select
  ls.course_id,
  ls.id as session_id,
  ls.title as session_title,
  ls.started_at,
  ls.ended_at,
  count(la.id) as attendance_total,
  count(la.id) filter (where la.status = 'late') as attendance_late,
  count(la.id) filter (where la.status = 'present') as attendance_on_time,
  count(la.id) filter (where la.status = 'absent') as attendance_absent
from public.live_sessions ls
left join public.live_attendance la on la.session_id = ls.id
group by ls.course_id, ls.id, ls.title, ls.started_at, ls.ended_at;

comment on view public.reporting_live_attendance_overview is
  '互動課堂簽到彙整；RLS 由底層 live_attendance 限制';

grant select on public.reporting_live_attendance_overview to authenticated;

-- ── 3. 課程參與度 materialized view（每課最近 7 日內訊息／作答／簽到）──
create materialized view if not exists public.reporting_course_engagement_7d as
select
  c.id as course_id,
  c.title as course_title,
  (
    select count(*) from public.forum_posts fp
    join public.forum_topics ft on ft.id = fp.topic_id
    where ft.course_id = c.id
      and fp.created_at >= now() - interval '7 days'
  ) as forum_posts_7d,
  (
    select count(*) from public.quiz_attempts qa
    join public.quizzes q on q.id = qa.quiz_id
    where q.course_id = c.id
      and qa.submitted_at >= now() - interval '7 days'
  ) as quiz_submissions_7d,
  (
    select count(*) from public.live_attendance la
    join public.live_sessions ls on ls.id = la.session_id
    where ls.course_id = c.id
      and la.recorded_at >= now() - interval '7 days'
  ) as attendance_7d,
  now() as refreshed_at
from public.courses c;

create unique index if not exists reporting_course_engagement_7d_pk
  on public.reporting_course_engagement_7d (course_id);

comment on materialized view public.reporting_course_engagement_7d is
  '近 7 日課程參與度三合一彙整（討論／作答／簽到）；以 refresh_reporting_course_engagement_7d 重整';

-- materialized view 無 RLS；存取限制透過 RPC
create or replace function public.admin_course_engagement_7d()
returns table (
  course_id uuid,
  course_title text,
  forum_posts_7d bigint,
  quiz_submissions_7d bigint,
  attendance_7d bigint,
  refreshed_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select v.course_id, v.course_title, v.forum_posts_7d, v.quiz_submissions_7d, v.attendance_7d, v.refreshed_at
  from public.reporting_course_engagement_7d v
  where public.is_platform_admin()
  order by (coalesce(v.forum_posts_7d, 0) + coalesce(v.quiz_submissions_7d, 0) + coalesce(v.attendance_7d, 0)) desc;
$$;

revoke execute on function public.admin_course_engagement_7d() from public;
grant execute on function public.admin_course_engagement_7d() to authenticated;

create or replace function public.refresh_reporting_course_engagement_7d()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'forbidden';
  end if;
  refresh materialized view concurrently public.reporting_course_engagement_7d;
end;
$$;

revoke execute on function public.refresh_reporting_course_engagement_7d() from public;
grant execute on function public.refresh_reporting_course_engagement_7d() to authenticated;

-- ── 4. 匯出任務表（非同步大型匯出；類似商用 LMS 的 background export） ──
create table if not exists public.report_export_jobs (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references public.profiles (id) on delete cascade,
  report_kind text not null check (
    report_kind in (
      'grade_item_scores',
      'grade_rollups',
      'quiz_overview',
      'live_attendance',
      'course_engagement'
    )
  ),
  scope_course_id uuid references public.courses (id) on delete cascade,
  format text not null check (format in ('csv', 'xlsx', 'pdf')),
  status text not null default 'queued' check (status in ('queued', 'running', 'ready', 'failed')),
  row_count integer,
  storage_path text,
  error_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists report_export_jobs_status_idx
  on public.report_export_jobs (status, created_at);

create index if not exists report_export_jobs_requester_idx
  on public.report_export_jobs (requested_by, created_at desc);

alter table public.report_export_jobs enable row level security;

drop policy if exists report_export_jobs_self_select on public.report_export_jobs;
create policy report_export_jobs_self_select on public.report_export_jobs
  for select using (
    requested_by = auth.uid() or public.is_platform_admin()
  );

drop policy if exists report_export_jobs_self_insert on public.report_export_jobs;
create policy report_export_jobs_self_insert on public.report_export_jobs
  for insert with check (
    requested_by = auth.uid()
    and (
      public.is_platform_admin()
      or (
        scope_course_id is not null
        and public.course_member_has_capability(scope_course_id, 'grades.export'::text)
      )
    )
  );

revoke update, delete on public.report_export_jobs from authenticated;

comment on table public.report_export_jobs is
  '非同步大量報表匯出任務佇列；由 Edge function 認領並更新 status／storage_path';

-- ── 5. 服務端認領／完成 RPC（service role 用；revoke from authenticated） ──
create or replace function public.report_export_jobs_claim_next()
returns public.report_export_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.report_export_jobs;
begin
  -- 僅 service_role / postgres 可以呼叫；platform admin 也允許（運維用）
  if not (
    public.is_platform_admin()
    or current_setting('request.jwt.claim.role', true) in ('service_role', 'postgres')
  ) then
    raise exception 'forbidden';
  end if;

  select * into v_job
  from public.report_export_jobs
  where status = 'queued'
  order by created_at asc
  for update skip locked
  limit 1;

  if v_job.id is null then
    return null;
  end if;

  update public.report_export_jobs
  set status = 'running', updated_at = now()
  where id = v_job.id
  returning * into v_job;

  return v_job;
end;
$$;

revoke execute on function public.report_export_jobs_claim_next() from public;
grant execute on function public.report_export_jobs_claim_next() to authenticated;

create or replace function public.report_export_jobs_complete(
  p_id uuid,
  p_status text,
  p_storage_path text,
  p_row_count integer,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    public.is_platform_admin()
    or current_setting('request.jwt.claim.role', true) in ('service_role', 'postgres')
  ) then
    raise exception 'forbidden';
  end if;

  if p_status not in ('ready', 'failed') then
    raise exception 'invalid status (expect ready|failed)';
  end if;

  update public.report_export_jobs
  set status = p_status,
      storage_path = p_storage_path,
      row_count = p_row_count,
      error_detail = p_error,
      updated_at = now()
  where id = p_id;
end;
$$;

revoke execute on function public.report_export_jobs_complete(uuid, text, text, integer, text) from public;
grant execute on function public.report_export_jobs_complete(uuid, text, text, integer, text) to authenticated;

comment on function public.report_export_jobs_claim_next() is
  '非同步匯出工作 worker 認領佇列下一筆';

comment on function public.report_export_jobs_complete(uuid, text, text, integer, text) is
  '非同步匯出工作 worker 標完成／失敗';
