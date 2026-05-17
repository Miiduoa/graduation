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
