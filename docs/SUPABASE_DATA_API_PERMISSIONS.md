# Supabase Data API 明確授權與重建驗證

## 盤點基準與結果

盤點日期：2026-10-21。基準為 `main` 的 `bcb33b260a3afb97f0ede58e9e476873f7ba8178`。

Supabase [官方公告](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically) 說明，2026-10-30 起既有專案的新建 `public` 資料表需要明確 GRANT，既存物件的 ACL 不會因此撤銷。Data API 包含 PostgREST、supabase-js 與 GraphQL；直接 PostgreSQL 連線不是這次設定的影響對象。

完整檢查 34 份歷史 migrations，其中 25 份建立資料表，找到 **103 張 public 實體表、15 個普通 view、1 個 materialized view**。103 張表均啟用 RLS；只有 `course_role_capabilities` 明確授予 authenticated SELECT，其他 102 張表完全沒有 table GRANT。前者其餘操作與 service_role 也依賴預設授權。沒有 serial、identity 或 application sequence，因此本次不新增 sequence grants。

表格授權與 RLS 分別決定「能否使用物件」與「能看／改哪一列」。service_role 的 BYPASSRLS 不取代表格權限，詳見 [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api)。本次以新增 migration 修復既有與新建環境，保留 34 份歷史 migrations。

## 實際呼叫方式與權限取捨

- Web `apps/web/src/app/lms-admin/` 保留 Data API 實作，但 `RequireAdmin.tsx` 目前不 mount 子頁面，安全身分連結尚未完成；`AuthGuard.tsx` 也會在身分切換時清除 Supabase session。
- Mobile LMS V2 頁面由 `LearnStack.tsx`／`developmentLmsRoute` 限定 development demo。AI 的 `supabaseLmsCache.ts`／`lmsV2WriteTools.ts` 則仍受 LMS feature flag 與 Supabase session 控制，沒有相同的全部 demo 限制。
- `packages/shared/src/lms/supabaseLmsAdapter.ts` 只轉換資料；`backend/functions/lmsV2/issueSupabaseJwt.js` 未從 Functions index 匯出。`_lms_v2_staged*` 與 `supabase/functions/_disabled/` 是保留程式，不視為正式部署證據。
- 用 anon key 建立 client 不表示登入後仍是 anon。所有私人 LMS base tables 都不授予 anon；登入角色一律是 authenticated，教師、學生、moderator、assistant、admin 差異由現有 RLS／capability 判斷。
- 未接到目前 UI 的已宣告資料庫契約仍保留對應的 RLS 操作權限。對已存在受控 RPC 的寫入則再收斂；盤點清單的 call_sites 記錄程式嘗試的操作，不能單憑嘗試寫入就繞過 schema 或 RLS。

### 後端直接表格權限

| 表格 | service_role | 對應用途 |
|---|---|---|
| profiles | SELECT、UPDATE | send-expo-push 的角色判斷；既有 trusted profile role 管理契約與回歸測試 |
| courses、course_units、course_materials、assignments、quizzes | SELECT | course-export-worker 匯出資料 |
| notifications | SELECT、UPDATE | dispatch-notification-push 領取與標記派送狀態 |
| push_tokens | SELECT | 查詢通知接收端 |
| notification_push_logs | INSERT | 寫入派送結果 |

`sync-external-directory` 使用 Auth Admin invite；profiles 由 Auth trigger 建立，因此沒有額外授予 service_role INSERT。匯出 job 的認領／完成使用 SECURITY DEFINER RPC，不需要給 service_role 直接讀寫 job 表。停用的 AI workers 未取得額外直接表格權限；重新啟用前必須另行盤點。

### RPC、view 與評分邊界

1. 每張表先撤銷 PUBLIC／anon／authenticated／service_role 的舊 ACL，再依下表明確授權，包含移除舊預設 TRUNCATE、REFERENCES、TRIGGER 等不需要的權限。沒有恢復全表預設授權，也沒有修改平台 schemas。
2. `quiz_attempts`、`rubric_scores`、`course_role_capabilities`、互評回應、問卷回應、學習時間、xAPI、閱讀確認、AI 同意紀錄等改成 authenticated 只讀；寫入使用既有且已核實的 RPC。
3. 14 個私人普通 views 設為 `security_invoker=true`。學生 dashboard／預警 view 外層也限本人或現有成績可見角色，避免同班其他學生的隱藏資料被聚合成假的零分列。公開課程目錄保留固定公開欄位與公開／未封存篩選，並加 security_barrier；anon 不因此取得 courses 權限。
4. `reporting_course_engagement_7d` 物化資料不開放直接讀取；仍由 admin RPC 查詢或刷新。
5. 81 個應用程式函式逐一列出 EXECUTE 權限：53 個使用者 RPC／RLS helpers 給 authenticated，8 個 worker／service 函式給 service_role，18 個 trigger 函式與 2 個內部計分 helpers 保留 owner-only。所有應用程式函式都不授予 anon；extension／Auth／Storage 函式不在此清單內。
6. 六個認領／完成／標記佇列 RPC 僅給 service_role，並用 `auth.role() IS DISTINCT FROM 'service_role'` 檢查，缺 claim 時拒絕。管理員瀏覽器仍可要求與查看自己的工作，但不能直接模擬 worker 完成工作。
7. 補上具體發現的跨帳號缺口：peer review 先驗 reviewer 與 pending 狀態；rubric 評分驗課程、target binding 與 assignments.grade capability；遲交分數只允許本人或有權批改者讀取。學生 grade-sync RPC 保留，但缺少 auth.uid 時會拒絕。
8. 作業 grade／feedback／graded_at／graded_by 與 quiz manual_score 加 SECURITY INVOKER trigger 保護。學生可正常提交與更新內容，不能自評；有權教師及受控計分 RPC 可批改。作業與答案的歸屬鍵不可搬移，防止把合法分數帶到別筆資料。
9. 移除 `grade_scores_insert_student_own_quiz`／`grade_scores_update_student_own_quiz` 兩條允許學生直接填寫測驗成績的政策，避免繞過伺服器計分。grade_scores 的 authenticated 寫入 grant 仍供既有教師／moderator 政策使用；學生透過 `sync_quiz_gradebook_from_attempt` 同步自己的伺服器計分結果。

學生提交的 upsert payload 應省略評分欄位，與現有正常呼叫一致；PATCH 若帶入未變更的既有評分值仍可通過。整列 upsert 若回送非 NULL 的 grade／manual_score，會先觸發 BEFORE INSERT 防護而遭拒絕，即使後續原本會走 ON CONFLICT UPDATE。

函式從 PUBLIC 撤銷 EXECUTE 還不夠：舊 Supabase defaults 可能另外直接授予 anon/authenticated。本 migration 明確清理三個 API roles，再重授需要的角色。

## 逐表盤點

`S` = SELECT、`I` = INSERT、`U` = UPDATE、`D` = DELETE；`—` = 無權限。全部表格 anon 均為 `—`，全部啟用 RLS。來源欄為首次 CREATE TABLE 的 migration；後續 policy 覆蓋已納入最終權限。完整機器可讀清單含來源、理由與呼叫類別：[privileges.json](../scripts/supabase-permissions/privileges.json)。

| 表格 | 建立 migration | 歷史明確 table GRANT | authenticated | service_role |
|---|---|---|---|---|
| `profiles` | [20260117120001](../supabase/migrations/20260117120001_core.sql) | — | SU | SU |
| `courses` | [20260117120001](../supabase/migrations/20260117120001_core.sql) | — | SIUD | S |
| `course_members` | [20260117120001](../supabase/migrations/20260117120001_core.sql) | — | SIUD | — |
| `course_materials` | [20260117120001](../supabase/migrations/20260117120001_core.sql) | — | SIUD | S |
| `announcements` | [20260117120001](../supabase/migrations/20260117120001_core.sql) | — | SIUD | — |
| `assignments` | [20260117120002](../supabase/migrations/20260117120002_assignments_quizzes.sql) | — | SIUD | S |
| `submissions` | [20260117120002](../supabase/migrations/20260117120002_assignments_quizzes.sql) | — | SIU | — |
| `quizzes` | [20260117120002](../supabase/migrations/20260117120002_assignments_quizzes.sql) | — | SIUD | S |
| `quiz_questions` | [20260117120002](../supabase/migrations/20260117120002_assignments_quizzes.sql) | — | SIUD | — |
| `quiz_question_solutions` | [20260117120002](../supabase/migrations/20260117120002_assignments_quizzes.sql) | — | SIUD | — |
| `quiz_attempts` | [20260117120002](../supabase/migrations/20260117120002_assignments_quizzes.sql) | — | S | — |
| `quiz_answers` | [20260117120002](../supabase/migrations/20260117120002_assignments_quizzes.sql) | — | SIUD | — |
| `forum_topics` | [20260117120003](../supabase/migrations/20260117120003_forum_grades.sql) | — | SIUD | — |
| `forum_posts` | [20260117120003](../supabase/migrations/20260117120003_forum_grades.sql) | — | SIUD | — |
| `grade_categories` | [20260117120003](../supabase/migrations/20260117120003_forum_grades.sql) | — | SIUD | — |
| `grade_items` | [20260117120003](../supabase/migrations/20260117120003_forum_grades.sql) | — | SIUD | — |
| `grade_scores` | [20260117120003](../supabase/migrations/20260117120003_forum_grades.sql) | — | SIUD | — |
| `live_sessions` | [20260117120004](../supabase/migrations/20260117120004_live.sql) | — | SIUD | — |
| `live_buzzer_state` | [20260117120004](../supabase/migrations/20260117120004_live.sql) | — | SIUD | — |
| `live_attendance` | [20260201090000](../supabase/migrations/20260201090000_tronclass_extend.sql) | — | SUD | — |
| `live_chat_messages` | [20260201090000](../supabase/migrations/20260201090000_tronclass_extend.sql) | — | SI | — |
| `notifications` | [20260201090000](../supabase/migrations/20260201090000_tronclass_extend.sql) | — | SUD | SU |
| `push_tokens` | [20260201090000](../supabase/migrations/20260201090000_tronclass_extend.sql) | — | SIUD | S |
| `material_progress` | [20260201090000](../supabase/migrations/20260201090000_tronclass_extend.sql) | — | SIUD | — |
| `forum_reports` | [20260217100200](../supabase/migrations/20260217100200_forum_moderation.sql) | — | SIU | — |
| `forum_post_edits` | [20260217100200](../supabase/migrations/20260217100200_forum_moderation.sql) | — | S | — |
| `audit_logs` | [20260218120000](../supabase/migrations/20260218120000_p2_enterprise.sql) | — | S | — |
| `ai_usage_daily` | [20260218120000](../supabase/migrations/20260218120000_p2_enterprise.sql) | — | S | — |
| `quiz_pool_entries` | [20260218120200](../supabase/migrations/20260218120200_wave2_commercial_gap.sql) | — | SIUD | — |
| `course_question_bank` | [20260218120200](../supabase/migrations/20260218120200_wave2_commercial_gap.sql) | — | SIUD | — |
| `notification_push_logs` | [20260218120200](../supabase/migrations/20260218120200_wave2_commercial_gap.sql) | — | S | I |
| `course_role_capabilities` | [20260517120000](../supabase/migrations/20260517120000_wave3_wave6_plan_expansion.sql) | authenticated: S | S | — |
| `material_ai_enrichment` | [20260517120000](../supabase/migrations/20260517120000_wave3_wave6_plan_expansion.sql) | — | SIU | — |
| `alert_dispatch_outbox` | [20260520120000](../supabase/migrations/20260520120000_gap_p1_04_dlq_dashboard.sql) | — | S | — |
| `report_export_jobs` | [20260520120200](../supabase/migrations/20260520120200_gap_p2_08b_reporting_visualization.sql) | — | SI | — |
| `ai_compliance_policies` | [20260520120300](../supabase/migrations/20260520120300_gap_p2_09_ai_compliance.sql) | — | SIUD | — |
| `ai_consent_log` | [20260520120300](../supabase/migrations/20260520120300_gap_p2_09_ai_compliance.sql) | — | S | — |
| `media_play_tokens` | [20260520120400](../supabase/migrations/20260520120400_drm_alt_signed_media_tokens.sql) | — | S | — |
| `course_units` | [20260520130000](../supabase/migrations/20260520130000_wave5_units_calendar.sql) | — | SIUD | S |
| `course_unit_items` | [20260520130000](../supabase/migrations/20260520130000_wave5_units_calendar.sql) | — | SIUD | — |
| `calendar_events` | [20260520130000](../supabase/migrations/20260520130000_wave5_units_calendar.sql) | — | SIUD | — |
| `course_groups` | [20260520130100](../supabase/migrations/20260520130100_wave5_groups_peer_review.sql) | — | SIUD | — |
| `course_group_members` | [20260520130100](../supabase/migrations/20260520130100_wave5_groups_peer_review.sql) | — | SIUD | — |
| `peer_review_assignments` | [20260520130100](../supabase/migrations/20260520130100_wave5_groups_peer_review.sql) | — | SIUD | — |
| `peer_review_pairs` | [20260520130100](../supabase/migrations/20260520130100_wave5_groups_peer_review.sql) | — | SIUD | — |
| `peer_review_responses` | [20260520130100](../supabase/migrations/20260520130100_wave5_groups_peer_review.sql) | — | S | — |
| `surveys` | [20260520130200](../supabase/migrations/20260520130200_wave5_surveys_badges_dashboard.sql) | — | SIUD | — |
| `survey_questions` | [20260520130200](../supabase/migrations/20260520130200_wave5_surveys_badges_dashboard.sql) | — | SIUD | — |
| `survey_responses` | [20260520130200](../supabase/migrations/20260520130200_wave5_surveys_badges_dashboard.sql) | — | S | — |
| `course_badges` | [20260520130200](../supabase/migrations/20260520130200_wave5_surveys_badges_dashboard.sql) | — | SIUD | — |
| `course_badge_awards` | [20260520130200](../supabase/migrations/20260520130200_wave5_surveys_badges_dashboard.sql) | — | SID | — |
| `scorm_packages` | [20260520140000](../supabase/migrations/20260520140000_wave6_scorm_lti_rubric.sql) | — | SIUD | — |
| `scorm_attempts` | [20260520140000](../supabase/migrations/20260520140000_wave6_scorm_lti_rubric.sql) | — | SIU | — |
| `xapi_statements` | [20260520140000](../supabase/migrations/20260520140000_wave6_scorm_lti_rubric.sql) | — | S | — |
| `lti_tools` | [20260520140000](../supabase/migrations/20260520140000_wave6_scorm_lti_rubric.sql) | — | SIUD | — |
| `lti_resource_links` | [20260520140000](../supabase/migrations/20260520140000_wave6_scorm_lti_rubric.sql) | — | SIUD | — |
| `lti_launches` | [20260520140000](../supabase/migrations/20260520140000_wave6_scorm_lti_rubric.sql) | — | SI | — |
| `rubrics` | [20260520140000](../supabase/migrations/20260520140000_wave6_scorm_lti_rubric.sql) | — | SIUD | — |
| `rubric_criteria` | [20260520140000](../supabase/migrations/20260520140000_wave6_scorm_lti_rubric.sql) | — | SIUD | — |
| `rubric_scores` | [20260520140000](../supabase/migrations/20260520140000_wave6_scorm_lti_rubric.sql) | — | S | — |
| `material_notes` | [20260520140100](../supabase/migrations/20260520140100_wave6_notes_versions_chapters_meeting.sql) | — | SIUD | — |
| `material_bookmarks` | [20260520140100](../supabase/migrations/20260520140100_wave6_notes_versions_chapters_meeting.sql) | — | SIUD | — |
| `material_versions` | [20260520140100](../supabase/migrations/20260520140100_wave6_notes_versions_chapters_meeting.sql) | — | SIUD | — |
| `material_chapter_markers` | [20260520140100](../supabase/migrations/20260520140100_wave6_notes_versions_chapters_meeting.sql) | — | SIUD | — |
| `course_meetings` | [20260520140100](../supabase/migrations/20260520140100_wave6_notes_versions_chapters_meeting.sql) | — | SIUD | — |
| `livestream_sessions` | [20260520140100](../supabase/migrations/20260520140100_wave6_notes_versions_chapters_meeting.sql) | — | SIUD | — |
| `learning_time_entries` | [20260520140200](../supabase/migrations/20260520140200_wave6_learning_time_workload.sql) | — | S | — |
| `course_export_packages` | [20260520150000](../supabase/migrations/20260520150000_wave7_export_richtext_preview.sql) | — | SI | — |
| `badge_issuer_config` | [20260520150000](../supabase/migrations/20260520150000_wave7_export_richtext_preview.sql) | — | SIUD | — |
| `badge_assertions` | [20260520150000](../supabase/migrations/20260520150000_wave7_export_richtext_preview.sql) | — | S | — |
| `html_sanitize_policy` | [20260520150000](../supabase/migrations/20260520150000_wave7_export_richtext_preview.sql) | — | SIUD | — |
| `material_previews` | [20260520150000](../supabase/migrations/20260520150000_wave7_export_richtext_preview.sql) | — | SIUD | — |
| `whiteboard_sessions` | [20260520150000](../supabase/migrations/20260520150000_wave7_export_richtext_preview.sql) | — | SIUD | — |
| `whiteboard_annotations` | [20260520150000](../supabase/migrations/20260520150000_wave7_export_richtext_preview.sql) | — | SID | — |
| `announcement_reads` | [20260520150100](../supabase/migrations/20260520150100_wave7_leaderboard_duplicate_reads_tags.sql) | — | S | — |
| `course_tags` | [20260520150100](../supabase/migrations/20260520150100_wave7_leaderboard_duplicate_reads_tags.sql) | — | SIUD | — |
| `course_material_tag_map` | [20260520150100](../supabase/migrations/20260520150100_wave7_leaderboard_duplicate_reads_tags.sql) | — | SIUD | — |
| `teacher_private_notes` | [20260520150100](../supabase/migrations/20260520150100_wave7_leaderboard_duplicate_reads_tags.sql) | — | SIUD | — |
| `course_feedback` | [20260520150100](../supabase/migrations/20260520150100_wave7_leaderboard_duplicate_reads_tags.sql) | — | SI | — |
| `grade_approval_requests` | [20260520150100](../supabase/migrations/20260520150100_wave7_leaderboard_duplicate_reads_tags.sql) | — | SIU | — |
| `enrollment_history` | [20260520150100](../supabase/migrations/20260520150100_wave7_leaderboard_duplicate_reads_tags.sql) | — | S | — |
| `webhook_subscriptions` | [20260520150200](../supabase/migrations/20260520150200_wave7_webhooks_offline_packs.sql) | — | SIUD | — |
| `webhook_deliveries` | [20260520150200](../supabase/migrations/20260520150200_wave7_webhooks_offline_packs.sql) | — | S | — |
| `material_offline_packs` | [20260520150200](../supabase/migrations/20260520150200_wave7_webhooks_offline_packs.sql) | — | SIUD | — |
| `material_offline_downloads` | [20260520150200](../supabase/migrations/20260520150200_wave7_webhooks_offline_packs.sql) | — | SI | — |
| `academic_terms` | [20260520160000](../supabase/migrations/20260520160000_wave8_academic_catalog.sql) | — | SIUD | — |
| `departments` | [20260520160000](../supabase/migrations/20260520160000_wave8_academic_catalog.sql) | — | SIUD | — |
| `course_sections` | [20260520160000](../supabase/migrations/20260520160000_wave8_academic_catalog.sql) | — | SIUD | — |
| `course_prerequisites` | [20260520160000](../supabase/migrations/20260520160000_wave8_academic_catalog.sql) | — | SIUD | — |
| `course_subscriptions` | [20260520160000](../supabase/migrations/20260520160000_wave8_academic_catalog.sql) | — | SID | — |
| `quiz_proctor_settings` | [20260520160100](../supabase/migrations/20260520160100_wave8_at_risk_group_proctor_publish.sql) | — | SIUD | — |
| `quiz_proctor_events` | [20260520160100](../supabase/migrations/20260520160100_wave8_at_risk_group_proctor_publish.sql) | — | SI | — |
| `ai_chat_threads` | [20260520160200](../supabase/migrations/20260520160200_wave8_ai_search_outcomes_prefs.sql) | — | SIUD | — |
| `ai_chat_messages` | [20260520160200](../supabase/migrations/20260520160200_wave8_ai_search_outcomes_prefs.sql) | — | SIUD | — |
| `material_ai_summary` | [20260520160200](../supabase/migrations/20260520160200_wave8_ai_search_outcomes_prefs.sql) | — | S | — |
| `push_notification_preferences` | [20260520160200](../supabase/migrations/20260520160200_wave8_ai_search_outcomes_prefs.sql) | — | SIUD | — |
| `user_favorites` | [20260520160200](../supabase/migrations/20260520160200_wave8_ai_search_outcomes_prefs.sql) | — | SIUD | — |
| `email_digest_preferences` | [20260520160200](../supabase/migrations/20260520160200_wave8_ai_search_outcomes_prefs.sql) | — | SIUD | — |
| `program_outcomes` | [20260520160200](../supabase/migrations/20260520160200_wave8_ai_search_outcomes_prefs.sql) | — | SIUD | — |
| `course_outcomes` | [20260520160200](../supabase/migrations/20260520160200_wave8_ai_search_outcomes_prefs.sql) | — | SIUD | — |
| `outcome_item_map` | [20260520160200](../supabase/migrations/20260520160200_wave8_ai_search_outcomes_prefs.sql) | — | SIUD | — |
| `teacher_office_hours` | [20260520160200](../supabase/migrations/20260520160200_wave8_ai_search_outcomes_prefs.sql) | — | SIUD | — |
| `office_hour_bookings` | [20260520160200](../supabase/migrations/20260520160200_wave8_ai_search_outcomes_prefs.sql) | — | SIU | — |

## Views 與 materialized view

普通私人 views 只給 authenticated SELECT；service_role 沒有直接 view 權限。公開目錄是刻意的投影例外，物化報表只經 RPC。

| 物件 | authenticated | anon | 執行方式 |
|---|---|---|---|
| `course_grade_rollups` | S | — | security_invoker |
| `reporting_grade_course_item_scores` | S | — | security_invoker |
| `reporting_push_dispatch_retry_curve` | S | — | security_invoker |
| `reporting_quiz_overview` | S | — | security_invoker |
| `reporting_live_attendance_overview` | S | — | security_invoker |
| `reporting_course_engagement_7d` | — | — | admin RPC only |
| `reporting_ai_quota_overview` | S | — | security_invoker |
| `reporting_student_dashboard` | S | — | security_invoker |
| `reporting_learning_time_monthly` | S | — | security_invoker |
| `reporting_teacher_workload` | S | — | security_invoker |
| `reporting_course_leaderboard` | S | — | security_invoker |
| `reporting_announcement_read_ratio` | S | — | security_invoker |
| `public_course_catalog` | S | S | restricted public projection + security_barrier |
| `reporting_at_risk_students` | S | — | security_invoker |
| `reporting_participation_score` | S | — | security_invoker |
| `course_search_index` | S | — | security_invoker |

## 可重現的安全測試

### 一般本機 PostgreSQL + PostgREST

使用獨立 PostgreSQL server 與安裝好的 psql／PostgREST 16.5：

```bash
CAMPUS_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/campus_permissions_test \
CAMPUS_TEST_PSQL=/path/to/psql \
CAMPUS_TEST_POSTGREST=/path/to/postgrest \
node scripts/supabase-permissions/run-local.mjs
```

這個 runner 只接受字面 loopback 位址、postgres 測試管理角色與固定測試資料庫名稱。它只會重建自身 marker 標記的 `campus_permissions_test_fresh`、`_upgrade`、`_reset`；拒絕遠端位址、query host 覆寫與其他既有資料庫。它清除繼承的 Supabase／Postgres 遠端目標環境設定。

三條路徑：

- **fresh**：先停用新表／sequence 的預設 Data API grants，再執行完整 migrations。
- **upgrade**：以舊式預設 grants 建立歷史 schema、加入合成測資，再停用預設 grants 並套用新增 migration；驗證舊資料與所需 API 存取仍在。
- **reset**：完整建立、驗證，再銷毀本 runner 的測試 DB 並重建，排除依賴殘留 ACL 或資料。

### 真正的 Supabase CLI reset

需要 Docker、Supabase CLI **2.121.0**、psql、Node 22：

```bash
node scripts/supabase-permissions/run-supabase.mjs
```

CI workflow：[Supabase permission migrations](../.github/workflows/supabase-permissions.yml)。使用獨立臨時 project ID 與本機 Docker volumes；未連結任何 hosted project、未使用 Actions secrets。測試保留 repo config 的 PostgreSQL 15 與 API schemas，只覆寫測試用 project ID、localhost ports、預設曝光設定及非必要服務。

測試首筆 migration 早於應用 migrations，撤銷預設 table S/I/U/D 與 sequence USAGE/SELECT；每次 reset 後建立並回滾 sentinel 表，確認新政策模擬未被 reset 洗掉。之後執行一次 fresh reset、第二次 reset，以及 legacy reset 後 migration up。所有 reset 都明確使用 `--local`，沒有 linked／遠端 DB 參數。

### 驗證內容與判讀

- 119 個 relation 的 **2,499** 項角色／操作 ACL assertions；81 個 application function 的 **243** 項角色 EXECUTE assertions。
- 每張表 RLS 開啟、私人 views 使用 caller RLS、新增未盤點物件會令測試失敗、匿名只可讀公開目錄。
- 同課程兩名學生與不同課程使用者的提交、通知、分數、views、答案及私人資料隔離。
- 教師與學生的 capability 邊界、profile 自行升權阻擋、trusted profile role 維護。
- HTTP nested select、HEAD count、upsert returning、問卷／簽到／學習時間／測驗 RPC 與計分契約。
- 後端必要讀取、推播紀錄 INSERT、匯出認領／完成、佇列 RPC 拒絕未授權角色與缺 JWT claim。
- peer/rubric／遲交分數的跨帳號拒絕與合法正向流程、評分欄位防竄改、學生不可直接寫入測驗成績、本人計分同步與教師批改。
- 既有 `profile_role_authority.sql` 在自身 BEGIN/ROLLBACK 內明確給測試限定 INSERT grant；正式 profiles 仍沒有 authenticated INSERT。

一般 PG runner 使用最小 auth/storage fixture，不能替代真正的 GoTrue、Storage 或 Supabase Docker 驗證。HTTP 測試直接使用真實 PostgREST，不使用 SDK mocks。它驗證 supabase-js 使用的 REST 契約，不代表所有 Web／App 畫面或正式環境均已驗收。

### 本次實測紀錄（2026-10-21）

本機隔離環境：PostgreSQL **16.15**、PostgREST **16.5**、Node **24.19.0**。執行 `node scripts/supabase-permissions/run-local.mjs`，使用 loopback 限定測試資料庫與上述固定工具版本；exit code **0**。

| 情境 | SQL 與權限驗證 | HTTP 測試 |
|---|---|---|
| 新政策下完整初始化 | 完整 35 份 migrations、defaults probe、ACL/RLS 與 profile role authority 通過 | 49/49，0 skipped |
| 舊 grants／既有資料升級 | 34 份歷史 migrations 與既有測資保留，追加新 migration 後通過 | 49/49，0 skipped |
| reset 情境首建 | 完整重播與全部 SQL assertions 通過 | 49/49，0 skipped |
| reset 情境第二次重建 | 移除本 runner 測試 DB 後完整重播通過 | 49/49，0 skipped |

合計 **196 次 HTTP 測試執行、0 失敗、0 跳過**。每輪驗證 2,499 項 relation ACL、243 項 function EXECUTE ACL，以及預設授權、RLS、view 與政策邊界。上述 reset 是 runner 的資料庫重建；真正的 `supabase db reset --local` 由 PR 的 PostgreSQL 15／Supabase CLI 2.121.0 Docker workflow 另外驗證，應以該次 GitHub Actions 執行結果判讀。正式資料庫尚未操作或驗收。

### 尚未涵蓋的既有功能問題

這次沒有重新開啟 LMS UI gate、部署 Edge Functions、呼叫外部推播／webhook、上傳 Storage 檔案，也沒有執行 GraphQL E2E。GraphQL 的資料權限使用相同 PostgreSQL ACL/RLS，但不能宣稱已完成其實際端點驗證。

保留的 Mobile AI write tools 有原本就存在的 schema 差異：部分表名不存在（`peer_review_submissions`、`survey_answers`、`submission_rubric_scores`、`forum_moderation_logs`）、向聚合 view 寫入、audit_logs 欄位與寫入方式不符，以及 submissions 使用 `user_id/content_text` 而實際為 `student_id/body_text`。這些呼叫不會因本次加 GRANT 就變成有效，也未為了它們放寬權限。恢復相關功能前需要另行修正資料契約。

## 部署與驗收

本次只提交程式與測試，**不修改正式資料庫、不合併 PR、不部署應用或 Edge Functions**。隔離測試通過與正式驗收是不同結果。

1. 審閱逐表／函式 ACL、角色變更及測試紀錄。以正式部署使用的 migration owner、Supabase Postgres 版本和 extensions 在預備環境重播。
2. 盤點目標 DB 的 migration history、現存 ACL、自訂 views／functions、額外後端呼叫。特別確認任何未在 repo 的 service 程式是否直接存取不在九張表清單內的物件。先留存 ACL／schema 備份。
3. 已套用歷史 migrations 的環境，只需追加 `20261021055702_explicit_data_api_privileges.sql`；不要重跑初始 CREATE TABLE。全新或預覽環境使用 migrations 目錄完整順序。
4. 經核准的部署流程套用這份追加 migration。它包含 `NOTIFY pgrst, 'reload schema'`；需要等待 API schema cache 更新，再測正常帳號、同課程第二帳號、外課帳號與 worker。
5. 正式驗收至少覆核登入者課程讀取、作業提交、教師評分、匿名目錄、通知派送與課程匯出。登入管理員不能直接認領 worker jobs 是刻意的權限界線。
6. 若需回復，使用部署前的 ACL／schema 備份做物件級回復；保留未授權存取的修補，避免用 `GRANT ALL ON ALL TABLES` 作為臨時解法。

本次沒有改 Web／App API 簽章；主要部署項目是追加的 SQL migration。`supabase/config.toml` 的 auto_expose_new_tables=false 與 local_smtp 更新供固定版本 CLI 本機／預覽使用，不是已變更 hosted project settings 的證明。
