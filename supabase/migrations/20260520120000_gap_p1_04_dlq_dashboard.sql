-- GAP_P1_04: 推播 DLQ 深化（重試曲線視圖、保留期、批次重試／取消、外部告警鉤點）
-- 對齊：scripts/tronclass-parity-matrix.txt 將 GAP_P1_04 由「可用」昇為「商用儀表完成」。

-- ── 通知派發保留期欄位（DLQ 自動清掃用） ─────────────────────────────
alter table public.notifications
  add column if not exists push_dispatch_purge_after timestamptz;

comment on column public.notifications.push_dispatch_purge_after is
  '若不為 NULL：到期後將由背景排程移除 DLQ 條目（不影響站內通知本體）';

-- ── 重試曲線視圖（24h／7d 桶累計），供 Admin 圖表使用 ─────────────────
create or replace view public.reporting_push_dispatch_retry_curve as
select
  date_trunc('hour', created_at) as bucket_hour,
  status,
  count(*)::integer as event_count
from public.notification_push_logs
where created_at >= now() - interval '7 days'
group by 1, 2;

comment on view public.reporting_push_dispatch_retry_curve is
  '近 7 日推播派發事件按小時分桶累計（attempted/success/failed）';

grant select on public.reporting_push_dispatch_retry_curve to authenticated;

-- ── 直接讀 view RLS 限制：只給 platform admin ───────────────────────
-- view 本身無 RLS；改以 SECURITY DEFINER function 包裝
create or replace function public.admin_push_retry_curve(p_hours integer default 48)
returns table (
  bucket_hour timestamptz,
  status text,
  event_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  select v.bucket_hour, v.status, v.event_count
  from public.reporting_push_dispatch_retry_curve v
  where public.is_platform_admin()
    and v.bucket_hour >= now() - make_interval(hours => greatest(coalesce(p_hours, 48), 1))
  order by v.bucket_hour asc, v.status asc;
$$;

revoke execute on function public.admin_push_retry_curve(integer) from public;
grant execute on function public.admin_push_retry_curve(integer) to authenticated;

-- ── 批次重試 RPC（最多 200 列；只動尚未 dispatched 之列） ─────────────
create or replace function public.admin_bulk_retry_notification_dispatch(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer := 0;
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'forbidden';
  end if;

  if p_ids is null or cardinality(p_ids) = 0 then
    return 0;
  end if;

  if cardinality(p_ids) > 200 then
    raise exception 'too many ids; batch cap is 200';
  end if;

  update public.notifications
  set
    push_dispatch_abandoned_at = null,
    push_dispatch_error = null,
    push_dispatch_attempts = 0,
    push_dispatch_purge_after = null
  where id = any (p_ids)
    and push_dispatched_at is null;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke execute on function public.admin_bulk_retry_notification_dispatch(uuid[]) from public;
grant execute on function public.admin_bulk_retry_notification_dispatch(uuid[]) to authenticated;

comment on function public.admin_bulk_retry_notification_dispatch(uuid[]) is
  '平台管理員批次清除尚未派發完成之通知重試鎖（最多 200）。';

-- ── 批次取消（標記放棄，停止後續派發）RPC ───────────────────────────
create or replace function public.admin_bulk_cancel_notification_dispatch(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer := 0;
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'forbidden';
  end if;

  if p_ids is null or cardinality(p_ids) = 0 then
    return 0;
  end if;

  if cardinality(p_ids) > 200 then
    raise exception 'too many ids; batch cap is 200';
  end if;

  update public.notifications
  set
    push_dispatch_abandoned_at = coalesce(push_dispatch_abandoned_at, now()),
    push_dispatch_error = coalesce(push_dispatch_error, 'cancelled_by_admin')
  where id = any (p_ids)
    and push_dispatched_at is null;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke execute on function public.admin_bulk_cancel_notification_dispatch(uuid[]) from public;
grant execute on function public.admin_bulk_cancel_notification_dispatch(uuid[]) to authenticated;

comment on function public.admin_bulk_cancel_notification_dispatch(uuid[]) is
  '平台管理員批次標記放棄派發，停止後續重試。';

-- ── DLQ 保留期清掃排程（手動或 pg_cron 呼叫） ─────────────────────────
create or replace function public.admin_purge_expired_dlq()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_removed integer := 0;
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'forbidden';
  end if;

  delete from public.notification_push_logs
  using public.notifications n
  where notification_push_logs.notification_id = n.id
    and n.push_dispatch_purge_after is not null
    and n.push_dispatch_purge_after < now();

  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

revoke execute on function public.admin_purge_expired_dlq() from public;
grant execute on function public.admin_purge_expired_dlq() to authenticated;

comment on function public.admin_purge_expired_dlq() is
  '清除已過保留期之 push 派發 log；建議由 pg_cron 每日呼叫。';

-- ── 外部告警鉤點：alert_dispatch_outbox（webhook／Datadog／Slack 抓取） ──
create table if not exists public.alert_dispatch_outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('push_dlq_exhausted', 'push_dlq_stuck', 'ai_quota_exceeded')),
  payload jsonb not null default '{}'::jsonb,
  delivered_at timestamptz,
  delivery_attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now()
);

create index if not exists alert_dispatch_outbox_pending_idx
  on public.alert_dispatch_outbox (created_at asc)
  where delivered_at is null;

alter table public.alert_dispatch_outbox enable row level security;

drop policy if exists alert_dispatch_outbox_admin_select on public.alert_dispatch_outbox;
create policy alert_dispatch_outbox_admin_select on public.alert_dispatch_outbox
  for select using (public.is_platform_admin());

revoke insert, update, delete on public.alert_dispatch_outbox from anon, authenticated;

comment on table public.alert_dispatch_outbox is
  'Dispatch 函式或排程寫入告警；外部 webhook（Datadog／Slack）由 Edge 拉取後標 delivered_at';

-- ── Trigger：當通知被標記為「放棄」時自動寫一筆告警 ──────────────────
create or replace function public.push_notification_abandon_alert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.push_dispatch_abandoned_at is not null
    and (old.push_dispatch_abandoned_at is null
         or old.push_dispatch_abandoned_at is distinct from new.push_dispatch_abandoned_at) then
    insert into public.alert_dispatch_outbox (kind, payload)
    values (
      'push_dlq_exhausted',
      jsonb_build_object(
        'notification_id', new.id,
        'user_id', new.user_id,
        'title', left(coalesce(new.title, ''), 200),
        'attempts', new.push_dispatch_attempts,
        'error', new.push_dispatch_error,
        'abandoned_at', new.push_dispatch_abandoned_at
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists notifications_abandon_alert_trg on public.notifications;
create trigger notifications_abandon_alert_trg
  after update of push_dispatch_abandoned_at on public.notifications
  for each row execute function public.push_notification_abandon_alert();

-- ── DLQ 摘要快查（給 Admin Dashboard banner 用） ─────────────────────
create or replace function public.admin_dlq_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not public.is_platform_admin() then jsonb_build_object('error', 'forbidden')
    else jsonb_build_object(
      'pending_total', (
        select count(*) from public.notifications
        where push_dispatched_at is null and push_dispatch_abandoned_at is null
      ),
      'stuck_ge3', (
        select count(*) from public.notifications
        where push_dispatched_at is null and push_dispatch_abandoned_at is null
          and push_dispatch_attempts >= 3
      ),
      'exhausted_total', (
        select count(*) from public.notifications
        where push_dispatched_at is null and push_dispatch_abandoned_at is not null
      ),
      'logs_last_24h', (
        select count(*) from public.notification_push_logs where created_at >= now() - interval '24 hours'
      ),
      'alerts_pending', (
        select count(*) from public.alert_dispatch_outbox where delivered_at is null
      )
    )
  end;
$$;

revoke execute on function public.admin_dlq_summary() from public;
grant execute on function public.admin_dlq_summary() to authenticated;

comment on function public.admin_dlq_summary() is
  '平台管理員 dashboard 用：DLQ／告警一次性摘要';
