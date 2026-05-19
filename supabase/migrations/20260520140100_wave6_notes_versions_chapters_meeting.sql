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
