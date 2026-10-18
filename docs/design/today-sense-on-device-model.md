# 今天殼裝置端模型定案

一句話：**下一輪若接模型，第一選擇是使用者同意後才下載的 Apache-2.0 Qwen3-0.6B，在瀏覽器以 Transformers.js／WebGPU 跑；符合條件的 iPhone 用系統內建 Apple Foundation Models、列出的 Android 用 Gemini Nano 當免下載備案。模型只改寫規則已經算出的卡片，截止判斷、寫回與權限仍由現有規則與預覽把關。裝置不夠、下載失敗、逾時或 OOM，畫面維持現在的「現在可處理」，不假裝有模型。**

本文件只做研究定案。**沒有接模型、沒有改產品行為、沒有部署、沒有付費。** 架構仍遵守 [ADR 0003](../adr/0003-ai-as-advisory-layer.md) 與 [today-sense-agent.md](./today-sense-agent.md)。

查閱日期：2026-10-19。下列只寫有網址與日期的來源；查不到的會標明。

對照已上 main 的規則版：

| 提交       | 做了什麼                                       |
| ---------- | ---------------------------------------------- |
| `95091124` | 定案今天殼感知與處理 agent                     |
| `a90a8452` | 今天殼加入可寫回的感知處理切片                 |
| `1b3ec1f3` | 修正網站重新整理後讀不回處理清單狀態           |

晉瑋補的硬條件：要能在**用戶端裝置**上跑、**免費**、且**夠強**。Granola 此環境帳號未授權，**查不到會議原文**，硬條件以本任務文字為準。

---

## 1. 對照現行規則版：模型只能補什麼

現在「現在可處理」已經能做、且**沒有模型也必須繼續做**：

- 用現在時間套 `live_now`／`overdue`／`due_soon`（24 小時）。
- 卡文案來自規則常數，不是生成。
- 「從清單移出／稍後一小時」先預覽再寫本機；撤銷可還原。
- 不繳交、不點名、不改成績。未登入／讀取中／失敗走今天殼三態。

**模型若接通，只允許：**

| 模型可做                                         | 仍由規則與確認把關                         |
| ------------------------------------------------ | ------------------------------------------ |
| 把**已經算出**的卡改寫成較短的人話標題／一句說明 | 哪幾張卡存在、`kind`、截止是否成立         |
| 把多張規則卡收成一段摘要（仍列出原卡）           | 寫回 handled／snooze；預覽文案與可撤銷     |
| 在裝置端產出結構化欄位草稿（標題、一句 why）     | 權限分級；不可代做的動作不出現             |
| 無模型、失敗、拒絕下載時維持現有文案             | 未登入／讀取失敗不准用模型填空或樣本卡     |

不准：模型自己決定「過期了」、自己寫回、自己開 LMS、自己點名、在規則 0 張時編出待辦、另開聊天窗。

「夠強」在這條產品裡的定義：**繁體中文讀得懂課程／作業標題，能把規則卡收成一句話，並在支援的裝置上幾秒內吐完短輸出。** 不要求世界知識、長推理或自由代辦。0.6B 級開源權重對這件事夠用；更強的系統內建 3B（Apple）或 Nano 只在裝置符合時當備案，不當唯一路徑。

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

因此定案採**一條跨端權重 + 兩條系統內建備案 + 其餘誠實降級**，而不是押單一 OS。

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

**對 nuni：** Web 第一條接線。下載約 570 MB 必須 opt-in，失敗回規則文案。

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

**對 nuni：** 跨 Web／未來原生的共同權重。0.6B 對「改寫已算出的卡」夠用；要明顯更強再評估 1.7B（LiteRT 表無 1.7B；WebLLM 有 Qwen3-1.7B，體積會明顯大於 0.6B）。

---

## 4. 定案

### 4.1 第一選擇

**權重：Qwen3-0.6B（Apache 2.0）。**  
**Web 執行：Transformers.js + `onnx-community/Qwen3-0.6B-ONNX`（q4f16，約 570 MB），有 WebGPU 用 GPU，沒有就不要硬跑 WASM 當產品路徑——直接降級規則文案。**  
**Web 備援執行：WebLLM 預建 Qwen3-0.6B（Apache-2.0 引擎、JSON-mode 現成）。**  
**未來原生：LiteRT-LM 的 Qwen3-0.6B（官方 586 MB）或 llama.cpp GGUF；iOS 亦可用系統 Foundation Models 當免下載替代。**

理由：唯一能同時照顧 **Web**、**繁體中文有官方聲明**、**免費、無雲端 token 費**、**下載小於 1 GB** 的組合。Gemma 4 更強但 E2B 就要 2.58 GB；Nano／Apple 更強但覆蓋不到 Web 與大量學生機。

### 4.2 備案（裝置符合才開，不當唯一路徑）

1. **iOS（Apple Intelligence 合格機）：** Foundation Models。免下載、約 3B、官方繁中、Guided Generation。要原生模組。
2. **Android（ML Kit Prompt 清單內）：** Gemini Nano Prompt API。免進包體、前景、beta。中文不保證。結構化輸出仍 alpha。
3. **較強但更大的開源包：** Gemma 4 E2B（Apache 2.0，2.58 GB）只在使用者明確同意大下載、且裝置 RAM／GPU 夠時考慮；不當預設。

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

1. **Web，桌面 Chrome／Edge 且 `navigator.gpu` 可用、使用者同意下載約 570 MB。** 這是唯一不必等 Expo 原生模組的路徑。
2. **iPhone：** Apple Intelligence 合格且語言含繁中／簡中，並已接原生模組之後。
3. **Android：** 在 ML Kit Prompt 清單內、AICore 可用、前景，並已接原生模組之後。
4. **其餘（含無 WebGPU 的瀏覽器、舊 Android、未開 Apple Intelligence、iOS WebView）：** 維持 `95091124`／`a90a8452`／`1b3ec1f3` 規則版，畫面不提模型。

### 4.5 模型只負責什麼；規則仍把關什麼

沿用 `packages/shared/src/todaySense.ts`：

- **規則繼續單獨決定：** 清單有沒有卡、`live_now`／`overdue`／`due_soon`、`dueAt` 比較、handled／snooze、三態、預覽文案。
- **模型最多輸出：** 已存在卡片的短標題、一句說明、多卡摘要。輸出須能對回既有 `card.id`；對不上就丟棄，顯示規則原文。
- **模型輸出不得觸發：** `handle`／`snooze`／開繳交／點名。若未來做「建議下一動」，也只是文案，按鈕仍走現有 permission。

`SENSE_SECTION_NOTE` 在接通前仍是「沒有接模型」。接通後改成「裝置端改寫；沒有模型或裝置不支援時與現在相同」——**那是下一輪文案，本輪不改程式。**

---

## 5. 誠實降級（接通時必須實作，本輪只鎖定）

1. **能力偵測先於 UI：** Web 查 WebGPU；Android `checkStatus()`；iOS 查 Foundation Models availability 與語言。失敗則連「下載模型」都不出現。
2. **Opt-in 下載：** 寫明大約體積（Web q4f16 **570 MB**；LiteRT Qwen3-0.6B **586 MB**；Gemma 4 E2B **2.58 GB**）。預設不抓。取消／失敗 → 規則版。
3. **逾時／OOM／背景：** Android 前景限制直接當不支援。Web 推論設短逾時（產品尚未定數字；**查不到**官方建議秒數就不寫死）。失敗用規則 `title`／`why`。
4. **不准用模型遮三態：** 未登入、讀取中、讀取失敗行為與現在相同。規則 0 張時不准生成待辦。
5. **權限：** 模型沒有寫入 API。預覽－確認－撤銷程式路徑不變。

---

## 6. 第一步最小可行接法（下一輪才做）

本輪**不實作**。鎖定範圍以免下一輪做大：

1. 只動 **Web** `TodaySensePanel` 的**展示文案**，不改 `todaySense.ts` 判定，不改 localStorage 寫入（`1b3ec1f3` 的掛載重讀要保持）。
2. 獨立模組：偵測 WebGPU → 詢問是否下載 Qwen3-0.6B ONNX（約 570 MB）→ worker 推論 → 只改寫已有卡的 title／why。
3. 門檻：**有 WebGPU、使用者同意下載、短輸出在數秒內回來**；否則零行為變化。
4. 不接 Expo 原生、不接 Nano、不接 Apple、不部署、不付費、不開聊天窗。
5. 測試：無權重時與現在畫面一致；改寫後預覽／撤銷／重新整理仍走本機狀態。

「數秒」沒有官方 SLA；LiteRT 表上 Qwen3-0.6B 在 Vivo X300 Pro GPU decode 21 tk/s，短句通常可在裝置端完成，但瀏覽器數字**查不到**，所以產品門檻用「逾時則規則文案」，不用公開 tk/s 承諾。

---

## 7. 查不到、因此不承諾

- Granola 會議裡晉瑋的完整原話（帳號未授權）。
- Gemini Nano 權重 MB、繁體中文品質。
- ML Kit GenAI Additional ToS 全文（本環境未抓到獨立條款頁）。
- Apple Foundation Models 開發者文件 HTML 正文（本環境近乎空白；改以 WWDC25 影片稿與支援頁 121115）。
- Qwen3-0.6B 在 Chrome／iPhone Safari 的實測 tk/s 與 RAM。
- WebLLM 預建 Qwen3-0.6B q4f16_1 的官方 MB。
- Expo 54 對 Foundation Models／ML Kit／llama.cpp 的官方一等支援。
- 「2025–2026 端側模型市場佔有」類數字。

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
| https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX | 查於 2026-10-19（q4f16 570 MB） |
| https://huggingface.co/blog/transformersjs-v4 | 2026-02-09 |
| https://www.npmjs.com/package/@mlc-ai/web-llm | 0.2.86，Updated 2026-10-11 |
| https://webllm.mlc.ai/ | 查於 2026-10-19 |
| https://github.com/mlc-ai/web-llm/commit/089bbd0ce77ba5395a68409ef3ca9916f36e1974 | 2025-05-05 |
| https://llm.mlc.ai/ | 查於 2026-10-19 |
| https://llm.mlc.ai/docs/deploy/android.html | 查於 2026-10-19 |
| https://github.com/ggml-org/llama.cpp/blob/HEAD/LICENSE | 查於 2026-10-19 |
| https://github.com/ggml-org/llama.cpp/blob/master/docs/android.md | 查於 2026-10-19 |
| https://github.com/ggml-org/llama.cpp/blob/master/docs/xcframework.md | 查於 2026-10-19 |
