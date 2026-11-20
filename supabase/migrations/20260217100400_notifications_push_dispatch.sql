-- Push dispatch bookkeeping for Edge Function workers

alter table public.notifications
  add column if not exists push_dispatched_at timestamptz;

comment on column public.notifications.push_dispatched_at is '若設定表示已嘗試透過 Expo Push 派發（不等於成功送達終端）';
