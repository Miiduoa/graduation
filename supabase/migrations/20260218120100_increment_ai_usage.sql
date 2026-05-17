-- Callable only by service_role (Edge Functions); increments daily AI counter atomically.

create or replace function public.increment_ai_usage(p_uid uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := (timezone('utc', now()))::date;
  v_cnt integer;
begin
  insert into public.ai_usage_daily (user_id, usage_date, requests)
  values (p_uid, v_day, 1)
  on conflict (user_id, usage_date)
  do update set requests = public.ai_usage_daily.requests + 1
  returning requests into v_cnt;

  return coalesce(v_cnt, 0);
end;
$$;

revoke all on function public.increment_ai_usage(uuid) from public;
grant execute on function public.increment_ai_usage(uuid) to service_role;
