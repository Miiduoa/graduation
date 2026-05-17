-- Assignments, submissions, quizzes, attempts, server-side scoring RPC

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  title text not null,
  description text not null default '',
  due_at timestamptz,
  max_points numeric not null default 100 check (max_points >= 0),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  body_text text not null default '',
  storage_path text,
  submitted_at timestamptz not null default now(),
  grade numeric check (grade is null or grade >= 0),
  feedback text,
  graded_at timestamptz,
  graded_by uuid references public.profiles (id),
  unique (assignment_id, student_id)
);

create table public.quizzes (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  title text not null,
  description text not null default '',
  time_limit_seconds integer check (time_limit_seconds is null or time_limit_seconds > 0),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes (id) on delete cascade,
  question_type text not null check (question_type in ('single', 'multiple', 'boolean', 'short')),
  prompt text not null,
  choices jsonb,
  points numeric not null default 1 check (points >= 0),
  sort_order integer not null default 0
);

create table public.quiz_question_solutions (
  question_id uuid primary key references public.quiz_questions (id) on delete cascade,
  correct_answer jsonb not null
);

create index quiz_questions_quiz_idx on public.quiz_questions (quiz_id);

create table public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  score numeric check (score is null or score >= 0),
  unique (quiz_id, student_id)
);

create table public.quiz_answers (
  attempt_id uuid not null references public.quiz_attempts (id) on delete cascade,
  question_id uuid not null references public.quiz_questions (id) on delete cascade,
  answer jsonb not null,
  primary key (attempt_id, question_id)
);

alter table public.assignments enable row level security;
alter table public.submissions enable row level security;
alter table public.quizzes enable row level security;
alter table public.quiz_questions enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.quiz_answers enable row level security;
alter table public.quiz_question_solutions enable row level security;

create policy quiz_solutions_teacher_all on public.quiz_question_solutions
  for all using (
    exists (
      select 1 from public.quiz_questions qq
      join public.quizzes q on q.id = qq.quiz_id
      where qq.id = quiz_question_solutions.question_id
        and public.is_course_teacher(q.course_id)
    )
  )
  with check (
    exists (
      select 1 from public.quiz_questions qq
      join public.quizzes q on q.id = qq.quiz_id
      where qq.id = question_id
        and public.is_course_teacher(q.course_id)
    )
  );

create policy assignments_select on public.assignments
  for select using (
    public.is_course_member(course_id)
  );

create policy assignments_write_teacher on public.assignments
  for insert with check (
    public.is_course_teacher(course_id)
    and created_by = auth.uid()
  );

create policy assignments_update_teacher on public.assignments
  for update using (public.is_course_teacher(course_id))
  with check (public.is_course_teacher(course_id));

create policy assignments_delete_teacher on public.assignments
  for delete using (public.is_course_teacher(course_id));

create policy submissions_select on public.submissions
  for select using (
    exists (
      select 1 from public.assignments a
      where a.id = submissions.assignment_id
        and (
          submissions.student_id = auth.uid()
          or public.is_course_teacher(a.course_id)
        )
    )
  );

create policy submissions_insert_self on public.submissions
  for insert with check (
    student_id = auth.uid()
    and exists (
      select 1 from public.assignments a
      where a.id = assignment_id
        and public.is_course_member(a.course_id)
    )
  );

create policy submissions_update_student on public.submissions
  for update using (student_id = auth.uid())
  with check (student_id = auth.uid());

create policy submissions_update_teacher_grade on public.submissions
  for update using (
    exists (
      select 1 from public.assignments a
      where a.id = submissions.assignment_id
        and public.is_course_teacher(a.course_id)
    )
  )
  with check (
    exists (
      select 1 from public.assignments a
      where a.id = submissions.assignment_id
        and public.is_course_teacher(a.course_id)
    )
  );

create policy quizzes_select on public.quizzes
  for select using (public.is_course_member(course_id));

create policy quizzes_write_teacher on public.quizzes
  for insert with check (
    public.is_course_teacher(course_id)
    and created_by = auth.uid()
  );

create policy quizzes_update_teacher on public.quizzes
  for update using (public.is_course_teacher(course_id))
  with check (public.is_course_teacher(course_id));

create policy quizzes_delete_teacher on public.quizzes
  for delete using (public.is_course_teacher(course_id));

create policy quiz_questions_select on public.quiz_questions
  for select using (
    exists (
      select 1 from public.quizzes q
      where q.id = quiz_questions.quiz_id
        and public.is_course_member(q.course_id)
    )
  );

create policy quiz_questions_write_teacher on public.quiz_questions
  for all using (
    exists (
      select 1 from public.quizzes q
      where q.id = quiz_questions.quiz_id
        and public.is_course_teacher(q.course_id)
    )
  )
  with check (
    exists (
      select 1 from public.quizzes q
      where q.id = quiz_questions.quiz_id
        and public.is_course_teacher(q.course_id)
    )
  );

create policy quiz_attempts_select on public.quiz_attempts
  for select using (
    student_id = auth.uid()
    or exists (
      select 1 from public.quizzes q
      where q.id = quiz_attempts.quiz_id
        and public.is_course_teacher(q.course_id)
    )
  );

create policy quiz_attempts_insert on public.quiz_attempts
  for insert with check (
    student_id = auth.uid()
    and exists (
      select 1 from public.quizzes q
      where q.id = quiz_id
        and public.is_course_member(q.course_id)
    )
  );

create policy quiz_attempts_update_self_unsubmitted on public.quiz_attempts
  for update using (
    student_id = auth.uid()
    and submitted_at is null
  )
  with check (
    student_id = auth.uid()
  );

create policy quiz_answers_select on public.quiz_answers
  for select using (
    exists (
      select 1 from public.quiz_attempts qa
      where qa.id = quiz_answers.attempt_id
        and (
          qa.student_id = auth.uid()
          or exists (
            select 1 from public.quizzes q
            where q.id = qa.quiz_id
              and public.is_course_teacher(q.course_id)
          )
        )
    )
  );

create policy quiz_answers_write_student on public.quiz_answers
  for insert with check (
    exists (
      select 1 from public.quiz_attempts qa
      where qa.id = attempt_id
        and qa.student_id = auth.uid()
        and qa.submitted_at is null
    )
  );

create policy quiz_answers_update_student on public.quiz_answers
  for update using (
    exists (
      select 1 from public.quiz_attempts qa
      where qa.id = quiz_answers.attempt_id
        and qa.student_id = auth.uid()
        and qa.submitted_at is null
    )
  )
  with check (
    exists (
      select 1 from public.quiz_attempts qa
      where qa.id = quiz_answers.attempt_id
        and qa.student_id = auth.uid()
        and qa.submitted_at is null
    )
  );

create policy quiz_answers_delete_student on public.quiz_answers
  for delete using (
    exists (
      select 1 from public.quiz_attempts qa
      where qa.id = quiz_answers.attempt_id
        and qa.student_id = auth.uid()
        and qa.submitted_at is null
    )
  );

-- Normalize JSON answers for grading
create or replace function public._quiz_normalize_answer(p_type text, p jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  ids text[];
begin
  if p_type = 'boolean' then
    return jsonb_build_object('value', coalesce((p->>'value')::boolean, null));
  elsif p_type = 'short' then
    return jsonb_build_object('text', lower(trim(coalesce(p->>'text', ''))));
  elsif p_type = 'single' then
    return jsonb_build_object('optionIds', case when p ? 'optionIds' then p->'optionIds' else '[]'::jsonb end);
  elsif p_type = 'multiple' then
    ids := array(select jsonb_array_elements_text(coalesce(p->'optionIds', '[]'::jsonb)));
    ids := array(select unnest(ids) order by 1);
    return jsonb_build_object('optionIds', to_jsonb(ids));
  end if;
  return p;
end;
$$;

create or replace function public._quiz_answer_correct(p_type text, p_student jsonb, p_correct jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  sn jsonb;
  cn jsonb;
begin
  sn := public._quiz_normalize_answer(p_type, p_student);
  cn := public._quiz_normalize_answer(p_type, p_correct);
  return sn = cn;
end;
$$;

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
  v_course_id uuid;
begin
  select qa.quiz_id into v_quiz_id
  from public.quiz_attempts qa
  where qa.id = p_attempt_id
    and qa.student_id = auth.uid()
    and qa.submitted_at is null;

  if v_quiz_id is null then
    raise exception '無效的作答紀錄或已繳交';
  end if;

  select q.course_id into v_course_id from public.quizzes q where q.id = v_quiz_id;

  for r in
    select qq.id as qid,
      qq.question_type as qtype,
      qq.points as pts,
      qs.correct_answer as corr,
      qa.answer as sans
    from public.quiz_questions qq
    join public.quiz_question_solutions qs on qs.question_id = qq.id
    left join public.quiz_answers qa
      on qa.question_id = qq.id and qa.attempt_id = p_attempt_id
    where qq.quiz_id = v_quiz_id
    order by qq.sort_order, qq.id
  loop
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
