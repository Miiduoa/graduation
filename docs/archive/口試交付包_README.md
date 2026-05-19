# 校園整合應用 App · 口試交付包

> 2026-05-15 完成 / 口試 5/23 / 組員：周攸晨、顧晉瑋、楊世堅、吳容陞

## 檔案清單（都在這個資料夾）

| 檔案 | 用途 |
|------|------|
| `口試簡報.pptx` | 14 張投影片，含架構圖 + 影片/截圖預留位 |
| `口試Demo主持腳本.docx` | 7 分鐘逐秒主持稿 + 拍攝清單 + Q&A + checklist |
| `角色資料畫面對照矩陣.xlsx` | 6 個 sheet：總覽 / 5 角色 / 14 事件 / AI service / demo 逐秒 / 拍攝分鏡 |
| `口試交付包_README.md` | 本檔 |

## 程式碼修補摘要（已 commit 到專案）

### 🔴 修了什麼致命 bug
1. **`subscribeAllRoleEvents` 之前只訂閱 7/14 種事件** → 已補齊 14 種，學生才收得到餐廳通知、主任廣播
2. **`VendorDashboard` 沒 subscribe `order_placed`** → 已補，學生下單餐廳即時 +1
3. **`TeacherCockpit` 沒 subscribe 學生反向事件** → 已補，學生繳交/發討論老師即時看到
4. **`TADashboard` 完全沒 AI、沒 RoleEventBus** → 已補上 `aiTANextAction` + 求助/討論訂閱 + Modal 直接回覆
5. **`DepartmentDashboard` 主任廣播按鈕沒實際 emit** → 已 wire `simulateDepartmentBroadcast` + topRisks 上 UI
6. **`aiPreReviewGrade` 在 `TeacherCockpit` import 但沒呼叫** → 已加進 `openDraftFor`，AI 預判 banner 出現在 Modal 最上面
7. **5 個缺漏的 simulator** → 補完：`simulateTeacherPublishHomework / simulateTeacherAssignPeerReview / simulateAnnouncementPosted / simulateStudentPostDiscussion / simulateStudentRequestHelp`

### ✅ 驗證結果
- TypeScript：與 demo flow 相關的所有檔 0 錯誤（剩 1 個 `expo-speech` module 在 GoogleMapsLikeScreen 缺漏，跟 demo 無關）
- Jest：950 / 951 通過（99.9%），失敗的 1 條 `proactiveAI.test.ts` 是 pre-existing 與我修的部分無關
- demoActionSimulator：13 個 simulator 全部 export
- roleEventBus：14 種 RoleEventKind 全部串通

## 5/23 之前還要做的事

### 必做（本週）
1. **錄影 + 截圖**（依 docx 第 4 節 / xlsx Sheet 5 拍攝清單）
   - 8 段影片 V01-V08（每段 8-15 秒）
   - 10 張截圖 S01-S10
   - 全部存到 `/Users/miiduoa/Desktop/畢業專題/demo-media/` 並照命名規範
2. **錄完後**：開 PPT 把 placeholder 框換成實機影片/截圖（檔名都對得上，PPT 已預留）
3. **跑一次完整 demo**（4 人從頭演到尾）

### 選做（時間夠的話）
- 修 `expo-speech` 缺漏（純 install 問題）
- 修 `proactiveAI.test.ts` 的 `30 分鐘後` 失敗（時區或 mock data 問題）
- 修 `AIAgentObservatoryScreen` 的舊 type 不一致（demo 不用 Observatory）

## 簡報注意事項

PPT 用 **PingFang TC** 字體 + 中文 emoji。在你 Mac 的 PowerPoint 或 Keynote 開啟時 emoji 會正常顯示為彩色圖示。**LibreOffice 預覽 PDF 時 emoji 會變豆腐字 □，那是預覽工具的問題，正式 demo 投影沒事。**

PPT 裡 8 個影片 + 4 個截圖位置都是虛線框 placeholder，等你錄完媒體後：
1. 把實機檔案放到 `demo-media/` 資料夾
2. 重新跑 `node /Users/miiduoa/Library/Application\ Support/Claude/local-agent-mode-sessions/.../delivery/build_pptx.js`（或在 PPT 裡手動拖進去）

## 4 人分工速查

| 組員 | 角色 | 負責影片 | 負責截圖 |
|------|------|---------|---------|
| 周攸晨 | 🎓 學生 | V04 / V05 (學生端) / V08 (學生端) | S01 / S02 / S09 |
| 顧晉瑋 | 👨‍🏫 老師 + 助教 | V02 / V03 | S03 / S04 / S05 / S06 |
| 楊世堅 | 🍱 餐廳 | V01 / V05 (餐廳端) / V06 | S07 |
| 吳容陞 | 🏛 主任 | V07 / V08 (主任端) | S08 |
| 全員 | — | — | S10 (登入頁) |

## 加油！5/23 一起把這個搞起來。

