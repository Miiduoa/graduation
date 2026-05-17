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
