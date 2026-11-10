-- 私人檔案（限動、群組封面、群組貼文附件、群組作業附件）改存 Supabase Storage。
-- 只建立私有 bucket，不新增任何 storage.objects 政策：
-- anon／authenticated 一律無法直接讀寫，只能透過 nuni-web 驗權後簽發的短效網址存取。
-- 單檔上限 45 MiB（與 packages/shared 的最大類型上限一致，低於免費方案 50 MB）。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'private-files',
  'private-files',
  false,
  47185920,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
    'video/mp4', 'video/quicktime', 'video/webm',
    'application/pdf', 'text/plain',
    'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
)
on conflict (id) do nothing;
