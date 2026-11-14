# 宿舍工單與輔導員工作台（規格 PR 2）

## 範圍與入口

完整讀取 `/workspace/agent-backend/lanes-1114/宿舍-規格-v1.md`，以已合併 #626 的學生雲端清單為基礎。此次加入正式工單、外宿卡及職員工作台；室友組合、入住點檢照片／PDF 仍屬規格 PR 3，不在這次變更內。

手機 staff 首頁（有宿舍服務權限才顯示）、Dormitory、網頁 `/dormitory` 保留所有個人備忘及校方正式入口；開通後才有輔導員服務及備忘編輯表單中的「送給宿舍輔導員」。網頁另有 `/staff/dorm?schoolId=pu` 職員入口，沿用相同操作。`dorm_staff` 是 `staff` 的子身分，不新增頂層權限。權限判斷依本校有效 membership 及既有 `serviceRoles.packages / repairs`，不是依前端身分標籤。

正式工單五階段以 `dormStatus` 記錄，保留原 `status` 給既有讀取者；每次階段變更及重新開啟都附伺服器時間。學生可確認結案、在修好待確認或已結案後按「還沒修好」重開同一張單。舊備忘不冒充工單。舊 updateRepairStatus 對新工單轉交狀態機，舊備忘行為不變。

外宿卡填日期及原因，學生僅讀本人資料；具有 repairs 權限的輔導員核可／不核可，每次審核有時間。正式報修透過既有 Firestore 監聽更新今晚報修數量，今晚已核可外宿也會顯示；外宿與工作台每 15 秒重新讀取，並提供手動重新整理。申請不等於核可。

包裹依匯入名冊登錄，只搜尋值班棟別內名冊；連續登錄清空學號／品名並回到學號欄，保留領取地點。核對學生身分頁上的學號與姓名後可一次核銷；郵局／掛號／收發室資料不由本工作台批次核銷。每日 21:00 可開啟三天未領清單並標記退件，這是值班清單，不新增排程任務。鍵盤原生語音輸入可填品名。公告需先預覽，只通知該棟名冊內帳號，學生也能在宿舍服務重讀。

住服組管理員預設看到不含學生個資的各棟數量總覽，可匯出 CSV（手機用系統分享）、指派或移除宿舍服務權限，再自行切換業務分段。其他 serviceRoles domain 不被清空。平台營運不因此取得學生個資或跨校服務權限；以現有平台營運程序審核學校開通及部署，學校業務仍由校內 membership/serviceRoles 控制。

## 需晉瑋說「上」

此工作樹**沒有部署或變更正式資料**。部署與開通需另行核准：

- 部署新的 `dormWorkflow` callable 及更新的 `updateRepairStatus`；Fly runtime 依既有 exports 載入方式提供同名 callable。
- 逐校在 `schools/{schoolId}` 新增 `dormWorkflowEnabled: true` 才開通，缺省或 false 隱藏新服務。不可全校批次預設開啟。
- 新集合：`schools/{schoolId}/dormLeaves`、`dormResidents`、`dormAnnouncements`。均只由驗證身份與權限的 callable 讀寫，不新增客戶端 Firestore 存取權。
- `repairRequests` 新增 `workflow: dorm_staff`、`dormStatus`、`history`、`schoolReference`、`vendor`、`expectedDate`；`packages` 新資料增加 `studentId`、`building`、`description` 等名冊欄位。現有文件不回填、不遷移。
- `serviceRoles` 新增 `staffSubtype: dorm_staff` 與選填 `buildings`，並沿用 `packages`、`repairs`。新工作台對非空 buildings 套用本棟範圍；舊 API、舊規則不收緊。空白代表全棟，僅管理員可設定。變更寫入既有 `adminLogs`。
- 照片最多三張、每張 10MB，使用既有 `temp/{uid}` 上傳及 Storage 規則，不新增公開路徑；網址只隨工單提供給本人及授權職員。
- 沒有 SQL migration、Firestore rule、Storage rule 或複合 index 變更。沒有自動執行資料遷移。正式開通前請提供真實住宿生名冊及輔導員帳號，並驗證通知設備設定。

## 驗收

1. 未開通學校與訪客：看不到正式送單、外宿申請及職員控制；舊備忘、複製及校方電話仍可用。
2. 開通校：學生編輯備忘，附最多三張照片、填棟房後送給輔導員；在本頁收到五階段進度與每一步時間。輔導員填學校單號後，學生看見「學校單號 A123（輔導員填）」。
3. 輔導員依序收件→安排→修好；學生確認結案或重新開啟，重開保留全部時間紀錄。職員不可代學生確認結案；其他學生不能改此工單。
4. 外宿卡核可／不核可均回到本人，第二次審核被拒。不同棟職員不能改單。
5. 名冊 CSV 四欄（學號、棟、房、床）；不屬本校、沒有唯一已啟用帳號、重複學號或格式錯誤須修正後重試。名冊原子寫入；不在名冊的包裹登錄拒絕。
6. 登錄十件包裹並實測平均十秒以內、裝置一分鐘內收到推播；這是現場驗收目標，本 PR 沒有宣稱已完成真機量測。通知失敗不回滾已建立的工單／包裹。
7. 學生學號核對後全部核銷、三天未領標記退件；公告預覽後發布，僅對本棟名冊成員推播。
8. 管理員匯出只有各棟數量、無學生姓名／學號／原因；權限異動有稽核。平台營運不能冒用校內職員。

工作天依台灣時區週一至週五計算，尚未接校曆假日。照片選取取消不建立工單。網路失敗後重試申請／包裹使用同一代碼，避免重複寫入；離開頁面後重新送相同內容仍視為新的主動申請。

## 回滾

先將指定學校 `dormWorkflowEnabled` 關閉，阻止新工作台操作，再回滾前端與 callable 部署。保留工單、外宿卡、名冊及公告，不刪除資料、不反向遷移；學生既有包裹／備忘頁、原有 API 與 serviceRoles 其他 domain 繼續可用。重新開通可讀回保留的工單。若只需撤銷特定輔導員，透過管理員移除宿舍服務權限，不變更其其他服務 domain。

## 自動驗證結果

- 後端：`jest dormWorkflow.test.js authz.test.js --runInBand`，21 項通過；新 handler 的 ESLint、index.js 語法檢查通過。
- 網頁：DormWorkflow、整個 dormitory 與 dormitory 工具測試，54 項通過；最後變更後另重跑相關 18 項通過。
- 手機：DormWorkflow、DormStaffHome、dormitoryWorkspace、aiSchoolScopedFallback、PublicSchoolServicesNavigation、AgentCardsDormitoryRedirect、releaseNavigation，118 項通過；最後 UI 變更後另重跑兩個新元件的 5 項通過。
- web、mobile、shared 全專案 typecheck 通過。工作樹的 node_modules 連至別的 checkout，直接跑 mobile tsc 會找不到本工作樹 @campus/shared；驗證用 `/tmp/dorm-*-tsconfig.json` 繼承原設定，只將 workspace 與 `@/` 解析指向本工作樹絕對路徑，web 額外指定既有 vitest/globals 型別。沒有排除原本檢查的檔案。手機 Jest 同理使用 `/tmp/dorm-mobile-jest.cjs`，只補共享套件映射。
- 使用環境現有 Node 24，套件引擎要求 Node 20／22，工具會顯示 engine warning；沒有安裝套件、更新 lockfile 或更換 symlink。
- 未連正式資料做寫入驗收；尚待校方裝置驗證推播、十件包裹操作時間及正式 Firebase Storage 照片權限。沒有生產 migration 或部署。

名冊匯入為新增／更新；「移出住宿名冊」保留原紀錄並設 `active: false`，不再出現在自動完成、公告對象或接受新包裹。重新匯入可恢復，不會自動刪除未列在 CSV 的住宿生。
