-- Wave 7：outbound webhooks + 行動端離線資料包

-- ============================================================
-- 14. webhook_subscriptions（外部系統訂閱事件）
-- ============================================================
create table if not exists public.webhook_subscriptions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  endpoint_url text not null,
  signing_secret text not null,
  event_types text[] not null default array[
    'grade_score_changed',
    'announcement_published',
    'assignment_submitted',
    'quiz_attempt_submitted',
    'enrollment_changed',
    'badge_awarded',
    'live_session_started'
  ],
  is_active boolean not null default true,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

alter table public.webhook_subscriptions enable row level security;

drop policy if exists webhook_subscriptions_admin_all on public.webhook_subscriptions;
create policy webhook_subscriptions_admin_all on public.webhook_subscriptions
  for all using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- 派發 outbox（與 alert_dispatch_outbox 同模式，但事件型）
create table if not exists public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.webhook_subscriptions (id) on delete cascade,
  event_type text not null,
  payload jsonb not null,
  attempt_count integer not null default 0,
  last_status integer,
  last_error text,
  last_attempted_at timestamptz,
  delivered_at timestamptz,
  abandoned_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists webhook_deliveries_pending_idx
  on public.webhook_deliveries (created_at)
  where delivered_at is null and abandoned_at is null;

alter table public.webhook_deliveries enable row level security;

drop policy if exists webhook_deliveries_admin_select on public.webhook_deliveries;
create policy webhook_deliveries_admin_select on public.webhook_deliveries
  for select using (public.is_platform_admin());

revoke insert, update, delete on public.webhook_deliveries from authenticated;

-- 給 Edge function 用：認領下一筆未派發
create or replace function public.webhook_deliveries_claim_next()
returns public.webhook_deliveries
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.webhook_deliveries;
begin
  if not (public.is_platform_admin()
    or current_setting('request.jwt.claim.role', true) in ('service_role', 'postgres')) then
    raise exception 'forbidden';
  end if;

  select * into v_row
  from public.webhook_deliveries
  where delivered_at is null and abandoned_at is null
  order by created_at asc
  for update skip locked
  limit 1;

  return v_row;
end;
$$;

revoke execute on function public.webhook_deliveries_claim_next() from public;
grant execute on function public.webhook_deliveries_claim_next() to authenticated;

create or replace function public.webhook_deliveries_mark(
  p_id uuid,
  p_status integer,
  p_error text,
  p_delivered boolean,
  p_abandon boolean
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

  update public.webhook_deliveries
  set attempt_count = attempt_count + 1,
      last_status = p_status,
      last_error = p_error,
      last_attempted_at = now(),
      delivered_at = case when p_delivered then now() else delivered_at end,
      abandoned_at = case when p_abandon then now() else abandoned_at end
  where id = p_id;
end;
$$;

revoke execute on function public.webhook_deliveries_mark(uuid, integer, text, boolean, boolean) from public;
grant execute on function public.webhook_deliveries_mark(uuid, integer, text, boolean, boolean) to authenticated;

-- 通用事件入列函式：trigger 呼叫此函式 fanout 給所有訂閱該 event_type 的 subscription
create or replace function public.enqueue_webhook_event(p_event_type text, p_payload jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  v_n integer := 0;
begin
  for s in
    select id from public.webhook_subscriptions
    where is_active = true and p_event_type = any (event_types)
  loop
    insert into public.webhook_deliveries (subscription_id, event_type, payload)
    values (s.id, p_event_type, coalesce(p_payload, '{}'::jsonb));
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- 範例 trigger：成績變更觸發
create or replace function public.webhook_grade_score_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.enqueue_webhook_event(
    'grade_score_changed',
    jsonb_build_object(
      'grade_item_id', new.grade_item_id,
      'student_id', new.student_id,
      'score_new', new.score,
      'score_old', case when tg_op = 'UPDATE' then old.score else null end,
      'op', tg_op
    )
  );
  return new;
end;
$$;

drop trigger if exists grade_scores_webhook_trg on public.grade_scores;
create trigger grade_scores_webhook_trg
  after insert or update on public.grade_scores
  for each row execute function public.webhook_grade_score_changed();

-- 範例 trigger：徽章授徽
create or replace function public.webhook_badge_awarded()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.enqueue_webhook_event(
    'badge_awarded',
    jsonb_build_object(
      'award_id', new.id,
      'badge_id', new.badge_id,
      'recipient_id', new.recipient_id,
      'awarded_at', new.awarded_at
    )
  );
  return new;
end;
$$;

drop trigger if exists course_badge_awards_webhook_trg on public.course_badge_awards;
create trigger course_badge_awards_webhook_trg
  after insert on public.course_badge_awards
  for each row execute function public.webhook_badge_awarded();

-- ============================================================
-- 15. 行動端離線資料包（material_offline_packs）
-- ============================================================
create table if not exists public.material_offline_packs (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  unit_id uuid references public.course_units (id) on delete cascade,
  title text not null,
  zip_storage_path text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  checksum_sha256 text,
  expires_at timestamptz,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create index if not exists material_offline_packs_course_idx
  on public.material_offline_packs (course_id, created_at desc);

alter table public.material_offline_packs enable row level security;

drop policy if exists material_offline_packs_select on public.material_offline_packs;
create policy material_offline_packs_select on public.material_offline_packs
  for select using (public.is_course_member(course_id) or public.is_platform_admin());

drop policy if exists material_offline_packs_write_staff on public.material_offline_packs;
create policy material_offline_packs_write_staff on public.material_offline_packs
  for all using (public.course_member_has_capability(course_id, 'materials.publish'::text))
  with check (public.course_member_has_capability(course_id, 'materials.publish'::text));

-- 行動端下載紀錄（每位學生每個 pack 一筆）
create table if not exists public.material_offline_downloads (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references public.material_offline_packs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  downloaded_at timestamptz not null default now(),
  device_fingerprint text,
  unique (pack_id, user_id)
);

alter table public.material_offline_downloads enable row level security;

drop policy if exists material_offline_downloads_self_select on public.material_offline_downloads;
create policy material_offline_downloads_self_select on public.material_offline_downloads
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from public.material_offline_packs p
      where p.id = material_offline_downloads.pack_id and public.is_course_staff(p.course_id)
    )
    or public.is_platform_admin()
  );

drop policy if exists material_offline_downloads_insert_self on public.material_offline_downloads;
create policy material_offline_downloads_insert_self on public.material_offline_downloads
  for insert with check (user_id = auth.uid());
