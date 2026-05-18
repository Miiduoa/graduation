-- LMS v2 — Combined migrations (33 個檔案,按時間序合併)
-- 用法:Supabase Dashboard → SQL Editor → New query → 貼上 → RUN
-- 產生於:Mon May 18 00:44:39 UTC 2026


-- ════════════════════════════════════════════════════════════
-- 20260117120001_core.sql
-- ════════════════════════════════════════════════════════════
-- Core: profiles, courses, members, materials, announcements, storage buckets & policies

create extension if not exists "pgcrypto";

-- Profiles (1:1 with auth.users)
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  role text not null default 'student' check (role in ('student', 'teacher', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(coalesce(new.email, ''), '@', 1)),
    'student'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Courses
create table public.courses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  owner_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.course_members (
  course_id uuid not null references public.courses (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('teacher', 'student', 'assistant')),
  joined_at timestamptz not null default now(),
  primary key (course_id, user_id)
);

create or replace function public.add_owner_as_course_teacher()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.course_members (course_id, user_id, role)
  values (new.id, new.owner_id, 'teacher')
  on conflict do nothing;
  return new;
end;
$$;

create trigger courses_owner_membership
  after insert on public.courses
  for each row execute function public.add_owner_as_course_teacher();

create table public.course_materials (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  title text not null,
  storage_path text,
  external_url text,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  author_id uuid not null references public.profiles (id),
  title text not null,
  body text not null default '',
  created_at timestamptz not null default now()
);

-- Membership helpers (SECURITY DEFINER: reads membership regardless of caller RLS recursion)
create or replace function public.is_course_member(p_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.course_members cm
    where cm.course_id = p_course_id
      and cm.user_id = auth.uid()
  );
$$;

create or replace function public.is_course_teacher(p_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.course_members cm
    where cm.course_id = p_course_id
      and cm.user_id = auth.uid()
      and cm.role = 'teacher'
  );
$$;

alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.course_members enable row level security;
alter table public.course_materials enable row level security;
alter table public.announcements enable row level security;

create policy profiles_select_self on public.profiles
  for select using (id = auth.uid());

create policy profiles_update_self on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy profiles_select_course_peers on public.profiles
  for select using (
    exists (
      select 1 from public.course_members m1
      join public.course_members m2 on m1.course_id = m2.course_id
      where m1.user_id = auth.uid()
        and m2.user_id = profiles.id
    )
  );

create policy courses_select_member on public.courses
  for select using (public.is_course_member(id));

create policy courses_insert_owner on public.courses
  for insert with check (owner_id = auth.uid());

create policy courses_update_owner on public.courses
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy courses_delete_owner on public.courses
  for delete using (owner_id = auth.uid());

create policy course_members_select on public.course_members
  for select using (public.is_course_member(course_id));

create policy course_members_manage_teacher on public.course_members
  for all using (public.is_course_teacher(course_id))
  with check (public.is_course_teacher(course_id));

create policy course_members_insert_self_student on public.course_members
  for insert with check (
    user_id = auth.uid()
    and role = 'student'
    and exists (
      select 1 from public.courses c
      where c.id = course_id
    )
  );

create policy materials_select on public.course_materials
  for select using (public.is_course_member(course_id));

create policy materials_write_teacher on public.course_materials
  for insert with check (
    public.is_course_teacher(course_id)
    and created_by = auth.uid()
  );

create policy materials_update_teacher on public.course_materials
  for update using (public.is_course_teacher(course_id))
  with check (public.is_course_teacher(course_id));

create policy materials_delete_teacher on public.course_materials
  for delete using (public.is_course_teacher(course_id));

create policy announcements_select on public.announcements
  for select using (public.is_course_member(course_id));

create policy announcements_insert on public.announcements
  for insert with check (
    public.is_course_teacher(course_id)
    and author_id = auth.uid()
  );

create policy announcements_update on public.announcements
  for update using (
    public.is_course_teacher(course_id)
    and (author_id = auth.uid() or public.is_course_teacher(course_id))
  )
  with check (public.is_course_teacher(course_id));

create policy announcements_delete on public.announcements
  for delete using (
    public.is_course_teacher(course_id)
    and (author_id = auth.uid() or public.is_course_teacher(course_id))
  );

-- Storage
insert into storage.buckets (id, name, public)
values ('materials', 'materials', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('submissions', 'submissions', false)
on conflict (id) do nothing;

-- Path: {course_id}/...
create policy materials_bucket_select on storage.objects
  for select using (
    bucket_id = 'materials'
    and public.is_course_member((split_part(name, '/', 1))::uuid)
  );

create policy materials_bucket_insert on storage.objects
  for insert with check (
    bucket_id = 'materials'
    and public.is_course_teacher((split_part(name, '/', 1))::uuid)
  );

create policy materials_bucket_update on storage.objects
  for update using (
    bucket_id = 'materials'
    and public.is_course_teacher((split_part(name, '/', 1))::uuid)
  );

create policy materials_bucket_delete on storage.objects
  for delete using (
    bucket_id = 'materials'
    and public.is_course_teacher((split_part(name, '/', 1))::uuid)
  );

-- Path: {course_id}/{assignment_id}/{student_id}/...
create policy submissions_bucket_select on storage.objects
  for select using (
    bucket_id = 'submissions'
    and (
      (
        split_part(name, '/', 4) <> ''
        and auth.uid() = (split_part(name, '/', 3))::uuid
      )
      or public.is_course_teacher((split_part(name, '/', 1))::uuid)
    )
  );

create policy submissions_bucket_insert on storage.objects
  for insert with check (
    bucket_id = 'submissions'
    and public.is_course_member((split_part(name, '/', 1))::uuid)
    and auth.uid() = (split_part(name, '/', 3))::uuid
  );

create policy submissions_bucket_update on storage.objects
  for update using (
    bucket_id = 'submissions'
    and (
      auth.uid() = (split_part(name, '/', 3))::uuid
      or public.is_course_teacher((split_part(name, '/', 1))::uuid)
    )
  );

create policy submissions_bucket_delete on storage.objects
  for delete using (
    bucket_id = 'submissions'
    and (
      auth.uid() = (split_part(name, '/', 3))::uuid
      or public.is_course_teacher((split_part(name, '/', 1))::uuid)
    )
  );


-- ════════════════════════════════════════════════════════════
-- 20260117120002_assignments_quizzes.sql
-- ════════════════════════════════════════════════════════════
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


-- ════════════════════════════════════════════════════════════
-- 20260117120003_forum_grades.sql
-- ════════════════════════════════════════════════════════════
-- Forum, gradebook, weighted totals view, quiz score sync into grade_scores

create table public.forum_topics (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  author_id uuid not null references public.profiles (id),
  title text not null,
  created_at timestamptz not null default now()
);

create table public.forum_posts (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.forum_topics (id) on delete cascade,
  author_id uuid not null references public.profiles (id),
  parent_post_id uuid references public.forum_posts (id) on delete cascade,
  body text not null default '',
  created_at timestamptz not null default now()
);

create index forum_topics_course_idx on public.forum_topics (course_id);
create index forum_posts_topic_idx on public.forum_posts (topic_id);

alter table public.forum_topics enable row level security;
alter table public.forum_posts enable row level security;

create policy forum_topics_select on public.forum_topics
  for select using (public.is_course_member(course_id));

create policy forum_topics_insert on public.forum_topics
  for insert with check (
    public.is_course_member(course_id)
    and author_id = auth.uid()
  );

create policy forum_topics_update on public.forum_topics
  for update using (
    public.is_course_member(course_id)
    and (
      author_id = auth.uid()
      or public.is_course_teacher(course_id)
    )
  )
  with check (public.is_course_member(course_id));

create policy forum_topics_delete on public.forum_topics
  for delete using (
    author_id = auth.uid()
    or public.is_course_teacher(course_id)
  );

create policy forum_posts_select on public.forum_posts
  for select using (
    exists (
      select 1 from public.forum_topics t
      where t.id = forum_posts.topic_id
        and public.is_course_member(t.course_id)
    )
  );

create policy forum_posts_insert on public.forum_posts
  for insert with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.forum_topics t
      where t.id = topic_id
        and public.is_course_member(t.course_id)
    )
  );

create policy forum_posts_update on public.forum_posts
  for update using (
    author_id = auth.uid()
    or exists (
      select 1 from public.forum_topics t
      where t.id = forum_posts.topic_id
        and public.is_course_teacher(t.course_id)
    )
  )
  with check (
    exists (
      select 1 from public.forum_topics t
      where t.id = topic_id
        and (
          author_id = auth.uid()
          or public.is_course_teacher(t.course_id)
        )
    )
  );

create policy forum_posts_delete on public.forum_posts
  for delete using (
    author_id = auth.uid()
    or exists (
      select 1 from public.forum_topics t
      where t.id = forum_posts.topic_id
        and public.is_course_teacher(t.course_id)
    )
  );

-- Gradebook
create table public.grade_categories (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  name text not null,
  weight numeric not null default 0 check (weight >= 0 and weight <= 1),
  sort_order integer not null default 0,
  unique (course_id, name)
);

create table public.grade_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.grade_categories (id) on delete cascade,
  source_type text not null check (source_type in ('assignment', 'quiz')),
  source_id uuid not null,
  title text not null,
  max_points numeric not null default 100 check (max_points > 0),
  unique (category_id, source_type, source_id)
);

create table public.grade_scores (
  id uuid primary key default gen_random_uuid(),
  grade_item_id uuid not null references public.grade_items (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  score numeric not null default 0 check (score >= 0),
  updated_at timestamptz not null default now(),
  unique (grade_item_id, student_id)
);

create index grade_scores_student_idx on public.grade_scores (student_id);

alter table public.grade_categories enable row level security;
alter table public.grade_items enable row level security;
alter table public.grade_scores enable row level security;

create policy grade_categories_select on public.grade_categories
  for select using (public.is_course_member(course_id));

create policy grade_categories_write_teacher on public.grade_categories
  for all using (public.is_course_teacher(course_id))
  with check (public.is_course_teacher(course_id));

create policy grade_items_select on public.grade_items
  for select using (
    exists (
      select 1 from public.grade_categories gc
      where gc.id = grade_items.category_id
        and public.is_course_member(gc.course_id)
    )
  );

create policy grade_items_write_teacher on public.grade_items
  for all using (
    exists (
      select 1 from public.grade_categories gc
      where gc.id = grade_items.category_id
        and public.is_course_teacher(gc.course_id)
    )
  )
  with check (
    exists (
      select 1 from public.grade_categories gc
      where gc.id = grade_items.category_id
        and public.is_course_teacher(gc.course_id)
    )
  );

create policy grade_scores_select on public.grade_scores
  for select using (
    student_id = auth.uid()
    or exists (
      select 1 from public.grade_items gi
      join public.grade_categories gc on gc.id = gi.category_id
      where gi.id = grade_scores.grade_item_id
        and public.is_course_teacher(gc.course_id)
    )
  );

create policy grade_scores_write_teacher on public.grade_scores
  for insert with check (
    exists (
      select 1 from public.grade_items gi
      join public.grade_categories gc on gc.id = gi.category_id
      where gi.id = grade_item_id
        and public.is_course_teacher(gc.course_id)
    )
  );

create policy grade_scores_update_teacher on public.grade_scores
  for update using (
    exists (
      select 1 from public.grade_items gi
      join public.grade_categories gc on gc.id = gi.category_id
      where gi.id = grade_scores.grade_item_id
        and public.is_course_teacher(gc.course_id)
    )
  )
  with check (
    exists (
      select 1 from public.grade_items gi
      join public.grade_categories gc on gc.id = gi.category_id
      where gi.id = grade_scores.grade_item_id
        and public.is_course_teacher(gc.course_id)
    )
  );

create policy grade_scores_delete_teacher on public.grade_scores
  for delete using (
    exists (
      select 1 from public.grade_items gi
      join public.grade_categories gc on gc.id = gi.category_id
      where gi.id = grade_scores.grade_item_id
        and public.is_course_teacher(gc.course_id)
    )
  );

create policy grade_scores_insert_student_own_quiz on public.grade_scores
  for insert with check (
    student_id = auth.uid()
    and exists (
      select 1 from public.grade_items gi
      join public.grade_categories gc on gc.id = gi.category_id
      where gi.id = grade_item_id
        and gi.source_type = 'quiz'
        and public.is_course_member(gc.course_id)
    )
  );

create policy grade_scores_update_student_own_quiz on public.grade_scores
  for update using (
    student_id = auth.uid()
    and exists (
      select 1 from public.grade_items gi
      where gi.id = grade_scores.grade_item_id
        and gi.source_type = 'quiz'
    )
  )
  with check (student_id = auth.uid());

-- Weighted percentage per student per course (0..100)
create or replace view public.course_grade_rollups as
with item_pct as (
  select
    gc.course_id,
    gs.student_id,
    gc.id as category_id,
    gc.weight as category_weight,
    gi.id as grade_item_id,
    gi.max_points,
    least(gs.score / nullif(gi.max_points, 0), 1::numeric) as item_pct
  from public.grade_scores gs
  join public.grade_items gi on gi.id = gs.grade_item_id
  join public.grade_categories gc on gc.id = gi.category_id
),
category_pct as (
  select
    course_id,
    student_id,
    category_id,
    category_weight,
    avg(item_pct) as cat_avg_pct
  from item_pct
  group by course_id, student_id, category_id, category_weight
)
select
  course_id,
  student_id,
  round((sum(category_weight * cat_avg_pct) / nullif(sum(category_weight), 0)) * 100, 2) as weighted_percent
from category_pct
group by course_id, student_id;

grant select on public.course_grade_rollups to authenticated;

-- Push quiz score into gradebook row tied to quiz (student invokes after submit RPC if item exists)
create or replace function public.sync_quiz_gradebook_from_attempt(p_attempt_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quiz_id uuid;
  v_student uuid;
  v_score numeric;
  v_max numeric := 0;
  gi record;
begin
  select qa.quiz_id, qa.student_id, qa.score
    into v_quiz_id, v_student, v_score
  from public.quiz_attempts qa
  where qa.id = p_attempt_id;

  if v_quiz_id is null or v_student <> auth.uid() then
    raise exception '無法同步成績';
  end if;

  select coalesce(sum(qq.points), 0)
    into v_max
  from public.quiz_questions qq
  where qq.quiz_id = v_quiz_id;

  for gi in
    select girow.id as gid
    from public.grade_items girow
    join public.grade_categories gc on gc.id = girow.category_id
    where girow.source_type = 'quiz'
      and girow.source_id = v_quiz_id
      and public.is_course_member(gc.course_id)
  loop
    insert into public.grade_scores (grade_item_id, student_id, score)
    values (gi.gid, v_student, least(coalesce(v_score, 0), (
      select gi2.max_points from public.grade_items gi2 where gi2.id = gi.gid
    )))
    on conflict (grade_item_id, student_id)
    do update set score = excluded.score, updated_at = now();
  end loop;
end;
$$;

grant execute on function public.sync_quiz_gradebook_from_attempt(uuid) to authenticated;


-- ════════════════════════════════════════════════════════════
-- 20260117120004_live.sql
-- ════════════════════════════════════════════════════════════
-- Interactive classroom sessions + deterministic buzzer winner (RPC)

create table public.live_sessions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  host_id uuid not null references public.profiles (id),
  title text not null default '',
  status text not null default 'live' check (status in ('scheduled', 'live', 'ended')),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create index live_sessions_course_idx on public.live_sessions (course_id);

create table public.live_buzzer_state (
  session_id uuid primary key references public.live_sessions (id) on delete cascade,
  winner_user_id uuid not null references public.profiles (id),
  claimed_at timestamptz not null default now()
);

alter table public.live_sessions enable row level security;
alter table public.live_buzzer_state enable row level security;

create policy live_sessions_select on public.live_sessions
  for select using (public.is_course_member(course_id));

create policy live_sessions_insert on public.live_sessions
  for insert with check (
    public.is_course_teacher(course_id)
    and host_id = auth.uid()
  );

create policy live_sessions_update_host on public.live_sessions
  for update using (
    host_id = auth.uid()
    or public.is_course_teacher(course_id)
  )
  with check (
    public.is_course_teacher(course_id)
  );

create policy live_sessions_delete_teacher on public.live_sessions
  for delete using (public.is_course_teacher(course_id));

create policy live_buzzer_select on public.live_buzzer_state
  for select using (
    exists (
      select 1 from public.live_sessions ls
      where ls.id = live_buzzer_state.session_id
        and public.is_course_member(ls.course_id)
    )
  );

create policy live_buzzer_teacher_all on public.live_buzzer_state
  for all using (
    exists (
      select 1 from public.live_sessions ls
      where ls.id = live_buzzer_state.session_id
        and public.is_course_teacher(ls.course_id)
    )
  )
  with check (
    exists (
      select 1 from public.live_sessions ls
      where ls.id = session_id
        and public.is_course_teacher(ls.course_id)
    )
  );

-- First caller wins; enforced by PK on session_id + transactional insert
create or replace function public.claim_live_buzzer(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  if auth.uid() is null then
    raise exception '未登入';
  end if;

  if not exists (
    select 1 from public.live_sessions ls
    where ls.id = p_session_id
      and ls.status = 'live'
      and public.is_course_member(ls.course_id)
  ) then
    raise exception '無效的課堂或尚未開始';
  end if;

  insert into public.live_buzzer_state (session_id, winner_user_id)
  values (p_session_id, auth.uid())
  on conflict (session_id) do nothing;

  get diagnostics affected = ROW_COUNT;
  return affected > 0;
end;
$$;

grant execute on function public.claim_live_buzzer(uuid) to authenticated;


-- ════════════════════════════════════════════════════════════
-- 20260201090000_tronclass_extend.sql
-- ════════════════════════════════════════════════════════════
-- TronClass 對齊擴充：點名、彈幕、通知、推播 token、教材進度、討論鎖帖／軟刪、測驗多次作答／限时、管理員唯讀、RPC

-- ── Helpers ─────────────────────────────────────────────────────────────
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  );
$$;

-- ── Live attendance ─────────────────────────────────────────────────────
create table public.live_attendance (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.live_sessions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'present' check (status in ('present', 'late', 'absent')),
  recorded_at timestamptz not null default now(),
  unique (session_id, user_id)
);

create index live_attendance_session_idx on public.live_attendance (session_id);

alter table public.live_attendance enable row level security;

create policy live_attendance_select on public.live_attendance
  for select using (
    exists (
      select 1 from public.live_sessions ls
      where ls.id = live_attendance.session_id
        and public.is_course_member(ls.course_id)
    )
  );

create policy live_attendance_insert_self on public.live_attendance
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.live_sessions ls
      where ls.id = session_id
        and ls.status = 'live'
        and public.is_course_member(ls.course_id)
    )
  );

create policy live_attendance_update_teacher on public.live_attendance
  for update using (
    exists (
      select 1 from public.live_sessions ls
      where ls.id = live_attendance.session_id
        and public.is_course_teacher(ls.course_id)
    )
  )
  with check (
    exists (
      select 1 from public.live_sessions ls
      where ls.id = session_id
        and public.is_course_teacher(ls.course_id)
    )
  );

create policy live_attendance_delete_teacher on public.live_attendance
  for delete using (
    exists (
      select 1 from public.live_sessions ls
      where ls.id = live_attendance.session_id
        and public.is_course_teacher(ls.course_id)
    )
  );

do $$
begin
  alter publication supabase_realtime add table public.live_attendance;
exception
  when undefined_object then null;
  when duplicate_object then null;
end $$;

alter table public.live_attendance replica identity full;

-- ── Live chat (persisted danmaku) ───────────────────────────────────────
create table public.live_chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.live_sessions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);

create index live_chat_session_created_idx on public.live_chat_messages (session_id, created_at desc);

alter table public.live_chat_messages enable row level security;

create policy live_chat_select on public.live_chat_messages
  for select using (
    exists (
      select 1 from public.live_sessions ls
      where ls.id = live_chat_messages.session_id
        and public.is_course_member(ls.course_id)
    )
  );

create policy live_chat_insert on public.live_chat_messages
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.live_sessions ls
      where ls.id = session_id
        and ls.status = 'live'
        and public.is_course_member(ls.course_id)
    )
  );

-- Enable Realtime (hosted Supabase); ignore errors on self-hosted without publication
do $$
begin
  alter publication supabase_realtime add table public.live_chat_messages;
exception
  when undefined_object then null;
  when duplicate_object then null;
end $$;

alter table public.live_chat_messages replica identity full;

-- ── Notifications + push tokens ─────────────────────────────────────────
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  body text not null default '',
  read_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index notifications_user_created_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

create policy notifications_own_select on public.notifications
  for select using (user_id = auth.uid());

create policy notifications_own_update on public.notifications
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy notifications_own_delete on public.notifications
  for delete using (user_id = auth.uid());

create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  token text not null,
  platform text not null default '' check (platform in ('ios', 'android', 'web', '')),
  updated_at timestamptz not null default now(),
  unique (user_id, token)
);

alter table public.push_tokens enable row level security;

create policy push_tokens_own_all on public.push_tokens
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── Material progress ───────────────────────────────────────────────────
create table public.material_progress (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.course_materials (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  progress numeric not null default 0 check (progress >= 0 and progress <= 1),
  last_seconds numeric not null default 0 check (last_seconds >= 0),
  opened_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (material_id, user_id)
);

create index material_progress_user_idx on public.material_progress (user_id);

alter table public.material_progress enable row level security;

create policy material_progress_select on public.material_progress
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from public.course_materials m
      where m.id = material_progress.material_id
        and public.is_course_teacher(m.course_id)
    )
  );

create policy material_progress_upsert_self on public.material_progress
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.course_materials m
      where m.id = material_id
        and public.is_course_member(m.course_id)
    )
  );

create policy material_progress_update_self on public.material_progress
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy material_progress_delete_self on public.material_progress
  for delete using (user_id = auth.uid());

-- ── Forum moderation ──────────────────────────────────────────────────────
alter table public.forum_topics
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by uuid references public.profiles (id);

alter table public.forum_posts
  add column if not exists deleted_at timestamptz;

drop policy if exists forum_posts_select on public.forum_posts;

create policy forum_posts_select on public.forum_posts
  for select using (
    exists (
      select 1 from public.forum_topics t
      where t.id = forum_posts.topic_id
        and public.is_course_member(t.course_id)
    )
    and (
      forum_posts.deleted_at is null
      or exists (
        select 1 from public.forum_topics t2
        where t2.id = forum_posts.topic_id
          and public.is_course_teacher(t2.course_id)
      )
    )
  );

drop policy if exists forum_posts_insert on public.forum_posts;

create policy forum_posts_insert on public.forum_posts
  for insert with check (
    author_id = auth.uid()
    and deleted_at is null
    and exists (
      select 1 from public.forum_topics t
      where t.id = topic_id
        and public.is_course_member(t.course_id)
        and (
          t.locked_at is null
          or public.is_course_teacher(t.course_id)
        )
    )
  );

-- ── Quiz: multiple attempts + enforce flags ─────────────────────────────
alter table public.quizzes
  add column if not exists max_attempts integer not null default 1 check (max_attempts >= 1 and max_attempts <= 50),
  add column if not exists enforce_time_limit boolean not null default true;

alter table public.quiz_attempts drop constraint if exists quiz_attempts_quiz_id_student_id_key;

alter table public.quiz_attempts
  add column if not exists attempt_no integer not null default 1 check (attempt_no >= 1);

update public.quiz_attempts set attempt_no = 1 where attempt_no is null;

alter table public.quiz_attempts
  add constraint quiz_attempts_quiz_student_attempt_no_unique unique (quiz_id, student_id, attempt_no);

-- Replace submit with time-limit check
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
  r_elapsed numeric;
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
begin
  if auth.uid() is null then
    raise exception '未登入';
  end if;

  select q.max_attempts into v_max
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

  return v_new;
end;
$$;

grant execute on function public.start_quiz_attempt(uuid) to authenticated;

create or replace function public.quiz_attempts_before_insert_guard()
returns trigger
language plpgsql
as $$
declare
  v_max integer;
  v_cnt integer;
  v_next integer;
begin
  if NEW.student_id <> auth.uid() then
    raise exception '只能建立自己的作答紀錄';
  end if;

  select q.max_attempts into v_max from public.quizzes q where q.id = NEW.quiz_id;

  select count(*) into v_cnt
  from public.quiz_attempts qa
  where qa.quiz_id = NEW.quiz_id
    and qa.student_id = NEW.student_id;

  if v_cnt >= coalesce(v_max, 1) then
    raise exception '超過作答次數上限';
  end if;

  select coalesce(max(qa.attempt_no), 0) + 1 into v_next
  from public.quiz_attempts qa
  where qa.quiz_id = NEW.quiz_id
    and qa.student_id = NEW.student_id;

  if NEW.attempt_no is distinct from v_next then
    raise exception '作答序號不正確';
  end if;

  return NEW;
end;
$$;

drop trigger if exists quiz_attempts_guard_insert on public.quiz_attempts;

create trigger quiz_attempts_guard_insert
  before insert on public.quiz_attempts
  for each row execute function public.quiz_attempts_before_insert_guard();

-- ── Random student picker ────────────────────────────────────────────────
create or replace function public.pick_random_student(p_course_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pick uuid;
begin
  if auth.uid() is null then
    raise exception '未登入';
  end if;

  if not public.is_course_teacher(p_course_id) then
    raise exception '僅教師可抽點';
  end if;

  select cm.user_id into v_pick
  from public.course_members cm
  where cm.course_id = p_course_id
    and cm.role = 'student'
  order by random()
  limit 1;

  return v_pick;
end;
$$;

grant execute on function public.pick_random_student(uuid) to authenticated;

-- ── Bulk notifications (teacher / admin) ────────────────────────────────
create or replace function public.notify_course_members(p_course_id uuid, p_title text, p_body text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer := 0;
begin
  if auth.uid() is null then
    raise exception '未登入';
  end if;

  if not (
    public.is_course_teacher(p_course_id)
    or public.is_platform_admin()
  ) then
    raise exception '無權限發送通知';
  end if;

  insert into public.notifications (user_id, title, body)
  select cm.user_id, p_title, coalesce(p_body, '')
  from public.course_members cm
  where cm.course_id = p_course_id;

  get diagnostics inserted = ROW_COUNT;
  return inserted;
end;
$$;

grant execute on function public.notify_course_members(uuid, text, text) to authenticated;

-- ── Admin read-only policies ────────────────────────────────────────────
create policy courses_admin_select on public.courses
  for select using (public.is_platform_admin());

create policy profiles_admin_select on public.profiles
  for select using (
    id = auth.uid()
    or public.is_platform_admin()
  );

create policy course_members_admin_select on public.course_members
  for select using (public.is_platform_admin());


-- ════════════════════════════════════════════════════════════
-- 20260217100000_live_attendance_window.sql
-- ════════════════════════════════════════════════════════════
-- Live session attendance time windows + RPC-only student check-in

alter table public.live_sessions
  add column if not exists attendance_open_at timestamptz,
  add column if not exists attendance_close_at timestamptz,
  add column if not exists attendance_late_cutoff_at timestamptz;

comment on column public.live_sessions.attendance_open_at is '簽到開放時間（NULL 搭配下方規則：若三者皆 NULL 則不限時間）';
comment on column public.live_sessions.attendance_close_at is '簽到截止時間';
comment on column public.live_sessions.attendance_late_cutoff_at is '超過此時間戳仍可在截止前簽到，但標記為 late（NULL 表示窗口內皆 present）';

-- Students must use RPC (security definer) so rules are enforced server-side
drop policy if exists live_attendance_insert_self on public.live_attendance;
drop policy if exists live_attendance_insert_blocked on public.live_attendance;

create policy live_attendance_insert_blocked on public.live_attendance
  for insert with check (false);

create or replace function public.record_live_attendance(p_session_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course uuid;
  v_status text not null default 'scheduled';
  v_open timestamptz;
  v_close timestamptz;
  v_late_cut timestamptz;
  v_final text;
  v_now timestamptz := now();
begin
  if auth.uid() is null then
    raise exception '未登入';
  end if;

  select ls.course_id, ls.status, ls.attendance_open_at, ls.attendance_close_at, ls.attendance_late_cutoff_at
    into v_course, v_status, v_open, v_close, v_late_cut
  from public.live_sessions ls
  where ls.id = p_session_id;

  if v_course is null then
    raise exception '無效的 Session';
  end if;

  if not public.is_course_member(v_course) then
    raise exception '非課程成員';
  end if;

  if v_status <> 'live' then
    raise exception '課堂未進行中';
  end if;

  -- 無開始／結束限制（維持舊版「隨時可簽」）
  if v_open is null and v_close is null then
    v_final := 'present';
  else
    if v_open is not null and v_now < v_open then
      raise exception '簽到尚未開放';
    end if;
    if v_close is not null and v_now > v_close then
      raise exception '簽到已截止';
    end if;
    if v_late_cut is not null and v_now > v_late_cut then
      v_final := 'late';
    else
      v_final := 'present';
    end if;
  end if;

  insert into public.live_attendance (session_id, user_id, status, recorded_at)
  values (p_session_id, auth.uid(), v_final, v_now)
  on conflict (session_id, user_id)
  do update set status = excluded.status, recorded_at = excluded.recorded_at;

  return v_final;
end;
$$;

grant execute on function public.record_live_attendance(uuid) to authenticated;


-- ════════════════════════════════════════════════════════════
-- 20260217100200_forum_moderation.sql
-- ════════════════════════════════════════════════════════════
-- Forum moderation: reports + post edit audit (trigger); teachers retain DELETE policy from base migration

create table public.forum_reports (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid references public.forum_topics (id) on delete cascade,
  post_id uuid references public.forum_posts (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reason text not null default '',
  status text not null default 'open' check (status in ('open', 'dismissed', 'resolved')),
  created_at timestamptz not null default now(),
  constraint forum_reports_target_ck check (
    topic_id is not null or post_id is not null
  )
);

create index forum_reports_topic_idx on public.forum_reports (topic_id);
create index forum_reports_post_idx on public.forum_reports (post_id);

alter table public.forum_reports enable row level security;

create policy forum_reports_select on public.forum_reports
  for select using (
    reporter_id = auth.uid()
    or public.is_platform_admin()
    or exists (
      select 1 from public.forum_topics t
      where (
          forum_reports.topic_id is not null
          and t.id = forum_reports.topic_id
          and public.is_course_teacher(t.course_id)
        )
        or (
          forum_reports.post_id is not null
          and t.id = (select fp.topic_id from public.forum_posts fp where fp.id = forum_reports.post_id)
          and public.is_course_teacher(t.course_id)
        )
    )
  );

create policy forum_reports_insert on public.forum_reports
  for insert with check (
    reporter_id = auth.uid()
    and (
      (
        topic_id is not null
        and exists (
          select 1 from public.forum_topics t
          where t.id = topic_id
            and public.is_course_member(t.course_id)
        )
      )
      or (
        post_id is not null
        and exists (
          select 1 from public.forum_posts fp
          join public.forum_topics t on t.id = fp.topic_id
          where fp.id = post_id
            and public.is_course_member(t.course_id)
        )
      )
    )
  );

create policy forum_reports_update_teacher on public.forum_reports
  for update using (
    public.is_platform_admin()
    or exists (
      select 1 from public.forum_topics t
      where (
          forum_reports.topic_id is not null
          and t.id = forum_reports.topic_id
          and public.is_course_teacher(t.course_id)
        )
        or (
          forum_reports.post_id is not null
          and t.id = (select fp.topic_id from public.forum_posts fp where fp.id = forum_reports.post_id)
          and public.is_course_teacher(t.course_id)
        )
    )
  );

create table public.forum_post_edits (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.forum_posts (id) on delete cascade,
  editor_id uuid not null references public.profiles (id) on delete cascade,
  previous_body text not null,
  new_body text not null,
  created_at timestamptz not null default now()
);

create index forum_post_edits_post_idx on public.forum_post_edits (post_id);

alter table public.forum_post_edits enable row level security;

create policy forum_post_edits_select on public.forum_post_edits
  for select using (
    public.is_platform_admin()
    or exists (
      select 1 from public.forum_posts fp
      join public.forum_topics t on t.id = fp.topic_id
      where fp.id = forum_post_edits.post_id
        and (
          fp.author_id = auth.uid()
          or public.is_course_teacher(t.course_id)
        )
    )
  );

-- Block direct inserts; edits logged via SECURITY DEFINER trigger below
create policy forum_post_edits_insert_blocked on public.forum_post_edits
  for insert with check (false);

create or replace function public.forum_posts_audit_edit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
    and old.body is distinct from new.body then
    insert into public.forum_post_edits (post_id, editor_id, previous_body, new_body)
    values (old.id, auth.uid(), old.body, new.body);
  end if;
  return new;
end;
$$;

drop trigger if exists forum_posts_audit_edit_trg on public.forum_posts;

create trigger forum_posts_audit_edit_trg
  before update on public.forum_posts
  for each row execute function public.forum_posts_audit_edit();


-- ════════════════════════════════════════════════════════════
-- 20260217100300_quiz_shuffle_essay.sql
-- ════════════════════════════════════════════════════════════
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


-- ════════════════════════════════════════════════════════════
-- 20260217100400_notifications_push_dispatch.sql
-- ════════════════════════════════════════════════════════════
-- Push dispatch bookkeeping for Edge Function workers

alter table public.notifications
  add column if not exists push_dispatched_at timestamptz;

comment on column public.notifications.push_dispatched_at is '若設定表示已嘗試透過 Expo Push 派發（不等於成功送達終端）';


-- ════════════════════════════════════════════════════════════
-- 20260217100500_quiz_manual_score_refresh_score.sql
-- ════════════════════════════════════════════════════════════
-- After teacher sets manual_score on essay answers, refresh quiz_attempts.score when already submitted.

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
  set score = v_score
  where id = p_attempt_id;
end;
$$;

grant execute on function public.set_quiz_manual_score(uuid, uuid, numeric) to authenticated;


-- ════════════════════════════════════════════════════════════
-- 20260218120000_p2_enterprise.sql
-- ════════════════════════════════════════════════════════════
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


-- ════════════════════════════════════════════════════════════
-- 20260218120100_increment_ai_usage.sql
-- ════════════════════════════════════════════════════════════
-- Callable only by service_role (Edge Functions); increments daily AI counter atomically.

create or replace function public.increment_ai_usage(p_uid uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := (timezone('utc', now()))::date;
  v_cnt integer;
begin
  insert into public.ai_usage_daily (user_id, usage_date, requests)
  values (p_uid, v_day, 1)
  on conflict (user_id, usage_date)
  do update set requests = public.ai_usage_daily.requests + 1
  returning requests into v_cnt;

  return coalesce(v_cnt, 0);
end;
$$;

revoke all on function public.increment_ai_usage(uuid) from public;
grant execute on function public.increment_ai_usage(uuid) to service_role;


-- ════════════════════════════════════════════════════════════
-- 20260218120200_wave2_commercial_gap.sql
-- ════════════════════════════════════════════════════════════
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


-- ════════════════════════════════════════════════════════════
-- 20260517120000_wave3_wave6_plan_expansion.sql
-- ════════════════════════════════════════════════════════════
-- Wave plan 3–6: DLQ abandonment + admin notification read, configurable RBAC capability matrix basis,
-- platform admin gradebook reads for reporting, AI material enrichment table + course flag.

-- ── Notifications: platform admin SELECT (DLQ／營運儀表)，與發送窮舉 ───────────

alter table public.notifications
  add column if not exists push_dispatch_abandoned_at timestamptz;

comment on column public.notifications.push_dispatch_abandoned_at is '達最大重試次數後標記為放棄，dispatch 將略過但仍保留 push_dispatch_attempts 紀錄';

create index if not exists notifications_dispatch_pending_idx
  on public.notifications (created_at asc)
  where push_dispatched_at is null and push_dispatch_abandoned_at is null;

drop policy if exists notifications_admin_select on public.notifications;

create policy notifications_admin_select on public.notifications
  for select using (public.is_platform_admin ());

-- ── RBAC: 可調整的角色─能力對照（以 UPDATE 此表達成組態；RLS / RPC 可查函式） ──

create table public.course_role_capabilities (
  role_key text not null check (role_key in ('teacher', 'student', 'assistant', 'moderator')),
  capability_slug text not null,
  allowed boolean not null default true,
  primary key (role_key, capability_slug)
);

comment on table public.course_role_capabilities is '課程內建角色對能力旗標；可依部署調整為「組態 RBAC」。';

alter table public.course_role_capabilities enable row level security;

drop policy if exists course_role_capabilities_read on public.course_role_capabilities;

create policy course_role_capabilities_read on public.course_role_capabilities
  for select using (true);

drop policy if exists course_role_capabilities_admin_write on public.course_role_capabilities;

create policy course_role_capabilities_admin_write on public.course_role_capabilities
  for insert with check (public.is_platform_admin ());

drop policy if exists course_role_capabilities_admin_update on public.course_role_capabilities;

create policy course_role_capabilities_admin_update on public.course_role_capabilities
  for update using (public.is_platform_admin ())
  with check (public.is_platform_admin ());

drop policy if exists course_role_capabilities_admin_delete on public.course_role_capabilities;

create policy course_role_capabilities_admin_delete on public.course_role_capabilities
  for delete using (public.is_platform_admin ());

revoke insert, update, delete on public.course_role_capabilities from anon;

grant select on public.course_role_capabilities to authenticated;

insert into public.course_role_capabilities (role_key, capability_slug, allowed) values
  ('teacher', 'members.bulk_import', true),
  ('teacher', 'quiz.import_bank', true),
  ('teacher', 'quiz.author_structure', true),
  ('teacher', 'grades.structure', true),
  ('moderator', 'members.bulk_import', false),
  ('moderator', 'quiz.import_bank', false),
  ('moderator', 'quiz.author_structure', false),
  ('moderator', 'grades.structure', false),
  ('moderator', 'grades.matrix_write', true),
  ('moderator', 'forum.moderate', true),
  ('assistant', 'members.bulk_import', false),
  ('assistant', 'quiz.import_bank', false),
  ('assistant', 'quiz.author_structure', false),
  ('assistant', 'grades.structure', false),
  ('assistant', 'grades.matrix_write', true),
  ('assistant', 'forum.moderate', false),
  ('student', 'members.bulk_import', false),
  ('student', 'quiz.import_bank', false),
  ('student', 'quiz.author_structure', false),
  ('student', 'grades.structure', false),
  ('student', 'grades.matrix_write', false),
  ('student', 'forum.moderate', false)
on conflict (role_key, capability_slug) do update set allowed = excluded.allowed;

create or replace function public.course_member_has_capability (
  p_course_id uuid,
  p_capability_slug text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid () is null then false
    when public.is_platform_admin () then true
    else exists (
      select 1
      from public.course_members cm
      join public.course_role_capabilities crc
        on crc.role_key = cm.role::text and crc.capability_slug = p_capability_slug
      where cm.course_id = p_course_id
        and cm.user_id = auth.uid ()
        and crc.allowed is true
    )
  end;
$$;

grant execute on function public.course_member_has_capability (uuid, text) to authenticated;

comment on function public.course_member_has_capability is '結合 course_members.role 與 course_role_capabilities；平台管理員視為全能。';

-- 將既有「bulk_import」門檻由純 teacher 改為可查 capability（仍以教師為預設真）
create or replace function public.bulk_import_course_members (p_course_id uuid, p_rows jsonb)
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
  if auth.uid () is null then
    raise exception '未登入';
  end if;

  if not (
    public.is_platform_admin ()
    or public.course_member_has_capability (p_course_id, 'members.bulk_import'::text)
  ) then
    raise exception '僅平台管理員或具 members.bulk_import 能力的課程成員可匯入';
  end if;

  -- 助教／仲裁仍不可把成員昇格為 teacher（平台管理員可）
  if p_rows is null or jsonb_typeof (p_rows) <> 'array' then
    raise exception 'p_rows 必須為 JSON array';
  end if;

  v_len := coalesce (jsonb_array_length (p_rows), 0);

  for i in 0 .. v_len - 1 loop
    r := p_rows->i;
    v_email := trim (lower (coalesce (r->>'email', '')));
    if v_email = '' then
      skipped := skipped + 1;
      continue;
    end if;

    v_role := lower (trim (coalesce (r->>'role', 'student')));
    if v_role not in ('student', 'assistant', 'teacher') then
      v_role := 'student';
    end if;

    if not public.is_platform_admin () then
      if v_role = 'teacher' then
        v_role := 'student';
      end if;
    end if;

    select au.id into v_uid from auth.users au where lower (au.email) = v_email limit 1;

    if v_uid is null then
      skipped := skipped + 1;
      continue;
    end if;

    insert into public.course_members (course_id, user_id, role)
    values (p_course_id, v_uid, v_role)
    on conflict (course_id, user_id) do update set role = excluded.role;

    inserted := inserted + 1;
  end loop;

  return jsonb_build_object ('inserted_or_updated', inserted, 'skipped', skipped);
end;
$$;

-- import_bank_questions_to_quiz 改以 capability quiz.import_bank（預設僅 teacher）
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

  select q.course_id into v_course from public.quizzes q where q.id = p_quiz_id;

  if v_course is null then
    raise exception '試卷不存在';
  end if;

  if not public.course_member_has_capability (v_course, 'quiz.import_bank'::text) then
    raise exception '無題庫匯入試卷能力';
  end if;

  if p_bank_ids is null or cardinality (p_bank_ids) = 0 then
    return 0;
  end if;

  select coalesce (max (qq.sort_order), 0) into v_sort_base
  from public.quiz_questions qq
  where qq.quiz_id = p_quiz_id;

  for b in
    select *
    from public.course_question_bank cqb
    where cqb.id = any (p_bank_ids) and cqb.course_id = v_course
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

    if coalesce (p_add_to_pool, true) then
      insert into public.quiz_pool_entries (quiz_id, question_id)
      values (p_quiz_id, v_new_qid)
      on conflict do nothing;
    end if;

    v_inserted := v_inserted + 1;
  end loop;

  return v_inserted;
end;
$$;

-- ── Reporting: admin 可查成績維度（唯讀彙總／匯出用） ────────────────────────

drop policy if exists grade_categories_select on public.grade_categories;

create policy grade_categories_select on public.grade_categories
  for select using (
    public.is_course_member (course_id) or public.is_platform_admin ()
  );

drop policy if exists grade_items_select on public.grade_items;

create policy grade_items_select on public.grade_items
  for select using (
    exists (
      select 1
      from public.grade_categories gc
      where gc.id = grade_items.category_id
        and (
          public.is_course_member (gc.course_id) or public.is_platform_admin ()
        )
    )
  );

drop policy if exists grade_scores_select on public.grade_scores;

create policy grade_scores_select on public.grade_scores
  for select using (
    student_id = auth.uid ()
    or public.is_platform_admin ()
    or exists (
      select 1
      from public.grade_items gi
      join public.grade_categories gc on gc.id = gi.category_id
      where gi.id = grade_scores.grade_item_id
        and public.is_course_moderator (gc.course_id)
    )
  );

-- ── AI 影音濃縮資料：分段摘要／字幕占位（後續 Whisper 接上） ─────────────────

alter table public.courses
  add column if not exists ai_media_enabled boolean not null default true;

comment on column public.courses.ai_media_enabled is '關閉時禁止呼叫素材 AI enrichment（字幕／摘要）管道';

create table if not exists public.material_ai_enrichment (
  id uuid primary key default gen_random_uuid (),
  material_id uuid not null references public.course_materials (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  status text not null default 'ready' check (status in ('pending', 'ready', 'failed')),
  subtitle_vtt text,
  segments jsonb not null default '[]'::jsonb,
  model_used text,
  error_detail text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now (),
  unique (material_id)
);

create index if not exists material_ai_enrichment_course_idx on public.material_ai_enrichment (course_id);

alter table public.material_ai_enrichment enable row level security;

drop policy if exists material_ai_select_course on public.material_ai_enrichment;

create policy material_ai_select_course on public.material_ai_enrichment
  for select using (
    public.is_course_member (course_id) or public.is_platform_admin ()
  );

drop policy if exists material_ai_write_staff on public.material_ai_enrichment;

create policy material_ai_write_staff on public.material_ai_enrichment
  for insert with check (
    public.is_course_staff (course_id) and created_by = auth.uid ()
  );

drop policy if exists material_ai_update_staff on public.material_ai_enrichment;

create policy material_ai_update_staff on public.material_ai_enrichment
  for update using (public.is_course_staff (course_id))
  with check (public.is_course_staff (course_id));

revoke insert, update, delete on public.material_ai_enrichment from anon;


-- ════════════════════════════════════════════════════════════
-- 20260518110000_tronclass_parity_round2.sql
-- ════════════════════════════════════════════════════════════
-- Parity round 2: admin DLQ retry RPC, RBAC grade structure capabilities, reporting flat view.

-- ── Admin：復原未完成派發之通知的重試狀態（已 dispatched 者不變動） ───────────────

create or replace function public.admin_retry_notification_dispatch (p_notification_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer := 0;
begin
  if auth.uid () is null or not public.is_platform_admin () then
    raise exception 'forbidden';
  end if;

  update public.notifications
  set
    push_dispatch_abandoned_at = null,
    push_dispatch_error = null,
    push_dispatch_attempts = 0
  where id = p_notification_id
    and push_dispatched_at is null;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

comment on function public.admin_retry_notification_dispatch (uuid) is
  '平台管理員清除未完成派發列之放棄旗標與重試計數，供下次 dispatch 取用。';

revoke execute on function public.admin_retry_notification_dispatch (uuid) from public;
grant execute on function public.admin_retry_notification_dispatch (uuid) to authenticated;

-- ── 成績「結構」維護改走 course_member_has_capability(..., grades.structure) ──
-- moderator／assistant／student 對照 course_role_capabilities 預設；教師為 true。

drop policy if exists grade_categories_write_teacher on public.grade_categories;

create policy grade_categories_write_teacher on public.grade_categories
  for all using (public.course_member_has_capability (course_id, 'grades.structure'::text))
  with check (public.course_member_has_capability (course_id, 'grades.structure'::text));

drop policy if exists grade_items_write_teacher on public.grade_items;

create policy grade_items_write_teacher on public.grade_items
  for all using (
    exists (
      select 1
      from public.grade_categories gc
      where gc.id = grade_items.category_id
        and public.course_member_has_capability (gc.course_id, 'grades.structure'::text)
    )
  )
  with check (
    exists (
      select 1
      from public.grade_categories gc
      where gc.id = grade_items.category_id
        and public.course_member_has_capability (gc.course_id, 'grades.structure'::text)
    )
  );

-- ── Reporting：項目級平坦視圖（RLS 由 grade_scores／items 強制） ───────────────

create or replace view public.reporting_grade_course_item_scores as
select
  gc.course_id,
  gc.id as category_id,
  gc.title as category_title,
  gi.id as grade_item_id,
  gi.title as item_title,
  gi.max_points,
  gs.student_id,
  gs.score,
  gs.updated_at as score_updated_at
from public.grade_scores gs
join public.grade_items gi on gi.id = gs.grade_item_id
join public.grade_categories gc on gc.id = gi.category_id;

comment on view public.reporting_grade_course_item_scores is
  '管理員／課程權責者查項目級 score 明細之用；資料列仍可見性受底層 RLS。';

grant select on public.reporting_grade_course_item_scores to authenticated;


-- ════════════════════════════════════════════════════════════
-- 20260518120001_rbac_quiz_author_capabilities.sql
-- ════════════════════════════════════════════════════════════
-- Align high-touch quiz authoring RLS with course_member_has_capability(..., quiz.author_structure).
-- Seeded caps: moderator/assistant lose author_structure; teachers retain via course_role_capabilities.

drop policy if exists quiz_solutions_teacher_all on public.quiz_question_solutions;

create policy quiz_solutions_teacher_all on public.quiz_question_solutions
  for all using (
    exists (
      select 1 from public.quiz_questions qq
      join public.quizzes q on q.id = qq.quiz_id
      where qq.id = quiz_question_solutions.question_id
        and public.course_member_has_capability (q.course_id, 'quiz.author_structure'::text)
    )
  )
  with check (
    exists (
      select 1 from public.quiz_questions qq
      join public.quizzes q on q.id = qq.quiz_id
      where qq.id = question_id
        and public.course_member_has_capability (q.course_id, 'quiz.author_structure'::text)
    )
  );

drop policy if exists quizzes_write_teacher on public.quizzes;

create policy quizzes_write_teacher on public.quizzes
  for insert with check (
    public.course_member_has_capability (course_id, 'quiz.author_structure'::text)
    and created_by = auth.uid()
  );

drop policy if exists quizzes_update_teacher on public.quizzes;

create policy quizzes_update_teacher on public.quizzes
  for update using (
    public.course_member_has_capability (course_id, 'quiz.author_structure'::text)
  )
  with check (
    public.course_member_has_capability (course_id, 'quiz.author_structure'::text)
  );

drop policy if exists quizzes_delete_teacher on public.quizzes;

create policy quizzes_delete_teacher on public.quizzes
  for delete using (
    public.course_member_has_capability (course_id, 'quiz.author_structure'::text)
  );

drop policy if exists quiz_questions_write_teacher on public.quiz_questions;

create policy quiz_questions_write_teacher on public.quiz_questions
  for all using (
    exists (
      select 1 from public.quizzes q
      where q.id = quiz_questions.quiz_id
        and public.course_member_has_capability (q.course_id, 'quiz.author_structure'::text)
    )
  )
  with check (
    exists (
      select 1 from public.quizzes q
      where q.id = quiz_questions.quiz_id
        and public.course_member_has_capability (q.course_id, 'quiz.author_structure'::text)
    )
  );

drop policy if exists quiz_pool_entries_teacher_all on public.quiz_pool_entries;

create policy quiz_pool_entries_teacher_all on public.quiz_pool_entries
  for all using (
    exists (
      select 1 from public.quizzes q
      where q.id = quiz_pool_entries.quiz_id
        and public.course_member_has_capability (q.course_id, 'quiz.author_structure'::text)
    )
  )
  with check (
    exists (
      select 1 from public.quizzes q
      where q.id = quiz_pool_entries.quiz_id
        and public.course_member_has_capability (q.course_id, 'quiz.author_structure'::text)
    )
  );


-- ════════════════════════════════════════════════════════════
-- 20260520120000_gap_p1_04_dlq_dashboard.sql
-- ════════════════════════════════════════════════════════════
-- GAP_P1_04: 推播 DLQ 深化（重試曲線視圖、保留期、批次重試／取消、外部告警鉤點）
-- 對齊：scripts/tronclass-parity-matrix.txt 將 GAP_P1_04 由「可用」昇為「商用儀表完成」。

-- ── 通知派發保留期欄位（DLQ 自動清掃用） ─────────────────────────────
alter table public.notifications
  add column if not exists push_dispatch_purge_after timestamptz;

comment on column public.notifications.push_dispatch_purge_after is
  '若不為 NULL：到期後將由背景排程移除 DLQ 條目（不影響站內通知本體）';

-- ── 重試曲線視圖（24h／7d 桶累計），供 Admin 圖表使用 ─────────────────
create or replace view public.reporting_push_dispatch_retry_curve as
select
  date_trunc('hour', created_at) as bucket_hour,
  status,
  count(*)::integer as event_count
from public.notification_push_logs
where created_at >= now() - interval '7 days'
group by 1, 2;

comment on view public.reporting_push_dispatch_retry_curve is
  '近 7 日推播派發事件按小時分桶累計（attempted/success/failed）';

grant select on public.reporting_push_dispatch_retry_curve to authenticated;

-- ── 直接讀 view RLS 限制：只給 platform admin ───────────────────────
-- view 本身無 RLS；改以 SECURITY DEFINER function 包裝
create or replace function public.admin_push_retry_curve(p_hours integer default 48)
returns table (
  bucket_hour timestamptz,
  status text,
  event_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  select v.bucket_hour, v.status, v.event_count
  from public.reporting_push_dispatch_retry_curve v
  where public.is_platform_admin()
    and v.bucket_hour >= now() - make_interval(hours => greatest(coalesce(p_hours, 48), 1))
  order by v.bucket_hour asc, v.status asc;
$$;

revoke execute on function public.admin_push_retry_curve(integer) from public;
grant execute on function public.admin_push_retry_curve(integer) to authenticated;

-- ── 批次重試 RPC（最多 200 列；只動尚未 dispatched 之列） ─────────────
create or replace function public.admin_bulk_retry_notification_dispatch(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer := 0;
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'forbidden';
  end if;

  if p_ids is null or cardinality(p_ids) = 0 then
    return 0;
  end if;

  if cardinality(p_ids) > 200 then
    raise exception 'too many ids; batch cap is 200';
  end if;

  update public.notifications
  set
    push_dispatch_abandoned_at = null,
    push_dispatch_error = null,
    push_dispatch_attempts = 0,
    push_dispatch_purge_after = null
  where id = any (p_ids)
    and push_dispatched_at is null;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke execute on function public.admin_bulk_retry_notification_dispatch(uuid[]) from public;
grant execute on function public.admin_bulk_retry_notification_dispatch(uuid[]) to authenticated;

comment on function public.admin_bulk_retry_notification_dispatch(uuid[]) is
  '平台管理員批次清除尚未派發完成之通知重試鎖（最多 200）。';

-- ── 批次取消（標記放棄，停止後續派發）RPC ───────────────────────────
create or replace function public.admin_bulk_cancel_notification_dispatch(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer := 0;
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'forbidden';
  end if;

  if p_ids is null or cardinality(p_ids) = 0 then
    return 0;
  end if;

  if cardinality(p_ids) > 200 then
    raise exception 'too many ids; batch cap is 200';
  end if;

  update public.notifications
  set
    push_dispatch_abandoned_at = coalesce(push_dispatch_abandoned_at, now()),
    push_dispatch_error = coalesce(push_dispatch_error, 'cancelled_by_admin')
  where id = any (p_ids)
    and push_dispatched_at is null;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke execute on function public.admin_bulk_cancel_notification_dispatch(uuid[]) from public;
grant execute on function public.admin_bulk_cancel_notification_dispatch(uuid[]) to authenticated;

comment on function public.admin_bulk_cancel_notification_dispatch(uuid[]) is
  '平台管理員批次標記放棄派發，停止後續重試。';

-- ── DLQ 保留期清掃排程（手動或 pg_cron 呼叫） ─────────────────────────
create or replace function public.admin_purge_expired_dlq()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_removed integer := 0;
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'forbidden';
  end if;

  delete from public.notification_push_logs
  using public.notifications n
  where notification_push_logs.notification_id = n.id
    and n.push_dispatch_purge_after is not null
    and n.push_dispatch_purge_after < now();

  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

revoke execute on function public.admin_purge_expired_dlq() from public;
grant execute on function public.admin_purge_expired_dlq() to authenticated;

comment on function public.admin_purge_expired_dlq() is
  '清除已過保留期之 push 派發 log；建議由 pg_cron 每日呼叫。';

-- ── 外部告警鉤點：alert_dispatch_outbox（webhook／Datadog／Slack 抓取） ──
create table if not exists public.alert_dispatch_outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('push_dlq_exhausted', 'push_dlq_stuck', 'ai_quota_exceeded')),
  payload jsonb not null default '{}'::jsonb,
  delivered_at timestamptz,
  delivery_attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now()
);

create index if not exists alert_dispatch_outbox_pending_idx
  on public.alert_dispatch_outbox (created_at asc)
  where delivered_at is null;

alter table public.alert_dispatch_outbox enable row level security;

drop policy if exists alert_dispatch_outbox_admin_select on public.alert_dispatch_outbox;
create policy alert_dispatch_outbox_admin_select on public.alert_dispatch_outbox
  for select using (public.is_platform_admin());

revoke insert, update, delete on public.alert_dispatch_outbox from anon, authenticated;

comment on table public.alert_dispatch_outbox is
  'Dispatch 函式或排程寫入告警；外部 webhook（Datadog／Slack）由 Edge 拉取後標 delivered_at';

-- ── Trigger：當通知被標記為「放棄」時自動寫一筆告警 ──────────────────
create or replace function public.push_notification_abandon_alert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.push_dispatch_abandoned_at is not null
    and (old.push_dispatch_abandoned_at is null
         or old.push_dispatch_abandoned_at is distinct from new.push_dispatch_abandoned_at) then
    insert into public.alert_dispatch_outbox (kind, payload)
    values (
      'push_dlq_exhausted',
      jsonb_build_object(
        'notification_id', new.id,
        'user_id', new.user_id,
        'title', left(coalesce(new.title, ''), 200),
        'attempts', new.push_dispatch_attempts,
        'error', new.push_dispatch_error,
        'abandoned_at', new.push_dispatch_abandoned_at
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists notifications_abandon_alert_trg on public.notifications;
create trigger notifications_abandon_alert_trg
  after update of push_dispatch_abandoned_at on public.notifications
  for each row execute function public.push_notification_abandon_alert();

-- ── DLQ 摘要快查（給 Admin Dashboard banner 用） ─────────────────────
create or replace function public.admin_dlq_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not public.is_platform_admin() then jsonb_build_object('error', 'forbidden')
    else jsonb_build_object(
      'pending_total', (
        select count(*) from public.notifications
        where push_dispatched_at is null and push_dispatch_abandoned_at is null
      ),
      'stuck_ge3', (
        select count(*) from public.notifications
        where push_dispatched_at is null and push_dispatch_abandoned_at is null
          and push_dispatch_attempts >= 3
      ),
      'exhausted_total', (
        select count(*) from public.notifications
        where push_dispatched_at is null and push_dispatch_abandoned_at is not null
      ),
      'logs_last_24h', (
        select count(*) from public.notification_push_logs where created_at >= now() - interval '24 hours'
      ),
      'alerts_pending', (
        select count(*) from public.alert_dispatch_outbox where delivered_at is null
      )
    )
  end;
$$;

revoke execute on function public.admin_dlq_summary() from public;
grant execute on function public.admin_dlq_summary() to authenticated;

comment on function public.admin_dlq_summary() is
  '平台管理員 dashboard 用：DLQ／告警一次性摘要';


-- ════════════════════════════════════════════════════════════
-- 20260520120100_gap_p2_08_role_matrix_capabilities.sql
-- ════════════════════════════════════════════════════════════
-- GAP_P2_08: 自訂角色矩陣 UI 與能力種子擴張
-- 對齊：scripts/tronclass-parity-matrix.txt 將 GAP_P2_08 由「部分組態化」昇為「組態完成＋寫入 RPC」。

-- ── 擴張能力 slug 與 seed（公告／教材／簽到／互動課堂／成績匯出／論壇／AI） ──
insert into public.course_role_capabilities (role_key, capability_slug, allowed) values
  -- 公告
  ('teacher',   'announcements.publish',        true),
  ('moderator', 'announcements.publish',        true),
  ('assistant', 'announcements.publish',        true),
  ('student',   'announcements.publish',        false),
  -- 教材
  ('teacher',   'materials.publish',            true),
  ('moderator', 'materials.publish',            false),
  ('assistant', 'materials.publish',            true),
  ('student',   'materials.publish',            false),
  -- 簽到設定（時間窗、學生簽到列表）
  ('teacher',   'attendance.manage',            true),
  ('moderator', 'attendance.manage',            true),
  ('assistant', 'attendance.manage',            true),
  ('student',   'attendance.manage',            false),
  -- 互動課堂主持
  ('teacher',   'live.host',                    true),
  ('moderator', 'live.host',                    true),
  ('assistant', 'live.host',                    true),
  ('student',   'live.host',                    false),
  -- 成績匯出
  ('teacher',   'grades.export',                true),
  ('moderator', 'grades.export',                true),
  ('assistant', 'grades.export',                true),
  ('student',   'grades.export',                false),
  -- 論壇仲裁（已存在 forum.moderate；補上對齊資料）
  ('teacher',   'forum.moderate',               true),
  ('assistant', 'forum.moderate',               false),
  -- AI 助教使用
  ('teacher',   'ai.assistant.use',             true),
  ('moderator', 'ai.assistant.use',             true),
  ('assistant', 'ai.assistant.use',             true),
  ('student',   'ai.assistant.use',             true),
  -- AI 教材濃縮（字幕／切段；高權能力）
  ('teacher',   'ai.material.enrich',           true),
  ('moderator', 'ai.material.enrich',           false),
  ('assistant', 'ai.material.enrich',           true),
  ('student',   'ai.material.enrich',           false),
  -- 作業批改
  ('teacher',   'assignments.grade',            true),
  ('moderator', 'assignments.grade',            true),
  ('assistant', 'assignments.grade',            true),
  ('student',   'assignments.grade',            false),
  -- 通知派發（站內 notify_course_members）
  ('teacher',   'notifications.dispatch',       true),
  ('moderator', 'notifications.dispatch',       false),
  ('assistant', 'notifications.dispatch',       false),
  ('student',   'notifications.dispatch',       false)
on conflict (role_key, capability_slug) do update set allowed = excluded.allowed;

-- ── 能力編輯（單筆 upsert／批次 RPC）─ 僅平台管理員可寫 ─────────────
create or replace function public.admin_set_course_role_capability(
  p_role_key text,
  p_capability_slug text,
  p_allowed boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'forbidden';
  end if;

  if p_role_key not in ('teacher', 'student', 'assistant', 'moderator') then
    raise exception 'invalid role_key';
  end if;

  if p_capability_slug is null or length(trim(p_capability_slug)) = 0 then
    raise exception 'invalid capability_slug';
  end if;

  insert into public.course_role_capabilities (role_key, capability_slug, allowed)
  values (p_role_key, trim(p_capability_slug), coalesce(p_allowed, false))
  on conflict (role_key, capability_slug) do update set allowed = excluded.allowed;
end;
$$;

revoke execute on function public.admin_set_course_role_capability(text, text, boolean) from public;
grant execute on function public.admin_set_course_role_capability(text, text, boolean) to authenticated;

comment on function public.admin_set_course_role_capability(text, text, boolean) is
  '平台管理員 upsert 單一 (role × capability) 旗標';

-- ── 批次匯入（JSON array of {role_key, capability_slug, allowed}） ───
create or replace function public.admin_bulk_set_course_role_capabilities(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  v_role text;
  v_slug text;
  v_allow boolean;
  v_n integer := 0;
  v_len integer;
  i integer;
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'forbidden';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be JSON array';
  end if;

  v_len := coalesce(jsonb_array_length(p_rows), 0);

  for i in 0 .. v_len - 1 loop
    r := p_rows->i;
    v_role := lower(trim(coalesce(r->>'role_key', '')));
    v_slug := trim(coalesce(r->>'capability_slug', ''));
    v_allow := coalesce((r->>'allowed')::boolean, false);

    if v_role not in ('teacher', 'student', 'assistant', 'moderator') then
      continue;
    end if;
    if length(v_slug) = 0 then
      continue;
    end if;

    insert into public.course_role_capabilities (role_key, capability_slug, allowed)
    values (v_role, v_slug, v_allow)
    on conflict (role_key, capability_slug) do update set allowed = excluded.allowed;

    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

revoke execute on function public.admin_bulk_set_course_role_capabilities(jsonb) from public;
grant execute on function public.admin_bulk_set_course_role_capabilities(jsonb) to authenticated;

comment on function public.admin_bulk_set_course_role_capabilities(jsonb) is
  '平台管理員批次 upsert 多筆 (role × capability) 旗標；JSON array';

-- ── 將既有 RLS 中部分硬編 teacher 改走 capability（不破壞既有教師預設） ──
-- announcements 寫入：改為 announcements.publish capability（教師預設 true）
drop policy if exists announcements_insert on public.announcements;
create policy announcements_insert on public.announcements
  for insert with check (
    public.course_member_has_capability(course_id, 'announcements.publish'::text)
    and author_id = auth.uid()
  );

drop policy if exists announcements_update on public.announcements;
create policy announcements_update on public.announcements
  for update using (
    public.course_member_has_capability(course_id, 'announcements.publish'::text)
    and (author_id = auth.uid() or public.is_course_teacher(course_id))
  )
  with check (public.course_member_has_capability(course_id, 'announcements.publish'::text));

drop policy if exists announcements_delete on public.announcements;
create policy announcements_delete on public.announcements
  for delete using (
    public.course_member_has_capability(course_id, 'announcements.publish'::text)
    and (author_id = auth.uid() or public.is_course_teacher(course_id))
  );

-- materials 寫入：改走 materials.publish；moderator 預設 false
drop policy if exists materials_write_teacher on public.course_materials;
create policy materials_write_teacher on public.course_materials
  for insert with check (
    public.course_member_has_capability(course_id, 'materials.publish'::text)
    and created_by = auth.uid()
  );

drop policy if exists materials_update_teacher on public.course_materials;
create policy materials_update_teacher on public.course_materials
  for update using (public.course_member_has_capability(course_id, 'materials.publish'::text))
  with check (public.course_member_has_capability(course_id, 'materials.publish'::text));

drop policy if exists materials_delete_teacher on public.course_materials;
create policy materials_delete_teacher on public.course_materials
  for delete using (public.course_member_has_capability(course_id, 'materials.publish'::text));

-- ── 能力查詢：列出某課程下，當前使用者所有 capability 旗標（給 App UI 控件） ──
create or replace function public.my_course_capabilities(p_course_id uuid)
returns table (capability_slug text, allowed boolean)
language sql
stable
security definer
set search_path = public
as $$
  select crc.capability_slug, bool_or(crc.allowed) as allowed
  from public.course_members cm
  join public.course_role_capabilities crc on crc.role_key = cm.role::text
  where cm.course_id = p_course_id
    and cm.user_id = auth.uid()
  group by crc.capability_slug
  order by crc.capability_slug;
$$;

grant execute on function public.my_course_capabilities(uuid) to authenticated;

comment on function public.my_course_capabilities(uuid) is
  '回傳當前使用者在指定課程內的能力旗標 union（多角色情境的 bool_or）';


-- ════════════════════════════════════════════════════════════
-- 20260520120200_gap_p2_08b_reporting_visualization.sql
-- ════════════════════════════════════════════════════════════
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


-- ════════════════════════════════════════════════════════════
-- 20260520120300_gap_p2_09_ai_compliance.sql
-- ════════════════════════════════════════════════════════════
-- GAP_P2_09: AI 字幕／切段／合規（PII 屏蔽、retention、跨境保存旗標、quota 監控）
-- 對齊：scripts/tronclass-parity-matrix.txt 將 GAP_P2_09 由「示範可跑」昇為「合規可驗收」。

-- ── AI 合規組態（單列；後續若分租戶可擴成多列） ──────────────────────
create table if not exists public.ai_compliance_policies (
  id text primary key default 'default',
  enabled boolean not null default true,
  daily_user_limit integer not null default 30 check (daily_user_limit > 0),
  monthly_course_limit integer check (monthly_course_limit is null or monthly_course_limit > 0),
  retention_days_transcript integer not null default 30 check (retention_days_transcript >= 0),
  retention_days_segments integer not null default 90 check (retention_days_segments >= 0),
  pii_redaction_required boolean not null default true,
  cross_border_storage_allowed boolean not null default false,
  cross_border_region text default null,
  consent_text text not null default '我已瞭解此影音將傳送至雲端 AI 服務進行轉寫與摘要，並承擔相關個資與著作權之合理使用責任。',
  data_processor_name text not null default 'OpenAI Whisper + Chat Completions',
  updated_at timestamptz not null default now()
);

alter table public.ai_compliance_policies enable row level security;

drop policy if exists ai_compliance_policies_select on public.ai_compliance_policies;
create policy ai_compliance_policies_select on public.ai_compliance_policies
  for select using (true);

drop policy if exists ai_compliance_policies_admin_write on public.ai_compliance_policies;
create policy ai_compliance_policies_admin_write on public.ai_compliance_policies
  for all using (public.is_platform_admin())
  with check (public.is_platform_admin());

insert into public.ai_compliance_policies (id) values ('default')
on conflict (id) do nothing;

-- ── 同意紀錄（每使用者每組態版本一次性記錄；可審計） ──────────────────
create table if not exists public.ai_consent_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  consent_version text not null default 'v1',
  consent_text_hash text not null,
  user_consented boolean not null,
  ip_addr inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists ai_consent_log_user_idx on public.ai_consent_log (user_id, created_at desc);

alter table public.ai_consent_log enable row level security;

drop policy if exists ai_consent_log_self_select on public.ai_consent_log;
create policy ai_consent_log_self_select on public.ai_consent_log
  for select using (user_id = auth.uid() or public.is_platform_admin());

drop policy if exists ai_consent_log_self_insert on public.ai_consent_log;
create policy ai_consent_log_self_insert on public.ai_consent_log
  for insert with check (user_id = auth.uid());

revoke update, delete on public.ai_consent_log from authenticated;

-- ── 增量 retention／PII 欄位於 material_ai_enrichment ───────────────
alter table public.material_ai_enrichment
  add column if not exists transcript_purge_after timestamptz;

alter table public.material_ai_enrichment
  add column if not exists segments_purge_after timestamptz;

alter table public.material_ai_enrichment
  add column if not exists pii_redacted boolean not null default false;

alter table public.material_ai_enrichment
  add column if not exists cross_border_flag boolean not null default false;

alter table public.material_ai_enrichment
  add column if not exists region_stored text;

comment on column public.material_ai_enrichment.transcript_purge_after is
  '字幕／逐字稿之保留到期日；到期由 admin_purge_expired_ai 清空 subtitle_vtt';

comment on column public.material_ai_enrichment.segments_purge_after is
  '切段摘要之保留到期日；到期由 admin_purge_expired_ai 清空 segments';

-- ── Trigger：寫入時依組態自動帶上 retention purge timestamps ────────
create or replace function public.material_ai_enrichment_apply_policy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pol record;
begin
  select * into v_pol
  from public.ai_compliance_policies
  where id = 'default';

  if v_pol.id is null then
    return new;
  end if;

  -- transcript／segments 預設套用保留期；若 subtitle/segments 為空則不設
  if new.subtitle_vtt is not null and v_pol.retention_days_transcript > 0 then
    new.transcript_purge_after := coalesce(
      new.transcript_purge_after,
      now() + make_interval(days => v_pol.retention_days_transcript)
    );
  end if;

  if jsonb_array_length(coalesce(new.segments, '[]'::jsonb)) > 0
     and v_pol.retention_days_segments > 0 then
    new.segments_purge_after := coalesce(
      new.segments_purge_after,
      now() + make_interval(days => v_pol.retention_days_segments)
    );
  end if;

  -- 跨境保存旗標：若組態不允許但 region_stored 不為空，警告
  if v_pol.cross_border_storage_allowed = false
     and new.region_stored is not null
     and new.region_stored <> '' then
    new.cross_border_flag := true;
  end if;

  return new;
end;
$$;

drop trigger if exists material_ai_enrichment_policy_trg on public.material_ai_enrichment;
create trigger material_ai_enrichment_policy_trg
  before insert or update on public.material_ai_enrichment
  for each row execute function public.material_ai_enrichment_apply_policy();

-- ── 清掃過期 transcript／segments（建議 pg_cron 每日呼叫） ─────────────
create or replace function public.admin_purge_expired_ai()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transcripts integer := 0;
  v_segments integer := 0;
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'forbidden';
  end if;

  update public.material_ai_enrichment
  set subtitle_vtt = null
  where transcript_purge_after is not null
    and transcript_purge_after < now()
    and subtitle_vtt is not null;

  get diagnostics v_transcripts = row_count;

  update public.material_ai_enrichment
  set segments = '[]'::jsonb
  where segments_purge_after is not null
    and segments_purge_after < now()
    and jsonb_array_length(coalesce(segments, '[]'::jsonb)) > 0;

  get diagnostics v_segments = row_count;

  return jsonb_build_object(
    'transcripts_purged', v_transcripts,
    'segments_purged', v_segments
  );
end;
$$;

revoke execute on function public.admin_purge_expired_ai() from public;
grant execute on function public.admin_purge_expired_ai() to authenticated;

comment on function public.admin_purge_expired_ai() is
  '清空已逾保留期之 AI 字幕／切段摘要欄位（不刪 row；保留稽核欄位）';

-- ── 同意紀錄寫入 RPC（給 Edge function／App 呼叫；hash 內容比對組態版本） ─
create or replace function public.record_ai_consent(
  p_consent_version text,
  p_consent_text_hash text,
  p_user_consented boolean,
  p_ip text,
  p_user_agent text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_ip inet;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated';
  end if;

  begin
    v_ip := nullif(p_ip, '')::inet;
  exception when others then
    v_ip := null;
  end;

  insert into public.ai_consent_log (
    user_id, consent_version, consent_text_hash, user_consented,
    ip_addr, user_agent
  )
  values (
    auth.uid(),
    coalesce(p_consent_version, 'v1'),
    coalesce(p_consent_text_hash, ''),
    coalesce(p_user_consented, false),
    v_ip,
    nullif(p_user_agent, '')
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.record_ai_consent(text, text, boolean, text, text) from public;
grant execute on function public.record_ai_consent(text, text, boolean, text, text) to authenticated;

-- ── Quota 監控視圖（給 Admin AI dashboard 查超限風險） ─────────────────
create or replace view public.reporting_ai_quota_overview as
select
  u.user_id,
  u.usage_date,
  u.requests,
  p.daily_user_limit as quota,
  (u.requests::float / nullif(p.daily_user_limit, 0)) as utilization,
  case when u.requests >= p.daily_user_limit then true else false end as over_limit
from public.ai_usage_daily u
cross join (select daily_user_limit from public.ai_compliance_policies where id = 'default') p;

comment on view public.reporting_ai_quota_overview is
  '日 AI usage vs. quota；over_limit=true 表示已達當日上限';

grant select on public.reporting_ai_quota_overview to authenticated;

create or replace function public.admin_ai_quota_overview()
returns table (
  user_id uuid,
  usage_date date,
  requests integer,
  quota integer,
  utilization double precision,
  over_limit boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select v.user_id, v.usage_date, v.requests, v.quota, v.utilization, v.over_limit
  from public.reporting_ai_quota_overview v
  where public.is_platform_admin()
  order by v.over_limit desc, v.utilization desc nulls last, v.usage_date desc
  limit 500;
$$;

revoke execute on function public.admin_ai_quota_overview() from public;
grant execute on function public.admin_ai_quota_overview() to authenticated;


-- ════════════════════════════════════════════════════════════
-- 20260520120400_drm_alt_signed_media_tokens.sql
-- ════════════════════════════════════════════════════════════
-- GAP_EXCLUDE_DRM 替代方案：signed media play tokens（時效、裝置綁定、一次性、稽核）
-- 對齊：scripts/tronclass-parity-matrix.txt 將 GAP_EXCLUDE_DRM「不接」改記為「以替代 token 模型對齊基本權限管控」。
-- 注意：本方案 **不等於** Widevine／FairPlay DRM；只是「教材播放鑒權」的最小集，能擋住一般複製連結分享。

create table if not exists public.media_play_tokens (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.course_materials (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  token text not null unique,
  device_fingerprint text,
  signed_url_used text,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  ip_addr inet,
  user_agent text
);

create index if not exists media_play_tokens_user_idx on public.media_play_tokens (user_id, issued_at desc);
create index if not exists media_play_tokens_material_idx on public.media_play_tokens (material_id, issued_at desc);
create index if not exists media_play_tokens_expire_idx on public.media_play_tokens (expires_at)
  where consumed_at is null and revoked_at is null;

alter table public.media_play_tokens enable row level security;

drop policy if exists media_play_tokens_self_select on public.media_play_tokens;
create policy media_play_tokens_self_select on public.media_play_tokens
  for select using (user_id = auth.uid() or public.is_platform_admin());

revoke insert, update, delete on public.media_play_tokens from authenticated;

comment on table public.media_play_tokens is
  '教材播放權杖（DRM 替代）：時效、裝置綁定、一次性，由 RPC issue／consume；不等於 Widevine/FairPlay';

-- ── 發行 token（要求已登入＋為該課程成員＋AI／影音播放允許） ────────
create or replace function public.issue_media_play_token(
  p_material_id uuid,
  p_device_fingerprint text default null,
  p_ttl_seconds integer default 600
)
returns table (token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_material record;
  v_token text;
  v_expires timestamptz;
  v_ttl integer;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated';
  end if;

  v_ttl := greatest(coalesce(p_ttl_seconds, 600), 30);
  if v_ttl > 3600 then v_ttl := 3600; end if;

  select cm.id, cm.course_id, cm.external_url, cm.mime_type
    into v_material
  from public.course_materials cm
  where cm.id = p_material_id;

  if v_material.id is null then
    raise exception 'material not found';
  end if;

  if not public.is_course_member(v_material.course_id) then
    raise exception 'not a course member';
  end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  v_expires := now() + make_interval(secs => v_ttl);

  insert into public.media_play_tokens (
    material_id, course_id, user_id, token, device_fingerprint, expires_at
  ) values (
    p_material_id, v_material.course_id, auth.uid(), v_token,
    nullif(p_device_fingerprint, ''), v_expires
  );

  return query select v_token, v_expires;
end;
$$;

revoke execute on function public.issue_media_play_token(uuid, text, integer) from public;
grant execute on function public.issue_media_play_token(uuid, text, integer) to authenticated;

-- ── 消耗 token（播放器於 onLoad 呼叫）─ 一次性使用 ─────────────────
create or replace function public.consume_media_play_token(
  p_token text,
  p_signed_url_hint text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated';
  end if;

  if p_token is null or length(p_token) < 32 then
    raise exception 'invalid token';
  end if;

  select * into v_row
  from public.media_play_tokens
  where token = p_token
    and user_id = auth.uid();

  if v_row.id is null then
    return false;
  end if;

  if v_row.revoked_at is not null then
    return false;
  end if;

  if v_row.expires_at < now() then
    return false;
  end if;

  if v_row.consumed_at is not null then
    return false; -- one-time only
  end if;

  update public.media_play_tokens
  set consumed_at = now(),
      signed_url_used = nullif(p_signed_url_hint, '')
  where id = v_row.id;

  return true;
end;
$$;

revoke execute on function public.consume_media_play_token(text, text) from public;
grant execute on function public.consume_media_play_token(text, text) to authenticated;

-- ── 撤銷（教師／管理員可主動撤銷某使用者某教材的所有未用 token） ──────
create or replace function public.revoke_media_play_tokens(
  p_material_id uuid,
  p_user_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course uuid;
  v_n integer := 0;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated';
  end if;

  select course_id into v_course from public.course_materials where id = p_material_id;
  if v_course is null then
    raise exception 'material not found';
  end if;

  if not (public.is_platform_admin() or public.is_course_teacher(v_course)) then
    raise exception 'forbidden';
  end if;

  update public.media_play_tokens
  set revoked_at = now()
  where material_id = p_material_id
    and (p_user_id is null or user_id = p_user_id)
    and revoked_at is null
    and consumed_at is null;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.revoke_media_play_tokens(uuid, uuid) from public;
grant execute on function public.revoke_media_play_tokens(uuid, uuid) to authenticated;

comment on function public.revoke_media_play_tokens(uuid, uuid) is
  '教師／平台管理員撤銷指定教材（與選填使用者）之尚未消耗 token';


-- ════════════════════════════════════════════════════════════
-- 20260520130000_wave5_units_calendar.sql
-- ════════════════════════════════════════════════════════════
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


-- ════════════════════════════════════════════════════════════
-- 20260520130100_wave5_groups_peer_review.sql
-- ════════════════════════════════════════════════════════════
-- Wave 5: 小組／分組 + 同儕互評（TronClass 商用核心模組）

-- ============================================================
-- 3. course_groups + members（分組）
-- ============================================================
create table if not exists public.course_groups (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  name text not null,
  description text not null default '',
  max_members integer check (max_members is null or max_members > 0),
  is_self_signup boolean not null default false,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create index if not exists course_groups_course_idx on public.course_groups (course_id);

alter table public.course_groups enable row level security;

drop policy if exists course_groups_select on public.course_groups;
create policy course_groups_select on public.course_groups
  for select using (public.is_course_member(course_id) or public.is_platform_admin());

drop policy if exists course_groups_write_staff on public.course_groups;
create policy course_groups_write_staff on public.course_groups
  for all using (public.is_course_staff(course_id))
  with check (public.is_course_staff(course_id));

create table if not exists public.course_group_members (
  group_id uuid not null references public.course_groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('member', 'leader')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index if not exists course_group_members_user_idx on public.course_group_members (user_id);

alter table public.course_group_members enable row level security;

drop policy if exists course_group_members_select on public.course_group_members;
create policy course_group_members_select on public.course_group_members
  for select using (
    exists (
      select 1 from public.course_groups g
      where g.id = course_group_members.group_id
        and (public.is_course_member(g.course_id) or public.is_platform_admin())
    )
  );

-- 教師可任意指派；自選分組情境下學生可自己加入未滿的群
drop policy if exists course_group_members_self_signup on public.course_group_members;
create policy course_group_members_self_signup on public.course_group_members
  for insert with check (
    exists (
      select 1 from public.course_groups g
      where g.id = group_id
        and (
          public.is_course_staff(g.course_id)
          or (
            g.is_self_signup = true
            and user_id = auth.uid()
            and public.is_course_member(g.course_id)
            and (
              g.max_members is null
              or (
                select count(*) from public.course_group_members cgm
                where cgm.group_id = g.id
              ) < g.max_members
            )
          )
        )
    )
  );

drop policy if exists course_group_members_self_leave on public.course_group_members;
create policy course_group_members_self_leave on public.course_group_members
  for delete using (
    user_id = auth.uid()
    or exists (
      select 1 from public.course_groups g
      where g.id = course_group_members.group_id and public.is_course_staff(g.course_id)
    )
  );

drop policy if exists course_group_members_staff_update on public.course_group_members;
create policy course_group_members_staff_update on public.course_group_members
  for update using (
    exists (
      select 1 from public.course_groups g
      where g.id = course_group_members.group_id and public.is_course_staff(g.course_id)
    )
  )
  with check (
    exists (
      select 1 from public.course_groups g
      where g.id = group_id and public.is_course_staff(g.course_id)
    )
  );

-- 自動隨機分組 RPC（保留每組均勻）
create or replace function public.auto_assign_course_groups(
  p_course_id uuid,
  p_target_group_count integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_students uuid[];
  v_groups uuid[];
  v_i integer := 0;
  v_n integer := 0;
  v_idx integer;
  v_sid uuid;
  v_gid uuid;
begin
  if not public.is_course_staff(p_course_id) then
    raise exception 'forbidden';
  end if;
  if p_target_group_count is null or p_target_group_count <= 0 then
    raise exception 'invalid group count';
  end if;

  -- 取得學生（排除老師／助教／仲裁）
  select array_agg(cm.user_id order by random())
    into v_students
  from public.course_members cm
  where cm.course_id = p_course_id and cm.role = 'student';

  if v_students is null then
    return 0;
  end if;

  -- 建組（簡單命名 G1..GN）
  for v_i in 1..p_target_group_count loop
    insert into public.course_groups (course_id, name, created_by)
    values (p_course_id, 'G' || v_i, auth.uid())
    returning id into v_gid;
    v_groups := array_append(v_groups, v_gid);
  end loop;

  -- 輪流分派
  for v_i in 1..coalesce(array_length(v_students, 1), 0) loop
    v_sid := v_students[v_i];
    v_idx := ((v_i - 1) % p_target_group_count) + 1;
    v_gid := v_groups[v_idx];

    insert into public.course_group_members (group_id, user_id, role)
    values (v_gid, v_sid, 'member')
    on conflict do nothing;
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

grant execute on function public.auto_assign_course_groups(uuid, integer) to authenticated;

-- ============================================================
-- 4. 同儕互評（peer review）
-- ============================================================
create table if not exists public.peer_review_assignments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  assignment_id uuid references public.assignments (id) on delete cascade,
  title text not null,
  description text not null default '',
  reviews_per_student integer not null default 2 check (reviews_per_student > 0),
  open_at timestamptz not null default now(),
  due_at timestamptz,
  rubric jsonb not null default '[]'::jsonb,
  anonymous boolean not null default true,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create index if not exists peer_review_assignments_course_idx
  on public.peer_review_assignments (course_id);

alter table public.peer_review_assignments enable row level security;

drop policy if exists peer_review_assignments_select on public.peer_review_assignments;
create policy peer_review_assignments_select on public.peer_review_assignments
  for select using (public.is_course_member(course_id) or public.is_platform_admin());

drop policy if exists peer_review_assignments_write_staff on public.peer_review_assignments;
create policy peer_review_assignments_write_staff on public.peer_review_assignments
  for all using (
    public.course_member_has_capability(course_id, 'assignments.grade'::text)
  )
  with check (
    public.course_member_has_capability(course_id, 'assignments.grade'::text)
  );

-- 配對表：誰要評誰
create table if not exists public.peer_review_pairs (
  id uuid primary key default gen_random_uuid(),
  review_assignment_id uuid not null references public.peer_review_assignments (id) on delete cascade,
  reviewer_id uuid not null references public.profiles (id) on delete cascade,
  reviewee_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'submitted', 'expired')),
  created_at timestamptz not null default now(),
  unique (review_assignment_id, reviewer_id, reviewee_id)
);

create index if not exists peer_review_pairs_reviewer_idx
  on public.peer_review_pairs (reviewer_id, status);
create index if not exists peer_review_pairs_assignment_idx
  on public.peer_review_pairs (review_assignment_id);

alter table public.peer_review_pairs enable row level security;

drop policy if exists peer_review_pairs_select on public.peer_review_pairs;
create policy peer_review_pairs_select on public.peer_review_pairs
  for select using (
    reviewer_id = auth.uid()
    or reviewee_id = auth.uid()
    or exists (
      select 1 from public.peer_review_assignments p
      where p.id = peer_review_pairs.review_assignment_id
        and public.is_course_staff(p.course_id)
    )
    or public.is_platform_admin()
  );

drop policy if exists peer_review_pairs_write_staff on public.peer_review_pairs;
create policy peer_review_pairs_write_staff on public.peer_review_pairs
  for all using (
    exists (
      select 1 from public.peer_review_assignments p
      where p.id = peer_review_pairs.review_assignment_id
        and public.is_course_staff(p.course_id)
    )
  )
  with check (
    exists (
      select 1 from public.peer_review_assignments p
      where p.id = review_assignment_id
        and public.is_course_staff(p.course_id)
    )
  );

-- 同儕評語／分數
create table if not exists public.peer_review_responses (
  id uuid primary key default gen_random_uuid(),
  pair_id uuid not null references public.peer_review_pairs (id) on delete cascade,
  scores jsonb not null default '{}'::jsonb,
  comment text not null default '',
  submitted_at timestamptz not null default now()
);

create index if not exists peer_review_responses_pair_idx on public.peer_review_responses (pair_id);

alter table public.peer_review_responses enable row level security;

drop policy if exists peer_review_responses_select on public.peer_review_responses;
create policy peer_review_responses_select on public.peer_review_responses
  for select using (
    exists (
      select 1 from public.peer_review_pairs pr
      join public.peer_review_assignments pa on pa.id = pr.review_assignment_id
      where pr.id = peer_review_responses.pair_id
        and (
          pr.reviewer_id = auth.uid()
          or pr.reviewee_id = auth.uid()
          or public.is_course_staff(pa.course_id)
          or public.is_platform_admin()
        )
    )
  );

drop policy if exists peer_review_responses_insert_self on public.peer_review_responses;
create policy peer_review_responses_insert_self on public.peer_review_responses
  for insert with check (
    exists (
      select 1 from public.peer_review_pairs pr
      where pr.id = pair_id and pr.reviewer_id = auth.uid() and pr.status = 'pending'
    )
  );

-- 自動配對 RPC（避免自己評自己；reviewer ≠ reviewee；每人評 N 人）
create or replace function public.auto_pair_peer_review(p_assignment_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course uuid;
  v_n integer;
  v_per integer;
  v_students uuid[];
  v_count integer;
  v_i integer;
  v_offset integer;
  v_inserted integer := 0;
  v_reviewee_idx integer;
begin
  select course_id, reviews_per_student into v_course, v_per
  from public.peer_review_assignments where id = p_assignment_id;
  if v_course is null then raise exception 'assignment not found'; end if;
  if not public.is_course_staff(v_course) then raise exception 'forbidden'; end if;

  select array_agg(cm.user_id order by random())
    into v_students
  from public.course_members cm
  where cm.course_id = v_course and cm.role = 'student';

  v_count := coalesce(array_length(v_students, 1), 0);
  if v_count < 2 then return 0; end if;

  v_per := least(v_per, v_count - 1);

  for v_i in 1..v_count loop
    for v_offset in 1..v_per loop
      v_reviewee_idx := ((v_i - 1 + v_offset) % v_count) + 1;
      insert into public.peer_review_pairs (review_assignment_id, reviewer_id, reviewee_id, status)
      values (p_assignment_id, v_students[v_i], v_students[v_reviewee_idx], 'pending')
      on conflict (review_assignment_id, reviewer_id, reviewee_id) do nothing;
      v_inserted := v_inserted + 1;
    end loop;
  end loop;

  return v_inserted;
end;
$$;

grant execute on function public.auto_pair_peer_review(uuid) to authenticated;

-- 提交評語並標記 pair 為 submitted
create or replace function public.submit_peer_review(
  p_pair_id uuid,
  p_scores jsonb,
  p_comment text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_response uuid;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;

  insert into public.peer_review_responses (pair_id, scores, comment)
  values (p_pair_id, coalesce(p_scores, '{}'::jsonb), coalesce(p_comment, ''))
  returning id into v_response;

  update public.peer_review_pairs
  set status = 'submitted'
  where id = p_pair_id and reviewer_id = auth.uid();

  return v_response;
end;
$$;

grant execute on function public.submit_peer_review(uuid, jsonb, text) to authenticated;


-- ════════════════════════════════════════════════════════════
-- 20260520130200_wave5_surveys_badges_dashboard.sql
-- ════════════════════════════════════════════════════════════
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


-- ════════════════════════════════════════════════════════════
-- 20260520140000_wave6_scorm_lti_rubric.sql
-- ════════════════════════════════════════════════════════════
-- Wave 6: SCORM/xAPI 學習物件 + LTI 1.3 + Rubric 評量量表

-- ============================================================
-- 1. SCORM packages（教師上傳的 SCORM 1.2/2004 套件 metadata）
-- ============================================================
create table if not exists public.scorm_packages (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  title text not null,
  scorm_version text not null default '1.2' check (scorm_version in ('1.2', '2004')),
  storage_path text not null,
  manifest_data jsonb not null default '{}'::jsonb,
  default_entry_url text,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scorm_packages_course_idx on public.scorm_packages (course_id);

alter table public.scorm_packages enable row level security;

drop policy if exists scorm_packages_select on public.scorm_packages;
create policy scorm_packages_select on public.scorm_packages
  for select using (public.is_course_member(course_id) or public.is_platform_admin());

drop policy if exists scorm_packages_write_staff on public.scorm_packages;
create policy scorm_packages_write_staff on public.scorm_packages
  for all using (public.course_member_has_capability(course_id, 'materials.publish'::text))
  with check (public.course_member_has_capability(course_id, 'materials.publish'::text));

-- SCORM 學員作答／進度（CMI data model 子集）
create table if not exists public.scorm_attempts (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.scorm_packages (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  attempt_no integer not null default 1,
  cmi jsonb not null default '{}'::jsonb,
  completion_status text default 'incomplete' check (
    completion_status in ('incomplete', 'completed', 'passed', 'failed')
  ),
  score numeric,
  total_time_seconds integer not null default 0,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists scorm_attempts_student_idx on public.scorm_attempts (student_id, package_id);

alter table public.scorm_attempts enable row level security;

drop policy if exists scorm_attempts_select on public.scorm_attempts;
create policy scorm_attempts_select on public.scorm_attempts
  for select using (
    student_id = auth.uid()
    or exists (
      select 1 from public.scorm_packages p
      where p.id = scorm_attempts.package_id and public.is_course_staff(p.course_id)
    )
    or public.is_platform_admin()
  );

drop policy if exists scorm_attempts_insert_self on public.scorm_attempts;
create policy scorm_attempts_insert_self on public.scorm_attempts
  for insert with check (
    student_id = auth.uid()
    and exists (
      select 1 from public.scorm_packages p
      where p.id = package_id and public.is_course_member(p.course_id)
    )
  );

drop policy if exists scorm_attempts_update_self on public.scorm_attempts;
create policy scorm_attempts_update_self on public.scorm_attempts
  for update using (student_id = auth.uid())
  with check (student_id = auth.uid());

-- xAPI statements（CMI5／Experience API 格式 statement）
create table if not exists public.xapi_statements (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references public.courses (id) on delete cascade,
  actor_id uuid not null references public.profiles (id) on delete cascade,
  verb_id text not null,
  object_id text not null,
  result jsonb not null default '{}'::jsonb,
  context jsonb not null default '{}'::jsonb,
  stored_at timestamptz not null default now()
);

create index if not exists xapi_statements_actor_idx on public.xapi_statements (actor_id, stored_at desc);
create index if not exists xapi_statements_course_idx
  on public.xapi_statements (course_id, stored_at desc)
  where course_id is not null;

alter table public.xapi_statements enable row level security;

drop policy if exists xapi_statements_select on public.xapi_statements;
create policy xapi_statements_select on public.xapi_statements
  for select using (
    actor_id = auth.uid()
    or (course_id is not null and public.is_course_staff(course_id))
    or public.is_platform_admin()
  );

drop policy if exists xapi_statements_insert_self on public.xapi_statements;
create policy xapi_statements_insert_self on public.xapi_statements
  for insert with check (actor_id = auth.uid());

-- xAPI statement 寫入 RPC（含 nonce、verb 白名單）
create or replace function public.record_xapi_statement(
  p_course_id uuid,
  p_verb_id text,
  p_object_id text,
  p_result jsonb,
  p_context jsonb
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
  if p_course_id is not null and not public.is_course_member(p_course_id) then
    raise exception 'not a course member';
  end if;

  insert into public.xapi_statements (course_id, actor_id, verb_id, object_id, result, context)
  values (
    p_course_id, auth.uid(), coalesce(p_verb_id, 'http://adlnet.gov/expapi/verbs/experienced'),
    coalesce(p_object_id, ''), coalesce(p_result, '{}'::jsonb), coalesce(p_context, '{}'::jsonb)
  )
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.record_xapi_statement(uuid, text, text, jsonb, jsonb) to authenticated;

-- ============================================================
-- 2. LTI 1.3 工具掛載
-- ============================================================
create table if not exists public.lti_tools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  client_id text not null,
  issuer text not null,
  jwks_url text not null,
  auth_login_url text not null,
  auth_token_url text not null,
  deployment_id text not null,
  redirect_uri text,
  scopes text[] not null default '{}'::text[],
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (issuer, client_id, deployment_id)
);

alter table public.lti_tools enable row level security;

drop policy if exists lti_tools_select on public.lti_tools;
create policy lti_tools_select on public.lti_tools
  for select using (auth.uid() is not null);

drop policy if exists lti_tools_admin_write on public.lti_tools;
create policy lti_tools_admin_write on public.lti_tools
  for all using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- 課程級資源連結
create table if not exists public.lti_resource_links (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  tool_id uuid not null references public.lti_tools (id) on delete cascade,
  title text not null,
  resource_link_id text not null,
  custom_params jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (course_id, tool_id, resource_link_id)
);

alter table public.lti_resource_links enable row level security;

drop policy if exists lti_resource_links_select on public.lti_resource_links;
create policy lti_resource_links_select on public.lti_resource_links
  for select using (public.is_course_member(course_id) or public.is_platform_admin());

drop policy if exists lti_resource_links_write_staff on public.lti_resource_links;
create policy lti_resource_links_write_staff on public.lti_resource_links
  for all using (public.course_member_has_capability(course_id, 'materials.publish'::text))
  with check (public.course_member_has_capability(course_id, 'materials.publish'::text));

-- launch 紀錄（含 nonce／state；OIDC login flow 第三方驗證後存證）
create table if not exists public.lti_launches (
  id uuid primary key default gen_random_uuid(),
  resource_link_id uuid not null references public.lti_resource_links (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  nonce text not null,
  state text,
  id_token_jti text,
  id_token_iss text,
  launched_at timestamptz not null default now()
);

create index if not exists lti_launches_user_idx on public.lti_launches (user_id, launched_at desc);

alter table public.lti_launches enable row level security;

drop policy if exists lti_launches_self_or_staff on public.lti_launches;
create policy lti_launches_self_or_staff on public.lti_launches
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from public.lti_resource_links rl
      where rl.id = lti_launches.resource_link_id and public.is_course_staff(rl.course_id)
    )
    or public.is_platform_admin()
  );

drop policy if exists lti_launches_insert_self on public.lti_launches;
create policy lti_launches_insert_self on public.lti_launches
  for insert with check (user_id = auth.uid());

revoke update, delete on public.lti_launches from authenticated;

-- ============================================================
-- 3. Rubric 評量量表（綁定 assignment 或 peer_review）
-- ============================================================
create table if not exists public.rubrics (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  title text not null,
  description text not null default '',
  bound_kind text check (bound_kind is null or bound_kind in ('assignment', 'peer_review')),
  bound_id uuid,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create index if not exists rubrics_course_idx on public.rubrics (course_id);
create index if not exists rubrics_bound_idx
  on public.rubrics (bound_kind, bound_id) where bound_id is not null;

alter table public.rubrics enable row level security;

drop policy if exists rubrics_select on public.rubrics;
create policy rubrics_select on public.rubrics
  for select using (public.is_course_member(course_id) or public.is_platform_admin());

drop policy if exists rubrics_write_staff on public.rubrics;
create policy rubrics_write_staff on public.rubrics
  for all using (
    public.course_member_has_capability(course_id, 'assignments.grade'::text)
  )
  with check (
    public.course_member_has_capability(course_id, 'assignments.grade'::text)
  );

create table if not exists public.rubric_criteria (
  id uuid primary key default gen_random_uuid(),
  rubric_id uuid not null references public.rubrics (id) on delete cascade,
  name text not null,
  description text not null default '',
  weight numeric not null default 1 check (weight >= 0),
  max_points numeric not null default 4 check (max_points > 0),
  sort_order integer not null default 0,
  levels jsonb not null default '[]'::jsonb
);

create index if not exists rubric_criteria_rubric_idx
  on public.rubric_criteria (rubric_id, sort_order);

alter table public.rubric_criteria enable row level security;

drop policy if exists rubric_criteria_select on public.rubric_criteria;
create policy rubric_criteria_select on public.rubric_criteria
  for select using (
    exists (
      select 1 from public.rubrics r
      where r.id = rubric_criteria.rubric_id
        and (public.is_course_member(r.course_id) or public.is_platform_admin())
    )
  );

drop policy if exists rubric_criteria_write_staff on public.rubric_criteria;
create policy rubric_criteria_write_staff on public.rubric_criteria
  for all using (
    exists (
      select 1 from public.rubrics r
      where r.id = rubric_criteria.rubric_id
        and public.course_member_has_capability(r.course_id, 'assignments.grade'::text)
    )
  )
  with check (
    exists (
      select 1 from public.rubrics r
      where r.id = rubric_id
        and public.course_member_has_capability(r.course_id, 'assignments.grade'::text)
    )
  );

-- Rubric 評分
create table if not exists public.rubric_scores (
  id uuid primary key default gen_random_uuid(),
  rubric_id uuid not null references public.rubrics (id) on delete cascade,
  target_kind text not null check (target_kind in ('submission', 'peer_review_pair')),
  target_id uuid not null,
  scorer_id uuid not null references public.profiles (id) on delete cascade,
  scores jsonb not null default '{}'::jsonb,
  total_points numeric,
  comment text,
  created_at timestamptz not null default now(),
  unique (rubric_id, target_kind, target_id, scorer_id)
);

create index if not exists rubric_scores_target_idx
  on public.rubric_scores (target_kind, target_id);

alter table public.rubric_scores enable row level security;

drop policy if exists rubric_scores_select on public.rubric_scores;
create policy rubric_scores_select on public.rubric_scores
  for select using (
    scorer_id = auth.uid()
    or exists (
      select 1 from public.rubrics r
      where r.id = rubric_scores.rubric_id and public.is_course_staff(r.course_id)
    )
    or public.is_platform_admin()
  );

drop policy if exists rubric_scores_insert_self on public.rubric_scores;
create policy rubric_scores_insert_self on public.rubric_scores
  for insert with check (scorer_id = auth.uid());

drop policy if exists rubric_scores_update_self on public.rubric_scores;
create policy rubric_scores_update_self on public.rubric_scores
  for update using (scorer_id = auth.uid())
  with check (scorer_id = auth.uid());

-- 評 rubric 之 RPC（自動計算 total）
create or replace function public.submit_rubric_score(
  p_rubric_id uuid,
  p_target_kind text,
  p_target_id uuid,
  p_scores jsonb,
  p_comment text
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric := 0;
  c record;
  v_score numeric;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  if p_target_kind not in ('submission', 'peer_review_pair') then
    raise exception 'invalid target_kind';
  end if;

  -- 加權總分
  for c in
    select id, weight, max_points
    from public.rubric_criteria
    where rubric_id = p_rubric_id
  loop
    v_score := least(
      greatest(coalesce((p_scores->>c.id::text)::numeric, 0), 0),
      c.max_points
    );
    v_total := v_total + (v_score * c.weight);
  end loop;

  insert into public.rubric_scores (
    rubric_id, target_kind, target_id, scorer_id, scores, total_points, comment
  ) values (
    p_rubric_id, p_target_kind, p_target_id, auth.uid(),
    coalesce(p_scores, '{}'::jsonb), v_total, coalesce(p_comment, '')
  )
  on conflict (rubric_id, target_kind, target_id, scorer_id)
  do update set scores = excluded.scores,
                total_points = excluded.total_points,
                comment = excluded.comment;

  return v_total;
end;
$$;

grant execute on function public.submit_rubric_score(uuid, text, uuid, jsonb, text) to authenticated;


-- ════════════════════════════════════════════════════════════
-- 20260520140100_wave6_notes_versions_chapters_meeting.sql
-- ════════════════════════════════════════════════════════════
-- Wave 6: 筆記／書籤 + 教材版本 + 影音章節 + 會議整合 + 直播

-- ============================================================
-- 4. material_notes（學生對教材的筆記）
-- ============================================================
create table if not exists public.material_notes (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.course_materials (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  position_seconds numeric,
  page_number integer,
  is_pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists material_notes_user_idx on public.material_notes (user_id, material_id);

alter table public.material_notes enable row level security;

drop policy if exists material_notes_self_select on public.material_notes;
create policy material_notes_self_select on public.material_notes
  for select using (user_id = auth.uid() or public.is_platform_admin());

drop policy if exists material_notes_self_write on public.material_notes;
create policy material_notes_self_write on public.material_notes
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

create trigger material_notes_touch
  before update on public.material_notes
  for each row execute function public.set_updated_at();

-- ============================================================
-- 5. material_bookmarks（書籤）
-- ============================================================
create table if not exists public.material_bookmarks (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.course_materials (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  label text not null default '',
  position_seconds numeric,
  page_number integer,
  created_at timestamptz not null default now(),
  unique (material_id, user_id, position_seconds, page_number)
);

create index if not exists material_bookmarks_user_idx on public.material_bookmarks (user_id, material_id);

alter table public.material_bookmarks enable row level security;

drop policy if exists material_bookmarks_self_select on public.material_bookmarks;
create policy material_bookmarks_self_select on public.material_bookmarks
  for select using (user_id = auth.uid() or public.is_platform_admin());

drop policy if exists material_bookmarks_self_write on public.material_bookmarks;
create policy material_bookmarks_self_write on public.material_bookmarks
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================
-- 6. material_versions（教材歷史版本）
-- ============================================================
create table if not exists public.material_versions (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.course_materials (id) on delete cascade,
  version_no integer not null,
  title text not null,
  storage_path text,
  external_url text,
  mime_type text,
  change_summary text not null default '',
  archived_by uuid references public.profiles (id) on delete set null,
  archived_at timestamptz not null default now(),
  unique (material_id, version_no)
);

create index if not exists material_versions_material_idx
  on public.material_versions (material_id, version_no desc);

alter table public.material_versions enable row level security;

drop policy if exists material_versions_select on public.material_versions;
create policy material_versions_select on public.material_versions
  for select using (
    exists (
      select 1 from public.course_materials cm
      where cm.id = material_versions.material_id
        and (public.is_course_member(cm.course_id) or public.is_platform_admin())
    )
  );

drop policy if exists material_versions_write_staff on public.material_versions;
create policy material_versions_write_staff on public.material_versions
  for all using (
    exists (
      select 1 from public.course_materials cm
      where cm.id = material_versions.material_id
        and public.course_member_has_capability(cm.course_id, 'materials.publish'::text)
    )
  )
  with check (
    exists (
      select 1 from public.course_materials cm
      where cm.id = material_id
        and public.course_member_has_capability(cm.course_id, 'materials.publish'::text)
    )
  );

-- 自動把舊版 snapshot 進 material_versions（每次 UPDATE 寫一筆）
create or replace function public.snapshot_material_on_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
begin
  if old.title is not distinct from new.title
     and old.storage_path is not distinct from new.storage_path
     and old.external_url is not distinct from new.external_url
     and old.mime_type is not distinct from new.mime_type then
    return new;
  end if;

  select coalesce(max(version_no), 0) + 1 into v_next
  from public.material_versions
  where material_id = new.id;

  insert into public.material_versions (
    material_id, version_no, title, storage_path, external_url, mime_type,
    change_summary, archived_by
  ) values (
    new.id, v_next, old.title, old.storage_path, old.external_url, old.mime_type,
    'auto-snapshot on update', auth.uid()
  );
  return new;
end;
$$;

drop trigger if exists course_materials_snapshot_trg on public.course_materials;
create trigger course_materials_snapshot_trg
  after update on public.course_materials
  for each row execute function public.snapshot_material_on_update();

-- ============================================================
-- 7. material_chapter_markers（手動影音章節，與 AI segments 互補）
-- ============================================================
create table if not exists public.material_chapter_markers (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.course_materials (id) on delete cascade,
  title text not null,
  start_seconds numeric not null check (start_seconds >= 0),
  end_seconds numeric check (end_seconds is null or end_seconds > start_seconds),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create index if not exists material_chapter_markers_material_idx
  on public.material_chapter_markers (material_id, start_seconds);

alter table public.material_chapter_markers enable row level security;

drop policy if exists material_chapter_markers_select on public.material_chapter_markers;
create policy material_chapter_markers_select on public.material_chapter_markers
  for select using (
    exists (
      select 1 from public.course_materials cm
      where cm.id = material_chapter_markers.material_id
        and (public.is_course_member(cm.course_id) or public.is_platform_admin())
    )
  );

drop policy if exists material_chapter_markers_write_staff on public.material_chapter_markers;
create policy material_chapter_markers_write_staff on public.material_chapter_markers
  for all using (
    exists (
      select 1 from public.course_materials cm
      where cm.id = material_chapter_markers.material_id
        and public.course_member_has_capability(cm.course_id, 'materials.publish'::text)
    )
  )
  with check (
    exists (
      select 1 from public.course_materials cm
      where cm.id = material_id
        and public.course_member_has_capability(cm.course_id, 'materials.publish'::text)
    )
  );

-- ============================================================
-- 8. course_meetings（Zoom／Teams／BBB／Webex 通用 URL placeholder）
-- ============================================================
create table if not exists public.course_meetings (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  provider text not null check (provider in ('zoom', 'teams', 'bbb', 'webex', 'google_meet', 'other')),
  title text not null,
  meeting_url text not null,
  meeting_id_external text,
  password_hint text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  host_id uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index if not exists course_meetings_course_idx on public.course_meetings (course_id, starts_at desc);

alter table public.course_meetings enable row level security;

drop policy if exists course_meetings_select on public.course_meetings;
create policy course_meetings_select on public.course_meetings
  for select using (public.is_course_member(course_id) or public.is_platform_admin());

drop policy if exists course_meetings_write_staff on public.course_meetings;
create policy course_meetings_write_staff on public.course_meetings
  for all using (public.course_member_has_capability(course_id, 'live.host'::text))
  with check (public.course_member_has_capability(course_id, 'live.host'::text));

-- ============================================================
-- 9. livestream_sessions（直播課程：HLS／RTMP URL + WebRTC fallback URL）
-- ============================================================
create table if not exists public.livestream_sessions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  title text not null,
  hls_play_url text,
  rtmp_ingest_url text,
  webrtc_join_url text,
  status text not null default 'scheduled' check (status in ('scheduled', 'live', 'ended', 'cancelled')),
  recording_url text,
  scheduled_at timestamptz not null,
  live_started_at timestamptz,
  live_ended_at timestamptz,
  host_id uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index if not exists livestream_sessions_course_idx on public.livestream_sessions (course_id, scheduled_at desc);

alter table public.livestream_sessions enable row level security;

drop policy if exists livestream_sessions_select on public.livestream_sessions;
create policy livestream_sessions_select on public.livestream_sessions
  for select using (public.is_course_member(course_id) or public.is_platform_admin());

drop policy if exists livestream_sessions_write_staff on public.livestream_sessions;
create policy livestream_sessions_write_staff on public.livestream_sessions
  for all using (public.course_member_has_capability(course_id, 'live.host'::text))
  with check (public.course_member_has_capability(course_id, 'live.host'::text));


-- ════════════════════════════════════════════════════════════
-- 20260520140200_wave6_learning_time_workload.sql
-- ════════════════════════════════════════════════════════════
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
  (select count(distinct qa.id) from public.quiz_answers qa
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


-- ════════════════════════════════════════════════════════════
-- 20260520150000_wave7_export_richtext_preview.sql
-- ════════════════════════════════════════════════════════════
-- Wave 7: IMS Common Cartridge 匯出 + Open Badge 2.0 + WYSIWYG + Office 預覽 + 電子白板

-- ============================================================
-- 1. course_export_packages（整課匯出任務；IMS Common Cartridge / Moodle backup）
-- ============================================================
create table if not exists public.course_export_packages (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  requested_by uuid not null references public.profiles (id) on delete cascade,
  format text not null check (format in ('imscc', 'moodle_backup', 'json_zip')),
  status text not null default 'queued' check (status in ('queued', 'running', 'ready', 'failed')),
  storage_path text,
  manifest_summary jsonb,
  error_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists course_export_packages_status_idx
  on public.course_export_packages (status, created_at);

alter table public.course_export_packages enable row level security;

drop policy if exists course_export_packages_self_or_staff on public.course_export_packages;
create policy course_export_packages_self_or_staff on public.course_export_packages
  for select using (
    requested_by = auth.uid()
    or public.is_course_staff(course_id)
    or public.is_platform_admin()
  );

drop policy if exists course_export_packages_insert_staff on public.course_export_packages;
create policy course_export_packages_insert_staff on public.course_export_packages
  for insert with check (
    requested_by = auth.uid()
    and public.is_course_staff(course_id)
  );

revoke update, delete on public.course_export_packages from authenticated;

-- worker 認領／完成 RPC（與 report_export_jobs 同模式）
create or replace function public.course_export_jobs_claim_next()
returns public.course_export_packages
language plpgsql
security definer
set search_path = public
as $$
declare v_job public.course_export_packages;
begin
  if not (public.is_platform_admin()
    or current_setting('request.jwt.claim.role', true) in ('service_role', 'postgres')) then
    raise exception 'forbidden';
  end if;

  select * into v_job
  from public.course_export_packages
  where status = 'queued'
  order by created_at asc
  for update skip locked
  limit 1;

  if v_job.id is null then return null; end if;

  update public.course_export_packages
  set status = 'running', updated_at = now()
  where id = v_job.id
  returning * into v_job;
  return v_job;
end;
$$;

revoke execute on function public.course_export_jobs_claim_next() from public;
grant execute on function public.course_export_jobs_claim_next() to authenticated;

create or replace function public.course_export_jobs_complete(
  p_id uuid,
  p_status text,
  p_storage_path text,
  p_manifest jsonb,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_platform_admin()
    or current_setting('request.jwt.claim.role', true) in ('service_role', 'postgres')) then
    raise exception 'forbidden';
  end if;
  if p_status not in ('ready', 'failed') then raise exception 'invalid status'; end if;

  update public.course_export_packages
  set status = p_status,
      storage_path = p_storage_path,
      manifest_summary = p_manifest,
      error_detail = p_error,
      updated_at = now()
  where id = p_id;
end;
$$;

revoke execute on function public.course_export_jobs_complete(uuid, text, text, jsonb, text) from public;
grant execute on function public.course_export_jobs_complete(uuid, text, text, jsonb, text) to authenticated;

-- ============================================================
-- 2. Open Badge 2.0：badge issuer 設定 + assertion 紀錄
-- ============================================================
create table if not exists public.badge_issuer_config (
  id text primary key default 'default',
  issuer_url text not null default '',
  issuer_name text not null default '',
  issuer_email text not null default '',
  signing_key_kid text,
  public_key_jwk jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.badge_issuer_config enable row level security;

drop policy if exists badge_issuer_config_read on public.badge_issuer_config;
create policy badge_issuer_config_read on public.badge_issuer_config
  for select using (true);

drop policy if exists badge_issuer_config_admin_write on public.badge_issuer_config;
create policy badge_issuer_config_admin_write on public.badge_issuer_config
  for all using (public.is_platform_admin())
  with check (public.is_platform_admin());

insert into public.badge_issuer_config (id) values ('default')
on conflict (id) do nothing;

-- Open Badge 2.0 BadgeClass JSON-LD（每個 course_badges 對應一筆）
alter table public.course_badges
  add column if not exists obc_image_url text;
alter table public.course_badges
  add column if not exists obc_criteria_url text;
alter table public.course_badges
  add column if not exists obc_tags text[];

-- BadgeAssertion（每次發行徽章寫一筆 OB 2.0 JSON-LD）
create table if not exists public.badge_assertions (
  id uuid primary key default gen_random_uuid(),
  award_id uuid not null references public.course_badge_awards (id) on delete cascade,
  assertion_jsonld jsonb not null,
  signature_jws text,
  public_url text,
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz not null default now(),
  unique (award_id)
);

alter table public.badge_assertions enable row level security;

drop policy if exists badge_assertions_self_or_staff on public.badge_assertions;
create policy badge_assertions_self_or_staff on public.badge_assertions
  for select using (
    exists (
      select 1 from public.course_badge_awards a
      join public.course_badges b on b.id = a.badge_id
      where a.id = badge_assertions.award_id
        and (a.recipient_id = auth.uid() or public.is_course_staff(b.course_id))
    )
    or public.is_platform_admin()
  );

revoke insert, update, delete on public.badge_assertions from authenticated;

-- ============================================================
-- 3. WYSIWYG 富文本：announcements / forum_posts / course_materials 加 body_html + sanitize policy
-- ============================================================
alter table public.announcements
  add column if not exists body_html text,
  add column if not exists body_markdown text;

alter table public.forum_posts
  add column if not exists body_html text;

alter table public.course_materials
  add column if not exists description_html text;

create table if not exists public.html_sanitize_policy (
  id text primary key default 'default',
  allowed_tags text[] not null default array[
    'p','br','strong','em','u','s','a','img',
    'ul','ol','li','blockquote','pre','code',
    'h1','h2','h3','h4','h5','h6',
    'table','thead','tbody','tr','th','td',
    'span','div','hr','figure','figcaption'
  ],
  allowed_attrs jsonb not null default
    '{"a":["href","title","target","rel"],"img":["src","alt","title","width","height"],"*":["class","id"]}'::jsonb,
  allow_data_uri_image boolean not null default false,
  max_html_bytes integer not null default 524288,
  updated_at timestamptz not null default now()
);

alter table public.html_sanitize_policy enable row level security;

drop policy if exists html_sanitize_policy_read on public.html_sanitize_policy;
create policy html_sanitize_policy_read on public.html_sanitize_policy
  for select using (true);

drop policy if exists html_sanitize_policy_admin_write on public.html_sanitize_policy;
create policy html_sanitize_policy_admin_write on public.html_sanitize_policy
  for all using (public.is_platform_admin())
  with check (public.is_platform_admin());

insert into public.html_sanitize_policy (id) values ('default') on conflict (id) do nothing;

-- ============================================================
-- 4. material_previews（Office / PDF 預覽 URL placeholder）
-- ============================================================
create table if not exists public.material_previews (
  material_id uuid primary key references public.course_materials (id) on delete cascade,
  preview_kind text not null check (preview_kind in (
    'office_online', 'google_viewer', 'pdfjs', 'image_thumbnail', 'custom'
  )),
  preview_url text not null,
  thumbnail_url text,
  page_count integer,
  updated_at timestamptz not null default now()
);

alter table public.material_previews enable row level security;

drop policy if exists material_previews_select on public.material_previews;
create policy material_previews_select on public.material_previews
  for select using (
    exists (
      select 1 from public.course_materials cm
      where cm.id = material_previews.material_id
        and (public.is_course_member(cm.course_id) or public.is_platform_admin())
    )
  );

drop policy if exists material_previews_write_staff on public.material_previews;
create policy material_previews_write_staff on public.material_previews
  for all using (
    exists (
      select 1 from public.course_materials cm
      where cm.id = material_previews.material_id
        and public.course_member_has_capability(cm.course_id, 'materials.publish'::text)
    )
  )
  with check (
    exists (
      select 1 from public.course_materials cm
      where cm.id = material_id
        and public.course_member_has_capability(cm.course_id, 'materials.publish'::text)
    )
  );

-- ============================================================
-- 5. whiteboard_sessions（電子白板；URL placeholder，與 livestream 互補）
-- ============================================================
create table if not exists public.whiteboard_sessions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  live_session_id uuid references public.live_sessions (id) on delete set null,
  livestream_session_id uuid references public.livestream_sessions (id) on delete set null,
  provider text not null check (provider in ('jamboard', 'miro', 'excalidraw', 'figma', 'custom')),
  join_url text not null,
  embed_url text,
  snapshot_url text,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create index if not exists whiteboard_sessions_course_idx on public.whiteboard_sessions (course_id, created_at desc);

alter table public.whiteboard_sessions enable row level security;

drop policy if exists whiteboard_sessions_select on public.whiteboard_sessions;
create policy whiteboard_sessions_select on public.whiteboard_sessions
  for select using (public.is_course_member(course_id) or public.is_platform_admin());

drop policy if exists whiteboard_sessions_write_staff on public.whiteboard_sessions;
create policy whiteboard_sessions_write_staff on public.whiteboard_sessions
  for all using (public.course_member_has_capability(course_id, 'live.host'::text))
  with check (public.course_member_has_capability(course_id, 'live.host'::text));

-- 白板註記（學生／教師可加）
create table if not exists public.whiteboard_annotations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.whiteboard_sessions (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  annotation jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists whiteboard_annotations_session_idx
  on public.whiteboard_annotations (session_id, created_at);

alter table public.whiteboard_annotations enable row level security;

drop policy if exists whiteboard_annotations_select on public.whiteboard_annotations;
create policy whiteboard_annotations_select on public.whiteboard_annotations
  for select using (
    exists (
      select 1 from public.whiteboard_sessions ws
      where ws.id = whiteboard_annotations.session_id
        and public.is_course_member(ws.course_id)
    )
    or public.is_platform_admin()
  );

drop policy if exists whiteboard_annotations_insert_self on public.whiteboard_annotations;
create policy whiteboard_annotations_insert_self on public.whiteboard_annotations
  for insert with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.whiteboard_sessions ws
      where ws.id = session_id and public.is_course_member(ws.course_id)
    )
  );

drop policy if exists whiteboard_annotations_delete_own_or_staff on public.whiteboard_annotations;
create policy whiteboard_annotations_delete_own_or_staff on public.whiteboard_annotations
  for delete using (
    author_id = auth.uid()
    or exists (
      select 1 from public.whiteboard_sessions ws
      where ws.id = whiteboard_annotations.session_id and public.is_course_staff(ws.course_id)
    )
  );


-- ════════════════════════════════════════════════════════════
-- 20260520150100_wave7_leaderboard_duplicate_reads_tags.sql
-- ════════════════════════════════════════════════════════════
-- Wave 7：排行榜 + 整課複製 + 公告閱讀回條 + 教材標籤 + 教師備課筆記 + 課程回饋 + 成績核可 + 加退選紀錄

-- ============================================================
-- 6. 排行榜（reporting_course_leaderboard）
-- ============================================================
create or replace view public.reporting_course_leaderboard as
select
  r.course_id,
  r.student_id,
  r.weighted_percent,
  rank() over (partition by r.course_id order by r.weighted_percent desc nulls last) as rank_in_course
from public.course_grade_rollups r
where r.weighted_percent is not null;

comment on view public.reporting_course_leaderboard is
  '課程內加權成績排名；RLS 由底層 grade_scores 強制（學生只看自己；教師看全班）';

grant select on public.reporting_course_leaderboard to authenticated;

create or replace function public.my_course_rank(p_course_id uuid)
returns table (rank_in_course bigint, weighted_percent numeric)
language sql
stable
security definer
set search_path = public
as $$
  select v.rank_in_course, v.weighted_percent
  from public.reporting_course_leaderboard v
  where v.course_id = p_course_id and v.student_id = auth.uid();
$$;

grant execute on function public.my_course_rank(uuid) to authenticated;

-- ============================================================
-- 7. 整課複製 RPC（章節、教材、徽章、Rubric、標籤 全拷貝）
-- ============================================================
create or replace function public.duplicate_course(
  p_source_course_id uuid,
  p_new_title text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new uuid;
  v_unit_map jsonb := '{}'::jsonb;
  v_rubric_map jsonb := '{}'::jsonb;
  v_badge_map jsonb := '{}'::jsonb;
  v_mat_map jsonb := '{}'::jsonb;
  r record;
  v_new_id uuid;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  if not (public.is_platform_admin() or public.is_course_teacher(p_source_course_id)) then
    raise exception 'forbidden';
  end if;

  -- 課程本體
  insert into public.courses (title, description, owner_id)
  select coalesce(p_new_title, c.title || '（複本）'), c.description, auth.uid()
  from public.courses c where c.id = p_source_course_id
  returning id into v_new;

  -- 教師自動入課
  insert into public.course_members (course_id, user_id, role)
  values (v_new, auth.uid(), 'teacher')
  on conflict do nothing;

  -- 教材
  for r in select * from public.course_materials where course_id = p_source_course_id loop
    insert into public.course_materials (course_id, title, storage_path, external_url, created_by)
    values (v_new, r.title, r.storage_path, r.external_url, auth.uid())
    returning id into v_new_id;
    v_mat_map := v_mat_map || jsonb_build_object(r.id::text, v_new_id);
  end loop;

  -- 章節
  for r in select * from public.course_units where course_id = p_source_course_id order by sort_order loop
    insert into public.course_units (
      course_id, title, description, sort_order, unlock_after, is_published, created_by
    ) values (
      v_new, r.title, r.description, r.sort_order, r.unlock_after, r.is_published, auth.uid()
    )
    returning id into v_new_id;
    v_unit_map := v_unit_map || jsonb_build_object(r.id::text, v_new_id);
  end loop;

  -- 章節子項（item_type=material 重新指向新教材）
  for r in
    select cui.*, cu.course_id as old_course
    from public.course_unit_items cui
    join public.course_units cu on cu.id = cui.unit_id
    where cu.course_id = p_source_course_id
  loop
    insert into public.course_unit_items (
      unit_id, item_type, ref_id, external_url, title, required_for_unlock, sort_order
    ) values (
      (v_unit_map->>r.unit_id::text)::uuid,
      r.item_type,
      case when r.item_type = 'material' and v_mat_map ? r.ref_id::text
        then (v_mat_map->>r.ref_id::text)::uuid
        else null end,
      r.external_url, r.title, r.required_for_unlock, r.sort_order
    );
  end loop;

  -- 徽章
  for r in select * from public.course_badges where course_id = p_source_course_id loop
    insert into public.course_badges (course_id, name, description, icon_url, criteria, is_active, created_by)
    values (v_new, r.name, r.description, r.icon_url, r.criteria, r.is_active, auth.uid())
    returning id into v_new_id;
    v_badge_map := v_badge_map || jsonb_build_object(r.id::text, v_new_id);
  end loop;

  -- Rubric + criteria
  for r in select * from public.rubrics where course_id = p_source_course_id loop
    insert into public.rubrics (course_id, title, description, bound_kind, bound_id, created_by)
    values (v_new, r.title, r.description, r.bound_kind, null, auth.uid())
    returning id into v_new_id;
    v_rubric_map := v_rubric_map || jsonb_build_object(r.id::text, v_new_id);

    insert into public.rubric_criteria (rubric_id, name, description, weight, max_points, sort_order, levels)
    select v_new_id, name, description, weight, max_points, sort_order, levels
    from public.rubric_criteria where rubric_id = r.id;
  end loop;

  return v_new;
end;
$$;

grant execute on function public.duplicate_course(uuid, text) to authenticated;

comment on function public.duplicate_course(uuid, text) is
  '整課複製：課程／教材／章節／章節子項（材料 ref 重指）／徽章／Rubric+criteria；學員、成績不複製。';

-- ============================================================
-- 8. 公告閱讀回條（announcement_reads + 已讀比例 view）
-- ============================================================
create table if not exists public.announcement_reads (
  announcement_id uuid not null references public.announcements (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

create index if not exists announcement_reads_user_idx on public.announcement_reads (user_id);

alter table public.announcement_reads enable row level security;

drop policy if exists announcement_reads_select on public.announcement_reads;
create policy announcement_reads_select on public.announcement_reads
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from public.announcements a
      where a.id = announcement_reads.announcement_id and public.is_course_staff(a.course_id)
    )
    or public.is_platform_admin()
  );

drop policy if exists announcement_reads_insert_self on public.announcement_reads;
create policy announcement_reads_insert_self on public.announcement_reads
  for insert with check (user_id = auth.uid());

revoke update, delete on public.announcement_reads from authenticated;

create or replace function public.mark_announcement_read(p_announcement_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  insert into public.announcement_reads (announcement_id, user_id)
  values (p_announcement_id, auth.uid())
  on conflict do nothing;
end;
$$;

grant execute on function public.mark_announcement_read(uuid) to authenticated;

create or replace view public.reporting_announcement_read_ratio as
select
  a.id as announcement_id,
  a.course_id,
  a.title,
  (select count(*) from public.announcement_reads r where r.announcement_id = a.id) as read_count,
  (select count(*) from public.course_members cm
    where cm.course_id = a.course_id and cm.role = 'student') as student_count,
  case
    when (select count(*) from public.course_members cm
      where cm.course_id = a.course_id and cm.role = 'student') = 0 then 0
    else (
      (select count(*) from public.announcement_reads r where r.announcement_id = a.id)::float
      / (select count(*) from public.course_members cm
          where cm.course_id = a.course_id and cm.role = 'student')
    )
  end as read_ratio
from public.announcements a;

grant select on public.reporting_announcement_read_ratio to authenticated;

-- ============================================================
-- 9. 教材標籤
-- ============================================================
create table if not exists public.course_tags (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  name text not null,
  color_hex text default '#6b7280',
  unique (course_id, name)
);

alter table public.course_tags enable row level security;

drop policy if exists course_tags_select on public.course_tags;
create policy course_tags_select on public.course_tags
  for select using (public.is_course_member(course_id) or public.is_platform_admin());

drop policy if exists course_tags_write_staff on public.course_tags;
create policy course_tags_write_staff on public.course_tags
  for all using (public.is_course_staff(course_id))
  with check (public.is_course_staff(course_id));

create table if not exists public.course_material_tag_map (
  material_id uuid not null references public.course_materials (id) on delete cascade,
  tag_id uuid not null references public.course_tags (id) on delete cascade,
  primary key (material_id, tag_id)
);

alter table public.course_material_tag_map enable row level security;

drop policy if exists course_material_tag_map_select on public.course_material_tag_map;
create policy course_material_tag_map_select on public.course_material_tag_map
  for select using (
    exists (
      select 1 from public.course_materials cm
      where cm.id = course_material_tag_map.material_id
        and (public.is_course_member(cm.course_id) or public.is_platform_admin())
    )
  );

drop policy if exists course_material_tag_map_write_staff on public.course_material_tag_map;
create policy course_material_tag_map_write_staff on public.course_material_tag_map
  for all using (
    exists (
      select 1 from public.course_materials cm
      where cm.id = course_material_tag_map.material_id and public.is_course_staff(cm.course_id)
    )
  )
  with check (
    exists (
      select 1 from public.course_materials cm
      where cm.id = material_id and public.is_course_staff(cm.course_id)
    )
  );

-- ============================================================
-- 10. 教師備課筆記（學生不可見）
-- ============================================================
create table if not exists public.teacher_private_notes (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  scope_kind text check (scope_kind is null or scope_kind in (
    'course', 'material', 'assignment', 'quiz', 'unit'
  )),
  scope_id uuid,
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists teacher_private_notes_teacher_idx
  on public.teacher_private_notes (teacher_id, course_id);

alter table public.teacher_private_notes enable row level security;

drop policy if exists teacher_private_notes_self_select on public.teacher_private_notes;
create policy teacher_private_notes_self_select on public.teacher_private_notes
  for select using (
    teacher_id = auth.uid()
    or public.is_platform_admin()
  );

drop policy if exists teacher_private_notes_self_write on public.teacher_private_notes;
create policy teacher_private_notes_self_write on public.teacher_private_notes
  for all using (teacher_id = auth.uid() and public.is_course_staff(course_id))
  with check (teacher_id = auth.uid() and public.is_course_staff(course_id));

create trigger teacher_private_notes_touch
  before update on public.teacher_private_notes
  for each row execute function public.set_updated_at();

-- ============================================================
-- 11. 課程意見回饋
-- ============================================================
create table if not exists public.course_feedback (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  respondent_id uuid references public.profiles (id) on delete set null,
  rating integer check (rating is null or (rating between 1 and 5)),
  body text not null default '',
  is_anonymous boolean not null default true,
  related_survey_id uuid references public.surveys (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists course_feedback_course_idx on public.course_feedback (course_id, created_at desc);

alter table public.course_feedback enable row level security;

drop policy if exists course_feedback_select on public.course_feedback;
create policy course_feedback_select on public.course_feedback
  for select using (
    (respondent_id = auth.uid() and respondent_id is not null)
    or public.is_course_staff(course_id)
    or public.is_platform_admin()
  );

drop policy if exists course_feedback_insert on public.course_feedback;
create policy course_feedback_insert on public.course_feedback
  for insert with check (
    public.is_course_member(course_id)
    and (
      is_anonymous = true and respondent_id is null
      or is_anonymous = false and respondent_id = auth.uid()
    )
  );

revoke update, delete on public.course_feedback from authenticated;

-- ============================================================
-- 12. 成績核可流程
-- ============================================================
create table if not exists public.grade_approval_requests (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  requested_by uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  summary jsonb not null default '{}'::jsonb,
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);

create index if not exists grade_approval_requests_course_idx
  on public.grade_approval_requests (course_id, status, created_at desc);

alter table public.grade_approval_requests enable row level security;

drop policy if exists grade_approval_requests_select on public.grade_approval_requests;
create policy grade_approval_requests_select on public.grade_approval_requests
  for select using (
    requested_by = auth.uid()
    or public.is_course_staff(course_id)
    or public.is_platform_admin()
  );

drop policy if exists grade_approval_requests_insert_staff on public.grade_approval_requests;
create policy grade_approval_requests_insert_staff on public.grade_approval_requests
  for insert with check (
    requested_by = auth.uid() and public.is_course_staff(course_id)
  );

drop policy if exists grade_approval_requests_decide_admin on public.grade_approval_requests;
create policy grade_approval_requests_decide_admin on public.grade_approval_requests
  for update using (public.is_platform_admin())
  with check (public.is_platform_admin());

create or replace function public.decide_grade_approval(
  p_id uuid,
  p_decision text,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'invalid decision'; end if;

  update public.grade_approval_requests
  set status = p_decision,
      decided_by = auth.uid(),
      decided_at = now(),
      decision_note = coalesce(p_note, '')
  where id = p_id and status = 'pending';
end;
$$;

grant execute on function public.decide_grade_approval(uuid, text, text) to authenticated;

-- ============================================================
-- 13. 加退選紀錄（course_members 變更 trigger 自動寫）
-- ============================================================
create table if not exists public.enrollment_history (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  event_kind text not null check (event_kind in ('enroll', 'role_change', 'drop')),
  role_before text,
  role_after text,
  actor_id uuid references public.profiles (id) on delete set null,
  event_at timestamptz not null default now()
);

create index if not exists enrollment_history_course_idx
  on public.enrollment_history (course_id, event_at desc);
create index if not exists enrollment_history_user_idx
  on public.enrollment_history (user_id, event_at desc);

alter table public.enrollment_history enable row level security;

drop policy if exists enrollment_history_select on public.enrollment_history;
create policy enrollment_history_select on public.enrollment_history
  for select using (
    user_id = auth.uid()
    or public.is_course_staff(course_id)
    or public.is_platform_admin()
  );

revoke insert, update, delete on public.enrollment_history from authenticated;

create or replace function public.course_members_audit_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.enrollment_history (course_id, user_id, event_kind, role_after, actor_id)
    values (new.course_id, new.user_id, 'enroll', new.role::text, auth.uid());
    return new;
  elsif tg_op = 'UPDATE' then
    if old.role::text is distinct from new.role::text then
      insert into public.enrollment_history (course_id, user_id, event_kind, role_before, role_after, actor_id)
      values (new.course_id, new.user_id, 'role_change', old.role::text, new.role::text, auth.uid());
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.enrollment_history (course_id, user_id, event_kind, role_before, actor_id)
    values (old.course_id, old.user_id, 'drop', old.role::text, auth.uid());
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists course_members_audit_trg on public.course_members;
create trigger course_members_audit_trg
  after insert or update or delete on public.course_members
  for each row execute function public.course_members_audit_touch();


-- ════════════════════════════════════════════════════════════
-- 20260520150200_wave7_webhooks_offline_packs.sql
-- ════════════════════════════════════════════════════════════
-- Wave 7：outbound webhooks + 行動端離線資料包

-- ============================================================
-- 14. webhook_subscriptions（外部系統訂閱事件）
-- ============================================================
create table if not exists public.webhook_subscriptions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  endpoint_url text not null,
  signing_secret text not null,
  event_types text[] not null default array[
    'grade_score_changed',
    'announcement_published',
    'assignment_submitted',
    'quiz_attempt_submitted',
    'enrollment_changed',
    'badge_awarded',
    'live_session_started'
  ],
  is_active boolean not null default true,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

alter table public.webhook_subscriptions enable row level security;

drop policy if exists webhook_subscriptions_admin_all on public.webhook_subscriptions;
create policy webhook_subscriptions_admin_all on public.webhook_subscriptions
  for all using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- 派發 outbox（與 alert_dispatch_outbox 同模式，但事件型）
create table if not exists public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.webhook_subscriptions (id) on delete cascade,
  event_type text not null,
  payload jsonb not null,
  attempt_count integer not null default 0,
  last_status integer,
  last_error text,
  last_attempted_at timestamptz,
  delivered_at timestamptz,
  abandoned_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists webhook_deliveries_pending_idx
  on public.webhook_deliveries (created_at)
  where delivered_at is null and abandoned_at is null;

alter table public.webhook_deliveries enable row level security;

drop policy if exists webhook_deliveries_admin_select on public.webhook_deliveries;
create policy webhook_deliveries_admin_select on public.webhook_deliveries
  for select using (public.is_platform_admin());

revoke insert, update, delete on public.webhook_deliveries from authenticated;

-- 給 Edge function 用：認領下一筆未派發
create or replace function public.webhook_deliveries_claim_next()
returns public.webhook_deliveries
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.webhook_deliveries;
begin
  if not (public.is_platform_admin()
    or current_setting('request.jwt.claim.role', true) in ('service_role', 'postgres')) then
    raise exception 'forbidden';
  end if;

  select * into v_row
  from public.webhook_deliveries
  where delivered_at is null and abandoned_at is null
  order by created_at asc
  for update skip locked
  limit 1;

  return v_row;
end;
$$;

revoke execute on function public.webhook_deliveries_claim_next() from public;
grant execute on function public.webhook_deliveries_claim_next() to authenticated;

create or replace function public.webhook_deliveries_mark(
  p_id uuid,
  p_status integer,
  p_error text,
  p_delivered boolean,
  p_abandon boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_platform_admin()
    or current_setting('request.jwt.claim.role', true) in ('service_role', 'postgres')) then
    raise exception 'forbidden';
  end if;

  update public.webhook_deliveries
  set attempt_count = attempt_count + 1,
      last_status = p_status,
      last_error = p_error,
      last_attempted_at = now(),
      delivered_at = case when p_delivered then now() else delivered_at end,
      abandoned_at = case when p_abandon then now() else abandoned_at end
  where id = p_id;
end;
$$;

revoke execute on function public.webhook_deliveries_mark(uuid, integer, text, boolean, boolean) from public;
grant execute on function public.webhook_deliveries_mark(uuid, integer, text, boolean, boolean) to authenticated;

-- 通用事件入列函式：trigger 呼叫此函式 fanout 給所有訂閱該 event_type 的 subscription
create or replace function public.enqueue_webhook_event(p_event_type text, p_payload jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  v_n integer := 0;
begin
  for s in
    select id from public.webhook_subscriptions
    where is_active = true and p_event_type = any (event_types)
  loop
    insert into public.webhook_deliveries (subscription_id, event_type, payload)
    values (s.id, p_event_type, coalesce(p_payload, '{}'::jsonb));
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- 範例 trigger：成績變更觸發
create or replace function public.webhook_grade_score_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.enqueue_webhook_event(
    'grade_score_changed',
    jsonb_build_object(
      'grade_item_id', new.grade_item_id,
      'student_id', new.student_id,
      'score_new', new.score,
      'score_old', case when tg_op = 'UPDATE' then old.score else null end,
      'op', tg_op
    )
  );
  return new;
end;
$$;

drop trigger if exists grade_scores_webhook_trg on public.grade_scores;
create trigger grade_scores_webhook_trg
  after insert or update on public.grade_scores
  for each row execute function public.webhook_grade_score_changed();

-- 範例 trigger：徽章授徽
create or replace function public.webhook_badge_awarded()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.enqueue_webhook_event(
    'badge_awarded',
    jsonb_build_object(
      'award_id', new.id,
      'badge_id', new.badge_id,
      'recipient_id', new.recipient_id,
      'awarded_at', new.awarded_at
    )
  );
  return new;
end;
$$;

drop trigger if exists course_badge_awards_webhook_trg on public.course_badge_awards;
create trigger course_badge_awards_webhook_trg
  after insert on public.course_badge_awards
  for each row execute function public.webhook_badge_awarded();

-- ============================================================
-- 15. 行動端離線資料包（material_offline_packs）
-- ============================================================
create table if not exists public.material_offline_packs (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  unit_id uuid references public.course_units (id) on delete cascade,
  title text not null,
  zip_storage_path text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  checksum_sha256 text,
  expires_at timestamptz,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create index if not exists material_offline_packs_course_idx
  on public.material_offline_packs (course_id, created_at desc);

alter table public.material_offline_packs enable row level security;

drop policy if exists material_offline_packs_select on public.material_offline_packs;
create policy material_offline_packs_select on public.material_offline_packs
  for select using (public.is_course_member(course_id) or public.is_platform_admin());

drop policy if exists material_offline_packs_write_staff on public.material_offline_packs;
create policy material_offline_packs_write_staff on public.material_offline_packs
  for all using (public.course_member_has_capability(course_id, 'materials.publish'::text))
  with check (public.course_member_has_capability(course_id, 'materials.publish'::text));

-- 行動端下載紀錄（每位學生每個 pack 一筆）
create table if not exists public.material_offline_downloads (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references public.material_offline_packs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  downloaded_at timestamptz not null default now(),
  device_fingerprint text,
  unique (pack_id, user_id)
);

alter table public.material_offline_downloads enable row level security;

drop policy if exists material_offline_downloads_self_select on public.material_offline_downloads;
create policy material_offline_downloads_self_select on public.material_offline_downloads
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from public.material_offline_packs p
      where p.id = material_offline_downloads.pack_id and public.is_course_staff(p.course_id)
    )
    or public.is_platform_admin()
  );

drop policy if exists material_offline_downloads_insert_self on public.material_offline_downloads;
create policy material_offline_downloads_insert_self on public.material_offline_downloads
  for insert with check (user_id = auth.uid());


-- ════════════════════════════════════════════════════════════
-- 20260520160000_wave8_academic_catalog.sql
-- ════════════════════════════════════════════════════════════
-- Wave 8: 學術結構（學期／系所／班次／先修）+ 課程目錄／邀請碼／旁聽

-- ============================================================
-- 1. academic_terms（學年學期）
-- ============================================================
create table if not exists public.academic_terms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  display_name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.academic_terms enable row level security;

drop policy if exists academic_terms_select on public.academic_terms;
create policy academic_terms_select on public.academic_terms
  for select using (true);

drop policy if exists academic_terms_admin_write on public.academic_terms;
create policy academic_terms_admin_write on public.academic_terms
  for all using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- ============================================================
-- 2. departments（系所）
-- ============================================================
create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  parent_id uuid references public.departments (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.departments enable row level security;

drop policy if exists departments_select on public.departments;
create policy departments_select on public.departments
  for select using (true);

drop policy if exists departments_admin_write on public.departments;
create policy departments_admin_write on public.departments
  for all using (public.is_platform_admin())
  with check (public.is_platform_admin());

alter table public.courses
  add column if not exists term_id uuid references public.academic_terms (id) on delete set null,
  add column if not exists department_id uuid references public.departments (id) on delete set null,
  add column if not exists credit_hours numeric default 0 check (credit_hours >= 0),
  add column if not exists is_archived boolean not null default false;

create index if not exists courses_term_idx on public.courses (term_id) where term_id is not null;
create index if not exists courses_dept_idx on public.courses (department_id) where department_id is not null;

alter table public.profiles
  add column if not exists department_id uuid references public.departments (id) on delete set null,
  add column if not exists student_no text;

-- ============================================================
-- 3. course_sections（同課程的多個班次／梯次）
-- ============================================================
create table if not exists public.course_sections (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  section_code text not null,
  capacity integer,
  instructor_id uuid references public.profiles (id) on delete set null,
  meeting_time text,
  classroom text,
  created_at timestamptz not null default now(),
  unique (course_id, section_code)
);

alter table public.course_sections enable row level security;

drop policy if exists course_sections_select on public.course_sections;
create policy course_sections_select on public.course_sections
  for select using (public.is_course_member(course_id) or public.is_platform_admin());

drop policy if exists course_sections_write_staff on public.course_sections;
create policy course_sections_write_staff on public.course_sections
  for all using (public.is_course_staff(course_id))
  with check (public.is_course_staff(course_id));

alter table public.course_members
  add column if not exists section_id uuid references public.course_sections (id) on delete set null;

-- ============================================================
-- 4. course_prerequisites（先修課程）
-- ============================================================
create table if not exists public.course_prerequisites (
  course_id uuid not null references public.courses (id) on delete cascade,
  prerequisite_course_id uuid not null references public.courses (id) on delete cascade,
  min_weighted_percent numeric default 60 check (min_weighted_percent is null or min_weighted_percent between 0 and 100),
  is_required boolean not null default true,
  primary key (course_id, prerequisite_course_id),
  check (course_id <> prerequisite_course_id)
);

alter table public.course_prerequisites enable row level security;

drop policy if exists course_prerequisites_select on public.course_prerequisites;
create policy course_prerequisites_select on public.course_prerequisites
  for select using (true);

drop policy if exists course_prerequisites_admin_write on public.course_prerequisites;
create policy course_prerequisites_admin_write on public.course_prerequisites
  for all using (
    public.is_platform_admin() or public.is_course_teacher(course_id)
  )
  with check (
    public.is_platform_admin() or public.is_course_teacher(course_id)
  );

-- 檢查使用者是否滿足某課之所有 prerequisite
create or replace function public.user_meets_course_prerequisites(p_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1
    from public.course_prerequisites cp
    where cp.course_id = p_course_id
      and cp.is_required = true
      and not exists (
        select 1
        from public.course_grade_rollups r
        where r.course_id = cp.prerequisite_course_id
          and r.student_id = auth.uid()
          and coalesce(r.weighted_percent, 0) >= coalesce(cp.min_weighted_percent, 0)
      )
  );
$$;

grant execute on function public.user_meets_course_prerequisites(uuid) to authenticated;

-- ============================================================
-- 5. 課程目錄（catalog flag）＋邀請碼（enrollment code）＋旁聽（subscriptions）
-- ============================================================
alter table public.courses
  add column if not exists is_catalog_public boolean not null default false,
  add column if not exists catalog_summary text default '',
  add column if not exists enrollment_code text;

create unique index if not exists courses_enrollment_code_uidx
  on public.courses (enrollment_code) where enrollment_code is not null;

-- 旁聽訂閱（不是 course_members；無寫權限，僅追蹤更新）
create table if not exists public.course_subscriptions (
  course_id uuid not null references public.courses (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  subscribed_at timestamptz not null default now(),
  primary key (course_id, user_id)
);

alter table public.course_subscriptions enable row level security;

drop policy if exists course_subscriptions_self_select on public.course_subscriptions;
create policy course_subscriptions_self_select on public.course_subscriptions
  for select using (
    user_id = auth.uid()
    or public.is_course_staff(course_id)
    or public.is_platform_admin()
  );

drop policy if exists course_subscriptions_self_insert on public.course_subscriptions;
create policy course_subscriptions_self_insert on public.course_subscriptions
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.courses c
      where c.id = course_id and c.is_catalog_public = true
    )
  );

drop policy if exists course_subscriptions_self_delete on public.course_subscriptions;
create policy course_subscriptions_self_delete on public.course_subscriptions
  for delete using (user_id = auth.uid());

-- 邀請碼自助加入 RPC（先檢查 prerequisites）
create or replace function public.enroll_by_code(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course uuid;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  if p_code is null or length(trim(p_code)) < 3 then raise exception 'invalid code'; end if;

  select id into v_course from public.courses where enrollment_code = trim(p_code) and is_archived = false;
  if v_course is null then raise exception 'invalid or archived code'; end if;

  if not public.user_meets_course_prerequisites(v_course) then
    raise exception '尚未滿足先修課程要求';
  end if;

  insert into public.course_members (course_id, user_id, role)
  values (v_course, auth.uid(), 'student')
  on conflict (course_id, user_id) do nothing;

  return v_course;
end;
$$;

grant execute on function public.enroll_by_code(text) to authenticated;

-- 課程目錄公開查詢（is_catalog_public=true 的列任何人皆可看 metadata）
create or replace view public.public_course_catalog as
select
  c.id,
  c.title,
  c.description,
  c.catalog_summary,
  c.credit_hours,
  c.term_id,
  c.department_id,
  c.is_archived
from public.courses c
where c.is_catalog_public = true and c.is_archived = false;

comment on view public.public_course_catalog is
  '公開課程目錄；非機敏欄位，未登入亦可查';

grant select on public.public_course_catalog to anon, authenticated;


-- ════════════════════════════════════════════════════════════
-- 20260520160100_wave8_at_risk_group_proctor_publish.sql
-- ════════════════════════════════════════════════════════════
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


-- ════════════════════════════════════════════════════════════
-- 20260520160200_wave8_ai_search_outcomes_prefs.sql
-- ════════════════════════════════════════════════════════════
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

