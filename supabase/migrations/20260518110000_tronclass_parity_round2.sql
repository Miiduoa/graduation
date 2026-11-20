-- Parity round 2: admin DLQ retry RPC, RBAC grade structure capabilities, reporting flat view.

-- ── Admin：復原未完成派發之通知的重試狀態（已 dispatched 者不變動） ───────────────

create or replace function public.admin_retry_notification_dispatch (p_notification_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer := 0;
begin
  if auth.uid () is null or not public.is_platform_admin () then
    raise exception 'forbidden';
  end if;

  update public.notifications
  set
    push_dispatch_abandoned_at = null,
    push_dispatch_error = null,
    push_dispatch_attempts = 0
  where id = p_notification_id
    and push_dispatched_at is null;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

comment on function public.admin_retry_notification_dispatch (uuid) is
  '平台管理員清除未完成派發列之放棄旗標與重試計數，供下次 dispatch 取用。';

revoke execute on function public.admin_retry_notification_dispatch (uuid) from public;
grant execute on function public.admin_retry_notification_dispatch (uuid) to authenticated;

-- ── 成績「結構」維護改走 course_member_has_capability(..., grades.structure) ──
-- moderator／assistant／student 對照 course_role_capabilities 預設；教師為 true。

drop policy if exists grade_categories_write_teacher on public.grade_categories;

create policy grade_categories_write_teacher on public.grade_categories
  for all using (public.course_member_has_capability (course_id, 'grades.structure'::text))
  with check (public.course_member_has_capability (course_id, 'grades.structure'::text));

drop policy if exists grade_items_write_teacher on public.grade_items;

create policy grade_items_write_teacher on public.grade_items
  for all using (
    exists (
      select 1
      from public.grade_categories gc
      where gc.id = grade_items.category_id
        and public.course_member_has_capability (gc.course_id, 'grades.structure'::text)
    )
  )
  with check (
    exists (
      select 1
      from public.grade_categories gc
      where gc.id = grade_items.category_id
        and public.course_member_has_capability (gc.course_id, 'grades.structure'::text)
    )
  );

-- ── Reporting：項目級平坦視圖（RLS 由 grade_scores／items 強制） ───────────────

create or replace view public.reporting_grade_course_item_scores as
select
  gc.course_id,
  gc.id as category_id,
  gc.name as category_title,
  gi.id as grade_item_id,
  gi.title as item_title,
  gi.max_points,
  gs.student_id,
  gs.score,
  gs.updated_at as score_updated_at
from public.grade_scores gs
join public.grade_items gi on gi.id = gs.grade_item_id
join public.grade_categories gc on gc.id = gi.category_id;

comment on view public.reporting_grade_course_item_scores is
  '管理員／課程權責者查項目級 score 明細之用；資料列仍可見性受底層 RLS。';

grant select on public.reporting_grade_course_item_scores to authenticated;
