# course-export-worker

非同步整課匯出 Worker。對應 migration `20260520150000_wave7_export_richtext_preview.sql` 的 `course_export_packages` 表。

## 用途
- IMS Common Cartridge (`.imscc`) — 商用 LMS 互通標準
- Moodle backup (`.mbz`)
- JSON zip 內部交換格式

## 排程
建議 cron 每 60 秒呼叫，或由 webhook 推送。

```
POST /functions/v1/course-export-worker
Authorization: Bearer ${COURSE_EXPORT_WORKER_SECRET}
```

## 流程
1. `report_export_jobs_claim_next` 樣板：認領 `status='queued'` 的一筆 → 標 `running`。
2. 依 `format` 走 IMSCC manifest 組裝 / Moodle backup XML / JSON dump。
3. 將 zip 寫入 `course-exports` Storage bucket（建立此 bucket 並設只允許 platform admin SELECT）。
4. 呼叫 `course_export_jobs_complete(p_id, 'ready', p_storage_path, p_manifest, null)`。
5. 失敗：`course_export_jobs_complete(p_id, 'failed', null, null, error.message)`。

## IMS Common Cartridge 1.3 必填項

- `imsmanifest.xml`：`<manifest>` 含 `<metadata>`、`<organizations>`、`<resources>`
- 每個資源（教材、討論、測驗）以 `<resource type=...>` 對應 IMS QTI / CC 副規格

實作時參考：https://www.imsglobal.org/cc/index.html

## Open Badge 2.0 同 worker（待擴充）

對應 migration `badge_issuer_config` + `badge_assertions`。Worker 在 `course_badge_awards` insert trigger 之後可一併簽發 OB 2.0 JSON-LD：
- 取 issuer config（signing_key_kid + public_key_jwk）
- 組 `Assertion { id, type, recipient, badge, verification: { type: 'SignedBadge' }, issuedOn }`
- JWS 簽章 → 寫 `badge_assertions.signature_jws`
- 公開 URL（serverless function `/badges/[assertion_id]`）回傳 JSON-LD

> 注意：實作 JWS signing 需要 ECDSA / RS256 key；務必把 private key 放在 Edge function secret，不要寫進 DB。
