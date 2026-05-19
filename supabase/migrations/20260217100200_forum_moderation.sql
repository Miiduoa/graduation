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
