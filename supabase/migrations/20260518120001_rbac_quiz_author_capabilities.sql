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
