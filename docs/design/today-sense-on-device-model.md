# 今天殼裝置端模型定案

一句話：**不接裝置端模型，維持規則版「現在可處理」。** 免費與裝置端仍是硬條件，但用產品真實卡片考過之後，Qwen3-0.6B 會漏課程名，同系列較大的 1.7B 會把截止時間講成觸發時間；兩邊都不達「不能改錯事實」的及格線，接上去會把卡片改壞。

本文件含規格比較與 2026-10-19 本機實測。**沒有接模型、沒有改產品行為、沒有部署、沒有付費。** 架構仍遵守 [ADR 0003](../adr/0003-ai-as-advisory-layer.md) 與 [today-sense-agent.md](./today-sense-agent.md)。

查閱日期：2026-10-19。下列只寫有網址與日期的來源；查不到的會標明。

對照已上 main 的規則版：

| 提交       | 做了什麼                                       |
| ---------- | ---------------------------------------------- |
| `95091124` | 定案今天殼感知與處理 agent                     |
| `a90a8452` | 今天殼加入可寫回的感知處理切片                 |
| `1b3ec1f3` | 修正網站重新整理後讀不回處理清單狀態           |
| `4034ff65` | 定案今天殼裝置端免費模型接線（規格層）         |
| `62a51ce4` | 修正處理清單寫入失敗假裝成功與手機建議卡順序   |

晉瑋補的硬條件：要能在**用戶端裝置**上跑、**免費**、且**夠強**；後又交代不要為了免費接會寫怪句、誤解繁中、或把卡片改壞的模型。Granola 此環境帳號未授權，**查不到會議原文**，以任務文字為準。

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

「夠強」在這條產品裡的定義見第 9 節及格線：**改寫不得改錯課程名、時間與截止判斷，不得自加建議或假訊息。** 規格表上的 0.6B「理論上夠用」已被實測推翻；在有模型通過這條線之前，規則文案就是產品文案。

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

規格層曾打算「一條跨端權重 + 兩條系統內建備案 + 其餘誠實降級」，而不是押單一 OS。第 9 節用真實卡片考過之後，開源小模型過不了事實及格線，**改為全部不接**，畫面維持規則版。

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

**對 nuni：** 若未來有模型通過第 9 節及格線，Web 才走這條（不必原生模組）。下載約 570 MB 必須 opt-in，失敗回規則文案。本輪考題不及格，不接。

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

**對 nuni：** 官方繁中聲明仍是開源小模型裡寫得最清楚的。LiteRT 表無 1.7B；Web ONNX q4f16 約 1.43 GB。第 9 節實測 0.6B 與 1.7B 都過不了「不能改錯事實」，所以兩顆都不當第一選擇。

---

## 4. 定案

規格層一度把 Qwen3-0.6B 當跨端第一選擇（免費、Apache-2.0、官方含繁中、Web 可跑、下載小於 1 GB）。**2026-10-19 用規則版真實卡片考過後，這個選擇不成立。** 見第 9 節。

### 4.1 第一選擇

**不接模型。畫面維持規則版 title／why。**

理由：免費與裝置端做得到，但考題上 0.6B 與 1.7B 都會改壞事實。規則句雖然長，至少課程名與時間不會被模型講反。

### 4.2 備案（現在都不接，只記若以後重考）

1. **同系列較大：Qwen3-1.7B。** 改寫四題字面勾選曾全過，但 E1 把截止時間講成觸發時間，實質不及格。Web ONNX q4f16 約 1.43 GB。
2. **iOS Foundation Models／Android Nano：** 本輪沒有這兩顆權重可在此環境實測；在開源小模型都還會改錯時間之前，不拿系統模型當「一定比較強」的藉口去接。
3. **Gemma 4 E2B：** 2.58 GB，本輪未跑。下載已不合理當第一包；沒考過就不能接。

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

1. **Web，桌面 Chrome／Edge 且 `navigator.gpu` 可用、使用者同意下載。** 這是唯一不必等 Expo 原生模組的路徑。體積以當時通過第 9 節的那顆為準（0.6B ONNX q4f16 570 MB；1.7B 1.43 GB），本輪兩顆都沒過。
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

## 6. 第一步最小可行接法（及格才做；本輪不及格所以沒做）

若未來有模型通過第 9 節及格線，第一步仍只准：

1. 只動 **Web** `TodaySensePanel` 的展示文案，不改 `todaySense.ts` 判定，不改 localStorage 寫入。
2. 使用者同意才下載；只改寫規則已算出的卡；判斷與寫回仍由規則把關。
3. 不支援／拒絕下載／模型出錯時畫面與現在完全相同。
4. 不開聊天窗、不部署、不寫正式資料庫、不碰點餐與公告三態。

本輪兩顆候選都不及格，因此**沒有接線、沒有下載 UI、沒有改寫路徑。**

---

## 7. 查不到、因此不承諾

- Granola 會議裡晉瑋的完整原話（帳號未授權）。
- Gemini Nano 權重 MB、繁體中文品質。
- ML Kit GenAI Additional ToS 全文（本環境未抓到獨立條款頁）。
- Apple Foundation Models 開發者文件 HTML 正文（本環境近乎空白；改以 WWDC25 影片稿與支援頁 121115）。
- Qwen3-0.6B／1.7B 在 Chrome／iPhone Safari 的實測 tk/s 與 RAM（本輪用 GGUF Q4_K_M、CPU 4 threads 當 4-bit 類比，沒在瀏覽器跑 ONNX）。
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
| https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX | 查於 2026-10-19（`onnx/model_q4f16.onnx` 569,789,750 bytes ≈ 570 MB） |
| https://huggingface.co/onnx-community/Qwen3-1.7B-ONNX | 查於 2026-10-19（`onnx/model_q4f16.onnx` 1,426,069,098 bytes ≈ 1.43 GB） |
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

原因不是「免費模型規格不夠好看」，是考題上會改錯課名或時間。規則句比較長，但課程名與截止不會被模型講反。以後若再考，必須看時間角色與課名，不能只掃字串；沒通過第 9.1 節就仍不接。
