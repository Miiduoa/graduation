# 今天殼裝置端模型定案

一句話：**接 Qwen3-4B，只聰明在「判斷今天先處理哪一件」；課名、時間、截止仍由程式鎖住照原樣顯示。** 自由改寫卡片那條路（第 9 節）已經證明會改壞事實，所以模型改成只能選、只能排。0.6B／1.7B 排序仍跟規則一樣把已過期作業排在兩小時內的測驗前面；4B 會把測驗提前，並排出先點名、再去小考。公告抽取 4B 仍會把「繳交「臺灣」現代詩習作」收成非原文連續字，所以**不接抽取、不改公告三態**。Web 第一步：有 WebGPU、至少兩張卡、使用者同意才下載約 2.8 GB（請用 Wi-Fi）；輸出驗不過就退回規則版。

手機另見第 11 節。晉瑋問學生不是每個人都隨時用電腦：**手機第一步不押系統內建模型**，沿用開發版已有的 `llama.rn` 下載同一顆 4B（GGUF Q4_K_M 約 2.50 GB）只做排序；系統內建當免下載加分項，A7 沒在該權重上考過就不接。跑不動或驗不過維持規則版。**第 11 節只定案、不接模型、不改產品行為。**

本文件含規格比較與 2026-10-19 本機實測。**沒有部署、沒有付費、不寫正式資料庫、不開聊天窗、不碰點餐。** 架構仍遵守 [ADR 0003](../adr/0003-ai-as-advisory-layer.md) 與 [today-sense-agent.md](./today-sense-agent.md)。

查閱日期：2026-10-19。下列只寫有網址與日期的來源；查不到的會標明。

對照已上 main 的規則版：

| 提交       | 做了什麼                                       |
| ---------- | ---------------------------------------------- |
| `95091124` | 定案今天殼感知與處理 agent                     |
| `a90a8452` | 今天殼加入可寫回的感知處理切片                 |
| `1b3ec1f3` | 修正網站重新整理後讀不回處理清單狀態           |
| `4034ff65` | 定案今天殼裝置端免費模型接線（規格層）         |
| `62a51ce4` | 修正處理清單寫入失敗假裝成功與手機建議卡順序   |
| `a2a14727` | 改寫考題後定案不接（自由改寫會改壞事實）       |

晉瑋補的硬條件：要能在**用戶端裝置**上跑、**免費**、且**夠強**；後又交代不要為了免費接會寫怪句、誤解繁中、或把卡片改壞的模型。Granola 此環境帳號未授權，**查不到會議原文**，以任務文字為準。

---

## 1. 對照現行規則版：模型只能補什麼

現在「現在可處理」已經能做、且**沒有模型也必須繼續做**：

- 用現在時間套 `live_now`／`overdue`／`due_soon`（24 小時）。
- 卡文案來自規則常數，不是生成。
- 「從清單移出／稍後一小時」先預覽再寫本機；撤銷可還原。
- 不繳交、不點名、不改成績。未登入／讀取中／失敗走今天殼三態。

**模型若接通，只允許：**

| 模型可做 | 仍由規則與確認把關 |
| -------- | ------------------ |
| 對**已經算出**的卡輸出完整 id 排列 | 哪幾張卡存在、`kind`、截止是否成立、課名／標題／時間原文 |
| 從固定 reasonCode 對上程式句型（進行中／硬截止／已過期／可等） | 寫回 handled／snooze；預覽文案與可撤銷 |
| 無模型、拒絕下載、輸出驗不過時維持規則順序與原文 | 未登入／讀取失敗不准用模型填空或樣本卡 |

不准：自由改寫課名或時間、自己決定「過期了」、自己寫回、自己開 LMS、自己點名、從公告發明新待辦、另開聊天窗。

「夠強」見第 10 節：要能理解狀況並判斷先後，且事實欄位過不了程式驗證就不顯示。第 9 節的改寫及格線仍然有效——那條路已淘汰。

---

## 2. 沒有單一方案同時滿足 Web + iPhone + Android + 免費 + 免下載 + 繁中

| 需求           | OS 內建（Nano／Apple）     | 自帶開源權重（Qwen3／Gemma 4）      |
| -------------- | -------------------------- | ----------------------------------- |
| 推論費用       | 官方寫明端側、無每次伺服器費 | 權重 Apache-2.0 或同等，本地跑      |
| App／頁面體積  | 不進包體                   | 要下載約 0.35–2.6 GB（視模型）      |
| Web            | Chrome 內建 Nano **不含手機**，官方語言清單**沒有中文** | WebGPU 可跑；無 WebGPU 則慢或降級 |
| iOS／Android   | 只在符合 Apple Intelligence／Nano 清單的機型 | 理論上可，但 Expo 要另接原生模組    |
| 繁體中文證據   | Apple 已列 traditional Chinese；Nano 寫「視裝置與已下載模型而異」 | Qwen3 官方列 Traditional Chinese    |
| 離線           | 模型在裝置上之後可以       | 權重下載完之後可以                  |

規格層曾打算「一條跨端權重 + 兩條系統內建備案 + 其餘誠實降級」。第 9 節改寫考題淘汰 0.6B／1.7B 自由改寫。第 10 節改成理解與判斷之後，**只接 4B 的排序**；抽取與小於 4B 的模型仍不接。

---

## 3. 各方案（2025–2026 一手來源）

### 3.1 Android Gemini Nano／AICore／ML Kit GenAI

- **是什麼：** Gemini Nano 跑在 Android 系統服務 AICore；app 經 ML Kit GenAI 呼叫。資料留在裝置，官方強調不必為每次推論付雲端費。  
  來源：Android Developers，[Gemini Nano](https://developer.android.com/ai/gemini-nano)，Last updated 2026-10-08 UTC。
- **免費與授權：** 推論無雲端 API 計費。使用 GenAI APIs 須遵守 **ML Kit GenAI API Additional Terms of Service**（官方頁面有此句；本環境抓 `developers.google.com/ml-kit/terms/genai` 只落到 ML Kit 總覽，**完整 ToS 正文查不到**）。混合推論官方指向 Firebase AI Logic Hybrid，落到雲端 Gemini **不是本定案範圍**（要帳號與可能計費）。
- **下載大小：** 模型由 AICore 管理，不進 app 包體。Prompt API 狀態可為 `AVAILABLE`／`DOWNLOADABLE`／`DOWNLOADING`／`UNAVAILABLE`。官方**沒寫** Nano 權重 MB 數。
- **中文：** 功能 API 裝置清單下寫「特定語言支援視裝置設定與已下載模型而異」。**查不到**繁體中文品質數字或保證。
- **速度／記憶體：** 官方只說視硬體；token 與能力有限。Prompt API 輸入須低於 4000 tokens（約 3000 英文字）；長輸出（>4K tokens）應避免。有 per-app 配額（`BUSY`、`PER_APP_BATTERY_USE_QUOTA_EXCEEDED`）。  
  來源：[Get started with Prompt API](https://developers.google.com/ml-kit/genai/prompt/android/get-started)，查於 2026-10-19（依賴 `genai-prompt:1.0.0-beta4`）。
- **離線：** 官方：輸入、推論、輸出在本機；無可靠網路時功能相同。第一次仍可能要下載設定或模型。
- **結構化／工具：** Prompt API 可出文字。Structured Output 為 **alpha**（`@Generable` Kotlin 物件），須另查 `isStructuredOutputFeatureAvailable()`。**不是**通用 tool calling。  
  來源：[Generate structured output](https://developers.google.com/ml-kit/genai/prompt/android/structured-output)，查於 2026-10-19。
- **Web：** 不可。這是 Android 系統服務。
- **iOS：** 不可。
- **Android：** 只在官方清單。Prompt API 另分 nano-v2／v3／v4 機型（例如 Pixel 9/10/11、部分 Galaxy S26／摺疊機、部分小米／vivo／OPPO）。功能 API（摘要等）清單更廣，仍不是「所有 Android」。未解鎖 bootloader。只准**前景**；背景含前景服務會 `BACKGROUND_USE_BLOCKED`。  
  來源：[ML Kit GenAI overview](https://developers.google.com/ml-kit/genai)，查於 2026-10-19。
- **降級：** `checkStatus() === UNAVAILABLE`、下載失敗、`BACKGROUND_USE_BLOCKED`、配額、中文不可用 → 規則卡原文，不顯示「AI 失敗」。

**對 nuni：** 合格 Android 的免下載備案，不能當第一選擇（Web 死、學生機大量不在清單、繁中無保證、Prompt 仍 beta）。

### 3.2 Chrome 內建 Prompt API（桌面 Gemini Nano）

- **是什麼：** Chrome 內建 LanguageModel／Prompt API，模型另下載。  
  來源：Chrome Developers，[The Prompt API](https://developer.chrome.com/docs/ai/prompt-api)，Published 2025-05-20，Last updated 2026-08-26。
- **免費：** 官方：使用模型時不把資料送到 Google 或第三方。無每次推論雲端費。
- **下載／門檻：** 至少 **22 GB** 磁碟空間（Chrome profile 所在卷）；GPU VRAM **嚴格大於 4 GB**，或 CPU **16 GB RAM + 4 核**。空間掉到 10 GB 以下會刪模型。初次下載要無限／非計量網路。
- **中文：** `expectedInputs`／`expectedOutputs` 的 `languages` 官方接受 `"en"`、`"ja"`、`"es"`、`"de"`、`"fr"`。**沒有中文。** 不支援的語言可能 `NotSupportedError`。
- **離線：** 下載後可離線。
- **結構化：** `responseConstraint` 可傳 JSON Schema。
- **Web：** 僅 **Chrome 桌面**（Windows 10/11、macOS 13+、Linux、Chromebook Plus）。**Chrome for Android、iOS、非 Chromebook Plus 的 ChromeOS 尚未支援。**
- **手機：** 不可。

**對 nuni：** 學生主力是手機與繁中，這條幾乎用不上。不當第一選擇。

### 3.3 Apple Foundation Models（裝置端 Apple Intelligence 模型）

- **是什麼：** Swift API 使用驅動 Apple Intelligence 的裝置端 LLM。WWDC25 講者說明約 **30 億參數、2-bit 量化**；為摘要、擷取、分類等裝置級工作優化，不是伺服器級世界知識。內建於系統，**不增加 app 體積**，可離線。  
  來源：Apple Developer，[Meet the Foundation Models framework](https://developer.apple.com/videos/play/wwdc2025/286/)，WWDC25。
- **免費與授權：** 系統能力，無每次雲端推論費。Apple 支援頁另寫：依賴**伺服器端**模型的部分功能有每日用量、未來可能收費；那是 Siri AI／Image Playground 等，**不是**裝置端 Foundation Models 本文。裝置端框架本身查不到「按 token 計費」。  
  來源：Apple Support，[How to get the next generation of Apple Intelligence](https://support.apple.com/en-us/121115)，Published 2026-09-14。
- **下載：** 不進 nuni 包體。系統端：部分新機最多約 14 GB、其他符合機最多約 8 GB 給 Apple Intelligence（整套功能，不是單模型檔）。
- **中文：** Apple Intelligence 語言清單含 **Chinese (simplified)** 與 **Chinese (traditional)**。香港新聞稿：2025-11-04 起含繁體中文。Foundation Models 論壇說明與 Apple Intelligence **同一語言集合**。voicemail／Notes 摘要另列 traditional Chinese（Hong Kong, Taiwan）。  
  來源：[Apple HK Newsroom 2025-11-04](https://www.apple.com/hk/en/newsroom/2025/11/apple-intelligence-expands-to-new-languages-including-traditional-chinese/)；支援頁 121115（2026-09-14）。
- **裝置：** iPhone 16 系列或更新、iPhone 15 Pro／Pro Max、iPhone Air；iPad mini (A17 Pro)；M1 或更新的 iPad／Mac 等。語言與 Siri 語言須相同且受支援。中國大陸購買或帳號／所在地限制見支援頁。
- **結構化／工具：** Guided Generation（`@Generable`／`@Guide`，constrained decoding）；WWDC 並介紹 tool calling。官方文件頁 [Foundation Models](https://developer.apple.com/documentation/foundationmodels) 與 generating-content 頁在本環境幾乎無正文，**細節以 WWDC25 影片稿為準**。
- **Web：** 不可。
- **Android：** 不可。
- **iOS：** 要 **原生 Swift 模組**。nuni Mobile 是 Expo ~54，**現在沒有**這層；未接模組前等於不可用。
- **降級：** `SystemLanguageModel` 不可用、語言不符、裝置不符 → 規則文案。

**對 nuni：** 合格 iPhone 上最強的免下載備案（約 3B、官方繁中、結構化輸出）。不能當跨端第一選擇。

### 3.4 MediaPipe LLM Inference

- **現況：** Android／iOS／Web 的 MediaPipe LLM Inference API **已進入 maintenance-only**；新功能與優化集中在 LiteRT-LM。官方建議遷移。Last updated **2026-10-01**。  
  來源：[LLM Inference guide](https://ai.google.dev/edge/mediapipe/solutions/genai/llm_inference)。
- **授權：** 另受 Generative AI Prohibited Use Policy 約束；Gemma 權重另見各模型授權。
- **對 nuni：** **不選為新接線。**

### 3.5 LiteRT-LM（含 Gemma 4、Qwen3、FunctionGemma）

- **是什麼：** 在 LiteRT 上跑 LLM 的跨平台層。Android／iOS／Web／桌面／IoT；GPU／NPU；文件寫有 Tool Use（constrained decoding）。  
  來源：[LiteRT-LM Overview](https://ai.google.dev/edge/litert-lm/overview)，Last updated 2026-10-06 UTC。
- **語言 API 成熟度（同頁）：** CLI／Python／Kotlin／C++ 標 Stable；**Swift、JavaScript 標 Early Preview**；Flutter 為社群套件。
- **官方列出的權重大小（MB）與部分速度：**

| 模型            | 類型 | 大小     | 官方測速摘錄                                      |
| --------------- | ---- | -------- | ------------------------------------------------- |
| Gemma4-E2B      | Chat | 2583 MB  | S26 Ultra GPU decode 52 tk/s；iPhone 17 Pro GPU 57 |
| Gemma4-E4B      | Chat | 3654 MB  | 更大、更慢                                        |
| Gemma-3n-E2B    | Chat | 2965 MB  | S24 Ultra GPU decode 16 tk/s                      |
| Gemma3-1B       | Chat | 1005 MB  | S24 Ultra CPU decode 33 tk/s                      |
| FunctionGemma   | Base | 289 MB   | S25 Ultra CPU decode 154 tk/s                     |
| Qwen3-0.6B      | Chat | **586 MB** | Vivo X300 Pro CPU decode 9、GPU 21 tk/s         |
| Qwen2.5-0.5B    | Chat | 521 MB   | S24 Ultra CPU decode 30 tk/s                      |

Gemma-4-E2B 峰值 CPU 記憶體：S26 Ultra CPU 1733 MB、GPU 676 MB；iPhone 17 Pro CPU 607 MB、GPU 1450 MB。Qwen3-0.6B **查不到**同表的峰值 RAM。

- **Gemma 4 授權：** Apache 2.0。官方部落格 2026-04-02。舊 Gemma（含 Gemma 3、FunctionGemma）仍走 [Gemma Terms of Use](https://ai.google.dev/gemma/terms)（Last modified 2026-04-01），不是 Apache。Gemma 4 另稱 140+ 語言；**該篇沒有單獨寫繁體中文評測。**
- **Web JS：** Early Preview。官方 JS 指南列出的 web-compatible 模型是 **Gemma 4 E2B／E4B／12B／26B／31B**，**沒有 Qwen3-0.6B**。E2B 檔約 2.58 GB，當 Web 第一包太大。  
  來源：[LiteRT-LM Web API](https://ai.google.dev/edge/litert-lm/js)，查於 2026-10-19。
- **FunctionGemma：** 官方要**再微調**才當 function-calling 專家，**不是對話模型**。未微調 Mobile Actions 58%，微調後 85%。S25 Ultra dynamic_int8：288 MB、峰值 RSS 約 549–551 MB。安全評測**只含英文 prompt**。授權為 Gemma ToU，不是 Apache。  
  來源：[FunctionGemma overview](https://ai.google.dev/gemma/docs/functiongemma)；[HF model card](https://huggingface.co/google/functiongemma-270m-it)，查於 2026-10-19。
- **離線：** 權重在裝置後可離線。
- **iOS／Android：** Kotlin Stable、Swift Early Preview；仍要原生層。Expo 現況接不上。

**對 nuni：** 行動端原生執行層首選（下一輪若做 native）。Web 第一包不要用 Gemma 4 E2B。FunctionGemma 不當對話、不微調不當第一。

### 3.6 Transformers.js（WebGPU／WASM）

- **是什麼：** 瀏覽器跑 Hugging Face 模型，ONNX Runtime；預設 WASM／CPU，可 `device: 'webgpu'`。文字生成任務官方支援。  
  來源：[Transformers.js 文件](https://huggingface.co/docs/transformers.js/en/index)，查於 2026-10-19。
- **免費與授權：** npm `@huggingface/transformers` **Apache-2.0**，v4.3.1，Updated 2026-10-06。權重另遵各模型授權。v4 部落格：2026-02-09。
- **Qwen3-0.6B ONNX：** `onnx-community/Qwen3-0.6B-ONNX` 官方範例 `device: "webgpu", dtype: "q4f16"`。Hugging Face 檔案樹（查於 2026-10-19）：`model_q4f16.onnx` **570 MB**；fp16 1.2 GB；int8 618 MB。這是社群 ONNX 轉換，基底為 `Qwen/Qwen3-0.6B`。
- **中文：** 見 Qwen3 官方（下節），不是 Transformers.js 另做的評測。
- **速度／記憶體：** 官方未給 Qwen3-0.6B 在瀏覽器的 tk/s。WebGPU 文件仍寫許多瀏覽器 experimental。無 WebGPU 可 WASM，會更慢、更吃 CPU。
- **離線：** Cache／IndexedDB 後可；本機未做離線包。
- **結構化／工具：** 核心是 text-generation。HF 教學提到可搭配 Vercel AI SDK 做 tool calling + human approval，那是應用層，不是執行引擎保證。
- **Web：** 可行，且對 nuni Next.js Web **不必原生模組**。
- **iOS／Android WebView：** 視 WebGPU；**查不到** Expo WebView 官方保證。原生 app 不當這條為準。

**對 nuni：** 本輪 Web 排序走這條（不必原生模組），權重改為 Qwen3-4B ONNX q4f16 約 2.8 GB，同意後才下載。失敗回規則文案。

### 3.7 WebLLM／MLC

- **WebLLM：** 瀏覽器 WebGPU 推論，OpenAI 相容 API。npm `@mlc-ai/web-llm` **0.2.86**，**Apache-2.0**，Updated **2026-10-11**。官方 README：JSON-mode 可用；**function-calling WIP**（有 preliminary `tools`／`tool_choice`）。支援 Qwen。Git 提交 2025-05-05 把 Qwen3-0.6B（`q0f16, q0f32, q4f16_1, q4f32_1`）與 1.7B／4B／8B 列入預建。  
  來源：[npm @mlc-ai/web-llm](https://www.npmjs.com/package/@mlc-ai/web-llm)；[web-llm#686](https://github.com/mlc-ai/web-llm/commit/089bbd0ce77ba5395a68409ef3ca9916f36e1974)。Qwen3-0.6B MLC 量化檔確切 MB **查不到官方表**（第三方站有 350 MB 一類數字，本文件不引用為定案）。
- **MLC LLM 原生：** Android SDK 文件存在（需實體機 GPU，模擬器不行；可執行時從 Hugging Face 下載或 `bundle_weight`）。iOS 部署文件本輪未完整抓到正文。建置鏈長（NDK、Rust、TVM）。  
  來源：[Android SDK](https://llm.mlc.ai/docs/deploy/android.html)，查於 2026-10-19。

**對 nuni：** Web 的備案執行層（JSON-mode 比 Transformers.js 更現成）。function-calling 仍 WIP，本來就不該讓模型直接呼叫寫回。原生 MLC 不當第一（建置重、Expo 不合）。

### 3.8 llama.cpp 類

- **授權：** MIT，Copyright 2023–2026 ggml authors。  
  來源：[LICENSE](https://github.com/ggml-org/llama.cpp/blob/HEAD/LICENSE)，查於 2026-10-19。
- **平台：** 官方 README 後端含 Metal、Vulkan、WebGPU、Hexagon（Snapdragon）等。Android：官方 `docs/android.md`，NDK `ANDROID_PLATFORM=android-28`、`arm64-v8a`。iOS：官方 XCFramework 文件與 GitHub Releases 資產「iOS XCFramework」（本環境查到的最新預發 b11724，2026-10-19）。
- **權重：** GGUF，大小隨量化；須另遵模型授權。Qwen3 官方部落格建議本地用 llama.cpp。
- **結構化：** GBNF grammars（官方文件目錄有此項）。
- **Web：** WebGPU backend 存在；瀏覽器產品化程度不如 Transformers.js／WebLLM 文件完整。
- **Expo：** 要原生模組，現在沒有。

**對 nuni：** 以後原生 iOS／Android 的穩妥執行層（MIT）。本輪不接。Web 仍優先 JS 生態。

### 3.9 Qwen3 權重（跨執行層的共同模型）

- **授權：** 官方 2025-04-29：Qwen3-0.6B 至 32B 與 MoE **Apache 2.0**。
- **中文：** 官方列 119 語言／方言，Sino-Tibetan 項含 **Chinese (Simplified Chinese, Traditional Chinese, Cantonese)**。這是目前各開源小模型裡，繁中寫得最清楚的一手聲明。
- **能力：** 0.6B dense、28 層、context 32K；有 thinking／non-thinking。官方也寫 agent／MCP 示例，那是較大模型與 Qwen-Agent，**不是**保證 0.6B 在瀏覽器可靠 tool-call。
- **來源：** [Qwen3: Think Deeper, Act Faster](https://qwenlm.github.io/blog/qwen3/)，2025-04-29。

**對 nuni：** 官方繁中聲明仍是開源小模型裡寫得最清楚的。第 10 節實測後接 4B 做排序（Web ONNX q4f16 約 2.8 GB）；0.6B／1.7B 排序不比規則聰明，改寫也過不了第 9 節。

---

## 4. 定案

規格層一度把 Qwen3-0.6B 當跨端第一選擇。第 9 節改寫考題把它推翻。第 10 節換成理解與判斷後，**第一選擇改為 Qwen3-4B，且只接排序。**

### 4.1 第一選擇

**Web 接 Qwen3-4B（ONNX q4f16，約 2.8 GB），只輸出已存在卡片的順序。** 課名、標題、截止、why 仍用規則版。理由句由 `card.kind` 與截止時間組出來，模型不能寫。有 WebGPU、至少兩張卡、使用者同意（請用 Wi-Fi）才下載。拒絕、不支援、逾時、JSON 驗不過 → 清單與現在完全相同。

不接 0.6B／1.7B：排序與規則相同，稱不上 agent。不接公告抽取：4B 在繁中標題 span 上仍會重組引號。

### 4.2 備案（現在都不接）

1. **Qwen3-1.7B：** 步驟題曾過，排序題仍把已過期作業排在兩小時內測驗前面。下載 1.43 GB 較小，但沒證明比規則聰明。
2. **iOS Foundation Models／Android Nano：** 本輪沒有這兩顆權重可在此環境實測。
3. **Gemma 4 E2B：** 2.58 GB，本輪未跑。沒考過就不能接。

### 4.3 明確不選為第一

| 方案                         | 原因 |
| ---------------------------- | ---- |
| 只押 Nano 或只押 Apple       | Web 沒有；大量學生裝置不符合 |
| Chrome Prompt API            | 非手機；語言清單無中文；22 GB 磁碟門檻 |
| MediaPipe LLM Inference      | 2026-10-01 起 maintenance-only |
| FunctionGemma 當對話／工具   | 必須微調；安全評測僅英文；Gemma ToU |
| 預設打 Gemma 4 E2B           | 2.58 GB，學生流量與空間不誠實 |
| 雲端 API（含 Firebase Hybrid） | 不符「裝置端、免費」硬條件 |
| 讓模型直接 tool 寫回         | 違反 ADR 0003 與現行預覽機制 |

### 4.4 哪些裝置先支援（接通以後，不是現在）

1. **Web，桌面 Chrome／Edge 且 `navigator.gpu` 可用、至少兩張規則卡、使用者同意下載約 2.8 GB（請用 Wi-Fi）。** 這是本輪唯一接通的路徑。
2. **iPhone／Android 原生 App：** 見第 11 節。本輪仍不接。
3. **其餘（含無 WebGPU 的瀏覽器、舊 Android、未開 Apple Intelligence、iOS WebView、載入 4B 失敗的手機）：** 維持規則版，畫面不提模型。

### 4.5 模型只負責什麼；規則仍把關什麼

沿用 `packages/shared/src/todaySense.ts`：

- **規則繼續單獨決定：** 清單有沒有卡、`live_now`／`overdue`／`due_soon`、`dueAt` 比較、handled／snooze、三態、預覽文案。
- **模型最多輸出：** 已存在卡片 id 的排列。對不上完整排列、點名沒排第一，就丟棄，顯示規則順序。
- **模型輸出不得觸發：** `handle`／`snooze`／開繳交／點名。畫面上的按鈕仍走現有 permission 與預覽。

`SENSE_SECTION_NOTE` 維持「沒有接模型，也不會在背景持續感知」，讓拒絕下載或不支援時畫面與現在相同。建議順序另寫在通過驗證之後的區塊。

---

## 5. 誠實降級（接通時必須實作，本輪只鎖定）

1. **能力偵測先於 UI：** Web 查 WebGPU；Android `checkStatus()`；iOS 查 Foundation Models availability 與語言。失敗則連「下載模型」都不出現。
2. **Opt-in 下載：** 寫明大約體積（本輪 Web Qwen3-4B q4f16 **約 2.8 GB**，請用 Wi-Fi；0.6B 570 MB、1.7B 1.43 GB 考題不及格所以不當第一包）。預設不抓。取消／失敗 → 規則版。
3. **逾時／OOM／背景：** Android 前景限制直接當不支援。Web 推論設短逾時（產品尚未定數字；**查不到**官方建議秒數就不寫死）。失敗用規則 `title`／`why`。
4. **不准用模型遮三態：** 未登入、讀取中、讀取失敗行為與現在相同。規則 0 張時不准生成待辦。
5. **權限：** 模型沒有寫入 API。預覽－確認－撤銷程式路徑不變。

---

## 6. 第一步最小可行接法（本輪已做：只排序，不改寫）

1. 只動 **Web** `TodaySensePanel`。不改 `todaySense.ts` 判定，不改 handled／snooze 寫入。
2. 使用者同意才下載 Qwen3-4B；模型只輸出已算出卡片的 id 排列；課名、時間、why、理由句由程式鎖住。
3. 不支援／拒絕下載／輸出驗不過時畫面與現在完全相同（含原來的 `SENSE_SECTION_NOTE`）。
4. 不開聊天窗、不部署、不寫正式資料庫、不碰點餐與公告三態、不把公告抽成新卡。
5. 輸出驗證見 `packages/shared/src/todaySenseAgent.ts`。Mobile 接線計畫見第 11 節；**本輪仍不接、不改 Mobile UI。**

---

## 7. 查不到、因此不承諾

- Granola 會議裡晉瑋的完整原話（帳號未授權）。
- Gemini Nano 權重 MB、繁體中文品質。
- ML Kit GenAI Additional ToS 全文（本環境未抓到獨立條款頁）。
- Apple Foundation Models 開發者文件 HTML 正文（本環境近乎空白；改以 WWDC25 影片稿與支援頁 121115）。
- Qwen3-0.6B／1.7B／4B 在 Chrome／iPhone Safari 的實測 tk/s 與 RAM（本輪用 GGUF Q4_K_M、CPU 4 threads 當 4-bit 類比，沒在瀏覽器跑 ONNX）。
- 瀏覽器能否穩定載入 2.8 GB 的 Qwen3-4B ONNX（視學生電腦記憶體；失敗則退回規則版）。
- WebLLM 預建 Qwen3-0.6B q4f16_1 的官方 MB。
- Expo 54 對 Foundation Models／ML Kit／llama.cpp 的官方一等支援。官方 `expo-ai` 文件標「next SDK」、alpha，**SDK 54 參考目錄沒有這頁**。
- 「2025–2026 端側模型市場佔有」類數字。
- 台灣學生手機機型市佔、各機官方 RAM 數字（Apple 規格頁不公布 RAM）。
- Apple Foundation Models／Gemini Nano 在 A7 四卡排序題上的輸出（本環境沒有合格 iPhone／Pixel）。
- Qwen3-4B 在任何實體手機上的 tk/s、OOM 與否、發熱（第 11 節只有 Linux CPU 類比）。
- 手機 Safari／Chrome 穩定載入 2.8 GB ONNX 或 2.5 GB GGUF。
- Transformers.js 官方支援 React Native（v4 PR 仍列 React Native support 未完成）。

---

## 8. 來源（網址與日期）

| 來源 | 日期 |
| ---- | ---- |
| https://developer.android.com/ai/gemini-nano | Last updated 2026-10-08 |
| https://developers.google.com/ml-kit/genai | 查於 2026-10-19 |
| https://developers.google.com/ml-kit/genai/prompt/android/get-started | 查於 2026-10-19（beta4） |
| https://developers.google.com/ml-kit/genai/prompt/android/structured-output | 查於 2026-10-19（alpha） |
| https://developer.chrome.com/docs/ai/prompt-api | 2025-05-20；Last updated 2026-08-26 |
| https://developer.apple.com/videos/play/wwdc2025/286/ | WWDC25 |
| https://developer.apple.com/documentation/foundationmodels | 查於 2026-10-19（正文幾乎未抓到） |
| https://support.apple.com/en-us/121115 | Published 2026-09-14 |
| https://www.apple.com/hk/en/newsroom/2025/11/apple-intelligence-expands-to-new-languages-including-traditional-chinese/ | 2025-11-04 |
| https://www.apple.com/newsroom/2025/06/apple-intelligence-gets-even-more-powerful-with-new-capabilities-across-apple-devices/ | 2025-06-09（當時承諾年底繁中） |
| https://ai.google.dev/edge/mediapipe/solutions/genai/llm_inference | Last updated 2026-10-01 |
| https://ai.google.dev/edge/litert-lm | Last updated 2026-10-06 |
| https://ai.google.dev/edge/litert-lm/overview | Last updated 2026-10-06 |
| https://ai.google.dev/edge/litert-lm/js | 查於 2026-10-19 |
| https://ai.google.dev/gemma/docs/core | 查於 2026-10-19 |
| https://ai.google.dev/gemma/terms | Last modified 2026-04-01 |
| https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/ | 2026-04-02 |
| https://ai.google.dev/gemma/docs/functiongemma | 查於 2026-10-19 |
| https://huggingface.co/google/functiongemma-270m-it | 查於 2026-10-19 |
| https://qwenlm.github.io/blog/qwen3/ | 2025-04-29 |
| https://huggingface.co/docs/transformers.js/en/index | 查於 2026-10-19 |
| https://www.npmjs.com/package/@huggingface/transformers | v4.3.1，Updated 2026-10-06 |
| https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX | 查於 2026-10-19（`onnx/model_q4f16.onnx` 569,789,750 bytes ≈ 570 MB） |
| https://huggingface.co/onnx-community/Qwen3-1.7B-ONNX | 查於 2026-10-19（`onnx/model_q4f16.onnx` 1,426,069,098 bytes ≈ 1.43 GB） |
| https://huggingface.co/onnx-community/Qwen3-4B-ONNX | 查於 2026-10-19（q4f16 2,832,918,673 bytes ≈ 2.83 GB） |
| https://huggingface.co/unsloth/Qwen3-4B-GGUF | 查於 2026-10-19（本機實測檔 `Qwen3-4B-Q4_K_M.gguf` 2,497,281,312 bytes） |
| https://huggingface.co/unsloth/Qwen3-0.6B-GGUF | 查於 2026-10-19（本機實測檔 `Qwen3-0.6B-Q4_K_M.gguf` 396,705,472 bytes = 378.3 MiB） |
| https://huggingface.co/unsloth/Qwen3-1.7B-GGUF | 查於 2026-10-19（本機實測檔 `Qwen3-1.7B-Q4_K_M.gguf` 1,107,409,472 bytes = 1056.1 MiB） |
| https://huggingface.co/blog/transformersjs-v4 | 2026-02-09 |
| https://www.npmjs.com/package/@mlc-ai/web-llm | 0.2.86，Updated 2026-10-11 |
| https://webllm.mlc.ai/ | 查於 2026-10-19 |
| https://github.com/mlc-ai/web-llm/commit/089bbd0ce77ba5395a68409ef3ca9916f36e1974 | 2025-05-05 |
| https://llm.mlc.ai/ | 查於 2026-10-19 |
| https://llm.mlc.ai/docs/deploy/android.html | 查於 2026-10-19 |
| https://github.com/ggml-org/llama.cpp/blob/HEAD/LICENSE | 查於 2026-10-19 |
| https://github.com/ggml-org/llama.cpp/blob/master/docs/android.md | 查於 2026-10-19 |
| https://github.com/ggml-org/llama.cpp/blob/master/docs/xcframework.md | 查於 2026-10-19 |
| 本機考題：llama-cpp-python、CPU 4 threads、`/no_think`、ChatML JSON 改寫 | 2026-10-19T06:30:00Z |
| https://developer.apple.com/foundation-models-framework/ | 查於 2026-10-19 |
| https://developer.apple.com/videos/play/wwdc2026/339/ | WWDC26 |
| https://support.apple.com/en-us/124025 | Published 2025-09-15 |
| https://www.apple.com/newsroom/2025/09/new-apple-intelligence-features-are-available-today/ | 2025-09-15 |
| https://developers.google.com/ml-kit/genai/prompt/android/get-started | 查於 2026-10-19（`genai-prompt:1.0.0-beta4`） |
| https://docs.expo.dev/versions/unversioned/sdk/ai | 查於 2026-10-19（標 next SDK、alpha） |
| https://docs.expo.dev/versions/v54.0.0 | 查於 2026-10-19（無 expo-ai 頁） |
| https://github.com/mybigday/llama.rn | MIT；本倉 lock `llama.rn@0.4.8` |
| https://raw.githubusercontent.com/mybigday/llama.rn/v0.4.8/README.md | 該版 Android 無 GPU 後端 |
| https://web.dev/blog/webgpu-supported-major-browsers | Published 2025-11-25 |
| https://github.com/gpuweb/gpuweb/wiki/Implementation-Status | 查於 2026-10-19 |
| https://huggingface.co/docs/transformers.js/guides/webgpu | 查於 2026-10-19 |
| https://github.com/huggingface/transformers.js/pull/1700 | Merged 2026-06-08（Safari／iOS 26 WebGPU） |
| https://github.com/huggingface/transformers.js/pull/1382 | Transformers.js v4；React Native support 未勾 |
| https://llm.mlc.ai/docs/deploy/ios.html | 查於 2026-10-19 |
| https://llm.mlc.ai/docs/get_started/quick_start.html | 查於 2026-10-19 |
| https://wcandillon.github.io/react-native-webgpu/docs/getting-started/installation | 查於 2026-10-19 |
| 本機 A7 補跑：llama-cpp-python、CPU 4 threads、`n_gpu_layers=0`、temperature=0、對齊 `buildOrderPrompt` | 2026-10-19 |

---

## 9. 產品考題與實測（2026-10-19）

規格表不能當接線依據。晉瑋交代不要為了免費接會寫怪句、誤解繁中、或把卡片改壞的模型。這一節用規則版會真的算出來的卡片當考題，定及格線，再決定接不接。

### 9.1 及格線

改寫一張**規則已經算出**的卡：

1. **課程全名必須留下。** 漏「國文」、把「國文（臺灣文學）」收成作業名，不及格。
2. **時間角色不得對調、數字不得改。** 截止是截止、觸發是觸發。字串裡「有出現 10/19 00:00」不算過；講成觸發就是改錯事實。
3. **截止／進行中狀態不得改。** 已過截止仍是已過截止；24 小時內截止仍是即將截止；進行中點名不得寫成作業截止。
4. **不准自加建議或假訊息。** 「建議」「可以先」「應該」「記得」、沒寫的教室／老師／繳交狀態、把「週日 17:00 閉館」講成全日不開，一律不及格。
5. **繁中用字。** 「臺灣」「習作」保持繁體，不准改成簡體。

**任一題改寫不及格 → 整顆模型不及格 → 不接，維持規則版。** 公告整理不是第一切片範圍，仍拿來當壓力題；過不了只記原因，不當接線藉口。

自動勾選只看字串有沒有出現，會漏掉時間角色對調，也會把「不提供線上預約」誤判成禁止詞「提供線上預約」。下表以人工重評為準。

### 9.2 考法與大小／速度

卡文案對齊 `packages/shared/src/todaySense.ts` 的 `buildCard`（`formatTaipeiDateTime`、`zh-TW`、`Asia/Taipei`）。觸發時刻固定為台灣時間 2026-10-19 13:00。

| 題 | 規則會算出什麼 | 輸入（節錄） |
| -- | -------------- | ------------ |
| E1 | `overdue` 作業卡 | 課程「資料結構」、標題「期末報告」、why：已過截止時間（10/19 00:00），於 10/19 13:00（台灣時間）觸發 |
| E2 | `due_soon` 測驗卡 | 課程「普通物理實驗」、標題「第一次小考」、why：將於 24 小時內截止（10/19 15:00），於 10/19 13:00 觸發 |
| E3 | `live_now` 點名卡 | 課程「微積分甲」、標題「課堂點名」、why：進行中的點名時段，於 10/19 13:00 觸發；無截止 |
| E4 | `overdue` 繁中作業卡 | 課程「國文（臺灣文學）」、標題「繳交「臺灣」現代詩習作」、why：已過截止時間（10/19 00:00），於 10/19 13:00 觸發 |
| E5 | 公告整理（非第一切片） | 圖書館期中延長開放：10/20–31；平日 22:00；週日 17:00 閉館；不延長週六；不提供線上預約 |

系統提示要求只輸出 `{"title","why"}`，不得發明新待辦，不得改數字。提示末加 `/no_think`。

實測環境：2026-10-19T06:30:00Z，CPU 4 threads、約 15 GiB RAM、無 GPU。權重是 unsloth `Q4_K_M` GGUF，llama-cpp-python、ChatML。這是裝置端 4-bit 級距的類比，**不是**瀏覽器 ONNX／WebGPU 原檔；改寫對錯看權重，瀏覽器速度本輪沒測。

| 模型 | 實測 GGUF | Web ONNX q4f16（若當第一包要下的） | 載入 | 改寫四題平均 | 對 0.6B |
| ---- | --------- | ---------------------------------- | ---- | ------------ | ------- |
| Qwen3-0.6B | 378.3 MiB | 570 MB | 0.50 s | 1.31 s（1.59／1.29／1.04／1.34） | — |
| Qwen3-1.7B | 1056.1 MiB | 1.43 GB | 0.83 s | 3.13 s（3.61／3.23／2.70／2.99） | 下載約 2.8×、改寫約 2.4× 慢 |
| Gemma 4 E2B | 未下載 | LiteRT 官方 2583 MB | — | 本輪未跑 | 第一包已不合理 |

1.7B 當「同系列較大、還算裝置端」的對照。Gemma 級距下載已超過 2.5 GB，沒有在 1.7B 過關之前當第一包的理由。

### 9.3 原始輸出與重評

**E1 資料結構／期末報告（過期）**

規則 why：`依據作業「期末報告」已過截止時間（10/19 00:00），於 10/19 13:00（台灣時間）觸發。`

- 0.6B（1.59 s）：title「期末報告已過截止」；why「依據課程名稱《資料結構》，原說明中提及的截止時間（10/19 00:00）已過，於台灣時間10/19 13:00觸發。」自動勾選過。人工：截止與觸發角色正確，課程名在。過。
- 1.7B（3.61 s）：title「期末報告作業已過截止」；why「資料結構課程於10/19 00:00觸發，10/19 13:00（台灣時間）」。自動勾選過（兩個時間字串都在）。**人工不及格：把截止 00:00 講成觸發。** 這比不改寫更糟，學生會以為 00:00 才觸發、或搞不清哪一個是繳交截止。

**E2 普通物理實驗／第一次小考（24h）**

- 0.6B（1.29 s）：幾乎照抄規則 why，課程、小考、15:00、13:00、24 小時內都在。過。
- 1.7B（3.23 s）：同上，事實正確。過。改寫增值很小。

**E3 微積分甲／課堂點名（進行中）**

- 0.6B（1.04 s）：「微積分甲課堂點名」＋進行中點名時段、10/19 13:00。過。
- 1.7B（2.70 s）：同，過。兩邊都沒把點名寫成作業截止。

**E4 國文（臺灣文學）／繳交「臺灣」現代詩習作（過期，繁中）**

- 0.6B（1.34 s）：title「繳交「臺灣」現代詩習作」；why 只重複作業名與 10/19 00:00、13:00。**漏了課程名「國文」。不及格。** 「臺灣」「習作」維持繁體，這點沒崩，但漏課名已經夠把卡片改壞。
- 1.7B（2.99 s）：title 含「國文（臺灣文學）」與作業名、已過截止；why 保留 10/19 00:00。本題過。觸發 13:00 被省略，沒講錯角色，不當成本題失敗。

**E5 圖書館公告（非第一切片）**

原文必須留下 22:00、17:00、不延長週六、不提供線上預約。

- 0.6B（1.54 s）：「期間：10月20日-31日，總圖書館一樓閱覽室平日開放至22:00；週日維持17:00閉館。座位仍需以學生證現場登記，不提供線上預約」。時間兩個都在，「不提供線上預約」是原文不是假訊息。自動勾選把「不提供線上預約」誤判成禁止詞，那筆不算。**人工仍不及格：漏「不延長週六」。**
- 1.7B（3.26 s）：「總圖書館一樓閱覽室自10月20日起至10月31日開放至22:00，週日仍閉館，座位須現場登記」。**不及格：漏 17:00；把「週日維持 17:00 閉館」講成週日不開；漏不延長週六。** 這是假訊息。

### 9.4 總表

| 題 | 0.6B 自動 | 0.6B 人工 | 1.7B 自動 | 1.7B 人工 |
| -- | --------- | --------- | --------- | --------- |
| E1 過期作業 | 過 | 過 | 過 | **不及格（截止講成觸發）** |
| E2 即將截止測驗 | 過 | 過 | 過 | 過 |
| E3 進行中點名 | 過 | 過 | 過 | 過 |
| E4 繁中課名 | **不及格（漏國文）** | **不及格** | 過 | 過 |
| E5 公告 | 不及格（含誤判） | **不及格（漏週六）** | 不及格 | **不及格（週日講成不開）** |
| 改寫四題（第一切片） | 不及格 | **不及格** | 自動全過 | **不及格** |

兩顆都沒通過改寫及格線。0.6B 較小、較快，但會把「國文（臺灣文學）」的課名丟掉。1.7B 繁中課名過了，卻在最普通的過期作業上把 10/19 00:00 講成觸發；下載多約 2.8 倍、改寫慢約 2.4 倍，品質沒換到「不會改壞卡片」。E2／E3 兩邊都傾向照抄規則句，接上去幾乎沒有人話價值，卻多了改錯的風險。

### 9.5 定案

**不接裝置端模型。維持規則版 title／why。本輪沒有做 Web 下載、沒有改寫路徑、沒有聊天窗。**

原因不是「免費模型規格不夠好看」，是考題上會改錯課名或時間。規則句比較長，但課程名與截止不會被模型講反。以後若再考，必須看時間角色與課名，不能只掃字串；沒通過第 9.1 節就仍不接。**這條路已關閉。** 後續接線改走第 10 節的理解與判斷。

---

## 10. 理解與判斷考題（2026-10-19 第二輪）

晉瑋回：只考改寫太窄，兩顆不及格不能證明裝置端做不出真的 AI agent。這一輪改成：模型只能選、只能排；課名與時間必須是原文連續字或課程表 id；程式驗不過就當沒有模型。Granola 此環境仍未授權，**沒有會議原文**。

### 10.1 及格線

1. **抽取：** `titleSpan`／`dueSpan`／`quote` 必須是原文連續字；`courseId` 必須在課程表，對不上就 null。圖書館開放、網路維護不准變成作業卡。
2. **排序：** 輸出必須是輸入卡片 id 的完整排列。進行中點名必須第一。幾小時內截止的測驗必須排在已過期作業前面——規則做不到這件事，這才叫判斷先後。
3. **步驟：** 第一步必須是前往點名；必須另有一步前往那份即將截止的測驗；action 只能 open／snooze。
4. **任一題發明事實或不比規則聰明 → 那顆模型不接該能力。** 排序過、抽取不過，就只接排序。

### 10.2 考題

現在固定台灣時間 2026-10-19 13:00。課程表：資料結構 `cs101`、普通物理實驗 `phys-lab`、微積分甲 `calc-a`、國文（臺灣文學）`zh-tw`。

| 題 | 要模型做什麼 | 輸入 |
| -- | ------------ | ---- |
| A1 | 公告有沒有待辦 | 圖書館期中延長開放（22:00／17:00、不延長週六、不提供線上預約） |
| A2 | 從助教通知抓截止 | 「資料結構助教通知：期末報告請於 10/20 23:59 前上傳至 iLMS」 |
| A3 | 繁中課名與作業名 | 「國文（臺灣文學）公告：繳交「臺灣」現代詩習作已過截止時間（10/19 00:00）」 |
| A4 | 從 iLMS 通知辨認測驗 | 「普通物理實驗「第一次小考」將於今日 15:00 截止，尚未作答」 |
| A5 | 有時間但不是作業 | 校園網路維護 10/21 02:00–04:00 |
| A6 | 課程表沒有的課 | 歷史系「中國近代史」期末考 10/22 10:00（不准猜成資料結構） |
| A7 | 混合四張卡排序 | 點名進行中；國文習作已過期；普物小考 15:00；資料結構習題三明天 09:00 |
| A8 | 多步驟 | 同上四張；第一步前往點名，另一步前往小考 |

實測環境：2026-10-19T06:41:28Z，CPU 4 threads、約 15 GiB RAM、無 GPU。unsloth Q4_K_M GGUF，llama-cpp-python、ChatML、`/no_think`。不是瀏覽器 ONNX 原檔。

| 模型 | 實測 GGUF | Web ONNX q4f16 | 載入 | 八題平均 |
| ---- | --------- | -------------- | ---- | -------- |
| Qwen3-0.6B | 378.3 MiB | 570 MB | 0.82 s | 1.90 s |
| Qwen3-1.7B | 1056.1 MiB | 1.43 GB | 1.12 s | 4.89 s |
| Qwen3-4B | 2382.2 MiB（2,497,281,312 bytes） | 2.83 GB（`model_q4f16.onnx` + 兩段 data = 2,832,918,673 bytes） | 3.70 s | 8.94 s |

### 10.3 原始輸出與重評

**A1 圖書館（應為沒有待辦）** 三顆都過：`hasActionableTask: false`，`courseId: null`，`kind: info`。

**A2 資料結構期末報告 10/20 23:59**  
- 0.6B：課選對，但 `titleSpan` 填「資料結構」，漏作業名。不及格。  
- 1.7B／4B：`titleSpan`「期末報告」、`dueSpan`「10/20 23:59」。過。

**A3 國文（臺灣文學）／「臺灣」現代詩習作**  
- 0.6B：課選成 `cs101`，`titleSpan` 只剩「臺灣」。不及格。  
- 1.7B：`hasActionableTask: false`，該抓的待辦沒抓到。不及格。  
- 4B：課選對 `zh-tw`，截止「10/19 00:00」是原文，但 `titleSpan` 寫成「臺灣「現代詩習作」」，原文是「繳交「臺灣」現代詩習作」。**不是連續字，不及格。** 程式驗證會丟掉這筆，這就是為什麼抽取不接。

**A4 iLMS 小考通知**  
- 0.6B：課選成 `cs101`。不及格。  
- 1.7B／4B：`phys-lab`、「第一次小考」、「15:00」。過。

**A5 網路維護** 三顆都過，沒編成作業。

**A6 歷史系不在課程表** 三顆都沒把課填進 `cs101`。過（保守：當沒有可掛上的課）。

**A7 排序（規則會排：點名 → 已過期 → 小考 → 明天作業）**  
- 0.6B／1.7B：`live, overdue, quiz, later`。點名第一，但測驗在已過期作業後面。**不及格。**  
- 4B：`live, quiz, later, overdue`。點名第一，兩小時內小考在已過期作業前面。**過。** 這是規則做不到的判斷。

**A8 步驟**  
- 0.6B：輸出 JSON 陣列不是物件，且把已過期作業標成 `due_soon_hard_stop`。不及格。  
- 1.7B／4B：第一步前往點名 `happening_now`，另有一步前往小考 `due_soon_hard_stop`。過。1.7B 步驟過、排序不過，同一顆模型問兩次答案不一致，不當第一選擇。

### 10.4 總表

| 題 | 0.6B | 1.7B | 4B |
| -- | ---- | ---- | -- |
| A1 圖書館無待辦 | 過 | 過 | 過 |
| A2 助教通知抓截止 | 不及格（標題填成課名） | 過 | 過 |
| A3 繁中作業名 | 不及格（課選錯） | 不及格（沒抓到） | **不及格（標題不是原文連續字）** |
| A4 通知辨認小考 | 不及格（課選錯） | 過 | 過 |
| A5 維護不是作業 | 過 | 過 | 過 |
| A6 表外課程 | 過 | 過 | 過 |
| A7 混合排序 | 不及格（跟規則一樣） | 不及格（跟規則一樣） | **過** |
| A8 多步驟 | 不及格 | 過 | **過** |

### 10.5 定案

**接 Qwen3-4B，只接排序。** 證據是 A7：規則與較小模型都把已過期國文習作排在 15:00 小考前面；4B 把小考提前，因為過了 15:00 就不能考，過期作業仍可能補交。A8 同時通過。畫面顯示的課名與時間仍來自原卡；理由句由程式依 `kind` 與截止組出。

不接抽取：A3 證明 4B 仍會重組繁中引號，程式會拒絕，接上去只會常常退回規則、看起來像沒有 agent。今天殼本輪也不讀公告，不改公告三態。

不接 0.6B／1.7B：排序不比規則聰明。1.7B 下載較小（1.43 GB vs 2.83 GB），但 A7 失敗。

4B 第一包約 2.8 GB，預設不抓，文案寫請用 Wi-Fi；沒有 WebGPU、不到兩張卡、拒絕、載入失敗，畫面與規則版相同。Gemma 4 E2B（2.58 GB）本輪未跑。

Web 實作：`todaySenseAgent.ts` 驗證、`TodaySensePanel` 同意後才下載、驗不過不顯示建議順序。Mobile 接線計畫見第 11 節；**本輪仍不接、不改 Mobile UI。**

---

## 11. 手機專章（2026-10-19）：學生不是每個人都隨時用電腦

一句定案：**手機第一步沿用現有 Expo 開發版裡的 `llama.rn`，同意後下載 Qwen3-4B Q4_K_M（約 2.50 GB）只排今天待辦；先支援載得動這顆權重的 iPhone（Metal）與 RAM 夠的 64-bit Android，其餘與載入失敗、輸出驗不過一律維持規則版。系統內建模型當免下載加分項，A7 沒在該權重上考過就不接。**

硬條件不變：用戶裝置端跑、免費、繁中、不要笨東西；模型只做判斷（排先後），課名／時間由程式鎖住，驗不過退回規則版。Granola 此環境仍未授權，**沒有會議原文**，以任務文字為準。

本節只寫研究定案。**沒有接模型、沒有改 TodaySensePanel／規則引擎／寫回、沒有部署、沒有開分支。** 現有聊天用的本機 LLM（`Qwen2.5-7B` 等）也不拿來當今天殼排序——那幾顆沒考過 A7，而且 7B Q4 約 4.7 GB，比 4B 更大。

### 11.1 沒有一條路能讓「學生手上常見中階機」免下載又夠聰明

查不到台灣學生機型市佔的一手調查，因此不編「學生都用哪一款」。能確定的是官方清單本身：

| 路線 | 官方涵蓋 | 常見中階機（iPhone 13／14／15 非 Pro、Galaxy A、Redmi Note 一類） |
| ---- | -------- | -------------------------------------------------------------- |
| Apple Foundation Models | 須 Apple Intelligence 合格機 | **多數不在清單**（iOS 26 能裝 ≠ Intelligence 能開） |
| Gemini Nano Prompt API | 官方列的幾乎是 2025–2026 旗艦 | **不在清單** |
| App 內 4B GGUF | 理論上任何 64-bit 機能下載 | 下載約 2.5 GB；RAM 不夠或 OOM → 規則版 |
| 手機瀏覽器 WebGPU | iOS 26 Safari、Android 12+ Chrome（Qualcomm／ARM） | 2.8 GB ONNX 在手機分頁記憶體裡**沒有實測**；舊 iOS／無 WebGPU 直接沒有 |

所以「免下載的系統模型」覆蓋的是新旗艦，不是「每個學生的手機」。要讓沒有電腦的學生有機會用到跟 Web 同一種判斷，只能走**可下載的 4B**，並對跑不動的機誠實降級。

### 11.2 各路線（2025–2026 一手來源）

下列「中文與判斷」若沒有在該權重上跑 A7，就只寫規格與缺口，不當接線證據。A7 題目與及格線沿用第 10.1／10.2 節：點名必須第一；幾小時內的測驗必須排在已過期作業前面。

#### 11.2.1 iOS 系統內建：Apple Foundation Models

- **是什麼：** Swift API 呼叫驅動 Apple Intelligence 的裝置端 LLM。WWDC25 講者說明約 **30 億參數、2-bit 量化**；為摘要、擷取、分類等裝置級工作優化，**不是**伺服器級世界知識。內建於系統，不增加 app 體積，可離線。Guided Generation（`@Generable`）用 constrained decoding 保證結構。  
  來源：[Meet the Foundation Models framework](https://developer.apple.com/videos/play/wwdc2025/286/)，WWDC25。
- **支援哪些手機／系統：** Foundation Models 隨 iOS 26+／iPadOS 26+／macOS 26+。Apple Intelligence 機型（支援頁 121115，Published 2026-09-14）：iPhone 16 系列或更新、iPhone 15 Pro／Pro Max、iPhone Air；iPad mini (A17 Pro)；M1 或更新的 iPad／Mac 等。Apple 支援頁 [124025](https://support.apple.com/en-us/124025)（2025-09-15）寫明 Intelligence 在 iPhone 15 Pro、15 Pro Max、所有 iPhone 16 及更新機。**iPhone 11–15 非 Pro 可裝 iOS 26，但不在 Intelligence 清單。** 裝置語言與 Siri 語言須相同且受支援。中國大陸購買或帳號／所在地限制見 121115，不在此編造。
- **下載多大：** 不進 nuni 包體。系統端：iOS 27 支援頁寫新機最多約 14 GB、其他合格機最多約 8 GB 給整套 Apple Intelligence（不是單顆模型檔）。app 本身不必再下一包 4B。
- **免費與授權：** 裝置端推論官方寫明對開發者無雲端 API 費（香港新聞稿 2025-11-04：third-party apps tap the on-device model, inference free of cost to developers）。支援頁另寫：**依賴伺服器端**的功能（Siri AI、Image Playground、AFM 3 Cloud 等）有每日用量、未來可能收費——那不是本定案要的裝置端路徑。WWDC26 把 Private Cloud Compute、Claude、Gemini 接進同一套 Swift API；那些落到雲端，**不符硬條件，不當今天殼備案。**
- **繁中：** Apple Intelligence 語言清單含 Chinese (traditional)。香港新聞稿 2025-11-04 起含繁體中文。Foundation Models 與 Apple Intelligence 同一語言集合（既有第 3.3 節）。這是系統模型裡繁中寫得最清楚的一手聲明。
- **判斷考題：** **本環境沒有合格 iPhone，沒跑 A7。** 約 3B 裝置級模型是否會把 15:00 小考排到過期作業前面，查不到實測。未考過就不能接今天殼。
- **要不要原生／Expo：** 要原生 Swift。官方 [`expo-ai`](https://docs.expo.dev/versions/unversioned/sdk/ai) 可包 Foundation Models，但文件標 **next SDK、alpha**，建置要 Xcode 26.4+，**不在 Expo SDK 54 參考目錄**。nuni Mobile 是 Expo ~54、`newArchEnabled: true`。社群 `@react-native-ai/apple`／`expo-local-llm` 存在，不是 Expo 一等套件。Expo Go **不能**跑。社群 [`expo-ai-kit`](https://expo-ai-kit.dev/guides/platform-support) 自稱 SDK 54+ 可開 built-in LLM，仍要原生開發版，A7 沒測。
- **對 nuni：** 合格 iPhone 上最強的**免下載加分項**。不能當手機第一步（大量學生機不在清單、A7 沒證據）。

#### 11.2.2 Android 系統內建：Gemini Nano／AICore／ML Kit Prompt API

- **是什麼：** Gemini Nano 跑在系統服務 AICore；app 經 ML Kit GenAI Prompt API 呼叫。資料留在裝置，官方強調不必為每次推論付雲端費。只准**前景**；背景含前景服務會 `BACKGROUND_USE_BLOCKED`。未解鎖 bootloader。  
  來源：[ML Kit GenAI overview](https://developers.google.com/ml-kit/genai)；[Get started with Prompt API](https://developers.google.com/ml-kit/genai/prompt/android/get-started)，依賴 `genai-prompt:1.0.0-beta4`，查於 2026-10-19。
- **支援哪些手機：** Prompt API 另分 nano-v2／v3／v4，官方清單幾乎是 Pixel 9–11、部分 Galaxy S26／摺疊機、部分小米／vivo／OPPO／OnePlus 旗艦（完整型號見該頁，此處不抄成保證表——清單會改，接線時以該頁加 `checkStatus()` 為準）。**Android 版本號本身不能證明支援。** Galaxy A、Redmi Note 等常見中階機**沒列在 Prompt API 清單**。
- **下載多大：** 模型由 AICore 管理，不進 app 包體。狀態可為 `AVAILABLE`／`DOWNLOADABLE`／`DOWNLOADING`／`UNAVAILABLE`。官方**沒寫** Nano 權重 MB。AICore Developer Preview 只寫「相對大、須 Wi-Fi」。
- **免費與授權：** 推論無雲端 API 計費。須遵守 ML Kit GenAI API Additional Terms of Service；本環境仍**抓不到 ToS 全文**。Firebase AI Logic Hybrid 落到雲端 Gemini，不當本定案。
- **繁中：** 功能 API 寫「特定語言支援視裝置設定與已下載模型而異」。**查不到**繁體中文品質數字或保證。
- **判斷考題：** **本環境沒有 Pixel／清單內 Android，沒跑 A7。** 不同 `getBaseModelName()` 版本對同一 prompt 可能不同答案。未考過就不接。
- **限制：** 輸入須低於 4000 tokens；長輸出（>4K）應避免；有 per-app 配額（`BUSY`、`PER_APP_BATTERY_USE_QUOTA_EXCEEDED`）。Structured Output 為 alpha。
- **Expo：** 官方 `expo-ai` 預覽用 ML Kit Prompt `1.0.0-beta4`，同樣是 next SDK／alpha，且 Android 推論離開前景會 `ERR_APP_BACKGROUND`。要 `minSdk` 26、Kotlin 2.2.21+。現有模組 `campus-google-credential` 預設 minSdk 24——若將來接 expo-ai 必須升 minSdk，本輪不動。
- **對 nuni：** 合格 Android 的免下載加分項。覆蓋比 Apple 更窄、繁中無保證、API 仍 beta，**不能當第一步**。

#### 11.2.3 App 內小型模型：llama.cpp／`llama.rn`（本倉已有）

- **是什麼：** `llama.rn` 是 llama.cpp 的 React Native 綁定。nuni Mobile **已經依賴** `llama.rn@0.4.8`（`pnpm-lock.yaml` 釘死），聊天設定頁可下載 GGUF；Expo Go 不行，必須開發版／正式包。iOS 該版可用 Metal（`n_gpu_layers`）；README 寫 Metal 需 **Apple7 GPU**，模擬器不行。**該版 Android「No integrated any GPU backend yet」，即 CPU only。** 上游較新的 llama.rn README（查於 2026-10-19）才提到 OpenCL（Adreno 700+）與實驗性 Hexagon（SM8450+）；那是升級後的能力，**不是 0.4.8 現況**。
- **授權：** llama.rn MIT（Copyright 2023 Jhen-Jie Hong）；llama.cpp MIT。Qwen3-4B 權重 Apache 2.0。
- **下載多大：** 本機實測檔 `unsloth/Qwen3-4B-Q4_K_M.gguf` **2,497,281,312 bytes ≈ 2.50 GB**（Hugging Face 目錄列 2.5 GB）。不要把 Web 用的 ONNX q4f16（2.83 GB）跟手機 GGUF 混成同一個數字。0.6B／1.7B 同系列 Q4_K_M 為 396,705,472／1,107,409,472 bytes，但第 10 節與下面 11.3 證明排序不比規則聰明，不當第一包。
- **支援哪些手機：** iOS 開發版＋64-bit（arm64）；Android 0.4.8 README 只寫 arm64-v8a／x86_64，32-bit 不能建 context。不是「所有能裝 nuni 的機都能跑 4B」——還要空間與 RAM。
- **Expo：** **已經接上原生模組**，這是各手機路線裡唯一不必從零寫 JNI／Swift 的。仍要 development build，不能靠 Expo Go。JSON 可用該版 `convertJsonSchemaToGrammar`（GBNF）把 `order` 鎖成完整 id 排列，再交給現有 `todaySenseAgent.ts` 驗證。
- **中文與判斷：** 見 11.3。同一顆 Qwen3-4B Q4_K_M，用與產品相同的 `buildOrderPrompt` 類比，**A7 關鍵判斷通過**（點名第一、小考在過期作業前）。這不是手機實測。
- **對 nuni：** **手機第一步。** 與 Web 同一判斷能力、授權免費、模組已在倉。代價是約 2.5 GB 下載，以及中階機可能 OOM。

#### 11.2.4 LiteRT-LM／MediaPipe

- **MediaPipe LLM Inference：** 2026-10-01 起 **maintenance-only**，官方建議遷 LiteRT-LM。不選為新接線。  
  來源：[LLM Inference guide](https://ai.google.dev/edge/mediapipe/solutions/genai/llm_inference)。
- **LiteRT-LM：** Android／iOS／Web；Kotlin Stable、**Swift Early Preview**、**JavaScript Early Preview**。官方表：Qwen3-0.6B 586 MB（Vivo X300 Pro GPU decode 21 tk/s）；Gemma4-E2B 2583 MB（S26 Ultra／iPhone 17 Pro）。**表上沒有 Qwen3-4B。** Gemma 4 Apache 2.0；舊 Gemma 走 Gemma ToU。  
  來源：[LiteRT-LM Overview](https://ai.google.dev/edge/litert-lm/overview)，Last updated 2026-10-06。
- **Expo：** 官方沒有 LiteRT 一等模組。`expo-ai` 預覽**不含**可下載第三方後端。社群 expo-ai-kit 宣稱 SDK 54+ 可用 LiteRT-LM 下載模型（iOS 有記憶體門檻；Android 限 arm64，x86 模擬器會停用），**不是 Expo 官方**，A7 沒測，本輪不當第一。
- **對 nuni：** 以後若放棄 llama.rn、改原生 Kotlin／Swift，可當執行層備案。現在多一條原生棧，沒有 4B 官方表，不比 llama.rn 更近。

#### 11.2.5 MLC LLM

- **原生：** iOS Swift SDK、Android SDK 文件都在。Android 官方：模擬器不行，要實體 GPU；建置要 NDK、Rust、TVM、`mlc_llm package`。預建 APK 寫明以 Samsung S23（Snapdragon 8 Gen 2）為準；quick start 另提到 Redmi Note 12 Pro（Snapdragon 685）與 Pixel，**沒有給 4B 的官方 MB／RAM 表**。iOS 有 App Store 預建 MLC Chat，那是別人的 app，不是 nuni 可直接呼叫的 API。  
  來源：[Android SDK](https://llm.mlc.ai/docs/deploy/android.html)、[iOS Swift SDK](https://llm.mlc.ai/docs/deploy/ios.html)、[Quick Start](https://llm.mlc.ai/docs/get_started/quick_start.html)，查於 2026-10-19。
- **Expo：** 沒有一等模組。要把 TVM runtime 編進 CNG，建置鏈比 llama.rn 重一個數量級。
- **授權：** Apache-2.0（執行層）；權重另遵模型授權。
- **判斷考題：** 本輪沒在 MLC 執行檔上跑 A7。
- **對 nuni：** 不當第一步。

#### 11.2.6 手機瀏覽器 WebGPU（含 App 內 WebView）

- **瀏覽器可用性（一手）：**  
  - Chrome／Edge Android：**Chrome 121+**、**Android 12+**、**Qualcomm 或 ARM GPU**（web.dev 2025-11-25；gpuweb Implementation Status 另列 Imagination 自 Android 16／Chrome 139，Samsung Xclipse 仍 TBD）。  
  - Safari：**iOS 26／iPadOS 26 預設開啟**（gpuweb wiki；Transformers.js #1700，2026-06-08 合併，明確分 iOS <26 與 >=26）。  
  - Firefox Android：仍 flag，Mozilla 預期 2026 才做。  
  - Chrome 內建 Prompt API：**不含手機**（既有第 3.2 節）。
- **權重：** 若沿用 Web 那包 ONNX q4f16，約 **2.83 GB**，還要進瀏覽器 Cache。手機分頁記憶體通常比桌面緊。
- **Expo／WebView：** nuni 有 `react-native-webview`，**查不到** WKWebView／Android WebView 對 4B ONNX 的官方保證。Transformers.js v4 PR 仍把 **React Native support 列為未完成**。`react-native-webgpu`（Dawn）可在 RN 0.81+ 提供 `navigator.gpu`，但把 Transformers.js 接上去仍是社群 PoC，不是產品路徑。
- **判斷考題：** 沒有在 iOS Safari 或 Chrome Android 上跑 A7。
- **對 nuni：** 只適合作「學生用手機 Chrome／Safari 開 nuni.tw」的**遠端備案**，且必須偵測 `navigator.gpu`、同意下載、失敗回規則。不當原生 App 第一步——App 裡已有 llama.rn，不必再繞 WebView 塞 2.8 GB。

### 11.3 A7 四卡排序：能實測的就實測

沿用第 10.2 節 A7（台灣時間 2026-10-19 13:00）：點名進行中（`live`）、國文習作已過期（`overdue`）、普物小考 15:00（`quiz`）、資料結構習題三明天 09:00（`later`）。規則會排 `live, overdue, quiz, later`。及格線：點名第一，且 `quiz` 在 `overdue` 前面。

2026-10-19 本環境補跑：llama-cpp-python 0.3.36、CPU 4 threads、`n_gpu_layers=0`、temperature=0、ChatML、提示對齊 `packages/shared/src/todaySenseAgent.ts` 的 `buildOrderPrompt`。權重即先前 unsloth Q4_K_M。**這是 llama.rn 會載的同一類 GGUF，不是 iPhone Metal、不是 AICore、不是手機瀏覽器。**

| 模型 | 檔案 bytes | 載入 | 推論 | 行程峰值 RSS | 輸出 order | 判定 |
| ---- | ---------- | ---- | ---- | ------------ | ---------- | ---- |
| Qwen3-0.6B | 396,705,472 | 1.59 s | 1.01 s | 1103.2 MiB | `live, overdue, quiz, later` | **不及格**（跟規則一樣） |
| Qwen3-1.7B | 1,107,409,472 | 3.30 s | 2.21 s | 2480.5 MiB | `live, overdue, quiz, later` | **不及格**（跟規則一樣） |
| Qwen3-4B | 2,497,281,312 | 6.08 s | 4.34 s | 5243.7 MiB | `live, quiz, overdue, later` | **過**（點名第一、小考在過期前） |

4B 這次把明天作業放在過期作業後面（`… overdue, later`），與第 10 節當日第一次的 `live, quiz, later, overdue` 不完全相同；**關鍵判斷沒變**：小考仍在過期作業前面，這是規則做不到的。峰值 RSS 是同一行程先後載三顆的 `ru_maxrss`，4B 最後載，約 5.2 GiB 代表這顆在 Linux CPU 上的行程高峰，**不是**手機官方 RAM 表，也不是 Metal／NPU 數字。它只說明：4B Q4 的工作集明顯大於 2.5 GB 檔案本身，6 GB 檔中階機有 OOM 風險，必須真機測，失敗就退回規則版。

Apple Foundation Models、Gemini Nano、手機 Safari／Chrome **沒跑 A7**，上面三行不能套到它們頭上。

### 11.4 學生中階機跑不跑得動（不編 RAM 表）

Apple 規格頁不公布各 iPhone RAM，本文件不引用第三方拆機數字當定案。能寫的只有：

1. **系統內建：** 中階機大多根本進不了官方清單，不是「跑得慢」，是 **API 直接 `UNAVAILABLE`／`isAvailable == false`**。
2. **4B GGUF：** 檔案 2.50 GB，還要加上 KV cache 與 App 本身。Linux CPU 類比高峰約 5.2 GiB。iPhone 12 起的 Metal（llama.rn 0.4.8 寫 Apple7 GPU）較有機會用 GPU 卸載；**Android 在 0.4.8 是 CPU only**，同檔在中階 Android 會更慢、更吃記憶體。空間不足、載入丟例外、推論逾時 → 規則版。
3. **0.6B／1.7B：** 較可能塞進中階機，但 A7 不及格，接上去只是多一次下載、順序與現在相同，稱不上 agent。
4. **現有聊天 7B（約 4.7 GB）：** 不當今天殼排序。沒考 A7，體積比 4B 更大。

沒有「中階機保證能跑 4B」這句話。產品句只能是：同意後試試；不行就跟現在一樣。

### 11.5 Expo 現況（對應本倉 Expo ~54）

| 能力 | 本倉現況 | 官方一等？ |
| ---- | -------- | ---------- |
| llama.cpp GGUF | 已有 `llama.rn@0.4.8`，開發版可用 | 社群模組，MIT；Expo 文件不當它是 SDK 一部分 |
| Apple Foundation Models | 未接 | `expo-ai` 為 **next SDK alpha**，SDK 54 目錄沒有 |
| Gemini Nano Prompt API | 未接 | 同上；且要 minSdk 26 |
| LiteRT-LM | 未接 | 無官方 Expo 模組 |
| MLC | 未接 | 無 |
| 手機 WebGPU 在 RN | 未接 | Transformers.js 官方尚未支援 RN |

結論：要在**不升級 Expo SDK、不重寫原生執行層**的前提下做手機第一步，只剩把今天殼排序接到已經存在的 `llama.rn`。若將來要系統內建免下載，再單開一輪升 SDK／寫 Swift／Kotlin，並先在真機跑 A7。

### 11.6 定案

**第一步做哪條：** 開發版／正式包的 `llama.rn` + Qwen3-4B Q4_K_M，只輸出已存在卡片 id 的排列。同意畫面沿用 Web 已鎖的事實句（體積改寫 **約 2.5 GB**、占這台裝置空間、建議 Wi-Fi、只排先後不改課名與時間）。下載可取消、設定可刪、沒同意就用規則版。輸出走既有 `todaySenseAgent.ts` 驗證。

**哪些手機先支援（接通以後，不是現在）：**

1. nuni **開發版或商店包**（不是 Expo Go），64-bit，使用者同意下載約 2.5 GB，載入成功，且至少兩張規則卡。
2. iOS：實體機、llama.rn Metal 可用時優先（README：Apple7 GPU；模擬器不行）。
3. Android：arm64；在升級 llama.rn 之前預期走 CPU，只對「載得動且等得完」的機顯示建議順序。

**跑不動怎麼退回規則版（必須偵測，不要先畫下載鈕再失敗）：**

- 不是開發版／模組 `require` 失敗。
- 剩餘空間明顯小於約 2.5 GB，或使用者拒絕。
- 下載取消、校驗失敗。
- `initLlama` 丟例外、OOM、背景被殺、逾時。
- `order` 不是完整排列、點名不是第一、或程式驗證失敗。

以上畫面與現在完全相同，不顯示「AI 失敗」。

**大概要多少開發量（不估日曆）：** 比 Web 那輪小、比從零接 Apple／Nano 大。執行層與下載／刪除 UI 已在聊天模型管理裡，今天殼只要：獨立同意鍵與快取（不要跟 7B 聊天模型共用檔）、`buildOrderPrompt` + GBNF／JSON 驗證、OOM／前景處理、iOS Metal 與一台中階 Android 的真機 A7。風險在 **Android 0.4.8 無 GPU**——若真機慢到不能用，下一步才是升 llama.rn（新版要求 New Architecture，本倉已開）或放棄該機。不包含：改規則引擎、改寫回、接聊天窗、把 4B 打進 ipa／apk、開系統內建、部署。

**明確不當第一步：** 只押 Apple Intelligence；只押 Gemini Nano；手機 Chrome Prompt API；MediaPipe LLM Inference；MLC 從零接入；App 內 WebView 跑 2.8 GB ONNX；把現有 Qwen2.5-7B 聊天權重拿來排序；雲端／Private Cloud Compute／Firebase Hybrid。

### 11.7 接通時仍不准做的事（與 Web 相同）

模型不得改課名、時間、`kind`，不得自己寫回 handled／snooze，不得從公告發明新卡。未登入／讀取中／失敗三態不准用模型填空。`SENSE_SECTION_NOTE` 在拒絕或不支援時維持現況。
