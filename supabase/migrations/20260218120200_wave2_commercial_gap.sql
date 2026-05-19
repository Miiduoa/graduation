-- Wave 2 commercial gap: quiz pool_entries, question bank, notification push logs, materials mime_type, moderator + RLS

-- ── Course member role: moderator ────────────────────────────────────────

do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.course_members'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%teacher%student%assistant%'
  loop
    execute format('alter table public.course_members drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.course_members
  add constraint course_members_role_check
  check (role in ('teacher', 'student', 'assistant', 'moderator'));

-- ── Helpers: 「教學側仲裁／評分」含教師、課程助理教師(role moderator)、平台管理員 ─

create or replace function public.is_course_moderator(p_course_id uuid)
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
        and cm.role in ('teacher', 'moderator')
    );
$$;

-- ── Materials: optional MIME hint (HLS helpers in app layer) ─────────────

alter table public.course_materials
  add column if not exists mime_type text;

comment on column public.course_materials.mime_type is '選填 MIME（例如 application/vnd.apple.mpegurl）；供 App 辨識 HLS／串流類型';

-- ── Quiz pool (candidate subset before random pick) ───────────────────────

create table public.quiz_pool_entries (
  quiz_id uuid not null references public.quizzes (id) on delete cascade,
  question_id uuid not null references public.quiz_questions (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (quiz_id, question_id)
);

create index quiz_pool_entries_quiz_idx on public.quiz_pool_entries (quiz_id);

create or replace function public.quiz_pool_entry_same_quiz()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.quiz_questions qq
    where qq.id = new.question_id
      and qq.quiz_id = new.quiz_id
  ) then
    raise exception 'quiz_pool_entries: question must belong to the same quiz';
  end if;
  return new;
end;
$$;

create trigger quiz_pool_entries_same_quiz_trg
  before insert or update on public.quiz_pool_entries
  for each row execute function public.quiz_pool_entry_same_quiz();

alter table public.quiz_pool_entries enable row level security;

create policy quiz_pool_entries_select on public.quiz_pool_entries
  for select using (
    exists (
      select 1
      from public.quizzes q
      where q.id = quiz_pool_entries.quiz_id
        and public.is_course_member(q.course_id)
    )
  );

create policy quiz_pool_entries_teacher_all on public.quiz_pool_entries
  for all using (
    exists (
      select 1
      from public.quizzes q
      where q.id = quiz_pool_entries.quiz_id
        and public.is_course_teacher(q.course_id)
    )
  )
  with check (
    exists (
      select 1
      from public.quizzes q
      where q.id = quiz_pool_entries.quiz_id
        and public.is_course_teacher(q.course_id)
    )
  );

-- ── Course-level question bank (teacher + assistant maintain) ─────────────

create table public.course_question_bank (
  id uuid primary key default gen_random_uuid (),
  course_id uuid not null references public.courses (id) on delete cascade,
  question_type text not null,
  prompt text not null,
  choices jsonb,
  points numeric not null default 1 check (points >= 0),
  correct_answer jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now (),
  constraint course_question_bank_type_ck check (
    question_type in ('single', 'multiple', 'boolean', 'short', 'essay')
  )
);

create index course_question_bank_course_idx on public.course_question_bank (course_id);

alter table public.course_question_bank enable row level security;

create policy course_question_bank_select on public.course_question_bank
  for select using (public.is_course_member (course_id));

create policy course_question_bank_write_staff on public.course_question_bank
  for insert with check (
    public.is_course_staff (course_id)
    and created_by = auth.uid()
  );

create policy course_question_bank_update_staff on public.course_question_bank
  for update using (public.is_course_staff (course_id))
  with check (public.is_course_staff (course_id));

create policy course_question_bank_delete_staff on public.course_question_bank
  for delete using (public.is_course_staff (course_id));

create or replace function public.import_bank_questions_to_quiz (
  p_quiz_id uuid,
  p_bank_ids uuid[],
  p_add_to_pool boolean default true
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course uuid;
  v_sort_base integer;
  v_inserted integer := 0;
  b record;
  v_new_qid uuid;
begin
  if auth.uid () is null then
    raise exception '未登入';
  end if;

  select q.course_id into v_course
  from public.quizzes q
  where q.id = p_quiz_id;

  if v_course is null then
    raise exception '試卷不存在';
  end if;

  if not public.is_course_teacher (v_course) then
    raise exception '僅該課教師可由題庫匯題至試卷';
  end if;

  if p_bank_ids is null or cardinality (p_bank_ids) = 0 then
    return 0;
  end if;

  select coalesce (max (qq.sort_order), 0)
    into v_sort_base
  from public.quiz_questions qq
  where qq.quiz_id = p_quiz_id;

  for b in
    select *
    from public.course_question_bank cqb
    where cqb.id = any (p_bank_ids)
      and cqb.course_id = v_course
    order by cqb.sort_order, cqb.created_at, cqb.id
  loop
    v_sort_base := v_sort_base + 1;

    insert into public.quiz_questions (
      quiz_id,
      question_type,
      prompt,
      choices,
      points,
      sort_order
    )
    values (
      p_quiz_id,
      b.question_type,
      b.prompt,
      b.choices,
      b.points,
      v_sort_base
    )
    returning id into v_new_qid;

    insert into public.quiz_question_solutions (question_id, correct_answer)
    values (v_new_qid, b.correct_answer);

    if p_add_to_pool then
      insert into public.quiz_pool_entries (quiz_id, question_id)
      values (p_quiz_id, v_new_qid)
      on conflict do nothing;
    end if;

    v_inserted := v_inserted + 1;
  end loop;

  return v_inserted;
end;
$$;

grant execute on function public.import_bank_questions_to_quiz(uuid, uuid[], boolean)
  to authenticated;

-- ── start_quiz_attempt: optional pool_entries as draw source ───────────────

create or replace function public.start_quiz_attempt (p_quiz_id uuid)
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
  v_use_pool boolean := false;
begin
  if auth.uid () is null then
    raise exception '未登入';
  end if;

  select q.max_attempts, q.pool_pick_count into v_max, v_pick
  from public.quizzes q
  where q.id = p_quiz_id;

  if not exists (
    select 1
    from public.quizzes q
    where q.id = p_quiz_id
      and public.is_course_member (q.course_id)
  ) then
    raise exception '無權限';
  end if;

  select count(*) into v_count
  from public.quiz_attempts qa
  where qa.quiz_id = p_quiz_id
    and qa.student_id = auth.uid ();

  if v_count >= coalesce(v_max, 1) then
    raise exception '已達作答次數上限';
  end if;

  select coalesce (max(qa.attempt_no), 0) + 1 into v_next
  from public.quiz_attempts qa
  where qa.quiz_id = p_quiz_id
    and qa.student_id = auth.uid ();

  insert into public.quiz_attempts (quiz_id, student_id, attempt_no)
    values (p_quiz_id, auth.uid (), v_next)
    returning id into v_new;

  if v_pick is not null and v_pick > 0 then
    select exists (
      select 1 from public.quiz_pool_entries e where e.quiz_id = p_quiz_id
    ) into v_use_pool;

    if v_use_pool then
      select count(*)::integer into v_total
      from public.quiz_pool_entries e
      where e.quiz_id = p_quiz_id;
    else
      select count(*)::integer into v_total
      from public.quiz_questions qq
      where qq.quiz_id = p_quiz_id;
    end if;

    if v_total > 0 then
      v_pick := least (v_pick, v_total);

      if v_use_pool then
        select array(
          select e.question_id
          from public.quiz_pool_entries e
          where e.quiz_id = p_quiz_id
          order by random ()
          limit v_pick
        ) into v_drawn;
      else
        select array(
          select qq.id
          from public.quiz_questions qq
          where qq.quiz_id = p_quiz_id
          order by random ()
          limit v_pick
        ) into v_drawn;
      end if;

      update public.quiz_attempts set drawn_question_ids = v_drawn where id = v_new;
    end if;
  end if;

  return v_new;
end;
$$;

grant execute on function public.start_quiz_attempt (uuid) to authenticated;

-- ── Manual score: moderator may grade essay attempts ─────────────────────

create or replace function public.set_quiz_manual_score(
  p_attempt_id uuid,
  p_question_id uuid,
  p_score numeric
)
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
  if auth.uid () is null then
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

  if not public.is_course_moderator (v_course) then
    raise exception '無權限評分（需為該課教師、課程仲裁或平台管理員）';
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
      and (v_drawn is null or qq.id = any(v_drawn))
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
    if public._quiz_answer_correct (r.qtype::text, r.sans, r.corr) then
      v_score := v_score + coalesce(r.pts, 0);
    end if;
  end loop;

  update public.quiz_attempts set score = v_score where id = p_attempt_id;
end;
$$;

grant execute on function public.set_quiz_manual_score(uuid, uuid, numeric) to authenticated;

-- ── Notification push dispatch logs ───────────────────────────────────────

create table public.notification_push_logs (
  id uuid primary key default gen_random_uuid (),
  notification_id uuid not null references public.notifications (id) on delete cascade,
  status text not null check (status in ('attempted', 'success', 'failed')),
  http_status integer,
  error_detail text,
  expo_ticket_sample jsonb,
  created_at timestamptz not null default now ()
);

create index notification_push_logs_notif_created_idx
  on public.notification_push_logs (notification_id, created_at desc);

alter table public.notification_push_logs enable row level security;

drop policy if exists notification_push_logs_admin_select on public.notification_push_logs;
create policy notification_push_logs_admin_select on public.notification_push_logs
  for select using (public.is_platform_admin ());

revoke insert, update, delete on public.notification_push_logs from anon, authenticated;

-- ── Quiz / forum / grade_scores RLS: extend teacher paths to moderator scope
-- （quiz_question_solutions 維持僅「教師」CRUD：標準答案仍由試卷編者維護；複閱僅經 RPC 計分）

drop policy if exists quiz_attempts_select on public.quiz_attempts;
create policy quiz_attempts_select on public.quiz_attempts
  for select using (
    student_id = auth.uid ()
    or exists (
      select 1 from public.quizzes q
      where q.id = quiz_attempts.quiz_id
        and public.is_course_moderator (q.course_id)
    )
  );

drop policy if exists quiz_answers_select on public.quiz_answers;
create policy quiz_answers_select on public.quiz_answers
  for select using (
    exists (
      select 1 from public.quiz_attempts qa
      where qa.id = quiz_answers.attempt_id
        and (
          qa.student_id = auth.uid ()
          or exists (
            select 1 from public.quizzes q
            where q.id = qa.quiz_id
              and public.is_course_moderator (q.course_id)
          )
        )
    )
  );

drop policy if exists forum_topics_update on public.forum_topics;
create policy forum_topics_update on public.forum_topics
  for update using (
    public.is_course_member (course_id)
    and (
      author_id = auth.uid ()
      or public.is_course_moderator (course_id)
    )
  )
  with check (public.is_course_member (course_id));

drop policy if exists forum_topics_delete on public.forum_topics;
create policy forum_topics_delete on public.forum_topics
  for delete using (
    author_id = auth.uid ()
    or public.is_course_moderator (course_id)
  );

drop policy if exists forum_posts_update on public.forum_posts;
create policy forum_posts_update on public.forum_posts
  for update using (
    author_id = auth.uid ()
    or exists (
      select 1 from public.forum_topics t
      where t.id = forum_posts.topic_id
        and public.is_course_moderator (t.course_id)
    )
  )
  with check (
    exists (
      select 1 from public.forum_topics t
      where t.id = topic_id
        and (
          author_id = auth.uid ()
          or public.is_course_moderator (t.course_id)
        )
    )
  );

drop policy if exists forum_posts_delete on public.forum_posts;
create policy forum_posts_delete on public.forum_posts
  for delete using (
    author_id = auth.uid ()
    or exists (
      select 1 from public.forum_topics t
      where t.id = forum_posts.topic_id
        and public.is_course_moderator (t.course_id)
    )
  );

drop policy if exists forum_reports_select on public.forum_reports;
create policy forum_reports_select on public.forum_reports
  for select using (
    reporter_id = auth.uid ()
    or public.is_platform_admin ()
    or exists (
      select 1 from public.forum_topics t
      where (
          forum_reports.topic_id is not null
          and t.id = forum_reports.topic_id
          and public.is_course_moderator (t.course_id)
        )
        or (
          forum_reports.post_id is not null
          and t.id = (select fp.topic_id from public.forum_posts fp where fp.id = forum_reports.post_id)
          and public.is_course_moderator (t.course_id)
        )
    )
  );

drop policy if exists forum_reports_update_teacher on public.forum_reports;
create policy forum_reports_update_teacher on public.forum_reports
  for update using (
    public.is_platform_admin ()
    or exists (
      select 1 from public.forum_topics t
      where (
          forum_reports.topic_id is not null
          and t.id = forum_reports.topic_id
          and public.is_course_moderator (t.course_id)
        )
        or (
          forum_reports.post_id is not null
          and t.id = (select fp.topic_id from public.forum_posts fp where fp.id = forum_reports.post_id)
          and public.is_course_moderator (t.course_id)
        )
    )
  );

drop policy if exists forum_post_edits_select on public.forum_post_edits;
create policy forum_post_edits_select on public.forum_post_edits
  for select using (
    public.is_platform_admin ()
    or exists (
      select 1 from public.forum_posts fp
      join public.forum_topics t on t.id = fp.topic_id
      where fp.id = forum_post_edits.post_id
        and (
          fp.author_id = auth.uid ()
          or public.is_course_moderator (t.course_id)
        )
    )
  );

drop policy if exists grade_scores_select on public.grade_scores;
create policy grade_scores_select on public.grade_scores
  for select using (
    student_id = auth.uid ()
    or exists (
      select 1 from public.grade_items gi
      join public.grade_categories gc on gc.id = gi.category_id
      where gi.id = grade_scores.grade_item_id
        and public.is_course_moderator (gc.course_id)
    )
  );

drop policy if exists grade_scores_write_teacher on public.grade_scores;
create policy grade_scores_write_teacher on public.grade_scores
  for insert with check (
    exists (
      select 1 from public.grade_items gi
      join public.grade_categories gc on gc.id = gi.category_id
      where gi.id = grade_item_id
        and public.is_course_moderator (gc.course_id)
    )
  );

drop policy if exists grade_scores_update_teacher on public.grade_scores;
create policy grade_scores_update_teacher on public.grade_scores
  for update using (
    exists (
      select 1 from public.grade_items gi
      join public.grade_categories gc on gc.id = gi.category_id
      where gi.id = grade_scores.grade_item_id
        and public.is_course_moderator (gc.course_id)
    )
  )
  with check (
    exists (
      select 1 from public.grade_items gi
      join public.grade_categories gc on gc.id = gi.category_id
      where gi.id = grade_scores.grade_item_id
        and public.is_course_moderator (gc.course_id)
    )
  );

drop policy if exists grade_scores_delete_teacher on public.grade_scores;
create policy grade_scores_delete_teacher on public.grade_scores
  for delete using (
    exists (
      select 1 from public.grade_items gi
      join public.grade_categories gc on gc.id = gi.category_id
      where gi.id = grade_scores.grade_item_id
        and public.is_course_moderator (gc.course_id)
    )
  );
