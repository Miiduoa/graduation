> R2 審查修正：新增權限與寫入流程已隔離，尚未接入正式產品。移除 hosted callable 註冊、派送與速率例外，Web／手機入口恢復本 PR 前的既有頁面與操作；新增 ClubPortal 元件及 handler 僅保留供測試與後續獨立 PR 審核。沒有新增開關，沒有部署。下方原交付說明為後續整合設計，不代表目前可從正式路由呼叫。

# 社團 PR 2：學號入社與幹部操作

完整閱讀 `社團-規格-v1.md`（2026-11-14）後，接續 #624 的唯讀頁面。所有新增操作使用 nuni-web `/api/fn/clubPortal` 與真實 Firestore；不依賴未部署的 clubAdmin Functions，也不受舊試辦旗標限制。舊 clubAdmin、原有頁面、邀請碼和擁有權轉讓維持可用。沒有新增依賴、環境旗標或部署動作。

## 已交付

- Web `/clubs`、手機既有 Groups：我的社團／找社團。只列出課外組核可資料；搜尋社名、學校分類，展示社課時間、招新狀態。手機在 Groups 頁內開啟新社團服務，未加入者不必先進入受會籍限制的 GroupDetail。沒有註冊 MapStack 或修改導覽殼層。
- 有效本校學號身分一鍵加入開放社團，或申請、等待、通過／不通過（選填理由）；核准時重驗學校與帳號。會籍、人數、users/groups 索引在同一交易更新，重送不重複計數。退出沿用既有會籍／索引模型，社長須先完成既有擁有權轉讓。
- 幹部管理：社員名單、電話缺資料顯示「未提供」、社費自記（不向學生回傳）、編輯介紹／社課時間／IG／LINE／入社方式、既有 posts 公告、clubEvents 活動。活動有名額、兩種截止、社員／本校公開範圍；學生看到伺服器確認的報名與簽到狀態。
- 簽到：QR、學號後四碼（重複後四碼要求 QR）、手機／Web 相機、名單核對、重複簽到時間、社員現場加入標記。手機成功輕震動。離線佇列依帳號／學校／社團／活動隔離，連線重送，伺服器確認才移除；失敗保留並可重試、明確確認清除。
- 課外組與具本校授權的維運人員可在找社團內進管理清單、核可／停權、學校分類、名冊與活動 CSV；沒有跨校超級權限。電話只有社團幹部取得。頁面不宣稱校方評鑑或經費結果。

## 需晉瑋說「上」

以下全部只提交程式碼；本 PR 未部署、未寫入正式資料，也沒有執行 migration。

1. 新 hosted callable `clubPortal` 的部署與 API 權限檢查：登入 uid、帳號有效性、`schools/{schoolId}/members/{uid}.status == active`；每次交易都檢查，並核對 group.type、schoolId。現有 token/session 驗證程式未變更；只有 callable 路由與獨立速率預算的派送調整。
2. 新增校方權威名錄 `schools/{schoolId}/clubs/{groupId}`：status（approved/suspended）、category、confirmedBy、confirmedAt。不得從 `groups.verification` 或幹部可編輯資料推論正式社團。學校應自行確認真實名單；本 PR 不 seed、不 backfill、不假造名單。未核可仍可走既有邀請碼。
3. 課外組權限：有效本校 `members.role == admin`；或 `role == staff` 加上既有 `serviceRoles/{uid}` 的 `status == active`、新增權限欄位 `clubs == true`。維運人員也必須取得同校授權；不從客戶端、使用者自填角色或 demoRole 取權。這是工作權限，沒有社團總開關。
4. 新申請子集合 `groups/{id}/joinRequests/{uid}`：pending/approved/declined、displayName、reason、requestedAt、reviewedBy、reviewedAt。只由 Admin SDK 寫入；本人只能從 API 取得自己的狀態／理由，幹部取得待審清單。新路徑目前受既有預設拒絕規則保護，無 Firestore 規則變更。
5. 新 `groups.clubProfile`：meetingTime、recruiting、joinPolicy、instagram、line；既有 name/description 仍由 owner/admin 編輯。API 僅接受指定欄位，校方認證分開保存。IG／LINE 僅接受相對應官方網域的 HTTPS 外連，讀取舊資料亦過濾。
6. 新增幹部私有子集合 `groups/{id}/clubMemberRecords/{uid}` 保存 duesPaid、updatedBy、updatedAt，只由 API 幹部讀寫，沿用新路徑的預設拒絕規則，不縮限原有 members 的讀取權限；沿用既有 posts 公告模型、clubEvents 及 registrations，新增 capacity、registrationDeadline、cancellationDeadline、visibility、studentSuffix、onSite。建立／公告寫入有 operationId 重送檢查；報名容量與截止、簽到活動期間、幹部撤權皆由交易檢查。新入社交易會更新既有 memberCount 及 users/groups 索引；舊資料若人數不合法會明確要求修復，不猜測人數。
7. 名冊／活動 API 與匯出權限僅 owner/admin 或本校課外組；一般學生不取得他人識別碼、電話、社費、申請名單。CSV 防止試算表公式注入。私人簽到佇列位於 Web localStorage／手機 AsyncStorage，只有 scoped 簽到碼、不存名單電話，需納入校方資料留存審查。
8. 無新增 table、SQL migration、Firestore index 或規則檔變更。目錄使用校方名錄 status 等值查詢；管理清單使用 schoolId/type 等值查詢。若正式環境關閉既有單欄索引，需另行審查恢復索引，不能直接上線臨時修規則。

## 明確範圍與限制

規格 PR 3 的接受式交接、舊幹部整批撤權、評鑑年度包 PDF、校園活動送審發布，尚未實作；不把既有立即擁有權轉讓冒充新交接。校級 `schools/{id}/clubEvents` 不會被本 PR 寫入或混入社團活動。今天頁／課表整合須另接日曆流程，未修改 #627 正在整理的入口與首頁。

簽到佇列連網後仍以伺服器活動期間和當下權限判定；活動結束才送達的紀錄保留待處理，不偽造成功。現場加入入口核對既有社員，公開活動的非社員須先在 App 報名。Web 相機先填入碼，再按確認；手機掃描即送出。後四碼只讀目前可取得的學校／本人學號資料；缺資料顯示未提供，仍可用 QR。

名冊每頁 100 位、待審申請每頁 100 筆、活動每頁 20 場，各自回傳游標；每場最多 1000 筆報名。活動名單依報名者 UID 每批 100 筆查詢學校 directory 姓名，包含尚未入社的公開活動報名者。公告沿用最近 20 則貼文中的最新 3 則公告。CSV 為名冊／活動統計，並非完整評鑑年度包。

課外組入口放在社團檔案內以避開 #627 導覽衝突；工作台入口可於整合 PR 補連結。平台角色在此規格沒有額外跨校授權定義，因此維運視圖沿用本校明確授權，不能只憑平台身分讀取全校社員個資。

## 驗證

測試紀錄與指令見 PR body；所有暫存設定、編譯快取與 log 均置於 `/tmp/club-*`。由於 node_modules 是指向其他 checkout 的既有 symlink，手機檢查用 /tmp 設定將 shared 路徑指回此工作樹，未安裝套件也未替換 symlink。

## 回復

revert 本 PR 即恢復 #624 唯讀 UI；邀請碼與既有群組頁不需復原資料。新增官方名錄、申請紀錄與既有會籍均保留，不刪除或反向扣除已成功入社的人數。若只撤回新 API，應一併撤回新 UI，避免留下會回 404 的操作。任何正式部署或資料調整仍需另獲「上」。

### 補充審查項目

- `schools/{schoolId}/clubs/{groupId}/officers/{uid}` 保存課外組逐筆確認的角色、確認人與時間。畫面對照即時會籍角色，角色不同即顯示待確認。這個確認不替代 PR 3 的接受式交接／舊幹部整批撤權，仍需正式權限與資料審查後才可上。
- 社團 API 採獨立每帳號每分鐘 240 次的程序內速率預算，避開共用 10 次預算造成連續 30 人簽到失敗；其餘 API 預算不變。此為容量保護，非權限或認證替代；未改登入、token 驗證或 session 邏輯。
- 手機退出從 clubPortal 交易更新既有會籍、索引與人數；Web 仍用既有 leaveMemberGroup 並保留作用域檢查。退出成功即清除社員畫面，避免離開未核可社團後再讀遭拒而誤報退出失敗。
- 手機可分享真正的 UTF-8 CSV 檔，分享結束會清除裝置暫存檔；不支援檔案分享的平台才改用文字分享。


## 審查修正

- 名冊 API、Web／手機與 CSV 移除完整學號；簽到比對仍留在伺服器。
- 現場報名在同一交易檢查有效報名數及名額，滿額拒絕，已報名者重送簽到不占新名額。
- 名冊每頁 100 位、活動每頁 20 場，以文件識別碼游標繼續讀取；Web／手機保留已載入內容，載入失敗可重試。CSV 明示匯出已載入資料。
- 本次修正未改授權判斷、登入、session、Firestore 規則或 migration；原 PR 上述「需晉瑋說『上』」項目仍適用。

- R2：移除正式入口的新授權派送，回復既有入口，屬審查要求的狹義權限隔離修正；登入、session、規則與 migration 未變更。申請新增獨立游標及雙端載入更多；活動姓名不再依賴社員當頁。

### R2 驗證

- Web 8 個相關測試檔共 68 項通過；涵蓋 API 隔離、既有派送與頁面、雙端分頁、報名姓名及個資界線。
- 手機 4 個相關測試檔共 22 項通過；原本 ClubPortal 測試另存專檔，並恢復既有 ClubProfile 回歸測試。
- 測試／型別檢查用的 shared 路徑在 `/tmp` 指回本工作樹；Web 補入既有 Vitest globals 型別，未改專案設定。環境 Node 為 24.22.1，pnpm 提示超出專案宣告版本範圍，未安裝或替換執行環境。
- Web、手機、shared 完整 typecheck 均通過；Prettier 與 git diff --check 通過。所有本輪 /tmp/club-r2-* 暫存設定、快取與 log 於完成後清除。
