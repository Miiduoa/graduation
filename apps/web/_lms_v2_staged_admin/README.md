# LMS v2 Admin Pages (Staged — Not Routed)

從 `/Users/miiduoa/畢業專題2/apps/admin/app/` 整批複製過來的 14 個管理頁。

放在這個位置 (apps/web/src/app/ 之外) 是為了:
- Next.js App Router 不會把它們當路由 (避免出現意外可訪問的 /lms-admin/__staged/*)
- 但又能被 TypeScript 解析確認語法正確

Phase 3 啟動時:
1. 把每個 page/layout 改 import 路徑 (../lib/supabaseClient 等)
2. 改名移到 apps/web/src/app/lms-admin/* 並按需重組 layout 樹
3. 在 SiteShell 加入「LMS 管理」入口 (依角色顯示)

對應表參見 /Users/miiduoa/Desktop/畢業專題/docs/LMS_V2_MIGRATION_RUNBOOK.md。
