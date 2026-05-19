# 真實情境審視：砍 / 留 / 改（2026-05-15）

> 目的：誠實評估「demo 漂亮 ≠ 真實會用」。把功能分三檔：**留**（真實情境會用且有差異化）/ **改**（方向對但要重做）/ **砍**（demo 騙人、真實沒人會用）。
>
> 評估維度（每項打 1-5 分）：
> - **真實使用頻率**：學期內會被打開幾次（5 = 每天 / 1 = 整學期 1 次都嫌多）
> - **獨特價值**：與 TronClass / Email / LINE / Google Calendar 比，差異化程度（5 = 無可取代 / 1 = 多此一舉）
> - **建置 ROI**：花的工 vs 真實受益（5 = 低成本高回饋 / 1 = 高成本低回饋）
> - **誤用風險**：被當成代寫、抄襲、騷擾工具的可能性（5 = 風險高 / 1 = 安全）
>
> 總分 = 頻率 + 獨特 + ROI − 誤用。**總分 ≥ 10 = 留 / 5-9 = 改 / ≤ 4 = 砍**。

---

## A. 留下來（核心戰力）

| 功能 | 頻率 | 獨特 | ROI | 風險 | 分 | 為什麼留 |
|------|------|------|-----|------|----|---------|
| **Today 駕駛艙 5 角色版**（TodayCockpit / TeacherCockpit / TADashboard / DepartmentDashboard / VendorDashboard）| 5 | 4 | 4 | 1 | **12** | 「打開 app 第一眼看什麼」是所有校園 app 的命脈。TronClass 沒有「角色感」，每人看同樣 menu。我們做了角色駕駛艙就贏一半。 |
| **跨角色 RoleEventBus**（老師批改 → 學生 inbox / 餐廳備餐 → 學生通知 / 主任公告 → 全體）| 4 | 5 | 4 | 1 | **12** | TronClass 是個「資料倉」，事件感弱。我們做了即時 event bus，整個系統有「活著」的感覺，是真實情境最大差異化。 |
| **focus CTA：next task + 預估時長 + 「開始」按鈕**（Today 上的黑卡）| 5 | 4 | 5 | 1 | **13** | 學生最痛的不是「不知道有什麼作業」，是「不知道現在該做哪個」。一個 CTA 取代 5 個 tab，這是 iOS Reminders 級別的好設計。 |
| **AI 起草評語 + 預測補交率**（TeacherCockpit）| 4 | 5 | 5 | 2 | **12** | 老師最花時間的是寫評語。AI 預先 draft → 老師微調是真實場景剛好的人機分工。預測補交率讓老師發提醒前有 calibration。**注意**：要清楚標示是 AI 草稿，避免老師直接送出失準評語。 |
| **GradeWhatIf 成績試算**（學生）| 3 | 4 | 5 | 1 | **11** | 期中後學生會打開 1-3 次的工具。算出來「如果期末考 80，學期成績 73」這種 actionable 數字比成績單有用。 |
| **MistakeRepertoire 錯題本 + spaced repetition**| 3 | 4 | 4 | 1 | **10** | 學生會在考前打開。把錯題自動入庫 + 隔天提醒，是 Anki 級別的 baseline 但綁在課程上比較自然。 |
| **AI Observatory（含 Guardrail Audit）**| 2 | 5 | 5 | 1 | **11** | 真實使用率低（學生不會每天看 AI 在想什麼），但**對信任建立極關鍵**。讓使用者能 audit AI 決策是 ML 系統倫理的剛需。也是這個 demo 與其他校園 app 拉開差距最大的單一功能。 |
| **AI 學伴配對**（本輪新增）| 2 | 5 | 4 | 2 | **9** | 學期初打開 1-2 次的工具。「同班 ≠ 合適學伴」的痛點是真的，多維度配對 + 透明解釋是好做法。**留下並標為改善優先**。 |
| **Pomodoro Session**| 4 | 2 | 5 | 1 | **10** | 番茄鐘本身不獨特，但內嵌在 next task → 開始這條動線裡，能把學生留在 app 內，是好的。 |
| **VendorDashboard 餐廳訂單佇列**| 5 | 4 | 5 | 1 | **13** | 校園餐廳老闆每天會用 N 次。LINE 接單→記帳這條路徑很痛，這個取代得了。 |

---

## B. 留但要改（方向對、做法要重做）

| 功能 | 主要問題 | 怎麼改 |
|------|---------|--------|
| **proactive AI agent 每 15 分鐘 scan** | 真實情境下，學生 14:30 收到「該複習錯題了」很容易反感。背景循環在手機上也很耗電。 | (1) 改成 **event-triggered**（學生剛打開 app / 剛繳完作業才掃）+ (2) 每天最多 2 次主動 push（已有 cap=8 但太寬鬆）+ (3) 加上「下次掃描時間」UI 讓使用者預期。 |
| **AI 思考鏈 explainChain 全文展開** | 真實使用者沒耐心讀 200 字的「觀察 → 推論 → 權衡 → 排序」narrative。 | 改成 **2 行摘要 + 「為什麼？」展開按鈕**。預設收起，要時可看。AI Observatory 留全文。 |
| **TADashboard 助教介面** | 助教在真實校園的角色變數大（有的只批改、有的開檢討課、有的當情緒支持窗口）。 | (1) 加「我這學期的職責」設定畫面，依勾選顯示對應 chip / (2) 大部分助教用 LINE 群組溝通，要做匯出/同步 LINE 的橋接而不是叫他們轉戰新工具。 |
| **AI Course Advisor**（選課建議）| 真實選課時學生最在意「會不會被當」「老師好不好」「能不能擠進去」，AI 答這些常會出包。 | 改成 **聚合 PTT / Dcard / 校內留言**，AI 只做 **summary + 標出爭議點**，不做最終建議。把責任留給學生。 |
| **CampusGarden / Companion / Constellation / 寵物養成** | 看 screen 名稱還在 codebase 裡 — 這類 gamification 在大學族群留存率非常低（小學中學才管用）。 | 砍掉大部分，只留「achievement badges」做 milestone 紀念（學期末完成所有作業、連續 30 天簽到等）。 |
| **AR Navigation / 校園 AR 導覽** | 真實情境一學期可能用 0 次。新生開學第一週用一次找教室，之後再也不開。 | 留首週入口，之後從 Today / 主 nav 消失。或改成 **室內導航 only**（找借書/還書架、找特定行政窗口），這比「找教室」實用得多。 |
| **多店 MerchantSwitcher** | 真實單一店家只關心自己店。多店多半是連鎖 / 校內中央廚房才有。 | 預設單店。多店功能放到「進階」settings 裡，避免一般店家 UI 雜訊。 |
| **AIChatScreen 開放式聊天** | 學生問「明天要不要交作業」AI 可以答；問「林家全教授怎樣」就會出事。 | 改成 **結構化 Slash command**（/作業、/成績、/期中、/找學伴），少做開放對話。或加 **「我不知道」按鈕**讓 AI 可以選擇沉默。 |

---

## C. 砍掉（demo 騙人，真實沒用）

| 功能 | 為什麼該砍 |
|------|----------|
| **CampusGameScreen / CampusGardenScreen / ConstellationScreen / CompanionScreen / CompanionCollectionScreen** | 大學生不會玩寵物養成換積分、收集卡牌。這在 demo 看起來很酷，但留存週數 < 2。砍掉省維護。 |
| **WidgetPreviewScreen / ThemePreviewScreen** | 給開發者預覽 UI 的「內部頁」，正式版根本不該出現在 user-facing nav 裡。 |
| **BugReportScreen** 自製版 | 直接接 GitHub Issues / Notion / 校內報修單即可，自己做不會比這些好用。 |
| **AccessibleRouteScreen 無障礙路徑單獨成頁** | 該整合進主 navigation（每個地圖入口都該有「無障礙模式」toggle），單獨成一個 tab 反而沒人去點。 |
| **CampusHubScreen 校園入口 hub** | 已經有 Today cockpit + bottom tabs + 各角色入口，再多一個「Hub」是疊床架屋。 |
| **CourseCatalogScreen 課程目錄** | 學生用 iCampus 課程查詢，老師在校務系統開課，這個自製版資料一定不如官方。砍。 |
| **CreditAuditScreen / CreditAuditInputScreen / CreditAuditStack 學分審核自製版** | 學分審核必須權威（出錯會延畢），自製版會被質疑。真實版應該 deep-link 到校務系統，不在 app 內做。 |
| **AdminCourseVerifyScreen 系所手動審課** | 真實流程在校務系統做，且需要法律簽章；app 端做只會增加流程歧義。 |
| **AcademicInsightsScreen 學業洞察分析（如果只是看圖）** | 真實情境學生只想知道「現在風險高不高」，不需要 5 個圖表。整合進 GradeWhatIf 一個指標卡即可。 |
| **AccountDeletionScreen 自製刪除帳號流程** | 法規上需要走特定 flow（GDPR / 個資法）；自製不如直接連到校方資料保護窗口。 |
| **TransportHubScreen 1975 行的交通頁** | 真實校園搭公車的需求由 Google Maps + 公車動態 App 解決。自己做 1975 行的同類功能 = 學生不會用 + 維護成本爆炸。砍到只留「校車時刻表」一個簡單 list。 |
| **多重「AI 服務」**（aiAgentOrchestrator / aiActionCoordinator / aiActionExecutor / aiActiveLearning / aiAmbientAwareness / aiAppContext / aiBrain / aiContinualLearning / aiCrossModuleInference / aiDynamicTraining / aiProactiveThinker / aiRealtimeAnalytics / aiRealtimeSync / aiReflexion / aiSelfDialog / aiSelfDialogMultiTurn / aiSemanticReasoner / aiSmartActions / aiToolLayer / aiToolRegistry）| 136 個 service 裡光 AI 就 30+。**很多是重複**（aiBrain vs aiThinking vs aiProactiveThinker；aiSelfDialog vs aiSelfDialogMultiTurn）。應該收斂到 **5 個**：`aiThinking`（思考鏈）/ `aiLearning`（學習）/ `aiSkillApplicator`（套用 + guardrail）/ `proactiveAIAgent`（主動掃）/ `aiOrchestrator`（動作前後演算）。其餘合併或刪。**這是 codebase 健康度最大的負債**。 |

---

## D. 真實情境下「最能創新」的 3 個方向

### D.1 把 RoleEventBus 升級成「校園活動神經」
**為什麼**：目前 14 個事件 kind 都圍繞「老師動作 → 學生收件」。真實校園裡很多事件被忽略 — 例如「圖書館有人在你借過的書旁邊發現你」、「同學在你下單的店半小時內也下了同款」、「你常坐的位置今天有人坐了」。  
**怎麼做**：把 RoleEventBus 抽象成 `CampusEvent`，後續任何「實體世界 → 數位 inbox」的橋接都用這層。  
**護城河**：TronClass / iCampus 不可能做 — 他們是教務系統，不是社交平台。我們處在「校園 OS」位置，能做這個。

### D.2 讓 Guardrail Audit 變成「AI 信任卡」
**為什麼**：目前 audit log 在 AI Observatory 裡，學生會看到「7 條 guardrail」說明。可以再往前一步 — 學期末給每個學生一張「你的 AI 信任卡」：  
> 「本學期 AI 主動推送 38 次，你採納 23 次。AI 為了不打擾你，自動擋下 17 次推送（含你睡覺時段的 12 次）。」  
**為什麼這是創新**：行業裡沒有人這樣做。學生會把這張卡分享到 IG。教育部會把這當教材。Anthropic / OpenAI 會引用。  
**實作**：1 個額外 screen + 既有 audit log。**ROI 超高**。

### D.3 學伴配對升級為「動態組隊」
**為什麼**：目前是「找 1 對 1 學伴」。真實大學讀書會通常 3-5 人，且角色互補（解題王 + 整理筆記王 + 主持人 + 進度督促者）。  
**怎麼做**：matchStudyBuddies 擴充支援 **多人 team optimization**，回傳「3 人組合」並標出各人角色。再串接 `roleEventBus` 的 `discussion_posted` 讓組讀書會的進度成為動態 inbox 訊息。  
**護城河**：這是「教學數據 × 社交配對」交集，沒有現成競品。

---

## E. 真實情境下「幫助不大」的東西（誠實的 self-critique）

### E.1 AI「自我反思」narrative
目前 `selfReflect()` 輸出「累積 N 次互動、整體採納率 X%、下一輪調整：...」  
**真實使用率**：學生看一次覺得「酷」，之後再也不會點開。  
**建議**：把「自我反思」拆成 **學生看得到的 1 行** + **背景紀錄用於演算法調整**。不要再讓使用者讀內部反思。

### E.2 33 個 domain 的 aiDataInventory
目前 AI 可以 query 33 個 domain（homework / grade / attendance / mistake / cafeteria / merchant / library / printing / transport / ...）  
**真實**：學生問 AI 的 query 90% 集中在 5 個 domain（homework / grade / today / mistake / time）。其他 28 個 domain 是「以防萬一」。  
**建議**：先把 5 個核心做到極致 + 加 unit test；其他 28 個做 lazy load（query 到才 import 該 domain 的資料），減少 cold start 時間。

### E.3 過多「思考鏈」可視化
AI Observatory 4 + 2 個 section 是「給開發者炫技」的設計。  
**真實使用率**：學生點進去 1 次，「哦原來 AI 在想這些」然後關掉。  
**建議**：保留給口委 demo 用，但**從學生主 nav 隱藏**。改成 settings → 進階 → 「看 AI 在想什麼」入口。釋出 home tab 給更高頻的功能。

### E.4 開發 SOP 裡的 6 階段流程
README / DEMO_FINAL_AND_DEV_SOP 寫了 6 步驟（判斷角色 → 設計系統 → cockpit primitives → RoleEventBus → AI 接入 → Demo fallback）。  
**真實情境**：80% 新功能不需要走 5、6 步（不是 AI、不是跨角色）。  
**建議**：SOP 改成 **「最少作業集」+ 加值步驟**。新功能預設只走 1-3，跨角色 / AI 是 opt-in。降低後續開發者心智負擔。

### E.5 任何「分數 / 排行榜 / 排名」UI
目前一些畫面（如 GradeWhatIf）有 percentile 概念。  
**真實情境**：大學生（尤其大學部）對排名敏感度極高，看到「你在班上排名第 22」會直接造成焦慮。  
**建議**：所有排名顯示加 **opt-in**（預設不顯示），且只給趨勢（「比上次進步」）而非絕對位置。

---

## F. 砍 / 改 / 留 一句話總結

> **留下：5 角色 Today 駕駛艙 + 跨角色事件流 + AI Guardrail Audit + Focus CTA + 餐廳訂單 + 成績試算 + 錯題本 + 學伴配對**  
> 這 8 個是真實情境會被打開的功能，也是 demo 與 TronClass 拉開距離的關鍵。
>
> **改造：proactive scan 頻率 / AI Chat 結構化 / TA dashboard 角色彈性 / 多店預設單店 / 選課建議去責任化**  
> 方向對但目前實作會在真實情境出包，需重做。
>
> **砍掉：寵物養成系列 / 校園 hub / 自製學分審核 / 1975 行交通頁 / 30+ 重複 AI service / 開放對話 AI**  
> 這些在 demo 漂亮，真實上線後 1 個月內會被棄用、或是會被官方系統取代。
>
> **最創新方向：把 RoleEventBus 抽象成「校園活動神經」+ Guardrail Audit 做成「AI 信任卡」+ 學伴配對升級多人組隊**  
> 三個都是「TronClass 不可能做、但我們可以做」的位置。

---

*本報告對應 demo 端到端腳本 docs/DEMO_FINAL_AND_DEV_SOP_2026_05_15.md*  
*下一步建議：先讀 docs/USER_JOURNEY_REALITY_2026_05_15.md 看 3 個角色一週的真實使用節奏，再決定砍 / 留 / 改的優先順序。*
