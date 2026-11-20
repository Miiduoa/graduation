-- P2 Enterprise: audit_logs, bulk enroll, course staff helpers, quiz pool, notifications dispatch diagnostics, AI usage ledger

-- ── Audit ───────────────────────────────────────────────────────────────

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_created_idx on public.audit_logs (created_at desc);
create index if not exists audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);

alter table public.audit_logs enable row level security;

drop policy if exists audit_logs_admin_select on public.audit_logs;
create policy audit_logs_admin_select on public.audit_logs
  for select using (public.is_platform_admin());

revoke insert, update, delete on public.audit_logs from authenticated;

create or replace function public.audit_forum_posts_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_topic uuid;
  v_snip text;
begin
  if tg_op = 'DELETE' then
    v_topic := old.topic_id;
    v_snip := left(coalesce(old.body, ''), 240);
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
    values (
      auth.uid(),
      'DELETE',
      'forum_posts',
      old.id,
      jsonb_build_object('topic_id', v_topic, 'body_snippet', v_snip)
    );
    return old;
  elsif tg_op = 'UPDATE' then
    v_topic := new.topic_id;
    v_snip := left(coalesce(new.body, ''), 240);
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
    values (
      auth.uid(),
      'UPDATE',
      'forum_posts',
      new.id,
      jsonb_build_object(
        'topic_id',
        v_topic,
        'body_snippet',
        v_snip,
        'edited',
        old.body is distinct from new.body
      )
    );
    return new;
  else
    v_topic := new.topic_id;
    v_snip := left(coalesce(new.body, ''), 240);
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
    values (
      auth.uid(),
      'INSERT',
      'forum_posts',
      new.id,
      jsonb_build_object('topic_id', v_topic, 'body_snippet', v_snip)
    );
    return new;
  end if;
end;
$$;

drop trigger if exists forum_posts_audit_touch on public.forum_posts;
create trigger forum_posts_audit_touch
  after insert or update or delete on public.forum_posts
  for each row execute function public.audit_forum_posts_touch();

create or replace function public.audit_grade_scores_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student uuid;
  v_item uuid;
begin
  if tg_op = 'DELETE' then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
    values (
      auth.uid(),
      'DELETE',
      'grade_scores',
      old.id,
      jsonb_build_object(
        'grade_item_id',
        old.grade_item_id,
        'student_id',
        old.student_id,
        'score_old',
        old.score
      )
    );
    return old;
  elsif tg_op = 'UPDATE' then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
    values (
      auth.uid(),
      'UPDATE',
      'grade_scores',
      new.id,
      jsonb_build_object(
        'grade_item_id',
        new.grade_item_id,
        'student_id',
        new.student_id,
        'score_old',
        old.score,
        'score_new',
        new.score
      )
    );
    return new;
  else
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
    values (
      auth.uid(),
      'INSERT',
      'grade_scores',
      new.id,
      jsonb_build_object(
        'grade_item_id',
        new.grade_item_id,
        'student_id',
        new.student_id,
        'score_new',
        new.score
      )
    );
    return new;
  end if;
end;
$$;

drop trigger if exists grade_scores_audit_touch on public.grade_scores;
create trigger grade_scores_audit_touch
  after insert or update or delete on public.grade_scores
  for each row execute function public.audit_grade_scores_touch();

-- ── Course staff (teacher + assistant + platform admin) ─────────────────

create or replace function public.is_course_staff(p_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_platform_admin()
    or exists (
      select 1
      from public.course_members cm
      where cm.course_id = p_course_id
        and cm.user_id = auth.uid()
        and cm.role in ('teacher', 'assistant')
    );
$$;

drop policy if exists materials_write_teacher on public.course_materials;
create policy materials_write_teacher on public.course_materials
  for insert with check (
    public.is_course_staff(course_id)
    and created_by = auth.uid()
  );

drop policy if exists materials_update_teacher on public.course_materials;
create policy materials_update_teacher on public.course_materials
  for update using (public.is_course_staff(course_id))
  with check (public.is_course_staff(course_id));

drop policy if exists materials_delete_teacher on public.course_materials;
create policy materials_delete_teacher on public.course_materials
  for delete using (public.is_course_staff(course_id));

drop policy if exists announcements_insert on public.announcements;
create policy announcements_insert on public.announcements
  for insert with check (
    public.is_course_staff(course_id)
    and author_id = auth.uid()
  );

drop policy if exists announcements_update on public.announcements;
create policy announcements_update on public.announcements
  for update using (
    public.is_course_staff(course_id)
    and (author_id = auth.uid() or public.is_course_teacher(course_id))
  )
  with check (public.is_course_staff(course_id));

drop policy if exists announcements_delete on public.announcements;
create policy announcements_delete on public.announcements
  for delete using (
    public.is_course_staff(course_id)
    and (author_id = auth.uid() or public.is_course_teacher(course_id))
  );

-- ── Bulk course member import ────────────────────────────────────────────

create or replace function public.bulk_import_course_members(p_course_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  r jsonb;
  v_email text;
  v_role text;
  v_uid uuid;
  inserted int := 0;
  skipped int := 0;
  i integer;
  v_len integer;
begin
  if auth.uid() is null then
    raise exception '未登入';
  end if;

  if not (
    public.is_platform_admin()
    or public.is_course_teacher(p_course_id)
  ) then
    raise exception '僅平台管理員或該課教師可匯入成員';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows 必須為 JSON array';
  end if;

  v_len := coalesce(jsonb_array_length(p_rows), 0);

  for i in 0 .. v_len - 1 loop
    r := p_rows->i;
    v_email := trim(lower(coalesce(r->>'email', '')));
    if v_email = '' then
      skipped := skipped + 1;
      continue;
    end if;

    v_role := lower(trim(coalesce(r->>'role', 'student')));
    if v_role not in ('student', 'assistant', 'teacher') then
      v_role := 'student';
    end if;

    if not public.is_platform_admin() then
      if v_role = 'teacher' then
        v_role := 'student';
      end if;
    end if;

    select au.id into v_uid from auth.users au where lower(au.email) = v_email limit 1;

    if v_uid is null then
      skipped := skipped + 1;
      continue;
    end if;

    insert into public.course_members (course_id, user_id, role)
    values (p_course_id, v_uid, v_role)
    on conflict (course_id, user_id) do update set role = excluded.role;

    inserted := inserted + 1;
  end loop;

  return jsonb_build_object('inserted_or_updated', inserted, 'skipped', skipped);
end;
$$;

grant execute on function public.bulk_import_course_members(uuid, jsonb) to authenticated;

-- ── Quiz pool: random K questions per attempt ───────────────────────────

alter table public.quizzes
  add column if not exists pool_pick_count integer check (pool_pick_count is null or pool_pick_count > 0);

alter table public.quiz_attempts
  add column if not exists drawn_question_ids uuid[];

comment on column public.quizzes.pool_pick_count is '若不為 NULL：每次開始作答自試卷題組隨機抽至多 K 題（写入 drawn_question_ids）';

create or replace function public.start_quiz_attempt(p_quiz_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
  v_max integer;
  v_count integer;
  v_new uuid;
  v_pick integer;
  v_total integer;
  v_drawn uuid[];
begin
  if auth.uid() is null then
    raise exception '未登入';
  end if;

  select q.max_attempts, q.pool_pick_count into v_max, v_pick
  from public.quizzes q
  where q.id = p_quiz_id;

  if not exists (
    select 1 from public.quizzes q
    where q.id = p_quiz_id
      and public.is_course_member(q.course_id)
  ) then
    raise exception '無權限';
  end if;

  select count(*) into v_count
  from public.quiz_attempts qa
  where qa.quiz_id = p_quiz_id
    and qa.student_id = auth.uid();

  if v_count >= coalesce(v_max, 1) then
    raise exception '已達作答次數上限';
  end if;

  select coalesce(max(qa.attempt_no), 0) + 1 into v_next
  from public.quiz_attempts qa
  where qa.quiz_id = p_quiz_id
    and qa.student_id = auth.uid();

  insert into public.quiz_attempts (quiz_id, student_id, attempt_no)
  values (p_quiz_id, auth.uid(), v_next)
  returning id into v_new;

  if v_pick is not null and v_pick > 0 then
    select count(*)::integer into v_total
    from public.quiz_questions qq
    where qq.quiz_id = p_quiz_id;

    if v_total > 0 then
      v_pick := least(v_pick, v_total);
      select array(
        select id
        from public.quiz_questions qq
        where qq.quiz_id = p_quiz_id
        order by random()
        limit v_pick
      ) into v_drawn;

      update public.quiz_attempts
      set drawn_question_ids = v_drawn
      where id = v_new;
    end if;
  end if;

  return v_new;
end;
$$;

grant execute on function public.start_quiz_attempt(uuid) to authenticated;

create or replace function public.submit_quiz_attempt(p_attempt_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_score numeric := 0;
  r record;
  v_quiz_id uuid;
  v_started timestamptz;
  v_limit integer;
  v_enforce boolean;
  v_drawn uuid[];
begin
  select qa.quiz_id, qa.started_at, qa.drawn_question_ids
    into v_quiz_id, v_started, v_drawn
  from public.quiz_attempts qa
  where qa.id = p_attempt_id
    and qa.student_id = auth.uid()
    and qa.submitted_at is null;

  if v_quiz_id is null then
    raise exception '無效的作答紀錄或已繳交';
  end if;

  select q.time_limit_seconds, q.enforce_time_limit
    into v_limit, v_enforce
  from public.quizzes q
  where q.id = v_quiz_id;

  if coalesce(v_enforce, true)
    and v_limit is not null
    and extract(epoch from (now() - v_started)) > v_limit then
    raise exception '超過作答時間限制';
  end if;

  for r in
    select qq.id as qid,
      qq.question_type as qtype,
      qq.points as pts,
      qs.correct_answer as corr,
      qa.answer as sans,
      qa.manual_score as ms
    from public.quiz_questions qq
    join public.quiz_question_solutions qs on qs.question_id = qq.id
    left join public.quiz_answers qa
      on qa.question_id = qq.id and qa.attempt_id = p_attempt_id
    where qq.quiz_id = v_quiz_id
      and (v_drawn is null or qq.id = any (v_drawn))
    order by qq.sort_order, qq.id
  loop
    if r.qtype::text = 'essay' then
      if r.ms is not null then
        v_score := v_score + least(coalesce(r.ms, 0), coalesce(r.pts, 0));
      end if;
      continue;
    end if;

    if r.sans is null then
      continue;
    end if;
    if public._quiz_answer_correct(r.qtype::text, r.sans, r.corr) then
      v_score := v_score + coalesce(r.pts, 0);
    end if;
  end loop;

  update public.quiz_attempts
  set score = v_score,
      submitted_at = now()
  where id = p_attempt_id;

  return v_score;
end;
$$;

grant execute on function public.submit_quiz_attempt(uuid) to authenticated;

create or replace function public.set_quiz_manual_score(p_attempt_id uuid, p_question_id uuid, p_score numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course uuid;
  v_pts numeric;
  rows_affected integer;
  v_quiz_id uuid;
  v_score numeric := 0;
  r record;
  v_submitted timestamptz;
  v_drawn uuid[];
begin
  if auth.uid() is null then
    raise exception '未登入';
  end if;

  select q.course_id, qq.points, qa.quiz_id, qa.submitted_at
    into v_course, v_pts, v_quiz_id, v_submitted
  from public.quiz_attempts qa
  join public.quizzes q on q.id = qa.quiz_id
  join public.quiz_questions qq on qq.id = p_question_id and qq.quiz_id = qa.quiz_id
  where qa.id = p_attempt_id;

  if v_course is null then
    raise exception '無效的作答或題目';
  end if;

  if not public.is_course_teacher(v_course) then
    raise exception '僅教師可評分';
  end if;

  update public.quiz_answers qa
  set manual_score = least(greatest(coalesce(p_score, 0), 0), coalesce(v_pts, 0))
  where qa.attempt_id = p_attempt_id
    and qa.question_id = p_question_id;

  get diagnostics rows_affected = row_count;
  if rows_affected = 0 then
    raise exception '找不到對應作答（請確認該題已有答案紀錄）';
  end if;

  if v_submitted is null then
    return;
  end if;

  select qa.drawn_question_ids into v_drawn from public.quiz_attempts qa where qa.id = p_attempt_id;

  for r in
    select qq.id as qid,
      qq.question_type as qtype,
      qq.points as pts,
      qs.correct_answer as corr,
      qa.answer as sans,
      qa.manual_score as ms
    from public.quiz_questions qq
    join public.quiz_question_solutions qs on qs.question_id = qq.id
    left join public.quiz_answers qa
      on qa.question_id = qq.id and qa.attempt_id = p_attempt_id
    where qq.quiz_id = v_quiz_id
      and (v_drawn is null or qq.id = any (v_drawn))
    order by qq.sort_order, qq.id
  loop
    if r.qtype::text = 'essay' then
      if r.ms is not null then
        v_score := v_score + least(coalesce(r.ms, 0), coalesce(r.pts, 0));
      end if;
      continue;
    end if;

    if r.sans is null then
      continue;
    end if;
    if public._quiz_answer_correct(r.qtype::text, r.sans, r.corr) then
      v_score := v_score + coalesce(r.pts, 0);
    end if;
  end loop;

  update public.quiz_attempts
  set score = v_score
  where id = p_attempt_id;
end;
$$;

grant execute on function public.set_quiz_manual_score(uuid, uuid, numeric) to authenticated;

-- ── Notifications dispatch diagnostics ─────────────────────────────────────

alter table public.notifications
  add column if not exists push_dispatch_error text;

alter table public.notifications
  add column if not exists push_dispatch_attempts integer not null default 0;

-- ── AI usage ledger (Edge Function increments via service role) ────────────

create table if not exists public.ai_usage_daily (
  user_id uuid not null references public.profiles (id) on delete cascade,
  usage_date date not null default ((timezone('utc', now()))::date),
  requests integer not null default 0 check (requests >= 0),
  primary key (user_id, usage_date)
);

alter table public.ai_usage_daily enable row level security;

drop policy if exists ai_usage_daily_own_select on public.ai_usage_daily;
create policy ai_usage_daily_own_select on public.ai_usage_daily
  for select using (user_id = auth.uid());

revoke insert, update, delete on public.ai_usage_daily from authenticated;
