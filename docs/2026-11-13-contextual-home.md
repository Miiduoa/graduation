# 首頁依個人階段與時間安排

## 解決的問題

相同的首頁入口無法反映學生年級、近期目標與生活方式。這次將簡短的入口設定接到現有今日頁：先選目前就讀階段與課業／生活重點，再依需要展開住宿通勤、近期目標及有起訖日期的準備期間。

年級是使用者自填背景；正式帳號、課程成員、學校資格及店家權限繼續由原有驗證決定。自選年級或目標不會修改任何角色、校務資格或助理操作權限。

## 已實作

- Web 的 StudentTodayPage，及原生的 StudentTodayScreen／Google NuniCourses 課程總覽，使用同一套 shared 推薦規則。
- 可選大一、大二、大三、大四以上、研究生、其他／先不設定；課業與生活、課業優先、生活優先。
- 選填通勤、宿舍、校外居住；近期目標最多三項：熟悉校園、跟上課業、專題合作、實習、升學、求職、校園生活。
- 每次最多三個建議，各有理由與現有目的地。同目的地合併，保留較重要的具體行動。
- 手動開學、期中、期末、假期期間支援開始／結束日，包含結束日、最長 90 天；未開始和過期期間不生效。
- 本人所選校園的個人期中／期末考行程，提前 14 個台北日曆日調整準備建議；結束後停止套用。全天事件沿用既有 exclusive endDate 語意。
- 用餐時段會提高生活偏好的餐飲建議。即將上課和快截止作業仍由原本今日優先序處理，位於個人化區之前。
- 原生優先使用目前已註冊的既有路由；需轉網頁的項目明示「在網頁開啟」，保留校園參數。
- 可以略過入口設定，也可隨時調整；設定不限制其他功能可見性。

專題與求職建議使用各種登入來源皆可用的個人行事曆，協助拆解里程碑或安排履歷／作品準備。未向 Google-only 帳號推薦需要 Firebase 學校登入的 `/groups`、`/community/me`。

## 資料與時間邊界

- 偏好目前保存在各裝置，依帳號與校園分隔；沒有跨裝置偏好同步。Google、學校帳號和訪客不相互繼承。
- 未選校時 Web 使用個人安排範圍，介面說明選校後可另設該校安排；原生沿用必須先有校園的個人資料 scope。
- 沒有將月份當成官方考試週，也沒有新增未驗證的全校校曆資料。
- 個人事件只用於本人所在資料範圍的推薦，不當作全校考試證據。取消、複習、讀書會、報告等標題不當作考試。
- 讀不到事件時顯示狀態並依偏好安排，不宣稱沒有考試。登入重新驗證、登出或切換帳號時即時隱藏前一個人的內容。
- 所有偏好值採固定欄位與列舉投影；未知欄位不進入存檔。未解析帳號、舊的儲存 callback、晚到讀取都不能更新新帳號畫面。
- 推薦只提供下一步，這次沒有自動新增行程、繳交作業、訂餐、報名或授權代理操作。既有功能的確認流程仍然有效。

## 下一階段設計

1. **可信身分來源：**讀取本人已驗證的學校基本資料，將學校、科系、年級作為可確認的預填值；轉系、延畢、研究所與跨校課程仍允許更正，不從學號自行推定所有人的年級。
2. **各校正式校曆：**建立附 schoolId、學年度／學期、來源 URL、查核時間、起訖日期的校曆資料；可加入開學、加退選、期中、期末、暑修、選課、寒暑假及畢業離校。個人課程日期和明確手動目標優先於一般校曆。
3. **可確認的安排：**將推薦接入既有助理規劃流程，讀取已授權課表與期限後提出可預覽的準備時段，待本人確認才寫入。未取得資料時補問必要日期，不製造行程事實。
4. **跨裝置偏好：**使用專用帳號偏好 API，伺服器從驗證後 session 決定帳號；不可把偏好寫進權限資料。需處理離線修改、版本衝突及刪除偏好的入口。
5. **回饋與可控性：**提供「先不要推薦這項」「這個目標已完成」，以本人明確回饋調整排序。年級只提供起點，不代替個人意願。

## 驗證與重現

以專案指定的 Node 22 與 pnpm 10 執行：

```sh
pnpm --filter web exec vitest run src/lib/campusPersonalization.test.ts src/lib/useCampusPersonalization.test.tsx src/components/today/CampusPersonalization.test.tsx src/components/today/CampusPersonalizationSection.test.tsx src/components/today/StudentToday.test.tsx src/app/page.test.tsx
pnpm --filter mobile exec jest src/__tests__/campusPersonalization.test.tsx src/__tests__/services/campusPersonalizationNavigation.test.ts src/__tests__/StudentTodayScreen.test.tsx src/__tests__/NuniCourses.test.tsx --runInBand
pnpm --filter web typecheck
pnpm --filter mobile typecheck
pnpm --filter @campus/shared typecheck
node scripts/qa/contextual-home/build.mjs
python scripts/qa/contextual-home/check.py
```

單元與元件測試包含台北午夜、閏年、不合法日期、日期到期、全天／跨夜考試、錯校事件、目標排序、個人化與急件的順序、切帳號／切校、儲存失敗和讀寫競態。瀏覽器 fixture 使用真正元件、測試帳號與固定日期，不連線正式帳號；驗收 320px 淺色、390px 深色、1280px 淺色的表單、持久保存、切換帳號、錯誤提示、到期後建議、焦點與水平溢位。

開發時上述 Web 六組測試 163 項通過；手機新功能、導航與 StudentTodayScreen 71 項及 NuniCourses 129 項通過。Web、mobile、shared 型別檢查和本輪檔案 lint 通過。新增測試也確認手機損壞偏好可以由本人明確重設，只更新該帳號／校園的偏好，不清除課表或其他帳號資料。

正式建置另發現 main 原有 `public-course-catalog/operations` 的 GET 將 Request 宣告成選填，不符合 Next.js 產生的 route 型別。這次改為框架實際會傳入的必要 Request，並調整原測試使用 Request；原 17 項路由測試通過。Webpack 編譯完成，後續整合建置在型別階段被環境終止（exit 137），不宣稱 production build 已完成；交由同 head 的 CI 再確認。

本次開發環境的 Chromium 因 Unix socket 限制未能啟動；遠端瀏覽器也不能存取這個環境的 localhost。瀏覽器流程已接入既有 Timetable Browser workflow，截圖與報告輸出到 contextual-home artifacts；以該提交的實際 Actions 結果判定，不以 fixture 建置成功替代瀏覽器驗收。原生真機／模擬器畫面尚需實機驗收。

合併前仍需核對當下 main／PR head、CI、CodeQL、Maestro，以及既有規則指定的 GitHub App「審查通過」檢查。這次沒有修改合併保護或加入略過條件。
