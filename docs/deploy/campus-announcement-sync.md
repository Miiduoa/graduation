# 校園公告同步：最小權限帳號與排程（2026-10-13 晉瑋核准，已啟用）

正式專案是 Firebase `campus-one-tw`。同步程式只准寫入：

- `schools/{schoolId}/announcements/{docId}`
- `schools/{schoolId}/announcement-sources/{sourceId}`

2026-10-13 已啟用：服務帳戶 `campus-announcement-sync`（只有 `roles/datastore.user`）、GitHub Environment `production` 的 `ANNOUNCEMENT_SYNC_SA_JSON` 與 `CAMPUS_ANNOUNCEMENT_SYNC_ENABLED=true`、workflow 每小時第 17 分（UTC）同步 `pu`。點餐開關維持關。

現況：CLI 預設 dry-run；`.github/workflows/campus-announcement-sync.yml` 只有手動試跑，寫入步驟固定失敗。

## 最小權限寫入帳號（核准後才建）

Admin SDK 會略過 Firestore Security Rules，IAM 也不能鎖到單一 subcollection。所以「最小權限」是：**專用帳號 + 最窄 IAM + 程式拒絕寫到別的路徑**，而不是指望規則擋這支排程。

建議帳戶 ID：`campus-announcement-sync`  
建議顯示名：校園公告同步  
建議 email：`campus-announcement-sync@campus-one-tw.iam.gserviceaccount.com`

只加這個角色（專案 `campus-one-tw`）：

| 角色 | 原因 |
| --- | --- |
| `roles/datastore.user` | 讀寫 Firestore。沒有更窄的「只寫 announcements」IAM |

不要加：

- `roles/firebase.admin`、`roles/firebase.developAdmin`
- `roles/iam.serviceAccountTokenCreator`（公告同步不發 custom token）
- Storage、Auth Admin、Functions Admin
- 現有 Fly `nuni-functions` 那把 `FIREBASE_SERVICE_ACCOUNT_JSON`（那把能發 token，範圍太大，不要拿來爬公告）

程式已有 `assertSchoolScopedWrite`：路徑不是上述兩個 collection 就丟錯。GitHub 這支 job 也不要拿這把金鑰去做別的 workflow。

金鑰：JSON 只放 GitHub Environment `production` 的 secret（建議名 `ANNOUNCEMENT_SYNC_SA_JSON`），不要進 repo、不要放專案目錄。能改用 GitHub OIDC 對 GCP 的 Workload Identity 就不要長期金鑰。

寫入開關另用 secret `CAMPUS_ANNOUNCEMENT_SYNC_ENABLED=true`。沒設這個，CLI `--write` 仍會拒絕。

## 排程（核准後才加，現在不要加）

學校網站要客氣：已有 robots、同一 origin 間隔 3 秒、一次一個連線、User-Agent 含聯絡。靜宜目前 7 個 origin，單輪大約半分鐘。

建議 GitHub Actions（不要用 Fly `nuni-api`，也不要開 Cloudflare Cron）：

```yaml
on:
  schedule:
    - cron: '17 * * * *' # 每小時第 17 分，避開整點尖峰
  workflow_dispatch:
```

| 項目 | 建議 |
| --- | --- |
| 頻率 | 先每小時一次。15–20 分太密；有停課／選課再考慮半小時 |
| 時區 | cron 是 UTC。`17 * * * *` 即可，不必對齊台北整點 |
| 併發 | 維持 `concurrency: campus-announcement-sync`、`cancel-in-progress: true` |
| 超時 | 20 分鐘夠用 |
| 範圍 | 一次一校或只跑已核准的 `schoolId`；不要一次掃完全部示範校 |
| 寫入 | 仍要 `CAMPUS_ANNOUNCEMENT_SYNC_ENABLED` 與服務帳戶；沒核准就只 dry-run |

Cloud Functions `onSchedule('every 20 minutes')` 在 Spark 上不會跑。Fly in-process 排程也不要為此打開。

核准後的手動檢查：先 `workflow_dispatch` 不開 write，對過標題再開 write。出問題先拿掉 `schedule`、清掉 `CAMPUS_ANNOUNCEMENT_SYNC_ENABLED`。

## 讀正式生效規則（只讀）

需要 `firebase.readonly` 或等價身分，本環境沒有這把憑證，所以沒有把 `cloud.firestore` release 的規則原文抓下來。核准後用既有 `FIREBASE_TOKEN` 或服務帳戶只讀：

```bash
TOKEN="$(gcloud auth print-access-token)"
curl -sS -H "Authorization: Bearer $TOKEN" \
  "https://firebaserules.googleapis.com/v1/projects/campus-one-tw/releases/cloud.firestore"
# 再用回傳的 rulesetName：
curl -sS -H "Authorization: Bearer $TOKEN" \
  "https://firebaserules.googleapis.com/v1/${RULESET_NAME}"
```

不要 `firebase deploy --only firestore:rules`。未登入探測正式庫目前全面 403；套上 repo 規則的影響見對話回報，不在這裡部署。
