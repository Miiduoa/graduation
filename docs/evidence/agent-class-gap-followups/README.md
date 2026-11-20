# 空堂助理的條件追問

## 使用流程

學生先問「明天下午有一個半小時的空堂嗎？」，接著可用「改成下午三點半以後」、「那後天有哪些空堂？」調整條件。每輪重新讀取目前帳號與學校的已存課表，再計算符合條件的時段。

| 說法 | 變動 | 保留 |
| --- | --- | --- |
| 那後天有哪些空堂？ | 日期改為後天 | 時段、鐘點、最低長度 |
| 只看下午 | 時段改為 12:00–18:00，清除原精確鐘點 | 日期、最低長度 |
| 只看 15:30 以後 | 縮小開始時間 | 日期、原時段、原結束時間、最低長度 |
| 改成下午三點半以後 | 取代舊時段與鐘點 | 日期、最低長度 |
| 14:00 到 17:00 | 取代舊時段與鐘點 | 日期、最低長度 |
| 不限長度 | 清除最低分鐘數 | 日期、時段與鐘點 |
| 全天 | 清除時段與鐘點 | 日期、最低長度 |

完整、沒有追問前綴的日期問題會開始新查詢。例如「今天有哪些空堂？」不沿用上一回合的長度；「那今天有哪些空堂？」則沿用。

目前支援今天、明天與後天。長度可說一個半小時、1.5 小時或一小時三十分鐘。鐘點可使用 24 小時格式，或明示上午／下午／晚上。沒有時段依據的「三點半」不猜測；矛盾範圍、無法完整辨識的限制會回覆說明，不交由模型猜出課表。無效追問也不能被當作新問題而丟掉原條件。

## 資料與計算

- 查詢限於已登入帳號與所選學校的手機課表、匯入紀錄和單日停課／調課；不呼叫雲端模型或校方 API。
- 空堂是兩段已知上課時間之間的差集。相鄰與重疊課程合併，不推測第一堂前、最後一堂後或整天空白可供安排。
- 本學期若有缺星期或無法定位時間的課程，不再先略過該課後斷言有空堂。舊學期無關資料不阻擋本期，前一學期跨夜調課仍納入邊界。
- 先扣除已過時間、套用時段與鐘點，再以完整分鐘計算最低長度；不足 90 分鐘的空檔不會向上補成 90 分鐘。
- 凌晨十二點為 00:00；24:00 只能作為終點。同日倒置範圍不自行解讀為跨夜。
- 帳號、學校或台灣日期改變時，原追問仍受既有範圍檢查保護。取消查詢後的延遲結果不得成為新答案。
- 回覆同時呈現生效條件與課表儲存時間，並提醒私人行程、通勤和未更新的調課不在計算內。

## 維護入口

| 檔案 | 責任 |
| --- | --- |
| `services/savedClassGapQuery.ts` | 問句、追問和條件替換語意，回答組合 |
| `services/nextSavedClasses.ts` | 已存課程與課間計算，來源完整性 |
| `services/onDeviceSchoolContext.ts` | 讀取所選帳號與學校的課表 |
| `features/campusAssistant.ts` | 對話派送、範圍檢查、取消與不支援問句 |
| `screens/ClassGapReplyCard.tsx` | 最新回覆的篩選操作；歷史回覆只保留內容與來源入口 |

以上路徑皆位於 `apps/mobile/src/`。與計畫分支整合時，`savedClassGaps` 和 `scheduledSavedClasses` 兩個來源函式需要共存；空堂和計畫的忙碌／取消狀態各自保留。

## 重現驗收

手機回歸清單位於 `.github/workflows/mobile-agent-regression.yml`；包含語句、來源、對話、帳號範圍、主畫面與獨立回覆卡測試。

```sh
pnpm --filter mobile exec jest --runInBand --runTestsByPath \
  src/__tests__/services/savedClassGapQuery.test.ts \
  src/__tests__/services/nextSavedClasses.test.ts \
  src/__tests__/services/onDeviceSchoolContext.test.ts \
  src/__tests__/features/campusAssistant.test.ts \
  src/__tests__/CampusAssistantScreen.test.tsx \
  src/__tests__/ClassGapReplyCard.test.tsx
pnpm --filter mobile typecheck
node scripts/qa/class-gap-followups/build.mjs
python scripts/qa/class-gap-followups/check.py
```

瀏覽器以正式解析、課間計算與回覆元件，配合固定台灣時間和合成課表，走完「一個半小時 → 改三點半後 → 後天無符合結果 → 不限長度 → 全天 → 開啟課表」。檢查 390px 淺色、320px 深色、鍵盤操作、至少 44px 控制項、水平溢位、頁面錯誤與意外外網請求。這不代替正式帳號、原生真機或校方資料驗收。

### 2026/11/07 本機結果

- Node 22.23.4：最後版本的 7 組定向回歸共 **340 項通過**，含立即取消等待、遲到結果、完整追問、衝突條件、來源與畫面操作。
- 依 Mobile Agent Regression 清單執行 38 組時，37 組共 **801 項通過**；`NuniCourses` 的測試程序被系統以 SIGKILL 終止，未取得斷言結果。設定 Node 記憶體上限並單獨重跑該完整套件，**111／111 通過**。上述案例與 340 項有重疊，不相加。
- 最後版本完整手機 TypeScript 通過，變更的 12 個 TypeScript／TSX 檔案 ESLint 無錯誤；`CampusAssistantScreen` 保留 2 項既有 Hook 依賴警告。取消等待修正後重跑其兩檔 lint 無錯誤。大型檢查同時執行曾遭系統終止，分開執行後完成。
- 瀏覽器 2 個情境、10 組幾何量測全部通過：最小控制項高度 44px，無水平溢位、頁面錯誤、外網請求或失敗請求。量測見 [browser-check.json](browser-check.json)。
- 已目視檢查 [320px 深色](320-dark-initial.png) 與 [390px 淺色追問](390-light-clock.png)。

GitHub CI、CodeQL、Mobile Agent Regression、Maestro 與 main 指定的「審查通過」核可，均須以 PR 最新提交的 Checks 為準；本機結果不替代正式合併條件。

## 比較依據與範圍

[愛通 App Store 官方介紹](https://apps.apple.com/tw/app/%E6%84%9B%E9%80%9A-ai/id6757301110) 已列出計畫儲存、記憶與提醒；本輪著重於可重現的校園條件修改及來源核對。尚未完成同裝置、同任務的競品測試，不能據此宣稱全面超越。
