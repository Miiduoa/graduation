## material-ai-pipeline

教師／助教以 JWT 呼叫，針對既有 `course_materials` 產出 **分段摘要**（JSON）與 **WebVTT 占位字幕**；寫入 `material_ai_enrichment`。

### Secrets

- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`（託管自動注入）
- `OPENAI_API_KEY`（未設定時仍以 stub 結果寫表，便於串接前驗證 RLS／配額）
- 選填 `OPENAI_MODEL`、`OPENAI_TRANSCRIPTION_MODEL`（轉寫預設 `whisper-1`）、
  `AI_MATERIAL_TRANSCRIBE_MAX_BYTES`（預設約 20MB）、`AI_MATERIAL_DAILY_LIMIT`
  （預設 30；與助教函式共用 `ai_usage_daily` + `increment_ai_usage`）

### 呼叫

`POST` Bearer 使用者 JWT，`user_consented` **必須為 `true`**（App 側明示確認後送入）。

```
{
  "material_id": "<uuid>",
  "teacher_note": "<選填>",
  "signed_media_url": "<選填，materials bucket 簽名 HTTPS URL>"
}
```

`signed_media_url` 之主機須等同 `SUPABASE_URL`（同源 Supabase 儲存體）；`mimetype` 為
`audio/*` ／ `video/*` 時才會嘗試 OpenAI Transcriptions，再將轉寫文字送 Chat 切段。

需 `courses.ai_media_enabled = true`（預設 true）且呼叫者為該課 `teacher`／`assistant`。
