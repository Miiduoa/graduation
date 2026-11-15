# 2026-11-15 官方安全公告與修補候選

查核日期：2026-11-15（Asia/Taipei）。本輪來源基準為 `082992d946d35a0d1fee6ef6c72ded06b43487c9`。

## 結論與發布狀態

本輪準備 Next.js 16.4.5、Node.js 22.23.5／24.22.3、Firebase Admin 14.5.1 的來源修補。版本符合公告範圍，與外部攻擊能否在此應用成立分開記錄；沒有證據顯示專案已遭入侵或資料外洩。

**這份文件記錄 16.4.5 修補內容，不是正式站機器已切換的證明。** 正式 Web 同時啟動 current 與 legacy 兩個程序。legacy 來源已更新為已發布的不可變映像 `registry.fly.io/nuni-web@sha256:da056fd9d05cf22522aabb3fb2634f592462ec0cb270019444439918ba9e8959`（Next.js 16.4.5）。共同 runtime gate 要求兩個程序及巢狀副本都是 16.4.5。正式站機器在另一次核准部署前仍是 v195。

## 版本對照

| 元件 | main 基準 | 本輪候選 | 驗證依據 |
| --- | --- | --- | --- |
| Next.js／ESLint Next 套件 | 16.4.2 | 16.4.5 | root overrides、Web manifest、pnpm lock、雙程序 runtime gate |
| Web／Functions／CI Node | 22.23.4 | 22.23.5 | .nvmrc、workflow、EAS、Docker 固定 digest |
| Legacy Web Node | 24.22.1 | 24.22.3 | legacy build 與組合 Web 的獨立 Node 執行檔來源 |
| Web firebase-admin | 13.10.0 | 14.5.1 | Web manifest 與 pnpm lock；Firestore optional dependency 由 7.x 升至 9.x，需回歸 |
| Functions firebase-admin | 14.5.0 | 14.5.1 | Functions manifest、pnpm lock、獨立 npm lock |
| Supabase JS | 2.117.3 | 維持 | 未發現需為本次託管 Storage 公告更新用戶端 SDK 的依據 |
| Firebase JS／Firestore JS | 12.8.0／4.10.0 | 維持 | App 使用 JS Firestore，未找到原生 FirebaseFirestore Pod |

根 engines 由 `>=20.19.4 <21 || >=22 <23` 收斂為 `>=22.23.5 <23`，與本專案的 Node 22 工具鏈一致。這不代表 Node 24 本身不受支援；legacy 的獨立環境仍固定受支援且已修補的 Node 24。

## Next.js：2026-11-03 安全更新

官方累積修補版本為 16.4.5／15.5.29：[公告](https://nextjs.org/blog/november-2026-security-release)。本專案 16.4.2 位於下列公告的受影響版本範圍，但目前 current Web 原碼未證明所有利用前提成立。

| 公告 | 受影響 16.x 範圍 | 官方嚴重度 | 專案查核 |
| --- | --- | --- | --- |
| [GHSA-mfr8-8qww-v76h](https://github.com/vercel/next.js/security/advisories/GHSA-mfr8-8qww-v76h) | >=16.3.0 <=16.4.4 | GHSA Moderate／6.3；blog 標 High，保留來源分歧 | current 未啟用 Cache Components，未見 use cache／unstable_cache／root params，未見觸發前提 |
| [GHSA-pc58-hwjq-p385](https://github.com/vercel/next.js/security/advisories/GHSA-pc58-hwjq-p385) | >=16.0.0 <=16.4.4 | Moderate／6.3 | 未見將攻擊者控制的 fetched Response 與壓縮 framing 原樣轉送；反向代理存在本身不構成可利用證據 |
| [GHSA-f3mh-rxg3-f5g2](https://github.com/vercel/next.js/security/advisories/GHSA-f3mh-rxg3-f5g2) | >=16.0.0 <=16.4.4 | Moderate／6.0 | 設 Cookie 的 current API 使用 nodejs，未見 Edge route 前提 |
| [GHSA-7qx7-33qx-rqx2](https://github.com/vercel/next.js/security/advisories/GHSA-7qx7-33qx-rqx2) | >=16.0.0 <=16.4.4 | Moderate／6.9 | 自架 optimizer 可繞過 SVG 禁用；current 圖片顯示用 unoptimized，無 remotePatterns，但這不代表 optimizer 端點被關閉，也不取代 legacy 原碼／映像查核 |

封存 legacy 的已讀 next.config.ts 同樣未啟用 Cache Components 或 remotePatterns；主要 `/api/campus` 代理只轉送明確列舉的內容／快取標頭，未轉送 content-encoding、content-length、transfer-encoding，故該路徑不符合壓縮 framing 原樣轉送前提。這不取代新映像驗收。

查核位置：`apps/web/next.config.ts`、`apps/web/src/lib/nuni/server.ts`、`apps/web/src/lib/legacy-routing.ts`、API route runtime 宣告與 next/image 使用處。本輪不調低 CSP、不移除 Cookie 防護、不修改資料權限來迴避公告。

## Node.js：2026-11-11 安全更新與 EOL

[官方安全更新](https://nodejs.org/en/blog/vulnerability/november-2026-security-releases/) 提供 22.23.5、24.22.3、26.13.1；本專案沿既有 22／24 分支更新，不無故升到 26。公告最高 High，涵蓋 HTTP/2／HTTPS／TLS 特定程式路徑的可用性與資料風險。Functions HTTP server 使用 `node:http`，未在正式程式找到 HTTP/2 server／特定 TLS callback，不能只因網站對外 HTTPS 就宣稱 Node 在直接終結 TLS 或已命中每個 CVE。

[Node 官方支援時程](https://github.com/nodejs/Release/blob/main/schedule.json) 列 Node 20 已於 2026-04-30 結束支援；[Supabase JS 公告](https://supabase.com/changelog/45715-deprecation-notice-dropping-support-for-node-js-20) 的 Node 20 支援於 2026-06-30 結束。實際基準 CI／Web Docker 已是 Node 22；本輪移除 engines 仍允許 Node 20 的過時宣告，不把歷史記憶當成正式仍跑 Node 20 的證據。

新 Docker tag 的 index、linux/amd64 manifest、config SHA-256 均由官方 registry 實取並驗證，config 的 NODE_VERSION 與標籤相符：

- `node:22.23.5-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee`
- `node:22.23.5-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a`
- `node:24.22.3-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5`

獨立 `deploy/nuni-api/security/` 的歷史來源修補鏈仍記錄 Node 24.22.1；未修改其既有 patch checksum／candidate tree，也未取得當下正式 API 映像驗證。需另行核對目前採用的 API overlay 來源並重建，不能把本輪 Web／Functions 更新說成所有服務已完成。

## Firebase Admin：2026-11-11 的 14.5.1

[官方 release notes](https://firebase.google.com/support/release-notes/admin/node) 記載修補 deepExtend 原型污染及 tenantId／providerId 路徑穿越驗證。已讀官方公告沒有完整 affected range、CVE 或 CVSS，因此不自行編造。官方 npm metadata 的最新 13.x 仍為 13.10.0，沒有可選的 13.10.1 安全回補。

官方套件原始碼比較確認 13.10.0 缺少新版對 `__proto__`、`constructor`、`prototype` 與 inherited target properties 的保護。Web 初始化重新組固定 service-account 欄位；未找到外部 request body 原樣傳入相關 Admin 合併流程或 Firebase tenant/provider 管理 API。因此記為「現用 SDK 缺少修補，應更新；未證實應用外部可觸發」，不宣稱已可跨校存取。

新增的 `backend/functions/adminSecurity.test.js` 用公開 initializeApp API 及合成 options 驗證原型污染、正常欄位與雙向深拷貝：同一測試在隔離的 14.5.1 通過，在 14.5.0／13.10.0 都於原型污染斷言失敗。它不建立 Auth／Firestore service、不請求憑證，並清理測試 marker；此結果證實 SDK 修補，不等同專案外部輸入可達性。

Web 已使用 firebase-admin/app、auth、firestore modular imports；未發現正式程式依賴 14.0 移除的 legacy namespace。升級仍需驗證 Firestore 7→9 的型別、登入與授權失敗模式、交易，以及正常 SDK 行為。Functions 本來已為 14.5.0，更新為同 minor 的修補版。

## 已篩除的非本專案警報

- [Supabase Storage role none RLS bypass](https://github.com/supabase/storage/security/advisories/GHSA-fgvp-cqg6-q8h2)：官方標 Critical，受影響 <=1.89.8、修復 1.89.9，並明載 hosted platform already patched。此專案配置指向 Supabase Cloud、沒有找到自架 Storage image；JWT issuer role 固定 authenticated，不能由 supabase-js 2.117.3 推論 Storage server 未修補。
- [原生 Firestore eMudhra CA 修補](https://firebase.google.com/support/guides/compromised-emudhra-intermediate-ca?hl=en)：App Firestore 來自 firebase/firestore JS SDK，已查 Podfile.lock 無 FirebaseFirestore；不把原生 Apple／Flutter Firestore 公告套在 JS SDK 上。

## 驗證與下一步

實際執行紀錄、精確提交及 CI 終態以本 PR 描述為準。已完成的本機發布／回滾／雙程序安全檢查，不等同 Docker 容器、正式站或真機驗收。

發布前須：

1. 套用可重現的 legacy 源碼修補，重建並驗證 linux/amd64 standalone、route parity 與 synthetic auth contract。
2. 新 legacy immutable digest 已寫入組合映像來源，並保留上一個已驗證映像作回滾。正式站機器仍待另一次核准部署。
3. 對精確 PR head 執行適用 CI／CodeQL 與既有發布檢查，並取得 ruleset 26004626 要求的 App 5504170「審查通過」。不偽造或略過閘門。
4. 以標準 PR 合併，再由既有 main Web release 流程、鎖定 expected_revision 發布；核對兩台正式機器映像、兩個 Node 執行檔、Next 套件實例、公開 readiness revision 與核心功能。
5. 依實際現網啟用情況循既有流程發布 Functions；獨立 API overlay 的 Node 修補另外驗證，不能用 Web 成功代替。

使用者已授權本安全追蹤任務在條件齊備時自行修改、合併與部署。缺的是客觀驗證／發布能力時，完成可審查修補並記錄精確阻礙，不重複要求一般性授權，也不把待辦寫成已完成。
