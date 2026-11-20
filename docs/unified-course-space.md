# 課程空間整合

Web 統一使用 `/classroom/course/[workspaceId]`。原有學習路徑、教材、作業與測驗保留，新增點名及教師名冊。學生不會看到名冊分頁，也不會請求成員或出席名冊端點；教師沿用既有課程角色。封存課程僅能查看點名紀錄。

舊 `/auth/platform/class-workspace/[workspaceId]` 在伺服器導向新頁，保留課程 ID、邀請碼及其他查詢參數。舊點名入口預設開啟點名；舊課程、成員與掛靠分頁分別對應新頁的學習路徑或名冊。建立、加入課程及課程清單都直接前往統一頁。

App 課程新增點名及教師名冊。學生可輸入簽到碼，教師可查看目前或最近一堂課的出席、缺席與遲到名單。簽到送出後回查同一堂課的 `checkedInByMe` 才顯示完成；回應遺失或回查失敗時先確認狀態，避免直接重送。帳號、課程或角色改變，以及收到存取拒絕時，會清除舊名冊並忽略遲到回應。

## API 接法與限制

本次未新增後端端點，也未改登入、OAuth、session 或伺服器權限判斷。Web 沿用既有 BFF。App 使用原有 `request` transport，呼叫 Web BFF 所轉送的同一組平台 API：

- `GET class-workspaces/:workspaceId/classroom-sessions`
- `POST class-workspaces/:workspaceId/classroom-sessions/:sessionId/check-in`
- `GET class-workspaces/:workspaceId/classroom-sessions/:sessionId/roster`
- `GET class-workspaces/:workspaceId/members`

App 沒有直接呼叫 Web BFF URL。現有 BFF 對非附件 POST 要求 Web Cookie／Origin／session context，平台憑證入口亦受附件開關限制，無法直接接受 App 的既有簽到請求。若要求 App 必須通過 Web BFF，仍需另外擴充該入口並驗證原生憑證及瀏覽器防偽請求邊界。這項限制可由 `apps/web/src/lib/nuni/api.ts` 與 `apps/mobile/src/services/nuniClient.ts` 的既有程式確認。

既有簽到回應沒有共用的固定回執契約，因此本次採回查確認。點名歷史分頁／篩選、匯出、即時更新、補簽理由與變更歷程、批次名冊及角色管理，未包含在本 repo 可用的 BFF 契約中；真正 API 位於另一 repo，需另外確認或補齊。這些能力不影響本次基本簽到與唯讀名冊整合。

## 檔案

新增：

- `packages/shared/src/nuniClassroom.ts`：既有點名與名冊資源的型別、回應解析及請求。
- `apps/mobile/src/screens/nuni/NuniAttendance.tsx`：App 點名及名冊畫面。
- `apps/mobile/src/__tests__/NuniAttendance.test.tsx`：實際課程入口、角色、簽到及非同步回歸。
- `apps/web/src/features/nuni/CourseMembers.tsx`：教師名冊及原有掛靠功能。
- `apps/web/src/app/auth/platform/class-workspace/[workspaceId]/page.test.ts`：舊網址導向相容。
- `apps/web/src/lib/nuni/classroomContracts.test.ts`：共用資料契約與請求測試。
- `docs/unified-course-space.md`：整合、驗證及限制說明。

修改：

- `apps/mobile/src/screens/nuni/NuniCourses.tsx`
- `apps/web/src/app/auth/platform/class-workspace/[workspaceId]/page.tsx`
- `apps/web/src/features/nuni/NuniApp.tsx`
- `apps/web/src/features/nuni/NuniApp.test.tsx`
- `apps/web/src/features/nuni/WorkspaceList.tsx`
- `apps/web/src/features/nuni/studyNavigation.ts`
- `apps/web/src/features/nuni/useCoursePanel.ts`
- `apps/web/src/features/platform/ClassCreate.test.tsx`
- `apps/web/src/features/platform/ClassJoin.test.tsx`
- `apps/web/src/features/platform/ClassroomSessions.tsx`
- `apps/web/src/features/platform/ClassroomSessions.test.tsx`
- `apps/web/src/features/platform/WorkspaceExtras.tsx`
- `apps/web/src/features/platform/WorkspaceExtras.test.tsx`
- `apps/web/src/features/platform/constants.ts`

刪除：

- `apps/web/src/features/platform/ClassWorkspace.tsx`
- `apps/web/src/features/platform/ClassWorkspace.test.tsx`

`WorkspaceExtras.tsx` 內未再引用的邀請元件與解析 helper 也已移除；統一頁繼續使用原有邀請流程。

## 驗證

使用 Node 22，最終結果：

| 檢查 | 結果 |
| --- | --- |
| `pnpm typecheck:web` | 通過 |
| `pnpm typecheck:mobile` | 通過 |
| `pnpm typecheck:shared` | 通過 |
| Web 相關測試 | 16 個測試檔，286 項通過 |
| App `NuniCourses`、`NuniAttendance` | 2 個測試檔，107 項通過 |
| `git diff --check` | 通過 |

Web 測試包含統一頁、舊網址導向、建立／加入課程、名冊、點名、課程清單、待辦、學習路徑、教材、作業、測驗、既有路由、BFF 轉送與共用資料契約。App 測試使用實際 `NuniCourses` 入口，涵蓋學生不能查看或請求名冊、兩種教師角色、簽到成功／失敗／重複點擊／回應遺失、封存及跨帳號／課程／角色的延遲回應。

測試使用本機固定資料，未連線正式後端或進行原生實機驗收；不代表已部署或完成正式帳號驗收。未 commit 或 push。

借用的根 `node_modules` symlink 維持不變。為讓檢查使用此工作樹的 shared 程式，Web 與 App 各自新增受忽略的 `node_modules/@campus/shared` 本機連結，未加入版本控制。
