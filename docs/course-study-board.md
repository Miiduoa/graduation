# 課程讀書白板

從課程的「教材櫃」選擇「陪我讀這份教材」，可以在原頁分段閱讀教材文字。
「讀講義」入口也接受本機 PDF、TXT、Markdown，或貼上的筆記。

這個流程借鏡 [Ahaboard 的白板家教](https://ahaboard.ai/zh-TW)（2026-11-07 查閱）。
本次沒有串接 Ahaboard 的服務、使用其品牌資產，或將教材傳給該服務。

## 本次行為

- 顯示原始教材文字及 PDF 頁碼，以最多 1,600 字元的完整片段閱讀。
- 可選理解概念、考前複習、練習思路。模式只影響明確啟用後的 AI 提示。
- AI 提供本段講解、逐字引用與一題自我檢查。先輸入自己的想法，再展開參考回答。
- 引用必須確實出現在該段來源。這項檢查不代表生成的解釋或算式一定正確。
- 支援瀏覽器語音輸入與可用時的本機中文朗讀；語音輸入不會自動送出。
- 沒有 WebGPU 或本機中文聲音時，原文閱讀仍可使用。

沒有正式評分、成績寫入、作業送出或教師進度變更。白板內容只保留在目前頁面的記憶體，
不寫入 localStorage、資料庫或學習計畫。切換段落／模式會清除該次講解與試答；
需要再生成時沿用裝置模型快取。跨段保留筆記與錯題追蹤尚未實作。

## 來源界線

`CourseMaterials` 只傳入當次已取得權限的教材正文。教材內的 URL 仍是文字，
不會自動下載附件、探查外站，或將教材描述當成附件內容。

PDF 沿用 `readPersonalImportDocumentFile` 的同源讀取器：最多 8 MiB、20 頁，
保留原始頁碼、OCR 與缺頁警示。公式、表格與圖像仍需對照原檔；辨識出的文字不代表理解圖表。
文字總量最多 60,000 字元，超過時要求拆分，不會默默截掉內容。

換帳號、session context、課程、角色或封存狀態時，父元件的 key 會重建整個閱讀工作階段。
重新讀取課程教材時會先關閉白板，401／403／404／410 存取失效後不得重開舊內容。
選新檔、切段、切模式、停止或收合會取消相應工作，晚回應不會寫入新工作階段。

## 裝置端講解

`studyTutorRuntime.ts` 沿用既有 `personalImportAi.worker.ts` 的生成介面與固定模型版本。
每次僅傳入目前的一段、模式與最多 500 字元的追問，不提供工具呼叫。
現有模型資源 GET 白名單、輸入／輸出 token 限制及 GPU tensor 釋放機制維持原樣。

只有使用者按下「啟用 AI 講解本段」才建立 worker。首次下載沿用現有約 1.9 GB 模型；
支援性檢查、下載、推論、格式錯誤或引文不符都會顯示失敗，不以預製講解冒充模型成功。
準備最多 10 分鐘、生成最多 120 秒。結束、錯誤、取消與逾時都會終止 worker。

朗讀只選 `SpeechSynthesisVoice.localService === true` 的中文聲音。
找不到時不改用遠端聲音。語音辨識沿用 `VoiceDictationButton`，可能使用瀏覽器的線上服務，
因此不能把整個語音流程宣稱為完全離線。朗讀時停用語音輸入，避免把播報聲錄成提問。

## 維護與驗證

核心檔案：

- `apps/web/src/features/nuni/CourseStudyPanel.tsx`：來源選擇、段落導覽、講解與試答。
- `apps/web/src/features/nuni/StudyReadAloud.tsx`：本機語音與播放生命週期。
- `apps/web/src/lib/studyTutor.ts`：來源轉換、完整分段、提示與輸出驗證。
- `apps/web/src/lib/studyTutorRuntime.ts`：worker 協議、取消、錯誤及逾時。

在專案支援的 Node 與 pnpm 版本、已安裝依賴的 checkout 執行：

```sh
pnpm --filter web exec vitest run src/lib/studyTutor.test.ts src/lib/studyTutorRuntime.test.ts src/features/nuni/CourseStudyPanel.test.tsx src/features/nuni/StudyReadAloud.test.tsx src/features/nuni/CourseMaterials.test.tsx
```

測試涵蓋完整分段、缺頁、錯引、HTML 文字處理、不自動啟動模型、worker 實際終止、
過期回應隔離、頁面切換、來源撤銷、本機聲音限制與輸入超限。

發布前仍需在有 WebGPU 的實機完成模型下載及中文教材推論，檢查延遲、記憶體、引用與教學品質；
以正式授權的課程確認 PDF／掃描頁，並做 iPhone、Android 的觸控與輔助功能驗收。
測試中的模擬 worker 不等於這些實機驗證。逐筆圖形白板、全雙工語音、跨段追問記憶與自動評題均尚未實作。
