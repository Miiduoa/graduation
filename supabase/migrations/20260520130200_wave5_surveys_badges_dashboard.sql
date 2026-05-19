-- Wave 5: 問卷 + 公告排程 + 徽章／證書 + i18n + 學生儀表板（TronClass 商用核心模組）

-- ============================================================
-- 5. surveys（非評分問卷／調查）
-- ============================================================
create table if not exists public.surveys (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  title text not null,
  description text not null default '',
  is_anonymous boolean not null default true,
  open_at timestamptz not null default now(),
  closes_at timestamptz,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create index if not exists surveys_course_idx on public.surveys (course_id);

alter table public.surveys enable row level security;

drop policy if exists surveys_select on public.surveys;
create policy surveys_select on public.surveys
  for select using (public.is_course_member(course_id) or public.is_platform_admin());

drop policy if exists surveys_write_staff on public.surveys;
create policy surveys_write_staff on public.surveys
  for all using (public.is_course_staff(course_id))
  with check (public.is_course_staff(course_id));

create table if not exists public.survey_questions (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys (id) on delete cascade,
  question_type text not null check (question_type in (
    'single', 'multiple', 'short', 'long', 'rating', 'boolean'
  )),
  prompt text not null,
  choices jsonb,
  required boolean not null default false,
  sort_order integer not null default 0
);

create index if not exists survey_questions_survey_idx on public.survey_questions (survey_id, sort_order);

alter table public.survey_questions enable row level security;

drop policy if exists survey_questions_select on public.survey_questions;
create policy survey_questions_select on public.survey_questions
  for select using (
    exists (
      select 1 from public.surveys s
      where s.id = survey_questions.survey_id
        and (public.is_course_member(s.course_id) or public.is_platform_admin())
    )
  );

drop policy if exists survey_questions_write_staff on public.survey_questions;
create policy survey_questions_write_staff on public.survey_questions
  for all using (
    exists (
      select 1 from public.surveys s
      where s.id = survey_questions.survey_id and public.is_course_staff(s.course_id)
    )
  )
  with check (
    exists (
      select 1 from public.surveys s
      where s.id = survey_id and public.is_course_staff(s.course_id)
    )
  );

create table if not exists public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys (id) on delete cascade,
  respondent_id uuid references public.profiles (id) on delete set null,
  answers jsonb not null default '{}'::jsonb,
  submitted_at timestamptz not null default now(),
  unique (survey_id, respondent_id)
);

create index if not exists survey_responses_survey_idx on public.survey_responses (survey_id);

alter table public.survey_responses enable row level security;

-- 匿名問卷：學生只能看自己已交（透過 respondent_id 比對；匿名則由 RPC 寫入時 respondent_id=null）
drop policy if exists survey_responses_self_or_staff on public.survey_responses;
create policy survey_responses_self_or_staff on public.survey_responses
  for select using (
    respondent_id = auth.uid()
    or exists (
      select 1 from public.surveys s
      where s.id = survey_responses.survey_id and public.is_course_staff(s.course_id)
    )
    or public.is_platform_admin()
  );

drop policy if exists survey_responses_insert_self on public.survey_responses;
create policy survey_responses_insert_self on public.survey_responses
  for insert with check (
    -- 走 RPC 才能繞過 respondent_id 約束；UI 端建議改呼叫 submit_survey_response
    respondent_id = auth.uid()
    and exists (
      select 1 from public.surveys s
      where s.id = survey_id
        and public.is_course_member(s.course_id)
        and (s.closes_at is null or s.closes_at > now())
        and s.open_at <= now()
    )
  );

revoke update, delete on public.survey_responses from authenticated;

-- 匿名／署名兩用 submit RPC：is_anonymous=true 時，respondent_id=null 保留稽核
create or replace function public.submit_survey_response(
  p_survey_id uuid,
  p_answers jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_anon boolean;
  v_open timestamptz;
  v_close timestamptz;
  v_course uuid;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;

  select is_anonymous, open_at, closes_at, course_id
    into v_anon, v_open, v_close, v_course
  from public.surveys
  where id = p_survey_id;

  if v_course is null then raise exception 'survey not found'; end if;
  if not public.is_course_member(v_course) then raise exception 'not a course member'; end if;
  if now() < v_open then raise exception 'survey not open yet'; end if;
  if v_close is not null and now() > v_close then raise exception 'survey closed'; end if;

  if v_anon then
    insert into public.survey_responses (survey_id, respondent_id, answers)
    values (p_survey_id, null, coalesce(p_answers, '{}'::jsonb))
    returning id into v_id;
  else
    insert into public.survey_responses (survey_id, respondent_id, answers)
    values (p_survey_id, auth.uid(), coalesce(p_answers, '{}'::jsonb))
    on conflict (survey_id, respondent_id) do update set answers = excluded.answers, submitted_at = now()
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

grant execute on function public.submit_survey_response(uuid, jsonb) to authenticated;

-- ============================================================
-- 6. 公告排程（announcements.scheduled_at + visibility scope）
-- ============================================================
alter table public.announcements
  add column if not exists scheduled_at timestamptz;

alter table public.announcements
  add column if not exists visibility_scope text not null default 'course'
    check (visibility_scope in ('course', 'group', 'role'));

alter table public.announcements
  add column if not exists visibility_target_id uuid;

comment on column public.announcements.scheduled_at is
  '排程發布時間；NULL 或 ≤ now() 表示已發布';
comment on column public.announcements.visibility_scope is
  '對象範圍：course=全課程；group=指定 course_group（target_id 為 group_id）；role=指定角色（target_id 暫不使用，用 role 字串 → 後續擴充）';

-- 學生視角僅看「已發布」（scheduled_at IS NULL 或已過）
drop policy if exists announcements_select on public.announcements;
create policy announcements_select on public.announcements
  for select using (
    public.is_course_member(course_id)
    and (
      scheduled_at is null
      or scheduled_at <= now()
      or public.is_course_staff(course_id)
    )
    and (
      visibility_scope = 'course'
      or (
        visibility_scope = 'group'
        and exists (
          select 1 from public.course_group_members cgm
          where cgm.group_id = announcements.visibility_target_id
            and cgm.user_id = auth.uid()
        )
      )
      or public.is_course_staff(course_id)
    )
  );

-- ============================================================
-- 7. 徽章／證書（course_badges + awards）
-- ============================================================
create table if not exists public.course_badges (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  name text not null,
  description text not null default '',
  icon_url text,
  criteria jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create index if not exists course_badges_course_idx on public.course_badges (course_id);

alter table public.course_badges enable row level security;

drop policy if exists course_badges_select on public.course_badges;
create policy course_badges_select on public.course_badges
  for select using (public.is_course_member(course_id) or public.is_platform_admin());

drop policy if exists course_badges_write_staff on public.course_badges;
create policy course_badges_write_staff on public.course_badges
  for all using (public.is_course_staff(course_id))
  with check (public.is_course_staff(course_id));

create table if not exists public.course_badge_awards (
  id uuid primary key default gen_random_uuid(),
  badge_id uuid not null references public.course_badges (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  awarded_by uuid references public.profiles (id) on delete set null,
  awarded_at timestamptz not null default now(),
  evidence jsonb not null default '{}'::jsonb,
  unique (badge_id, recipient_id)
);

create index if not exists course_badge_awards_recipient_idx on public.course_badge_awards (recipient_id);

alter table public.course_badge_awards enable row level security;

drop policy if exists course_badge_awards_self_or_staff on public.course_badge_awards;
create policy course_badge_awards_self_or_staff on public.course_badge_awards
  for select using (
    recipient_id = auth.uid()
    or exists (
      select 1 from public.course_badges b
      where b.id = course_badge_awards.badge_id and public.is_course_staff(b.course_id)
    )
    or public.is_platform_admin()
  );

drop policy if exists course_badge_awards_staff_grant on public.course_badge_awards;
create policy course_badge_awards_staff_grant on public.course_badge_awards
  for insert with check (
    exists (
      select 1 from public.course_badges b
      where b.id = badge_id and public.is_course_staff(b.course_id)
    )
  );

drop policy if exists course_badge_awards_staff_revoke on public.course_badge_awards;
create policy course_badge_awards_staff_revoke on public.course_badge_awards
  for delete using (
    exists (
      select 1 from public.course_badges b
      where b.id = course_badge_awards.badge_id and public.is_course_staff(b.course_id)
    )
  );

-- 自動授徽（criteria 範例：{"min_weighted_percent":80}）
create or replace function public.maybe_auto_award_badges(p_course_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
  v_n integer := 0;
  v_threshold numeric;
  r record;
begin
  if not public.is_course_staff(p_course_id) then
    raise exception 'forbidden';
  end if;

  for b in
    select * from public.course_badges
    where course_id = p_course_id and is_active = true
      and (criteria ? 'min_weighted_percent')
  loop
    v_threshold := coalesce((b.criteria->>'min_weighted_percent')::numeric, null);
    if v_threshold is null then continue; end if;

    for r in
      select student_id from public.course_grade_rollups
      where course_id = p_course_id
        and weighted_percent >= v_threshold
    loop
      insert into public.course_badge_awards (badge_id, recipient_id, awarded_by, evidence)
      values (b.id, r.student_id, auth.uid(), jsonb_build_object('reason', 'auto:weighted_percent>='||v_threshold))
      on conflict do nothing;
      v_n := v_n + 1;
    end loop;
  end loop;

  return v_n;
end;
$$;

grant execute on function public.maybe_auto_award_badges(uuid) to authenticated;

-- ============================================================
-- 8. i18n 框架（profiles.preferred_locale）
-- ============================================================
alter table public.profiles
  add column if not exists preferred_locale text default 'zh-TW';

alter table public.profiles
  add column if not exists timezone text default 'Asia/Taipei';

comment on column public.profiles.preferred_locale is 'IETF BCP 47 locale；App 取此值切換語系';
comment on column public.profiles.timezone is 'IANA timezone；行事曆／通知用';

-- ============================================================
-- 9. 學生學習儀表板（reporting view + RPC）
-- ============================================================
create or replace view public.reporting_student_dashboard as
select
  cm.course_id,
  cm.user_id as student_id,
  (select count(*) from public.assignments a
   where a.course_id = cm.course_id
     and (a.due_at is null or a.due_at >= now() - interval '30 days')) as assignments_active,
  (select count(*) from public.assignments a
   left join public.submissions s
     on s.assignment_id = a.id and s.student_id = cm.user_id
   where a.course_id = cm.course_id and s.id is null and (a.due_at is null or a.due_at > now())) as assignments_pending,
  (select count(*) from public.quizzes q
   left join public.quiz_attempts qa
     on qa.quiz_id = q.id and qa.student_id = cm.user_id and qa.submitted_at is not null
   where q.course_id = cm.course_id and qa.id is null) as quizzes_not_attempted,
  (select count(*) from public.peer_review_pairs pr
   join public.peer_review_assignments pa on pa.id = pr.review_assignment_id
   where pa.course_id = cm.course_id and pr.reviewer_id = cm.user_id and pr.status = 'pending') as peer_reviews_pending,
  (select count(*) from public.course_badge_awards a
   join public.course_badges b on b.id = a.badge_id
   where b.course_id = cm.course_id and a.recipient_id = cm.user_id) as badges_earned,
  (select coalesce(weighted_percent, 0) from public.course_grade_rollups r
   where r.course_id = cm.course_id and r.student_id = cm.user_id limit 1) as weighted_percent
from public.course_members cm
where cm.role = 'student';

comment on view public.reporting_student_dashboard is
  '學生課程儀表板：待辦作業／測驗、待評同儕、徽章、加權成績；RLS 由底層強制';

grant select on public.reporting_student_dashboard to authenticated;

create or replace function public.my_dashboard()
returns setof public.reporting_student_dashboard
language sql
stable
security definer
set search_path = public
as $$
  select * from public.reporting_student_dashboard
  where student_id = auth.uid();
$$;

grant execute on function public.my_dashboard() to authenticated;
