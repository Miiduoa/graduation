# LMS v2 Migration Runbook

> 由 `LMS_整合計畫.docx` 派生的執行手冊。所有檔案路徑可直接 `cd` 進去使用。

## ✅ 已完成範圍 (2026-05-17)

**Phase A — AI 工具切換至 Supabase facade:** `aiAgentTools.ts` / `aiRealtimeAnalytics.ts` / `aiSmartActions.ts` 已改 import `supabaseLmsCache`,舊 AI 自動拿 Supabase 資料。

**Phase B — Mobile LearnStack 直接換掉:** 新增 13 個 `Course*V2Screen.tsx` (`apps/mobile/src/screens/lmsV2/`),LearnStack `CourseHub` 已 dispatcher 化(`isLmsV2Enabled()` 為 true 走 V2)。LMS 課程頁的 AI 助教按鈕走 `buildPerCourseAIContext` → 既有 `AIChat`(舊 `chatWithCampusAssistant`)。

**Phase C — Web Admin 14 頁直接遷移:** 14 個 page 已從 `_lms_v2_staged_admin/` 移到 `apps/web/src/app/lms-admin/`。`SiteShell` secondaryNav 新增「LMS 管理」入口。`supabase-browser.ts`、`RequireAdmin.tsx`、`rechartsShim.tsx`、`RichTextEditor.tsx` 等相容層已建。

**AI 深度整合 — 完整角色 × 動作 × 跨角色因果鏈:** 21 個 AI 寫入工具(`lmsV2WriteTools.ts`)註冊到 `aiToolRegistry`,跨 student/teacher/TA/moderator/department 五角色,內建 RBAC + RLS 雙重防線、audit log、5 分鐘內可撤銷 (`undoLastWrite`)。設計文件:`docs/LMS_V2_ROLE_ACTION_MAP.md`。

**驗證:**
- Mobile tsc: **0 errors** (含 13 個新 V2 Screen + 21 個 AI 工具)
- Web tsc: **0 errors** (含 14 個 admin page + recharts shim + RichTextEditor)
- Shared tsc: **0 errors**
- Jest 12 套件 / **179 tests 全綠** (LMS 共用引擎 8 + AI 助理 4)

---


## ⚠️ 關鍵設計決定(覆寫整合計畫第 6 章)

**AI 助理:全部使用舊版**(畢業專題既有的 `chatWithCampusAssistant` + `aiAgentRuntime`)。

- ❌ **不部署**畢業專題2 的 `ai-course-assistant` Edge Function — 已封存到 `supabase/functions/_disabled/`
- ❌ **不部署**畢業專題2 的 `material-ai-pipeline` Edge Function — 已封存到 `supabase/functions/_disabled/`
- ✅ LMS 課程頁的「AI 助教」按鈕 → 走既有 `AIChatScreen` + `chatWithCampusAssistant`,以 `perCourseAIContext` 注入 courseId 上下文
- ✅ 全域 Agent (aiAgentRuntime / aiOrchestrator) 不動,工具改透過 `supabaseLmsCache` facade 讀 Supabase 資料
- ✅ Background Agent 的 31 個 `ai*.ts` 服務全部保留,不重寫

換句話說:**Supabase 只負責提供 LMS 的資料**(課程、作業、成績、教材、討論…);**AI 推理、tool 調用、對話流程一律走舊版**。

## 本批次已完成的「零風險」前置工程

所有檔案都是**新增**,沒有動到任何既有檔案。Feature flag 預設 OFF,行為與現狀完全相同。

### Supabase 資源
- `supabase/migrations/` — 已複製 33 個 SQL 檔(從畢業專題2)
- `supabase/functions/` — 已複製 6 個 Edge Functions(ai-course-assistant、material-ai-pipeline、course-export-worker、dispatch-notification-push、send-expo-push、sync-external-directory)
- `supabase/config.toml` — 本機 Supabase CLI 設定
- `supabase/APPLY.txt` — migration 套用順序

### Feature flag 系統
- `apps/mobile/src/services/lmsV2FeatureFlag.ts` — Mobile flag 與 config 讀取
- `apps/web/src/lib/lmsV2FeatureFlag.ts` — Web flag 與 config 讀取
- `.env.lms-v2.example` — 環境變數範本

### Supabase Client (惰性初始化)
- `apps/mobile/src/services/supabaseClient.ts`
- `apps/web/src/lib/supabaseClient.ts`
- 當 flag OFF 或缺 URL/key 時,client 為 null,任何呼叫都會 graceful fallback

### Auth Bridge (Firebase → Supabase JWT)
- `apps/mobile/src/services/lmsAuthBridge.ts` — Mobile 端橋接器
- `backend/functions/lmsV2/issueSupabaseJwt.js` — Firebase Callable (HS256 簽 Supabase JWT)
- `backend/functions/lmsV2/index.js` — 匯出聚合器
- `backend/functions/lmsV2/README.md` — 啟用步驟

### LMS Data Source Facade
- `apps/mobile/src/services/supabaseLmsCache.ts` — 與 `puDataCache` 同介面;flag OFF 時 100% 委派回舊路徑

### 共用引擎 Adapter
- `packages/shared/src/lms/supabaseLmsAdapter.ts` — 與 `tronclassAdapter` 同型別輸出

### LMS 課程頁 → 舊 AI 對話橋接
- `apps/mobile/src/services/perCourseAIContext.ts` — `buildPerCourseAIContext(courseId)` 與 `buildPerCourseSystemHint(...)`,讓既有 `AIChatScreen` 在課程頁也能拿到該課程的 LMS 資料,**仍走 `chatWithCampusAssistant`**

### 已封存(不部署)
- `supabase/functions/_disabled/ai-course-assistant/` — 不使用
- `supabase/functions/_disabled/material-ai-pipeline/` — 不使用

### Phase 2/3 Staged 檔案 (尚未啟用)
- `apps/mobile/src/screens/_lms_v2_staged/` — 25 個 `.staged` 課程子頁(TypeScript / Metro 不會編譯)
- `apps/web/_lms_v2_staged_admin/` — 14 個管理頁 Next.js source(置於 src/app 之外,不會被路由)

---

## 你需要做的事(順序)

### 步驟 1:把 Supabase keys 貼進 .env

```bash
# 在 /Users/miiduoa/Desktop/畢業專題 根目錄
cp .env.lms-v2.example .env.local
# 編輯 .env.local 填入真實 keys (你說已經建好 Supabase 專案)
```

需要填的 keys(從 Supabase Dashboard → Project Settings → API):
- `EXPO_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` — Project URL
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — anon public key
- `SUPABASE_SERVICE_ROLE_KEY` — service_role 密鑰(Edge Functions / Firebase Callable 用)
- `SUPABASE_JWT_SECRET` — Settings → API → JWT Settings 的 secret
- `OPENAI_API_KEY` — Edge Function ai-course-assistant 用

### 步驟 2:推送 migrations

```bash
# 安裝 Supabase CLI (若尚未裝)
brew install supabase/tap/supabase

# 連結到你的 Supabase 專案
cd /Users/miiduoa/Desktop/畢業專題
supabase link --project-ref YOUR-PROJECT-REF

# 推送 migrations (33 個按順序)
supabase db push
```

驗證:在 Supabase Dashboard → Table Editor 應該能看到 `courses`、`course_members`、`assignments`、`quizzes` 等表。

### 步驟 3:部署 Edge Functions(只部署 4 個)

```bash
# 設定 secrets
supabase secrets set NOTIFICATION_DISPATCH_SECRET=any-strong-random
supabase secrets set EXPO_ACCESS_TOKEN=YOUR-EXPO-TOKEN

# ⚠️ ai-course-assistant 與 material-ai-pipeline 不部署
# (AI 全部走舊版 chatWithCampusAssistant + aiAgentRuntime)

supabase functions deploy dispatch-notification-push
supabase functions deploy send-expo-push
supabase functions deploy sync-external-directory
supabase functions deploy course-export-worker
```

備註:`OPENAI_API_KEY` 在「全部走舊版 AI」的方案下不需要(舊版 AI 已有自己的 provider 設定:Gemini / 本機 LLM / Firebase 雲端代理,見 `apps/mobile/src/services/ai.ts` 的 `EXPO_PUBLIC_AI_PROVIDER`)。

### 步驟 4:設定 Firebase Functions Secrets 並部署 issueSupabaseJwt

```bash
cd backend/functions

# 把 lms v2 callable 加入 index.js 匯出
echo "exports.issueSupabaseJwt = require('./lmsV2').issueSupabaseJwt;" >> index.js

# 安裝額外依賴
npm i @supabase/supabase-js

# 設定 secrets
firebase functions:secrets:set SUPABASE_URL
firebase functions:secrets:set SUPABASE_SERVICE_ROLE_KEY
firebase functions:secrets:set SUPABASE_JWT_SECRET

# 部署
firebase deploy --only functions:issueSupabaseJwt
```

### 步驟 5:打開 flag,驗證

```bash
# 編輯 .env.local
EXPO_PUBLIC_LMS_V2=true
NEXT_PUBLIC_LMS_V2=true

# Mobile dev:
cd apps/mobile && npx expo start -c

# Web dev:
cd apps/web && pnpm dev
```

驗證項:
1. App 啟動後不應 crash(flag 邏輯有 graceful fallback)
2. 用 Firebase 登入,然後在 AIChatScreen 問「列出我的課程」— 若回傳的內容含 `__source: 'supabase'`,代表 facade 成功切換
3. 開啟 Mobile 設定頁(若有 debug 入口)應能看到 `getLmsV2BridgeStatus()` 為 `{ enabled: true, isFresh: true }`

### 步驟 6:Phase 2 / 3 啟用(改寫 UI)

當前置都通過後,參考下列對應表把 staged 檔搬回:

#### Mobile 對應表

| 原檔(staged) | 改寫後 Screen 名 | LearnStack 註冊路由 |
|---|---|---|
| `_lms_v2_staged/(app)/course/[id]/index.tsx.staged` | `CourseHubV2Screen.tsx` | `CourseHubV2` |
| `_lms_v2_staged/(app)/course/[id]/materials.tsx.staged` | `CourseMaterialsV2Screen.tsx` | `CourseMaterialsV2` |
| `_lms_v2_staged/(app)/course/[id]/assignments/index.tsx.staged` | `CourseAssignmentsV2Screen.tsx` | `CourseAssignmentsV2` |
| `_lms_v2_staged/(app)/course/[id]/assignments/[assignmentId].tsx.staged` | `CourseAssignmentDetailV2Screen.tsx` | `CourseAssignmentDetailV2` |
| `_lms_v2_staged/(app)/course/[id]/quizzes/index.tsx.staged` | `CourseQuizzesV2Screen.tsx` | `CourseQuizzesV2` |
| `_lms_v2_staged/(app)/course/[id]/quizzes/[quizId].tsx.staged` | `CourseQuizTakingV2Screen.tsx` | `CourseQuizTakingV2` |
| `_lms_v2_staged/(app)/course/[id]/forum/index.tsx.staged` | `CourseForumV2Screen.tsx` | `CourseForumV2` |
| `_lms_v2_staged/(app)/course/[id]/forum/topic/[topicId].tsx.staged` | `CourseForumTopicV2Screen.tsx` | `CourseForumTopicV2` |
| `_lms_v2_staged/(app)/course/[id]/announcements.tsx.staged` | `CourseAnnouncementsV2Screen.tsx` | `CourseAnnouncementsV2` |
| `_lms_v2_staged/(app)/course/[id]/grades.tsx.staged` | `CourseGradesV2Screen.tsx` | `CourseGradesV2` |
| `_lms_v2_staged/(app)/course/[id]/ai-assistant.tsx.staged` | `CourseAIAssistantV2Screen.tsx`(殼,內容直接 navigate 到既有 `AIChat`,並用 `buildPerCourseAIContext(courseId)` 注入 context) | `CourseAIAssistantV2` |
| `_lms_v2_staged/(app)/course/[id]/question-bank.tsx.staged` | `CourseQuestionBankV2Screen.tsx` | `CourseQuestionBankV2` |
| `_lms_v2_staged/(app)/course/[id]/live.tsx.staged` | `CourseLiveV2Screen.tsx` | `CourseLiveV2` |

改寫核心動作:
- `import { useLocalSearchParams, router } from 'expo-router'` → `import { useRoute, useNavigation } from '@react-navigation/native'`
- `useLocalSearchParams()` → `useRoute().params`
- `router.push('/path')` → `useNavigation().navigate('ScreenName', params)`
- 預設匯出 functional component(`export default function CourseHubV2Screen() {...}`)

#### Web 對應表

| 原檔(staged) | 移到 |
|---|---|
| `_lms_v2_staged_admin/page.tsx` | `apps/web/src/app/lms-admin/page.tsx` |
| `_lms_v2_staged_admin/courses/page.tsx` | `apps/web/src/app/lms-admin/courses/page.tsx` |
| `_lms_v2_staged_admin/members/page.tsx` | `apps/web/src/app/lms-admin/members/page.tsx` |
| `_lms_v2_staged_admin/reports/page.tsx` | `apps/web/src/app/lms-admin/reports/page.tsx` |
| `_lms_v2_staged_admin/role-matrix/page.tsx` | `apps/web/src/app/lms-admin/role-matrix/page.tsx` |
| `_lms_v2_staged_admin/notify/page.tsx` | `apps/web/src/app/lms-admin/notify/page.tsx` |
| `_lms_v2_staged_admin/push-logs/page.tsx` | `apps/web/src/app/lms-admin/push-logs/page.tsx` |
| `_lms_v2_staged_admin/export-jobs/page.tsx` | `apps/web/src/app/lms-admin/export-jobs/page.tsx` |
| `_lms_v2_staged_admin/ai-compliance/page.tsx` | `apps/web/src/app/lms-admin/ai-compliance/page.tsx` |
| `_lms_v2_staged_admin/audit/page.tsx` | `apps/web/src/app/lms-admin/audit/page.tsx` |
| `_lms_v2_staged_admin/bulk-import/page.tsx` | `apps/web/src/app/lms-admin/bulk-import/page.tsx` |
| `_lms_v2_staged_admin/wave5/page.tsx` | `apps/web/src/app/lms-admin/wave5/page.tsx` |
| `_lms_v2_staged_admin/wave6/page.tsx` | `apps/web/src/app/lms-admin/wave6/page.tsx` |

改寫核心動作:
- `import { supabase } from '../../lib/supabase'` → `import { getSupabaseClient } from '@/lib/supabaseClient'`
- 每個 page 開頭加 `const supabase = getSupabaseClient(); if (!supabase) return <DisabledNotice />;`
- Layout 用 `SiteShell` 包

---

## 緊急回退

如果 LMS v2 出問題影響到正常運作,**立即執行**:

```bash
# 1. 關掉 flag (最快的方式)
sed -i.bak 's/^EXPO_PUBLIC_LMS_V2=.*/EXPO_PUBLIC_LMS_V2=false/' .env.local
sed -i.bak 's/^NEXT_PUBLIC_LMS_V2=.*/NEXT_PUBLIC_LMS_V2=false/' .env.local

# 2. Mobile clear cache 重啟
cd apps/mobile && npx expo start -c

# 3. Web 重新 build
cd apps/web && pnpm build && pnpm start
```

行為立刻回到「舊 LMS + TronClass + Firebase」,沒有任何資料遺失風險,因為 LMS v2 是疊加上去的。

---

## 風險清單對齊

對應 `LMS_整合計畫.docx` 第 10 章的 9 條風險,目前狀態:

| 風險 | 緩解狀態 |
|---|---|
| Firebase↔Supabase 身分不同步 | ✅ `issueSupabaseJwt` callable + `lmsAuthBridge` 已寫 |
| Mobile 路由樣式衝突 | ✅ Staged 檔以 `.staged` 後綴,Metro/TS 不打包;Phase 2 統一改 RN 寫法 |
| 共用引擎相依 tronclassAdapter | ✅ `supabaseLmsAdapter.ts` 已寫,介面完全對偶 |
| Demo 模式破損 | ✅ flag OFF 時 facade 委派回 puDataCache,Demo 完全不變 |
| ai-course-assistant 每日限額 30 次 | ✅ **不適用** — Edge Function 已封存,AI 走舊版,沒有此限制 |
| Supabase RLS 漏寫導致洩漏 | ⏳ 上線前要跑「多 user 假登入測試」(見 Phase 0 驗收清單) |
| 推播 Token 不一致 | ⏳ Phase 4 寫入工具時處理 |
| 舊 LMS 仍被部分非 LMS 功能 import | ✅ 舊 LMS 完全沒動,import 不破 |
| 口試時間不夠 | ✅ Phase 0+1 已就緒,可以從 Mobile happy path demo |
