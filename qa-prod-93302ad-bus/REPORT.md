# 正式站複驗 `93302ad` 公車紅燈修正（PR #131）

未登入。只 GET／瀏覽。版號只打 `https://nuni.tw/health/ready`。**沒有打 `api.nuni.tw`。** 沒有寫資料、部署。

畫面：Playwright **390×844** 與 **350×844** 開 `https://nuni.tw/bus?campus=pu`。  
官方：`citybus.taichung.gov.tw/ebus` GraphQL 同一分鐘；友善網 `citybus-free.taichung.gov.tw/driving-map` 截圖。TDX 訪客 GET 僅旁證。

兩輪間隔約 10 分。台灣時間 2026-10-22 **15:49** 與 **16:01**。

原始：`round1/round.json`、`round2/round.json`、`summary.json`、`followup/followup.json`、`regression/regression.json`、`git-ci.json`。

---

## 結論表

| 項目 | 判定 |
| --- | --- |
| **1. 版號／`ec9a4904..93302ad`／CI 真跑／發布** | **PASS** |
| **2. 兩輪對照：300 方向、162 往校內、307副單行省略＋面板／aria** | **PASS** |
| **3. 抽查 306、302、310區2 即時仍在且對得上（非一律退表定）** | **PASS** |
| **4. 350px 版面＋390×844 對照** | **PASS** |
| **5. 回歸：公告三態、點餐關閉、今天未登入句** | **PASS** |

---

## 1. 版號／提交／CI／發布 — PASS

`GET https://nuni.tw/health/ready` 探針開頭、兩輪、結束皆逐字：

```json
{"service":"campus-one-web","status":"ready","revision":"93302ad606d10b8d4097620dc2012e2824d8b3c5","legacy":"ready"}
```

證據：`health.body`；round1／round2 `health`；`summary.json` `health0`／`healthEnd`（`07:49:29Z`–`08:04:35Z`）。頁面 POST `https://nuni.tw/api/transit`（非 `api.nuni.tw`）。`hitApiNuni=false`。

`ec9a490437c1d14fe43b0220911a7b3604432349..93302ad606d10b8d4097620dc2012e2824d8b3c5` **正好 1 筆**。

| | |
| --- | --- |
| 完整 SHA | `93302ad606d10b8d4097620dc2012e2824d8b3c5` |
| 短 | `93302ad` |
| 訊息 | 公車頁：專用道方向對齊 TDX 去返程，162 往校內改英才路，長終點改單行省略 (#131) |
| 正文 | 即時資料方向對不上官方去返程時退回表定；162 往校內改採英才路返程；長終點單行加省略，完整終點移到班次面板與 VoiceOver。 |
| 作者 | Miiduoa `<107848266+Miiduoa@users.noreply.github.com>` |
| 提交者 | GitHub `<noreply@github.com>` |
| 時間 | `2026-10-22T15:22:36+08:00` |
| 共同作者 | 無（merge 與功能提交 `2c6e1a80` 皆無 `Co-authored-by`） |
| AI 痕跡 | **有，在 PR 而非 commit trailer**：分支 `cursor/fix-bus-direction-eta-ba00`；PR 正文包 `<!-- CURSOR_AGENT_PR_BODY_BEGIN -->`…`END`；頁尾 Cursor agent 圖 `bc-521bd54a-3a06-5e6e-8e31-63eca356ba00` |
| 父 | `ec9a490437c1d14fe43b0220911a7b3604432349` |
| 改檔 | **11 files，+474/−41**：`CampusArrivalRow.tsx`、`TransitExplorer.test.tsx`、`transit.module.css`、`tdx-providence-student-report.json`、`transit-catalog.ts`、`transit-server.ts`、`transit.heading.test.ts`、`transit.student-report.test.ts`、`transit.ts`、`scripts/test-transit.cjs`、`.github/workflows/transit.yml` |
| PR | [#131](https://github.com/Miiduoa/graduation/pull/131) 合併 `2026-10-22T07:22:37Z` |

CI [39740063232](https://github.com/Miiduoa/graduation/actions/runs/39740063232) `push` `headSha=93302ad` `conclusion=success` `07:22:39Z`–`07:27:32Z`：

| Job | conclusion | 計入全綠？ |
| --- | --- | --- |
| Web Tests | success | 是 |
| Mobile Tests | success | 是 |
| Security Gates | success | 是 |
| Firestore Rules Tests | success | 是 |
| Functions Tests | success | 是 |
| Lint & Type Check | success | 是 |
| Build Web | success | 是 |
| Build Mobile | success | 是 |
| CI Summary | success | 是 |
| Deploy Firebase backend | **skipped** | **不算** |

已跑項無 failure。Transit contract [39740062949](https://github.com/Miiduoa/graduation/actions/runs/39740062949) success（不計入上表）。

發布：

| Run | 結果 |
| --- | --- |
| [39740083245](https://github.com/Miiduoa/graduation/actions/runs/39740083245) `07:22:50Z`–`07:23:13Z` | **failure**（`release`：CI 尚未過；`guards` success；`reject-non-main` skipped） |
| [39740660449](https://github.com/Miiduoa/graduation/actions/runs/39740660449) `07:27:53Z`–`07:32:32Z` | **success**（`guards`／`release` 皆 success；此 run 上線。health 對得上） |

---

## 2. 兩輪對照 — PASS

官方網開得了（ebus GraphQL 200、友善網 200）。ebus xno 含 302／306／411（310區2）／907（307副）。

### 第一輪 15:49 — 300／162／307副

| 重點 | nuni | 官方（同站同向） | 差 | 判定 |
| --- | --- | --- | --- | --- |
| 專用道 **300 往 台中車站** | **表定 15:50** | 去程 靜宜→臺中車站 **表定 15:50** | 0 | PASS（未把返程即時掛去程） |
| 專用道 300 往 靜宜 | 表定 16:46 | 同向表定 | — | PASS |
| 往校內 **162** | **11 分**；等車句「校門口站牌・**英才路側**」 | 英才路返程 **10 分** | **1** | PASS（≤2） |
| 307副長終點 | 往 八德東大勇路口；`nowrap`＋ellipsis；`truncated`；未折行 | — | — | 見下 |

截圖：`round1/nuni-專用道-390x844.png`、`nuni-往校內-390x844.png`、`official-300-goback1.png`、`official-162-goback2.png`。

### 第二輪 16:01 — 300／162／307副

| 重點 | nuni | 官方 | 差 | 判定 |
| --- | --- | --- | --- | --- |
| 專用道 **300 往 靜宜** | **3 分** | 返程朝靜宜 **2 分** | **1** | PASS（方向對上返程，不是往車站） |
| 專用道 300 往 台中車站 | **表定 16:02** | 去程表定（友善網靜宜專用道 16:02） | — | PASS |
| 往校內 **162** | **3 分**；站名 **靜宜大學(英才路)**；等車「英才路側」 | 英才路返程 **2 分** | **1** | PASS |
| 307副長終點 | 往 八德東大勇路口；單行省略（390 寬 `scrollWidth 141 > clientWidth 118`） | ebus 907 返程約 111 分 | — | 見下 |

截圖：`round2/nuni-專用道-390x844.png`、`nuni-往校內-390x844.png`、`official-300-goback2.png`。

上一版紅燈（`ec9a490`）：300 把返程 8 分寫成「往 台中車站」；162 往校內 17 分對英才路 11 分。本版 300 即時掛「往 靜宜」，去程只留表定；162 分鐘差 1。

### 307副「往 ○○」單行／面板／aria — PASS

畫面長終點列（不是「往 台中車站」那列）：

- 列文：`往 八德東大勇路口`；`white-space:nowrap`、`text-overflow:ellipsis`、`rectCount=1`、`wrapped=false`、視覺「往 八德東大勇…」
- `aria-label` 逐字含完整站名：`307副 往 八德東大勇路口 111 分`（第二輪；第一輪表定時為 `… 表定 17:58`）
- 點開面板：`終點 八德東大勇路口`＋`專用道站牌`

證據：`followup/followup.json` `panel`；截圖 `followup/307副-八德-panel-350.png`（面板逐字「終點 八德東大勇路口」）、`followup/307副-八德-panel-390.png`。`round1`／`round2` 該列表 `wrap.wrapped=false`。

---

## 3. 抽查 306／302／310區2 — PASS

即時分鐘**沒有**被一律改表定。306、302 兩輪皆有即時且對上官方同向。

| 輪 | 路線 | nuni | 官方 ebus 同站同向 | 判定 |
| --- | --- | --- | --- | --- |
| 1 15:49 | **306** 往 台中車站 | **進站中** | 去程即將進站／0–1 分 | PASS |
| 1 | **302** 往 新光里 | **進站中** | 去程即將進站／1 分 | PASS |
| 1 | **310區2** 往 台中車站／往 靜宜 | 表定 **21:59**／**23:18** | ebus **411** 同站同向即 **表定 21:59／23:18**（無即時） | PASS |
| 2 16:01 | **306** 往 清水 | **8 分** | 返程朝清水 **8 分** | PASS |
| 2 | **302** 往 機場 | **6 分** | 返程朝機場 **6 分** | PASS |
| 2 | **310區2** | 表定 21:59／23:18 | 仍無即時；與 411 表定相同 | PASS |

310 本線（xno 310）當下有即時（例如 follow-up 去程 8 分／返程 1 分），與 **310區2** 不是同一條。nuni 310區2 對的是 411 的表定，沒有拿 310 的分鐘來充。截圖 `round1/official-310區2-goback1.png`、`followup/followup.json` `ebus411`。

---

## 4. 350px 與 390×844 — PASS

350×844（`round1/layout350`、`followup/layout350`）：

- `scrollWidth=350`，**無橫向捲動**
- `rowOverlaps=[]`、`overflowing=[]`，列內路線／終點／分鐘**無重疊**
- 路線標籤 `white-space:nowrap`、`badgeWraps=[]`（含 307副、310區2）
- 終點長文走省略，不折行（350 寬「往 八德…」「往 主顧…」「往 沙鹿…」）
- 觸控：看板「重新整理」**44×44**；350 寬可見 button 無小於 44（`undersize=[]`）

截圖：`round1/nuni-專用道-350.png`、`nuni-往沙鹿-350.png`、`nuni-往校內-350.png`、`followup/307副-八德-panel-350.png`、`followup/explorer-350.png`。

390×844 對照：`round1`／`round2` 的 `nuni-*-390x844.png`。

---

## 5. 回歸 — PASS

舊上架句、舊長句 14 間皆無。

| 代碼 | 學生畫面 |
| --- | --- |
| pu | 列表 36 |
| ncku | 列表 29 |
| ntpu | 列表 20 |
| feu／mmc／nchu／tku | 逐字「**本站還沒接上這間學校的公告。**」 |
| ntust | 列表 27 |
| nccu | 列表 9 |
| **cycu** | 「**暫時讀不到資料，請稍後再試**」＋「**再試一次**」；再試後同句 |
| ntu | 列表 5 |
| nthu | 學生「**目前沒有學生日常公告。**」 |
| fju | 列表 10 |
| **tmu** | 同中原鎖定失敗句＋再試一次 |

點餐：列表「**目前還不能線上點餐**」；店名「未核對」；無「供應中」。全家逐字：

> 這間店的菜單和價格還沒跟店家核對過，可能跟現場不一樣，目前不能點餐。

今天頁「現在可處理」未登入句逐字：

> 登入後，這裡會列出近期要處理的課程待辦。

截圖：`regression/home.png`、`cafeteria-pu.png`、`cafeteria-shop-1.png`、`announcements-cycu.png`。`foodOrImportWrites=[]`。

---

## 方法備註

- 官方主來源：`POST https://citybus.taichung.gov.tw/ebus/graphql`。310區2＝xno 411；307副＝xno 907。
- 友善網截圖佐證 300 去／返、162 返程。
- 未登入、未寫入、未打 `api.nuni.tw`。
