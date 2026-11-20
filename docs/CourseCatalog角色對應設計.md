# 課綱查詢系統 × App 角色對應設計

> 資料來源：靜宜大學 課綱查詢系統
> <https://mypu.pu.edu.tw/Framework/Academic/CourseCatalogSys/>
>
> 對應檔案：
> - `apps/mobile/src/data/courseCatalogConstants.ts`
> - `apps/mobile/src/services/courseCatalogClient.ts`
> - `apps/mobile/src/services/courseCatalogRoleMapping.ts`
> - `apps/mobile/src/screens/CourseCatalogScreen.tsx`

---

## 1. 資料模型總覽

課綱查詢系統的每一筆「開設課程」由 11 個欄位構成，本 App 將其結構化成 `CatalogCourse`：

| 課綱欄位 | App 型別欄位 | App 內主資料連結 |
| --- | --- | --- |
| 學期別 | `semester` | `Enrollment.semester`, `Grade.semester` |
| 選課代號 | `code` | `Enrollment.courseCode`, `PUCourse.code`, `TCCourse.code` |
| 課程名稱（中/英） | `name` / `nameEn` | `Course.name`, `puGradRequirements.CourseRequirement.name` |
| 修別 | `courseType` / `courseTypeKey` | `creditAudit.categories.key` |
| 學分 | `credits` | `Course.credits` |
| 開課班級 | `classOffered` | `UserProfile.className` |
| 上課時段（含星期/節次/大樓/教室） | `timePlaceRaw` → `slots[]` | `schedule.events.dayOfWeek+startTime`, `roomBooking.location` |
| 授課教師 | `teacher` / `teacherEmail` | `users.displayName`, `teachers.email` |
| 開課單位（學院/系/中心） | `department` | `departments.name`, `users.profile.department` |
| 授課語言 | `language` / `languageKey` | `users.preferences.language`, `EMI` 統計 |
| 課程種類（通識/體育/數位/微學分…） | `tags[]` + `category` filter | `creditAudit.GE`, `gamification.badges` |

> ⚠️ App **不會** 一次將 60+ 學期、數千課程全部下載並 bundle 進 App，
> 而是依使用者篩選條件即時透過 `courseCatalogClient.queryCatalog()` 抓取並快取 24 小時。
> 公開資料，不需 E 校園 cookie，**任何角色（含未登入訪客）皆能使用**。

---

## 2. 課綱查詢的入口

> **設計原則**：選課是學期初/末才用的低頻功能，**不能** 當作每日首頁按鈕。
> 因此入口只出現在「正在看課表時自然會想到要找課」的脈絡，避免干擾日常操作。

| 入口 | 進入路由 | 角色 | 出現時機 |
| --- | --- | --- | --- |
| 課程頁 → 課表 tab 底部「選課工具」區塊 | `CourseCatalog` | 全角色 | 學生看到自己課表後，自然會想換課/補課 |
| AI 選課助理（個性化推薦） | `AICourseAdvisor` | 學生 | 學期前的主要選課動線 |
| 教學中樞 / TeachingHub（可擴充） | `CourseCatalog?filter={teacher:本人}` | 教師、教授 | 教師查自己的開課 |
| 系所中樞 / DepartmentHub（可擴充） | `CourseCatalog?filter={department:本系}` | 系主任、系辦 | 系內課程審視 |
| 校園 → 公開資訊（未登入） | `CourseCatalog` | 訪客 | 校外人士查課 |

### 課表 tab 內的「選課工具」區塊
共三張卡片：
1. **課綱查詢**（`library-outline`，#3B82F6）— 全校課程搜尋
2. **AI 選課助理**（`sparkles-outline`，#FF6B9A）— 依你的資料推薦
3. **學分檢核**（`calculator-outline`，accent）— 畢業進度

說明文字：「學期初/末查課、找替代方案、評估畢業進度」，明確讓使用者理解這是低頻功能。

從其他畫面導入時可帶預設篩選：

```jsx
navigation.navigate('CourseCatalog', { filter: { teacher: profile.displayName } })
```

---

## 3. 各角色的使用情境與資料對應

> 完整的程式化矩陣請見 `courseCatalogRoleMapping.ts` 的 `CATALOG_ROLE_MATRIX`。
> 以下為設計理念說明。

### 3.1 學生 (`student`)
- **典型情境**：選課前一週用本系統挑下學期的課
- **重點欄位**：課名、教師、時段、學分、修別、目前選課人數
- **可執行動作**：
  - 一鍵加入個人課表（自動轉成 `Course` 並寫入 `schedule.addCourse`）
  - 與已選課程衝堂偵測（`detectConflicts()`）
  - 對應畢業學分（`puGradRequirements`）→ 點「對應畢業學分」可看到該課程能補哪一類
  - AI 選課助理直接以 catalog 結果為候選池
- **資料 join key**：`code` → `Enrollment.courseCode`、`puGradRequirements.CourseRequirement.name`

### 3.2 校友 (`alumni`)
- **典型情境**：回查當年所修過的課，或繼續查現在還有沒有微學分 / 推廣
- **重點欄位**：學期、課名、開課單位、課綱 URL
- **限制**：不可加入個人課表（已畢業）

### 3.3 教師 (`teacher`) / 教授 (`professor`)
- **典型情境**：
  1. 確認自己這學期所有開課
  2. 規劃教室、看自己的時段是否衝堂
  3. 看跨系合開、雙修選課狀況
- **重點欄位**：選課代號、班級、時段、教室容量、目前選課人數
- **快捷動作**：「我的開課」自動以 `profile.displayName` 作 `teacher` 篩選
- **資料 join key**：`teacher` → `users.displayName`（fuzzy）

### 3.4 系所主管 (`department_head`) / 校長 (`principal`)
- **典型情境**：
  - 學期前掌握本系開課覆蓋率（必/選/通/輔雙）
  - 跨院合作、雙主修課程
  - 8 大核心能力對應檢核
  - 出統計報表給校級
- **重點欄位**：教師、班級、修別、學分、語言、人數
- **可執行動作**：`canExportReport: true`、`canCompareGraduation: true`

### 3.5 系辦 (`department`)
- 與系主任類似，但偏行政查詢、教師授課時數核算
- 重點：跨學期教師教學負擔比較

### 3.6 教務處 / 校級 (`school`) / 系統管理員 (`admin`)
- 校級觀點的多維度統計：EMI 比例、微學分執行、數位課程比例
- 用 `canExportReport: true` 的匯出功能輸出 CSV

### 3.7 行政職員 (`staff`)
- 排教室、安排維護或場館租借
- 快捷「教室使用情形」依 `building` 直接抓本學期上課時段，
  與 `roomBooking` 模組對齊（避開上課時段）

### 3.8 商家 / 餐廳老闆 (`vendor`)
- 用上課時段反推人潮：12:00、17:00 散課時段是高峰
- 隱藏不必要欄位（課綱 URL、修別、語言）
- 對應到 `recommendLunch` 引擎，
  店家可預先備餐、推送閃購給該時段附近大樓的學生

### 3.9 訪客 (`visitor`)
- 完全公開，任何人都可瀏覽
- 不顯示選課人數 / 容量（避免被未驗證者利用做爬蟲熱門度分析）
- 不可加入課表

---

## 4. 對應到 App 既有模組

| 模組 | 對應方式 |
| --- | --- |
| **個人課表** `schedule` | `toPersonalCourseDraft()` 直接產 `Course` 物件 |
| **學分審計** `creditAudit` / `puGradRequirements` | `courseType`/`category` → 學分類別；`name` → 必修課對應 |
| **AI 選課助理** `AICourseAdvisorScreen` | **已實際接通**：以 `queryCatalog()` 抓本學期候選池，配合 `recommendFromCatalog()`（讀使用者歷史成績/本系/興趣/已選課/避早八等）做 multi-criteria 評分，再由 LLM 對前 10 名加一句個人化建議 |
| **行事曆** `smartCalendar` | 加入課表後同步寫入 `CalendarEvent` |
| **教室預約** `roomBooking` / `facilities` | 依 `slots[].building+room` 反查是否被佔用 |
| **地圖 AR** `ARNavigationScreen` | `building` code 對應 `map.pois`，可直接導航至教室 |
| **餐廳推薦** `recommendLunch` | 依 `period=4` 散課人潮 → 餐廳人潮預測 |
| **成績** `puDirectScraper.PUGrade` | `code` join，呈現歷史學期當時開課時的修課人數 |
| **跨域學分 / 微學分** `gamificationEngine` | `tags: ['micro_credit']` → 微學分徽章 |
| **公告 / 通知** `notifications` | 課綱更新或關注的課加開時推播 |

---

## 5. 權限

於 `permissions.ts` 新增 `courses.catalog`，五大 RoleGroup（student / teacher / staff / department_head / admin）全部具備，
未登入也能進入 `CourseCatalogScreen`（公開）。

---

## 6. 未來擴充

- **核心能力查詢**：`CatalogFilter.coreCompetency` 已預留，等待官方 endpoint 公開
- **微課程資訊**：對應 `tags=['micro_credit']`
- **各系通識時段**：以 `category=ge_*` × `period` 交叉查詢可達成
- **同步官方更新**：`fetchCatalogOrganization()` 可在 server-side 排程同步開課單位樹，覆寫 `CATALOG_COLLEGES`
- **離線快取**：目前 24 h；可由教務處 push 全學期 dump 到 Storage，App 啟動時 prefetch

---

## 7. 變更摘要

| 檔案 | 變更 |
| --- | --- |
| `apps/mobile/src/data/courseCatalogConstants.ts` | 新檔。學期/大樓/節次/院系/修別/種類/語言/核心能力 等所有枚舉 |
| `apps/mobile/src/services/courseCatalogClient.ts` | 新檔。HTTPS 即時查詢、HTML 解析、24h 快取、衝堂判斷、個人課表轉換 |
| `apps/mobile/src/services/courseCatalogRoleMapping.ts` | 新檔。11 種角色（含 vendor / visitor）的情境與欄位重點 |
| `apps/mobile/src/services/courseRecommendationEngine.ts` | 新增 `generateCatalogRecommendations()` 與 `recommendFromCatalog()`：用課綱候選 × 使用者所有資料（成績/本系/興趣/已選課/偏好）做多準則演算 |
| `apps/mobile/src/screens/CourseCatalogScreen.tsx` | 新檔。完整查詢 UI（含 Filter Modal、快捷動作、衝堂提示） |
| `apps/mobile/src/screens/AICourseAdvisorScreen.tsx` | `handleStartAnalysis` 改用真實課綱 + 全部使用者資料；新增「演算法依據」卡片顯示 source/semester/usedSignals |
| `apps/mobile/src/screens/AcademicStack.tsx` | 註冊路由 `CourseCatalog` |
| `apps/mobile/src/services/permissions.ts` | 新增 `courses.catalog` 權限，給 student/teacher/staff/department_head/admin |
| `apps/mobile/src/screens/CoursesHomeScreen.tsx` | 在課表 tab 內加入「選課工具」區塊（不再放頭部常駐按鈕） |
