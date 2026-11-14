# 宿舍工單與輔導員工作台（規格 PR 2）

## 範圍與入口

完整讀取 `/workspace/agent-backend/lanes-1114/宿舍-規格-v1.md`，以已合併 #626 的學生雲端清單為基礎。此次加入正式工單、外宿卡及職員工作台；室友組合、入住點檢照片／PDF 仍屬規格 PR 3，不在這次變更內。

手機 staff 首頁（有宿舍服務權限才顯示）、Dormitory、網頁 `/dormitory` 保留所有個人備忘及校方正式入口；開通後才有輔導員服務及備忘編輯表單中的「送給宿舍輔導員」。網頁另有 `/staff/dorm?schoolId=pu` 職員入口，沿用相同操作。`dorm_staff` 是 `staff` 的子身分，不新增頂層權限。權限判斷依本校有效 membership 及獨立 `dormStaffRoles.packages / repairs`；沒有宿舍授權紀錄的既有服務人員仍沿用既有 serviceRoles，不是依前端身分標籤。

正式工單五階段以 `dormStatus` 記錄，保留 `status` 對應欄位，完整內容僅透過 callable 讀取；每次階段變更及重新開啟都附伺服器時間。學生可確認結案、在修好待確認或已結案後按「還沒修好」重開同一張單。舊備忘不冒充工單。新工單透過 dormWorkflow 狀態機操作，舊備忘與舊 API 行為保留。

外宿卡填日期及原因，學生僅讀本人資料；具有 repairs 權限的輔導員核可／不核可，每次審核有時間。正式報修透過本人 callable 查詢更新今晚報修數量，今晚已核可外宿也會顯示；外宿與工作台每 15 秒重新讀取，並提供手動重新整理。申請不等於核可。

包裹依匯入名冊登錄，只搜尋值班棟別內名冊；連續登錄清空學號／品名並回到學號欄，保留領取地點。核對學生身分頁上的學號與姓名後可一次核銷；郵局／掛號／收發室資料不由本工作台批次核銷。每日 21:00 可開啟三天未領清單並標記退件，這是值班清單，不新增排程任務。鍵盤原生語音輸入可填品名。公告需先預覽，只通知該棟名冊內帳號，學生也能在宿舍服務重讀。

住服組管理員預設看到不含學生個資的各棟數量總覽，可匯出 CSV（手機用系統分享）、指派或移除宿舍服務權限，再自行切換業務分段。其他 serviceRoles domain 不被清空。平台營運不因此取得學生個資或跨校服務權限；以現有平台營運程序審核學校開通及部署，學校業務仍由校內 membership/serviceRoles 控制。

## 需晉瑋說「上」

此工作樹**沒有部署或變更正式資料**。部署與開通需另行核准：

- 部署新的 `dormWorkflow` callable 及更新的 `updateRepairStatus`；Fly runtime 依既有 exports 載入方式提供同名 callable。
- 逐校在 `schools/{schoolId}` 新增 `dormWorkflowEnabled: true` 才開通，缺省或 false 隱藏新服務。不可全校批次預設開啟。
- 新集合：`schools/{schoolId}/dormLeaves`、`dormResidents`、`dormAnnouncements`。均只由驗證身份與權限的 callable 讀寫，不新增客戶端 Firestore 存取權。
- 完整報修資料寫入 `dormRepairs`，包裹學號、棟別寫入 `dormPackages`，不進入舊規則允許全校服務人員直接讀取的集合。學生既有 `packages` feed 僅保留 recipientId、品名、地點、狀態、到件時間，不含學號、棟別或名冊資料；登錄與核銷同步原子更新。
- 管理員指派／撤銷宿舍權限只寫入獨立 `dormStaffRoles`（packages、repairs、buildings），不再寫共用 `serviceRoles`，既有服務的有效權限不變。非空 buildings 限定棟別，空白代表全棟，僅管理員可設定；異動寫入 `adminLogs`。未修改共用登入；本 PR 的共用 postLoginRoles／roles 解析有將 `dorm_staff` 映射為 `staff`，屬權限相關變更。
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

先將指定學校 `dormWorkflowEnabled` 關閉，阻止新工作台操作，再回滾前端與 callable 部署。保留工單、外宿卡、名冊及公告，不刪除資料、不反向遷移；學生既有包裹／備忘頁、原有 API 與 serviceRoles 其他 domain 繼續可用。關閉後學生仍可讀取本人歷史工單與外宿紀錄（唯讀），重新開通後恢復操作。若只需撤銷特定輔導員，透過管理員移除宿舍服務權限，不變更其其他服務 domain。

## 自動驗證結果

- 後端：`jest dormWorkflow.test.js authz.test.js --runInBand`，21 項通過；新 handler 的 ESLint、index.js 語法檢查通過。
- 網頁：DormWorkflow、整個 dormitory 與 dormitory 工具測試，54 項通過；最後變更後另重跑相關 18 項通過。
- 手機：DormWorkflow、DormStaffHome、dormitoryWorkspace、aiSchoolScopedFallback、PublicSchoolServicesNavigation、AgentCardsDormitoryRedirect、releaseNavigation，118 項通過；最後 UI 變更後另重跑兩個新元件的 5 項通過。
- web、mobile、shared 全專案 typecheck 通過。工作樹的 node_modules 連至別的 checkout，直接跑 mobile tsc 會找不到本工作樹 @campus/shared；驗證用 `/tmp/dorm-*-tsconfig.json` 繼承原設定，只將 workspace 與 `@/` 解析指向本工作樹絕對路徑，web 額外指定既有 vitest/globals 型別。沒有排除原本檢查的檔案。手機 Jest 同理使用 `/tmp/dorm-mobile-jest.cjs`，只補共享套件映射。
- 使用環境現有 Node 24，套件引擎要求 Node 20／22，工具會顯示 engine warning；沒有安裝套件、更新 lockfile 或更換 symlink。
- 未連正式資料做寫入驗收；尚待校方裝置驗證推播、十件包裹操作時間及正式 Firebase Storage 照片權限。沒有生產 migration 或部署。

名冊匯入為新增／更新；「移出住宿名冊」保留原紀錄並設 `active: false`，不再出現在自動完成、公告對象或接受新包裹。重新匯入可恢復，不會自動刪除未列在 CSV 的住宿生。

## 審查修正（R1）

- P1：名冊匯入改用 Firestore transaction，先讀取整批既有名冊並檢查原棟別，再寫入；包含已移出的住宿生。跨棟移轉僅限學校管理員，即使職員同時負責兩棟也不能移轉。
- P1（依審查要求隔離的權限修正）：僅修改宿舍 handler 的 setStaff 寫入。當共用 serviceRoles 原為 inactive，而此次授予宿舍服務時，將非宿舍 domain（沿用既有 SERVICE_ROLE_DOMAINS 清單）的旗標明確設為 false，避免共用 status 啟用時恢復舊權限。原為 active 的其他服務保持原狀；其他中繼資料保留。這會清除停用紀錄中的舊服務旗標，未來若要恢復該服務須另外明確授權。
- 有登入權限migration變更：上述為審查要求的狹義權限修正，仍屬「需晉瑋說『上』」的權限部署範圍；未修改登入、sessions、共用 authz、角色解析、Firestore／Storage rules 或 migration，未部署或操作正式資料。
- 新增 5 項回歸案例，涵蓋跨棟覆寫、停用名冊、管理員移轉、同棟更新、多棟職員限制，以及 active／inactive 的其他服務有效權限與撤權結果。
- 驗證：dormWorkflow.test.js、authz.test.js 共 26 項通過；shared typecheck、兩個變更 JS 檔案的 ESLint、handler 語法檢查、git diff --check 通過。執行環境為既有 Node 24，套件要求 Node 20／22，工具有引擎版本警告；無新增依賴、安裝套件或更動 node_modules symlink，未建立暫存檔。

## 審查修正（R2，取代 R1 的共用授權寫入方式）

- P1：依審查要求隔離宿舍授權與個資集合，改用 dormStaffRoles、dormRepairs、dormPackages；完整內容只經 callable 的成員、domain 與棟別檢查。保留既有 serviceRoles／舊服務 API，不清除、不啟用任何共用 domain。新授權無法取得舊 Firestore 全校 packages／repairRequests 讀權。
- P2：學校關閉開通旗標後，mine 仍只查本人歷史；兩端保留狀態時間軸、照片與外宿紀錄，隱藏所有寫入操作。今晚宿舍摘要改接本人 callable 結果，避免隔離集合後漏計正式報修。
- P2：兩端修改包裹搜尋文字立即清除已選學號；必須重新選取目前名冊結果才能啟用登錄。
- 有登入權限migration變更：本次只在宿舍 handler 內進行審查要求的狹義權限／儲存隔離；未改登入、sessions、共用 authz、角色解析、Firestore／Storage rules 或 migration。新增集合與 callable 部署仍屬「需晉瑋說『上』」，本次未部署、未回填或遷移正式資料。此為尚未開通的 PR 資料模型修正，不自動轉移舊試驗資料或撤回過去另行核發的 serviceRoles。
- R2 驗證：後端 dormWorkflow／authz 28 項、web DormWorkflow／dormitory 46 項、手機 DormWorkflow／DormStaffHome／dormitoryWorkspace 11 項通過；web、mobile、shared 全專案 typecheck、宿舍後端 ESLint、git diff --check 通過。使用 /tmp 的 tsconfig／Jest 設定只修正共享 node_modules symlink 的 workspace 解析；未排除檔案，驗證後刪除暫存設定。環境仍為 Node 24，套件引擎要求 20／22，無安裝依賴或更換 symlink。


## 審查修正（R3）

- Web／mobile 的包裹搜尋改為同步清空選取學號，選取結果時一次更新搜尋與學號。登錄送出當下以 ref 核對目前選取學號與名冊，拒絕舊 render 排隊的送出事件；新增舊事件回歸測試。
- 能力狀態以 uid＋schoolId 綁定；身分或學校改變立即視為未知並重新查詢。未知／連線失敗保留宿舍入口。config 與輪詢使用不同取消代碼，避免輪詢清理丟棄新 config；手機職員首頁也套用相同的未知預設與身分綁定。
- 既有 confirmPackagePickup 在單一 transaction 內檢查收件人並更新 packages 與存在的 dormPackages，保留舊包裹支援；已退件包裹不可再領取。回歸涵蓋既有入口領取、工作台狀態、禁止事後退件、非本人拒絕及舊包裹。
- 更正前述 R1／R2「未改共用角色解析」的記錄：該描述僅適用當輪新增修正，不適用整份 PR。本 PR 原有 postLoginRoles／roles 的 dorm_staff → staff 解析變更仍存在，必須如實列為權限相關範圍；本輪未修改該映射、登入、rules 或 migration，也未部署。
- 驗證：後端 dormWorkflow／authz 30 項、web DormWorkflow／dormitory 47 項、mobile DormWorkflow／DormStaffHome／dormitoryWorkspace 14 項通過；web、mobile、shared 全專案 typecheck、變更後端模組 ESLint、index.js 語法與 git diff --check 通過。沿用 /tmp 驗證設定修正共享 node_modules 的 workspace 解析，未排除檔案、安裝依賴或更換 symlink。

## 指定審查修正（2026-11-14）

- P1：撤回 shared roles／postLoginRoles 的 `dorm_staff → staff` 共用映射；宿舍頁面的職員工作台繼續依 callable capability 判斷，不擴大全域職員身分。
- P2：外宿新增時在 transaction 以登入 UID 查啟用住宿名冊，由伺服器決定棟房；無名冊、停用或多筆有效住宿紀錄時拒絕建立。審核 transaction 再讀取名冊，棟房異動或停用後不可核准原申請。
- P2：既有包裹領取只在有對應 dormPackages 時套用退件限制；舊包裹維持原收件人確認領取行為，新宿舍包裹仍同步更新兩份紀錄。
- 有登入權限migration變更：本輪依指定審查要求，僅撤回兩行共用角色映射並在宿舍外宿流程內加入名冊檢查；未修改登入、sessions、共用 authz、ACL／Firestore／Storage rules 或 migration，未部署與操作正式資料。宿舍新增集合及授權仍屬需晉瑋說「上」的部署範圍。
- 新增角色隔離、偽造棟房、缺漏／停用／重複名冊、審核前棟房異動、舊退件包裹相容與新流程退件限制的回歸測試。
- 驗證：後端 dormWorkflow／authz 36 項、shared 角色解析 14 項、Web DormWorkflow／cloud 21 項測試通過；shared、mobile、web 全專案 typecheck、變更後端檔案 ESLint、JS 語法與 git diff --check 通過。首次直接執行的 Jest 因 ESM 相依套件失敗，改用既有 backend Jest 設定即通過；直接 typecheck 的共享套件解析問題，使用 /tmp 設定指向此工作樹修正，未排除檔案。暫存設定與輸出已刪除。沿用 Node 24 與現有依賴，未安裝套件或更動 node_modules symlink。

## 指定 R2 審查結果修正（學號綁定與包裹競態）

- P1：名冊匯入不再查詢客戶端可修改的 users.studentId，改用既有 schools/{schoolId}/members 的伺服器維護學號映射，並要求唯一且啟用的本校成員。名冊姓名同樣取自成員紀錄。缺少已驗證映射或存在重複映射時拒絕匯入，不能退回可修改的個人資料；須由既有已驗證校務登入／校方維護流程補齊成員學號。
- P2：包裹及名冊在同一 transaction 讀取，於建立兩份包裹紀錄前驗證最新啟用狀態及棟別。transaction 回傳成功提交的包裹，推播只使用該收件人；重試不沿用失敗嘗試的收件人。已成功的相同重試代碼直接回傳成功，不重複通知。
- 本輪涉及審查要求的狹義身分綁定修正，隔離在宿舍 handler；未改登入、sessions、共用 authz、ACL、Firestore／Storage rules 或 migration，未新增集合、依賴或部署。既有 PR 的宿舍授權部署範圍仍須依原流程核准。
- 新增 5 項回歸案例，涵蓋個人資料偽造／重複學號、重複伺服器映射、並行停用／移棟，以及 transaction 重試更換收件人與冪等通知。
- 驗證：dormWorkflow.test.js、authz.test.js 共 41 項通過；shared typecheck、兩個變更 JS 檔案 ESLint、handler 語法檢查及 git diff --check 通過。只修改後端 JS 與本驗證文件，未變更前端型別。使用既有 Node 24（套件引擎為 20／22，工具有警告）；未安裝依賴、更換 node_modules symlink或建立暫存檔。
