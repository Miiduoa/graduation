# ai-course-assistant

已登入使用者（須為指定課程之 **course_members**）可呼叫 OpenAI 做簡短助教回答；每日每使用者限量預設 **30** 次（見程式 `DAILY_LIMIT`，並依 `increment_ai_usage` 計數）。

## Secrets

| 變數 | 說明 |
|------|------|
| `OPENAI_API_KEY` | OpenAI API Key |
| `OPENAI_MODEL` | （選）預設 `gpt-4o-mini` |
| （自動注入） | `SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY` |

## Request

前端／App 使用 **使用者 access_token**（anon key + Authorization Bearer），勿傳 service_role。

```http
POST /functions/v1/ai-course-assistant
Authorization: Bearer <使用者 JWT>
Content-Type: application/json

{
  "course_id": "<uuid>",
  "prompt": "請摘要本章重點",
  "context": "（選填）使用者貼上的講義／討論文字片段"
}
```

## 注意

- 隱私：避免將全系統資料自動送入模型；僅傳使用者明示提供的 `context`。
- 計數表：`public.ai_usage_daily`（migration `20260218120000_p2_enterprise.sql` + RPC `increment_ai_usage`）。
