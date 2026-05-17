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
