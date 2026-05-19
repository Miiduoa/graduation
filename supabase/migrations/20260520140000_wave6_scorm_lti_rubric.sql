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
