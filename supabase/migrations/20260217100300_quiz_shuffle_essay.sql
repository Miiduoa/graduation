-- Quiz: shuffle flag, essay type, manual_score on answers, scoring + teacher RPC

alter table public.quizzes
  add column if not exists shuffle_questions boolean not null default false;

alter table public.quiz_answers
  add column if not exists manual_score numeric check (manual_score is null or manual_score >= 0);

alter table public.quiz_questions drop constraint if exists quiz_questions_question_type_check;

alter table public.quiz_questions
  add constraint quiz_questions_question_type_check check (
    question_type in ('single', 'multiple', 'boolean', 'short', 'essay')
  );

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
begin
  select qa.quiz_id, qa.started_at
    into v_quiz_id, v_started
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
begin
  if auth.uid() is null then
    raise exception '未登入';
  end if;

  select q.course_id, qq.points
    into v_course, v_pts
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
end;
$$;

grant execute on function public.set_quiz_manual_score(uuid, uuid, numeric) to authenticated;
