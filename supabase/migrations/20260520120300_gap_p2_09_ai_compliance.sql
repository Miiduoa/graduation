-- GAP_P2_09: AI 字幕／切段／合規（PII 屏蔽、retention、跨境保存旗標、quota 監控）
-- 對齊：scripts/tronclass-parity-matrix.txt 將 GAP_P2_09 由「示範可跑」昇為「合規可驗收」。

-- ── AI 合規組態（單列；後續若分租戶可擴成多列） ──────────────────────
create table if not exists public.ai_compliance_policies (
  id text primary key default 'default',
  enabled boolean not null default true,
  daily_user_limit integer not null default 30 check (daily_user_limit > 0),
  monthly_course_limit integer check (monthly_course_limit is null or monthly_course_limit > 0),
  retention_days_transcript integer not null default 30 check (retention_days_transcript >= 0),
  retention_days_segments integer not null default 90 check (retention_days_segments >= 0),
  pii_redaction_required boolean not null default true,
  cross_border_storage_allowed boolean not null default false,
  cross_border_region text default null,
  consent_text text not null default '我已瞭解此影音將傳送至雲端 AI 服務進行轉寫與摘要，並承擔相關個資與著作權之合理使用責任。',
  data_processor_name text not null default 'OpenAI Whisper + Chat Completions',
  updated_at timestamptz not null default now()
);

alter table public.ai_compliance_policies enable row level security;

drop policy if exists ai_compliance_policies_select on public.ai_compliance_policies;
create policy ai_compliance_policies_select on public.ai_compliance_policies
  for select using (true);

drop policy if exists ai_compliance_policies_admin_write on public.ai_compliance_policies;
create policy ai_compliance_policies_admin_write on public.ai_compliance_policies
  for all using (public.is_platform_admin())
  with check (public.is_platform_admin());

insert into public.ai_compliance_policies (id) values ('default')
on conflict (id) do nothing;

-- ── 同意紀錄（每使用者每組態版本一次性記錄；可審計） ──────────────────
create table if not exists public.ai_consent_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  consent_version text not null default 'v1',
  consent_text_hash text not null,
  user_consented boolean not null,
  ip_addr inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists ai_consent_log_user_idx on public.ai_consent_log (user_id, created_at desc);

alter table public.ai_consent_log enable row level security;

drop policy if exists ai_consent_log_self_select on public.ai_consent_log;
create policy ai_consent_log_self_select on public.ai_consent_log
  for select using (user_id = auth.uid() or public.is_platform_admin());

drop policy if exists ai_consent_log_self_insert on public.ai_consent_log;
create policy ai_consent_log_self_insert on public.ai_consent_log
  for insert with check (user_id = auth.uid());

revoke update, delete on public.ai_consent_log from authenticated;

-- ── 增量 retention／PII 欄位於 material_ai_enrichment ───────────────
alter table public.material_ai_enrichment
  add column if not exists transcript_purge_after timestamptz;

alter table public.material_ai_enrichment
  add column if not exists segments_purge_after timestamptz;

alter table public.material_ai_enrichment
  add column if not exists pii_redacted boolean not null default false;

alter table public.material_ai_enrichment
  add column if not exists cross_border_flag boolean not null default false;

alter table public.material_ai_enrichment
  add column if not exists region_stored text;

comment on column public.material_ai_enrichment.transcript_purge_after is
  '字幕／逐字稿之保留到期日；到期由 admin_purge_expired_ai 清空 subtitle_vtt';

comment on column public.material_ai_enrichment.segments_purge_after is
  '切段摘要之保留到期日；到期由 admin_purge_expired_ai 清空 segments';

-- ── Trigger：寫入時依組態自動帶上 retention purge timestamps ────────
create or replace function public.material_ai_enrichment_apply_policy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pol record;
begin
  select * into v_pol
  from public.ai_compliance_policies
  where id = 'default';

  if v_pol.id is null then
    return new;
  end if;

  -- transcript／segments 預設套用保留期；若 subtitle/segments 為空則不設
  if new.subtitle_vtt is not null and v_pol.retention_days_transcript > 0 then
    new.transcript_purge_after := coalesce(
      new.transcript_purge_after,
      now() + make_interval(days => v_pol.retention_days_transcript)
    );
  end if;

  if jsonb_array_length(coalesce(new.segments, '[]'::jsonb)) > 0
     and v_pol.retention_days_segments > 0 then
    new.segments_purge_after := coalesce(
      new.segments_purge_after,
      now() + make_interval(days => v_pol.retention_days_segments)
    );
  end if;

  -- 跨境保存旗標：若組態不允許但 region_stored 不為空，警告
  if v_pol.cross_border_storage_allowed = false
     and new.region_stored is not null
     and new.region_stored <> '' then
    new.cross_border_flag := true;
  end if;

  return new;
end;
$$;

drop trigger if exists material_ai_enrichment_policy_trg on public.material_ai_enrichment;
create trigger material_ai_enrichment_policy_trg
  before insert or update on public.material_ai_enrichment
  for each row execute function public.material_ai_enrichment_apply_policy();

-- ── 清掃過期 transcript／segments（建議 pg_cron 每日呼叫） ─────────────
create or replace function public.admin_purge_expired_ai()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transcripts integer := 0;
  v_segments integer := 0;
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'forbidden';
  end if;

  update public.material_ai_enrichment
  set subtitle_vtt = null
  where transcript_purge_after is not null
    and transcript_purge_after < now()
    and subtitle_vtt is not null;

  get diagnostics v_transcripts = row_count;

  update public.material_ai_enrichment
  set segments = '[]'::jsonb
  where segments_purge_after is not null
    and segments_purge_after < now()
    and jsonb_array_length(coalesce(segments, '[]'::jsonb)) > 0;

  get diagnostics v_segments = row_count;

  return jsonb_build_object(
    'transcripts_purged', v_transcripts,
    'segments_purged', v_segments
  );
end;
$$;

revoke execute on function public.admin_purge_expired_ai() from public;
grant execute on function public.admin_purge_expired_ai() to authenticated;

comment on function public.admin_purge_expired_ai() is
  '清空已逾保留期之 AI 字幕／切段摘要欄位（不刪 row；保留稽核欄位）';

-- ── 同意紀錄寫入 RPC（給 Edge function／App 呼叫；hash 內容比對組態版本） ─
create or replace function public.record_ai_consent(
  p_consent_version text,
  p_consent_text_hash text,
  p_user_consented boolean,
  p_ip text,
  p_user_agent text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_ip inet;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated';
  end if;

  begin
    v_ip := nullif(p_ip, '')::inet;
  exception when others then
    v_ip := null;
  end;

  insert into public.ai_consent_log (
    user_id, consent_version, consent_text_hash, user_consented,
    ip_addr, user_agent
  )
  values (
    auth.uid(),
    coalesce(p_consent_version, 'v1'),
    coalesce(p_consent_text_hash, ''),
    coalesce(p_user_consented, false),
    v_ip,
    nullif(p_user_agent, '')
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.record_ai_consent(text, text, boolean, text, text) from public;
grant execute on function public.record_ai_consent(text, text, boolean, text, text) to authenticated;

-- ── Quota 監控視圖（給 Admin AI dashboard 查超限風險） ─────────────────
create or replace view public.reporting_ai_quota_overview as
select
  u.user_id,
  u.usage_date,
  u.requests,
  p.daily_user_limit as quota,
  (u.requests::float / nullif(p.daily_user_limit, 0)) as utilization,
  case when u.requests >= p.daily_user_limit then true else false end as over_limit
from public.ai_usage_daily u
cross join (select daily_user_limit from public.ai_compliance_policies where id = 'default') p;

comment on view public.reporting_ai_quota_overview is
  '日 AI usage vs. quota；over_limit=true 表示已達當日上限';

grant select on public.reporting_ai_quota_overview to authenticated;

create or replace function public.admin_ai_quota_overview()
returns table (
  user_id uuid,
  usage_date date,
  requests integer,
  quota integer,
  utilization double precision,
  over_limit boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select v.user_id, v.usage_date, v.requests, v.quota, v.utilization, v.over_limit
  from public.reporting_ai_quota_overview v
  where public.is_platform_admin()
  order by v.over_limit desc, v.utilization desc nulls last, v.usage_date desc
  limit 500;
$$;

revoke execute on function public.admin_ai_quota_overview() from public;
grant execute on function public.admin_ai_quota_overview() to authenticated;
