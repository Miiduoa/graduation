# 2026-11-24 全分支整合決策

## 來源範圍

本輪延續 PR #753 的候選 `98af9155665be9c52b2140a95084a9e95a45b3e1`，主線基準為 `15bdca30796646d93263ddf8442eca248aa196b4`。於台灣時間 **2026-11-24 07:21:53** 固定 GitHub 現存的 **21 個 refs（20 個非 main 分支與 main）**；完整名稱、SHA 與 PR 對照見同目錄 `2026-11-24-all-branches-sources.json`。

新增整合來源為課程與紀錄編輯 #755 `f19e329b`、互動連續性 #756 `7ca15911`、首次使用 #757 `96e84d85`，以及 TronClass #616 `b1e99ec2`、地圖 #722 `e6e446dd` 的後續提交。其餘來源已包含於前一候選。全部來源均保留為候選祖先；來源快照後的其他分支提交不算本次已驗收範圍。

保留 main #740 的社群簡介決策，未恢復已撤回的複雜草稿還原、timeout UI、FirstCardRead bridge 或逐欄位 revision。四個 Web／Mobile CreatorCard 實作與測試檔相較 `98af9155` 均未改動。

## 整合決策與實測修補

### 個人紀錄編輯、取消與使用連續性

新編輯 Modal 與既有 AbortController 寫入保護有實質衝突。本輪保留草稿、未儲存確認、焦點還原、原紀錄版本檢查與防止重複提交，同時讓編輯及移除繼續傳遞 AbortSignal。等待鎖時的取消動作也能從最上層移除確認框操作。取消、切換帳號／校園或重新驗證後，舊操作不能在鎖釋放時遲到寫入；草稿仍能重試。

首頁保留原 AppFrame、教師情境及 TronClass 入口，再整合新的完整課程來源判斷。安裝建議依 #757 僅在 `/life` 出現；已修正仍期待首頁顯示提示的舊 AppFrame 測試，保留並擴充草稿／焦點、跨頁提示、關閉及不自動呼叫安裝 prompt 的斷言。

介面瀏覽器 QA 採功能聯集：原有 quick_search、navigation、feedback、task_flow、loading，加上 course_editing、record_editing、search_continuity 均保留。

### 地圖可見性與恢復

保留最後一筆匹配 host 的 observer entry、正交集面積、異常 getter 防護及空回呼無動作。新的 observerConfirmedVisible 也必須通過這些驗證。可量測的 dialog 裁切優先於過期的正向 observer。

首輪完整測試發現兩個恢復案例失敗：手動啟動的 ignoredViewport 同時忽略了「已重新可見」的正向幾何證據。修補將忽略限於遮蔽判斷；恢復仍須通過 viewport 與 dialog 的有效交集。原失敗斷言保留，未放寬 timeout。另修正鍵盤情境的 fixture，提供實際取得焦點的輸入元件。

保留來源新的搜尋／清除、目的地保留、平面圖工作階段、串流大小及 UTF-8 檢查。來源的 stale viewport 取捨亦保留：無 VirtualKeyboard 幾何時，新的正向 observer 加上 4 秒沒有 viewport 變動，可解除過期遮蔽狀態；已知鍵盤幾何、dialog 裁切與 pinch zoom 仍優先阻擋。這不代表能辨識所有鍵盤遮蔽。

### TronClass 與帳號邊界

納入清理／平台關閉 worker 的近期成功與 readiness 檢查、LMS cookies-only 的 AES v2 封裝、目標帳號登入額度及新的意圖辨識。保留學生角色、owner／school、authority epoch、停止／取消及 scope 隔離。

來源恢復的原生密碼綁定及 legacy 討論／問卷／互評寫入相關檔案，經逐檔確認與目前 main 完全相同；本輪不宣稱仍維持前輪歷史文件的全面唯讀描述。帳號刪除保留 UID 格式與控制字元保護，以及前輪既有的 TronClass owner closure barrier，其餘主線清理步驟未撤回。

衝突解決保留 owner-account／target-account 預算斷言、不建立舊 account scope 的斷言、route partial mock、emulator 的 vi import。Playwright installer 同時保留 timeout subprocess cleanup 與 inherited-monitor 回歸。

Firestore／Storage 規則、依賴與 lockfile、主 CI 及原生驗收政策相較 `98af9155` 無變更；本輪僅擴充來源新增的瀏覽器 QA。沒有更改部署設定、遠端功能開關或 App 審查規則。

## 本地證據及界線

使用專案指定 Node 22.23.5／pnpm 10.28.2，從 frozen lock 安裝。所有支線測試皆使用各自隔離工作樹；以下結果對應實際測試的支線版本，不把它們描述為同一次最終候選的全套測試。

| 範圍 | 實際證據 |
| --- | --- |
| UI 支線 `24499584` | Web 25 個不同檔案、779 個不同測試均取得最終通過證據；其中首輪 1 個 AppFrame 舊預期失敗，修正後 AppFrame／PWA 24 個測試全部通過。Mobile 5 檔 64／64 通過。 |
| 匯入／Modal | UI 上述範圍內 4 檔 160／160，包含取消、遲到寫入、帳號／校園與重驗中止。 |
| UI QA bundle | interface-design 建置成功，394 個來源雜湊；first-value 成功，147 個來源雜湊；8 組介面情境均列入 manifest。這是建置證據，非真實瀏覽器驗收。 |
| 地圖支線 `2f6fa2a0` | 3 檔 2,092／2,092、0 skipped；四個變更 TS／TSX lint 為 0 errors／4 個基準既有 warnings。 |
| TronClass 支線 `b2d71b77` | Web 19 檔 8,741、Mobile 12 suites 273、Functions 3 suites 240；installer 17、launcher 7，全部通過且 0 skipped。 |
| TronClass lint | Web 32 檔 0 errors／4 warnings；Mobile 16 檔 0 errors／15 warnings；Functions 5 檔與 edge 2 檔均 0 errors／0 warnings。 |

跨模組唯讀審閱確認：地圖 subtree 與已驗證地圖支線相同；Assistant、Web server、TronClass API／clients、Functions 與 shared 等安全相關範圍與已驗證 TronClass 支線相同。新共用 Modal／scroll、首頁完整來源、搜尋返回及 PWA observer 未發現額外的跨帳號回流或地圖焦點衝突。

總整合工作樹已完成完整 Web／Mobile／shared typecheck；最後 AppFrame 測試更新後，Web typecheck 再驗一次。Git whitespace、來源祖先及最終 tree 一致性於發布前檢查。最終 GitHub 候選 SHA、精確 head 的 CI／PostgreSQL／Firestore emulator、真實瀏覽器及 iOS Release／Maestro 結果由 PR #753 記錄；舊 `98af9155` 的綠燈僅為歷史，不能取代本輪驗收。

合入 main 仍需遵守既有 ruleset 26004626：由 nuni-merge-gate（App 5504170）對最終候選提供 `審查通過`。一般測試成功或普通 PR review 不能代替該 App 的核可。此文件不代表 main 已合併或已部署。
