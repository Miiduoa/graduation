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
