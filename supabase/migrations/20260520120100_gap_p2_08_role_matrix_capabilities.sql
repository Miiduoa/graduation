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
