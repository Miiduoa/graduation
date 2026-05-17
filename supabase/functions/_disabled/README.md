# 不部署 — Disabled Edge Functions

這兩個 Edge Function 在原本「畢業專題2」LMS 設計裡負責 AI(課程助教、教材轉寫摘要),
但本專案決定 **AI 路徑統一走舊版 chatWithCampusAssistant + aiAgentRuntime**,
所以這兩支留作備份不部署。

- `ai-course-assistant/` — 已被 `apps/mobile/src/services/perCourseAIContext.ts` + 既有 `AIChatScreen` 取代
- `material-ai-pipeline/` — 教材轉寫摘要功能本期不啟用;如要啟用,移回 ../ 並 supabase functions deploy

回頭啟用方式:
```bash
mv supabase/functions/_disabled/ai-course-assistant supabase/functions/
supabase functions deploy ai-course-assistant
```
