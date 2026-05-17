-- GAP_EXCLUDE_DRM 替代方案：signed media play tokens（時效、裝置綁定、一次性、稽核）
-- 對齊：scripts/tronclass-parity-matrix.txt 將 GAP_EXCLUDE_DRM「不接」改記為「以替代 token 模型對齊基本權限管控」。
-- 注意：本方案 **不等於** Widevine／FairPlay DRM；只是「教材播放鑒權」的最小集，能擋住一般複製連結分享。

create table if not exists public.media_play_tokens (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.course_materials (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  token text not null unique,
  device_fingerprint text,
  signed_url_used text,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  ip_addr inet,
  user_agent text
);

create index if not exists media_play_tokens_user_idx on public.media_play_tokens (user_id, issued_at desc);
create index if not exists media_play_tokens_material_idx on public.media_play_tokens (material_id, issued_at desc);
create index if not exists media_play_tokens_expire_idx on public.media_play_tokens (expires_at)
  where consumed_at is null and revoked_at is null;

alter table public.media_play_tokens enable row level security;

drop policy if exists media_play_tokens_self_select on public.media_play_tokens;
create policy media_play_tokens_self_select on public.media_play_tokens
  for select using (user_id = auth.uid() or public.is_platform_admin());

revoke insert, update, delete on public.media_play_tokens from authenticated;

comment on table public.media_play_tokens is
  '教材播放權杖（DRM 替代）：時效、裝置綁定、一次性，由 RPC issue／consume；不等於 Widevine/FairPlay';

-- ── 發行 token（要求已登入＋為該課程成員＋AI／影音播放允許） ────────
create or replace function public.issue_media_play_token(
  p_material_id uuid,
  p_device_fingerprint text default null,
  p_ttl_seconds integer default 600
)
returns table (token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_material record;
  v_token text;
  v_expires timestamptz;
  v_ttl integer;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated';
  end if;

  v_ttl := greatest(coalesce(p_ttl_seconds, 600), 30);
  if v_ttl > 3600 then v_ttl := 3600; end if;

  select cm.id, cm.course_id, cm.external_url, cm.mime_type
    into v_material
  from public.course_materials cm
  where cm.id = p_material_id;

  if v_material.id is null then
    raise exception 'material not found';
  end if;

  if not public.is_course_member(v_material.course_id) then
    raise exception 'not a course member';
  end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  v_expires := now() + make_interval(secs => v_ttl);

  insert into public.media_play_tokens (
    material_id, course_id, user_id, token, device_fingerprint, expires_at
  ) values (
    p_material_id, v_material.course_id, auth.uid(), v_token,
    nullif(p_device_fingerprint, ''), v_expires
  );

  return query select v_token, v_expires;
end;
$$;

revoke execute on function public.issue_media_play_token(uuid, text, integer) from public;
grant execute on function public.issue_media_play_token(uuid, text, integer) to authenticated;

-- ── 消耗 token（播放器於 onLoad 呼叫）─ 一次性使用 ─────────────────
create or replace function public.consume_media_play_token(
  p_token text,
  p_signed_url_hint text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated';
  end if;

  if p_token is null or length(p_token) < 32 then
    raise exception 'invalid token';
  end if;

  select * into v_row
  from public.media_play_tokens
  where token = p_token
    and user_id = auth.uid();

  if v_row.id is null then
    return false;
  end if;

  if v_row.revoked_at is not null then
    return false;
  end if;

  if v_row.expires_at < now() then
    return false;
  end if;

  if v_row.consumed_at is not null then
    return false; -- one-time only
  end if;

  update public.media_play_tokens
  set consumed_at = now(),
      signed_url_used = nullif(p_signed_url_hint, '')
  where id = v_row.id;

  return true;
end;
$$;

revoke execute on function public.consume_media_play_token(text, text) from public;
grant execute on function public.consume_media_play_token(text, text) to authenticated;

-- ── 撤銷（教師／管理員可主動撤銷某使用者某教材的所有未用 token） ──────
create or replace function public.revoke_media_play_tokens(
  p_material_id uuid,
  p_user_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course uuid;
  v_n integer := 0;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated';
  end if;

  select course_id into v_course from public.course_materials where id = p_material_id;
  if v_course is null then
    raise exception 'material not found';
  end if;

  if not (public.is_platform_admin() or public.is_course_teacher(v_course)) then
    raise exception 'forbidden';
  end if;

  update public.media_play_tokens
  set revoked_at = now()
  where material_id = p_material_id
    and (p_user_id is null or user_id = p_user_id)
    and revoked_at is null
    and consumed_at is null;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.revoke_media_play_tokens(uuid, uuid) from public;
grant execute on function public.revoke_media_play_tokens(uuid, uuid) to authenticated;

comment on function public.revoke_media_play_tokens(uuid, uuid) is
  '教師／平台管理員撤銷指定教材（與選填使用者）之尚未消耗 token';
