# nuni 感知與處理 agent（定案）

一句話定位：**在「今天」殼裡，依已讀到的課程訊號與現在時間即時列出可處理事項，讓人預覽後寫回本機狀態；不是聊天窗，也不是 ChatGPT 替代品。**

本文件鎖定第一切片能做什麼、不能假裝什麼。架構仍遵守 [ADR 0003](../adr/0003-ai-as-advisory-layer.md)：模型是諮詢層，沒有模型時核心產品要能運作，高敏感寫入必須確認。

查閱日期：2026-10-19。下列結論只寫有網址與日期的來源；查不到的會標明，不編產品功能或趨勢數字。

---

## 1. 研究結論（附來源）

### 1.1 主動式／環境感知不是「永遠在跑的精靈」

- Apple 把 app 能力公開成系統可呼叫的 **App Intent**，並提供 `UndoableIntent`、`CancellableIntent`、確認條件（`ConfirmationConditions`）。這是「系統可觸發、可撤銷、有副作用要確認」的官方模型，不是聊天框。  
  來源：Apple Developer，[App intents](https://developer.apple.com/documentation/appintents/app-intents.md)，頁面版權 2026，查於 2026-10-19。
- Android 端側模型 **Gemini Nano** 走 AICore，強調不必聯網、資料留在裝置；文件寫明裝置硬體、token 與能力有限，複雜查詢要 hybrid 落到雲端。這支持「規則與端側先做、雲端模型後加」，不支持「已有隨時感知的雲端大腦」。  
  來源：Android Developers，[Gemini Nano](https://developer.android.com/ai/gemini-nano)，Last updated 2026-10-08 UTC。
- Android 背景工作：**非前景時系統會限制**；前景以外的工作不保證做完。官方建議多數排程用 WorkManager，緊急長任務才用前景服務，且前景服務有通知與啟動限制。  
  來源：Android Developers，[Background tasks overview](https://developer.android.com/develop/background-work/background-tasks)，Last updated 2026-02-26 UTC。
- iOS `BGTaskScheduler` 官方文件存在（[BGTaskScheduler](https://developer.apple.com/documentation/backgroundtasks/bgtaskscheduler)）。2026-10-19 抓取到的頁面幾乎沒有正文，**查不到**可引用的「保證每隔 N 分鐘喚醒」數字。因此不把背景排程寫成已實現的隨時感知。

**對 nuni：** 今天殼前景重算 = 現在做得到的感知。OS 背景喚醒、鎖定畫面、Siri 螢幕感知都還沒接，不能寫成已有。

### 1.2 能真的執行任務的產品，失敗在「雲端一斷就什麼都不是」與「先錄再說」

- Humane Ai Pin：HP 官方 2025-02-18 宣布收購 Cosmos／人才／智財，**不含**消費裝置線。Humane 消費者 FAQ 寫明 2025-02-28 12:00 PST 後裝置不再連上伺服器；離線只剩電量等，語音／AI 回覆／.Center 不可用。  
  來源：HP Newsroom，[HP Accelerates AI Software Investments…](https://www.hp.com/us-en/newsroom/press-releases/2025/hp-accelerates-ai-software-investments-to-transform-the-future-of-work.html)，2025-02-18；Humane Support，[Ai Pin Consumers FAQ](https://support.humane.com/hc/en-us/articles/34243204841997-Ai-Pin-Consumers-FAQ)，查於 2026-10-19。Reuters 同日報導見 [wind-down](https://www.reuters.com/markets/deals/ai-startup-humane-wind-down-wearable-pin-business-sell-assets-hp-2025-02-19/)（2025-02-19；本環境抓取曾 401，日期與交易金額改以 HP 稿為準）。
- Microsoft Recall：2024-06-07 起多次延後預覽，改為 opt-in、需 Windows Hello、快照本機加密。說明「先廣泛錄螢幕再當記憶」會撞上信任，必須可關、可刪、預設不開。  
  來源：Windows Experience Blog，[Update on the Recall preview feature for Copilot+ PCs](https://blogs.windows.com/windowsexperience/2024/06/07/update-on-the-recall-preview-feature-for-copilot-pcs/)，2024-06-07，文內更新至 2024-10-31。

**對 nuni：** 沒有模型、沒有雲端連線時，規則卡仍要能出、能處理、能誠實說做不到什麼。不准用樣本資料假裝感知。不另做螢幕錄製式記憶。

### 1.3 工具呼叫必須先同意；互通協定還不是產品功能

- MCP（Model Context Protocol）於 2024-11-25 由 Anthropic 開源；現行規範 2025-06-18。安全原則寫明：使用者必須明確同意資料存取與操作；**呼叫任何 tool 前 host 必須取得明確同意**；應提供可審查、可授權的 UI。  
  來源：Anthropic，[Introducing the Model Context Protocol](https://www.anthropic.com/news/model-context-protocol)，2024-11-25；MCP spec，[2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18)。
- Google 於 2025-04-09 發布 A2A，並寫明 **A2A 互補 MCP**（MCP 給 agent 工具與上下文，A2A 給 agent 彼此協調）。長任務可帶人在迴路裡。  
  來源：Google Developers Blog，[Announcing the Agent2Agent Protocol (A2A)](https://developers.googleblog.com/a2a-a-new-era-of-agent-interoperability/)，2025-04-09。
- OpenAI Agents SDK 的 human-in-the-loop：敏感 tool 以 `needs_approval` 暫停，核准或拒絕後才繼續；核准面是 run-wide。  
  來源：OpenAI Agents SDK 文件，[Human-in-the-loop](https://openai.github.io/openai-agents-python/human_in_the_loop/)，查於 2026-10-19（頁面未標發布日）。

**對 nuni：** 第一切片不接 MCP／A2A／模型 tool。預覽－確認－可撤銷直接做在規則動作上，與上述同意模型同方向。接模型之後也不能讓模型直接繳交、點名、改成績。

### 1.4 端側與雲端

Gemini Nano（上節，2026-10-08）把隱私與離線放在端側，能力不夠才上雲。Humane 斷雲即死（2025-02-28）是反例。nuni 第一切片：**規則在 client 算，狀態寫本機；不呼叫模型。** 端側 LLM、雲端 LLM 都還沒接通到這條產品路徑。

### 1.5 查不到、因此不寫進產品承諾的事項

- 查不到可引用的「2024–2026 主動式 agent 市場佔有或成功率」一手數字。
- 查不到 nuni 已取得 iOS 背景重新整理、Android 精確鬧鐘、或通知排程授權並在今天殼使用。
- 查不到 WWDC26 Apple Intelligence 指南正文（本環境未成功抓到可引用段落）；App Intents 文件本身已足夠支持「可撤銷／需確認」。
- Granola 會議紀錄：此環境帳號未授權，**沒有會議定案可引用**。
- Play 上「24/7」類行銷句不當成 nuni 或作業系統能力。

---

## 2. nuni 現有資產盤點（只寫程式裡看得到的）

今天殼：

| 端     | 畫面                                             | 資料                                                                         |
| ------ | ------------------------------------------------ | ---------------------------------------------------------------------------- |
| Web    | `apps/web/src/app/page.tsx`                      | `loadHomeData`（學校 Firebase 作業）或 `loadNuniHomeData`（Nuni 作業＋測驗） |
| Mobile | `apps/mobile/src/screens/StudentTodayScreen.tsx` | `loadStudentHome` → 課程＋`InboxTask`                                        |

**已能在今天殼即時讀到（前景、已登入、讀取成功時）：**

- 課程成員與未讀數（Web 學校路徑、Mobile）。
- 未繳交且已發佈的作業；Web Nuni 路徑另有未作答測驗。
- 截止時間 `dueAt`（有則為真實時間；沒有則 Web 仍列出、Mobile 學生作業列**不會**收進 inbox）。
- Mobile 進行中的點名／live session（`InboxTask.kind === 'live'`）。
- Web／Mobile 既有三態：未登入或被擋、讀取中、失敗、成功（空或有列）。Web 失敗與空分開，不准把失敗寫成沒有待辦。

**今天殼現在沒有載入、因此第一切片不准當已感知：**

- 校園公告（有獨立頁與三態；**本線不改公告三態、不在今天殼重抓公告**）。
- 本機個人課表（`PersonalTimetable`／personal import 存在，今天殼未讀）。
- 成績、教材清單、公車即時、系統通知 inbox。
- Mobile 學生 **已過期** 作業：`listInboxTasks` 只收未來 7 日內有截止的項目（`diff < 0` 會 skip）。過期卡在 Web 做得到，Mobile 要等 inbox 規則改——本次不改 LMS 已驗範圍。

**假裝成 agent、但不是這條產品：**

- `proactiveAIAgent` / `useProactiveAIAgentLoop`：開發 demo session 才轉；內含 DEMO 課程。不當成已上線感知。
- `AIAgentConsole`、`AIAgentObservatory`、emoji／信心百分比：不擴充、不當第一切片容器。
- Web `/ai-assistant`：問答殼，本線不把 agent 做成第二個聊天窗。
- 沒有已接通、可供今天殼呼叫的產品模型。沒有背景感知權限流程。

**明確不碰：** 點餐開關、公告三態、LMS 繳交／成績／已驗範圍、正式資料庫、部署。

---

## 3. 感知來源分級

### A. App 內真訊號（第一切片只用這個）

在今天殼**已經載入成功**的列：進行中點名（Mobile）、已過截止的未繳作業／測驗（Web）、24 小時內截止的未繳作業／測驗（兩端，且該列確實存在於今天資料）。

觸發時間 = 這次畫面用來計算的「現在」（Web 每 60 秒、Mobile 面板同樣用現在時間）。每張卡必須寫：依據哪個訊號、何時觸發。

### B. 需使用者授權的裝置訊號（未做）

通知排程、背景重新整理、精確鬧鐘、位置。Mobile 雖有 `expo-notifications`（例如訂閱菜單），今天殼感知**未**申請、也未用來建立提醒。第一切片「稍後一小時」只寫本機 snooze，**不會**跳出系統通知。

### C. 未來才有

模型接通後的改寫／合併／排序；MCP tool；A2A；OS 級 App Intent；個人課表進今天殼；公告／成績／教材／公車當感知源；背景掃描。未做就標未做。

---

## 4. 能真的處理的動作與權限分級

| 動作                                                 | 分級                           | 實際效果                                                         |
| ---------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------- |
| 前往這份作業／測驗／簽到                             | 可直接做                       | 開既有繳交／測驗／點名畫面或錨點。不改資料。                     |
| 從清單移出                                           | 要先預覽確認                   | 只寫入帳號範圍本機狀態，這張卡不再出現。**不**繳交、**不**簽到。 |
| 稍後一小時                                           | 要先預覽確認                   | 本機 snooze 一小時。不做系統提醒。                               |
| 撤銷上次操作                                         | 可直接做（僅當上次標為可撤銷） | 還原本機 handled／snooze。不可再撤銷撤銷。                       |
| 代繳作業、代答測驗、代點名、改成績、發公告、開關點餐 | 不可代做                       | 不提供按鈕。                                                     |

預覽文案必須講清楚「不會幫你繳交」。狀態列紀錄：何時、做了什麼、可否撤銷（照實）。

---

## 5. 預覽－確認－可撤銷

1. 會改本機狀態的動作，先在卡片內顯示預覽，確認後才寫入。
2. 寫入後留下一筆 `lastRecord`（時間、動作、對象、是否可撤銷）。
3. 可撤銷的上次操作可還原該卡的 handled／snooze。
4. 開啟作業不是寫入，不需預覽。
5. 不可代做的事不出現「確認後仍假裝已繳交」。

儲存鍵：`makeScopedStorageKey('todaySense', { uid, schoolId })`，跟帳號走，不用 anonym 共用。壞掉的 JSON 當成空狀態，不拿範例填。

---

## 6. 沒有模型時 vs 接通後

**現在（規則，第一切片）：** 用現在時間套 live／過期／24h 規則。沒符合就說沒有，不編。離線且讀取失敗走既有錯誤態，不展示過期卡片。未登入不展示個人卡。

**模型接通後才可以多的：** 對已經算出的卡判斷先後，並用程式鎖住的課名／時間組出「為什麼先做」。仍須預覽確認；不可跳過權限分級。沒有模型、拒絕下載或輸出驗不過時行為與現在相同。

裝置端模型見 [today-sense-on-device-model.md](./today-sense-on-device-model.md)。結論：**Web 接 Qwen3-4B，只做排序。** 自由改寫已淘汰。0.6B／1.7B 排序不比規則聰明。公告抽取未過 span 驗證，不接。模型不得自行判斷截止或寫回。

---

## 7. 失敗、離線、沒資料

沿用今天殼三態，感知區不另造「成功空狀態」來遮失敗：

- 未登入／session 被擋：不讀個人待辦、不出個人卡。Web 可寫「登入後才會依你已讀到的待辦顯示」。
- 讀取中：不顯示空清單、不用樣本卡。
- 讀取失敗：不顯示上一輪個人卡，不說「目前沒有需要處理的事項」。
- 成功但規則 0 張：顯示「目前沒有需要立即處理的事項。這是依現在時間與已讀到的待辦算出來的，不是範例。」

---

## 8. 紅線

- 不另開聊天窗，不做 ChatGPT 式問答殼。
- 不用「智慧推薦」口吻，不寫信心百分比，不使用 emoji 當狀態。
- 不准 AI 感霓虹／紫漸層；沿用紙白與墨綠（見 `docs/design/design-system.md`）。
- 不用假資料假裝感知；demo agent 迴圈不接到這條 UI。
- 不宣稱背景感知或模型已接通。

---

## 9. 第一切片範圍（這次交進 main）

- 共用規則：`packages/shared/src/todaySense.ts`。
- Web 今天首頁完整可用：有過期或 24h 內截止的已載入待辦就出卡；前往、移出、稍後、撤銷寫入 `localStorage`。
- Mobile 今天頁完整可用：進行中點名、以及 inbox 裡 24h 內截止的作業／測驗；寫入 AsyncStorage。**不出** Mobile 端沒載入的過期作業卡。
- 兩端都接同一套規則與文案。不部署、不寫正式資料庫。

尚未做（誠實）：背景感知、系統提醒、MCP／A2A、公告／課表／成績／公車進感知、代繳與代點名、把 demo `proactiveAIAgent` 改成真來源、Mobile 裝置端模型。Web 今天殼可在同意後下載 4B 來排序，見 [today-sense-on-device-model.md](./today-sense-on-device-model.md)。
