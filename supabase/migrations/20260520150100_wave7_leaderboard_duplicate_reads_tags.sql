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
