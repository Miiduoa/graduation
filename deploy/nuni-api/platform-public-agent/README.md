# 平台帳號公開任務組裝候選

本機可走完「公開校園導航 → 檢視資料 → 本人確認 → 一次執行 → 來源與路線回執」。
使用地圖頁的 `PublicNavigationTask` 元件與真實 HTTP handler／service／ledger 程式；
`serve-local.mjs` 才注入合成平台 session、序列化 SQL protocol fixture 與既有公開地點目錄。
這不是正式登入、PostgreSQL 或雲端模型驗證。

```sh
node scripts/test-platform-public-agent.mjs
node scripts/platform-public-agent/serve-local.mjs
# 開啟 http://127.0.0.1:4319；輸入「從主顧樓到蓋夏圖書館」
```

本機只綁 loopback，紀錄在記憶體，重開會消失；不可拿來服務正式帳號。
地點來自 `packages/shared/src/providenceCampus.ts` 已附 OSM 來源的交叉核對項目。
目錄日期顯示為 2026-10-19，不宣稱即時通行、定位或校方同步。
導航只接受「從完整地點名稱到完整地點名稱」的唯一匹配；不理解任意自然語言。

## 組裝邊界

- `PlatformPublicAdmission` 使用既有 `PlatformAccountService.resolveSession` 結構介面，不接受 JSON 身分、角色、學籍或 Firebase uid。
- `PlatformPublicTaskService` 目前只啟用確定性公開導航，沒有模型呼叫或 fallback；Groq 任務回 executor unavailable。原入場層仍保留兩個公開任務的嚴格契約。
- `createPlatformPublicAgentHandler` 預設關閉，沒有在 Next／Fastify 註冊。未新增環境開關、部署或 migration manifest。地圖也未收到 production port，因此正式入口維持不變。
- 未來 host 須以既有受信 signed HttpOnly cookie／platform session 實作 `resolveHttpSession`，提供固定 origin，不能使用本機 fixture 的測試 header。handler 驗 POST、同源、custom header、session context、8 KiB body、完整期限與回應前 session；不接受跨校／跨帳號身分 JSON。
- 確認綁任務、內容雜湊、來源 fingerprint、校園、provider/model 與 session。`deterministic/public-poi-exact-match-v1` 與 Groq 是不同綁定；只有公開導航接受前者。

## 執行與回復

確認消耗、共用 budget、帳號 quota 與 operation 在同一交易。只有首次 claimed 取得隨機 execution token，DB 僅存 hash；HTTP 不暴露 token，重試不再取得執行權或扣次數。
結果須通過公開來源及 canonical 路線驗證才能以 token CAS 完成。completed／failed／unknown 都不能被晚到結果覆寫。
執行逾時或提交回應遺失保留不明狀態；查詢原任務不會觸發 executor。未知工作不自動補送或退款額度。
`readBound` 使用完整內容綁定；每次完成回執交付都重驗身分、來源與路線，不直接信任快取。
JSONB 欄位順序不影響驗證。公開名稱只是資料，不是模型或工具指令。

UI 確認前不執行，取消回輸入並恢復焦點；換帳校會卸載舊工作、清理晚到結果。
正式導航的同帳同校跨頁草稿保留及換校確認仍須由 host 與既有 Agent 草稿管理接合，本機 selector 只是隔離測試控制項，不是正式切校流程。
沒有真正的模型推理、任意任務或私人資料寫入。

## 仍未核實／啟用

- 未執行 `schema.candidate.sql`，未新增 GRANT；真 PostgreSQL 鎖、FK、跨程序競態、statement timeout／commit 故障及帳號清理尚待隔離 DB 驗證。
- fixture 的序列化回滾不是 PostgreSQL 證據。實際 DB transaction 不會因 HTTP abort 自動取消。
- 確認紀錄上限預設 1000，過期／已耗用也計入；未知操作不刪除。保留及容量清理政策尚未核定。
- 身分與來源為順序檢查，不是分散式原子快照，最後來源讀取後仍有 TOCTOU 窗口。
- 正式 API 介面基底 `Miiduoa/nuni-prod@9de47b4b`，account service 已與 `security/source.json` 綁定的 `b0a10ac` patch 單檔核對，保留 password 的有效 operator 指派重驗；整份目前部署來源與 migration/grants 未重建核准。
- 真 session BFF、正式公開來源 reader／包裝註冊、部署與任何免費雲端 provider 帳戶額度均未啟用或實測。
- 歷史安全掃描 22 筆命中／4 筆權屬未明仍待處理；本切片沒有新增 ignore、縮減掃描或放寬安全閘門。
