# 2026-11-26 合併閘門覆核

## 覆核版本與結論

本輪在獨立工作樹覆核整合候選 `ab6787be8027cc51870c8071ecf59cc4b909465a`，tree 為 `5a6805f33fa152ad94429a7d243d57285a2ed30b`。來源安全提案為 [PR #798](https://github.com/Miiduoa/graduation/pull/798)，查核時 head 為 `8cfc9f182b734c143b7f8ba261c4328684137bac`；主線為 `b04c38dc8074c8eb26a46c11c322a6322fbef73c`。

**候選可保留停用的閘門程式供既有程序審查；本輪不具備啟用或發出 App 核准的證據。** `scripts/merge-gate/policy.json` 的 `publicationEnabled` 維持 `false`。此報告是 AI 程式覆核及可重現本機驗證紀錄，不是 GitHub App `5504170` 的「審查通過」。

## #798 的 P1 保留未結案

[原始討論](https://github.com/Miiduoa/graduation/pull/798#discussion_r4692803692) 的 thread ID 是 `PRRT_kwDORvCyI8670T0G`。本輪讀取 GitHub 時仍為 `is_resolved=false`、`is_outdated=false`。問題要求：同一 head 已取得 App 成功紀錄後，CI 重新執行而失敗、尚在執行，或新增未解決討論時，必須阻擋合併，並驗證舊核准失效。

目前程式已補上以下處理：

| 控制點 | 目前程式與驗證 |
| --- | --- |
| 合併時仍有效的原生限制 | `gate.mjs` 的 `validateNativeRules()` 要求嚴格同步主線、來源固定的必要 checks，以及 GitHub 原生討論結案條件。缺少任一條件即拒絕。 |
| 精確版本與最新工作嘗試 | `verify()`、`verifiedRuns()`、`verifiedJob()` 核對 PR、head、base、來源 repository、最新 `run_attempt`、job/check 身分與成功結果；並重新讀取 review、留言及未解決 threads。 |
| 重新執行與討論事件 | `nuni-merge-gate-revalidate.yml` 監聽 `workflow_run` 的 `requested`、`in_progress`、`completed`；`in_progress` 覆蓋不會產生 `requested` 的重跑。無 checkout、無權限的 review relay 轉送審查／逐行討論事件，另外每 15 分鐘查核無直接 Actions 事件的變動。 |
| 舊核准撤銷 | `invalidPublishedChecks()` 僅檢查該 App 自己具有 `nuni-gate:v2:` 識別的成功紀錄。`revokeIfStillInvalid()` 在寫入前再次讀取 GitHub，核對 check ID、head、完整稽核識別、網址及完成時間，僅可改成失敗，不能恢復成功。其他 App、既有人工核准及其他 head 均不修改。 |
| 保護憑證與並行順序 | 發行與撤銷共用 `nuni-merge-gate-publisher` lock；工作只取受信任的 `main` 版本。App token 綁單一 repository 且僅請求 `checks:write`，使用後撤銷。 |
| 啟用前停止 | `requirePublicationEnabled()` 在 approve／publish 進入環境與金鑰流程前拒絕。測試只在無真實憑證的子程序 fixture 模擬未來啟用路徑。 |

以上回歸涵蓋舊成功紀錄遇到 CI 失敗／執行中、新未解決討論、review 撤回、指令修改、base 變更、原生限制停用、資料無法取得，以及等待環境核准期間證據改變。這些程式案例均通過。**P1 的程式處理已有實作，正式 GitHub 行為仍缺完整現場驗收，因此保留原討論與停用狀態。**

### 正式環境仍缺的證據

本輪唯讀取得的 [ruleset 26004626](https://github.com/Miiduoa/graduation/rules/26004626) 為 active、嚴格同步、要求討論解決、空白 bypass 名單，`current_user_can_bypass=never`。當時只包含下列六項必要 checks：

| Check | GitHub App ID |
| --- | --- |
| 審查通過 | 5504170 |
| CI Summary | 15368 |
| Analyze (javascript-typescript) | 15368 |
| CodeQL | 57789 |
| policy-and-postgres | 15368 |
| EAS Update (Preview) | 15368 |

候選所要求的 `Maestro PR result`、`Mobile agent PR result`、`Spatial browser PR result` 尚未納入正式規則。候選閘門 workflows 與 `scripts/merge-gate` 當時也尚未進入主線。非同步撤銷工作可能等候環境核准，其執行速度不能代替 GitHub 原生即時阻擋。

在獨立啟用變更前，仍須由既有真正 App 程序驗證：

1. 保留目前限制，核對三項條件式結果已在主線出現且由指定 App 產生，再查核正式規則與空白 bypass 名單。
2. 在不影響正式資料的受控 PR 上，先取得可核對 head/base 與稽核識別的真正 App 成功紀錄。
3. 在相同 head 上實際重跑必要工作，確認執行中及失敗均無法合併；另外新增未解決討論，確認同樣無法合併。保存 GitHub 的實際拒絕結果與工作連結。
4. 核對舊 App 紀錄的實際撤銷、保護環境的審批與最小 token 權限；證據恢復後，也必須重新核對目前版本，不能沿用失效核准。

本輪不把原 P1 標成 resolved，不透過整合 PR 視為已完成以上驗收，也不把停用候選改為可發行核准。

## 工作流程與固定物件指紋

覆核 #768 與 #798 的工作流程差異後，更新 12 項確切 workflow blob pins；目前完整清單包含 46 個非 gate workflows。新增 AI Workspace／First Value 瀏覽器工作只讀原始碼、停用 checkout 憑證持續保存，無正式環境密鑰。CI 增補隔離測試、固定 Ubuntu 與共用安裝程式；Release 的 `build_only_sha` 必須等於 GitHub 選定的完整 `GITHUB_SHA`，並限制 production 且禁止商店提交，保留既有主線與環境限制。

Maestro 合併同時保留 #768 的固定 CocoaPods 版本與 `pod install --deployment`，以及 #798 的精確 PR 分類、完整流程、結果匯總與獨立 emulator entrypoint。測試入口只接受 `demo-campus-one`、指定 loopback ports、關閉 mock／通用測試帳號，使用 Firebase emulator 的實際身分；正常 App entrypoint 不載入它。Mobile／Spatial／Maestro 三個匯總均拒絕分類失敗、缺少結果、取消或適用測試被略過。

`EAS Update (Preview)` 的 skipped 來自既有可選 preview label 條件。此狀態不代表已產生預覽或正式部署。

## 可重現驗證

驗證使用 Node `22.23.5`、Gitleaks `8.24.3`。各結果獨立列出，不以相加數字代替完整產品驗收。

| 指令／範圍 | 實際結果 |
| --- | --- |
| `node --test scripts/merge-gate/*.test.mjs` | 57 passed、0 failed、0 skipped；含完整 inventory／blob pins、同 head 失效與撤銷、無憑證環境及 hold 測試 |
| `python3 scripts/merge-gate/maestro-reports.test.py` | 1 passed |
| `node --test scripts/security/verify-gitleaks-history.test.mjs` | 30 passed、0 failed、0 skipped |
| `node scripts/security/verify-gitleaks-history.mjs positive-control` | 7 個已審位置的新隨機秘密均被原始規則偵測 |
| 實際 Git 歷史物件核對 | 25 組 alias 的完整來源／觀察 blob 均相同；CocoaPods 的完整歷史檔與精確行內容通過；缺少的 3 個歷史物件以 `--no-write-fetch-head` 取回，未移動任何分支 |
| 公開 workflow SHA 誤報核對 | 原政策 blob `7fc7c50d7add53919c401d2729464e5b93fb347a`、原第 18 行、來源 commit 與 baseline 兩棵樹，均指向 course-access workflow blob `11d270b1acd222b158b2a182e46d7ccb3c3aa099` |

歷史例外仍綁 commit／path／rule／line 與完整檔案物件；新增公開 workflow 記錄通過原始 policy 及兩棵歷史樹核對，沒有加入路徑級忽略。完整歷史掃描、整合後產品 CI、指定 App 核准與部署結果由本輪整合紀錄分別記載。
