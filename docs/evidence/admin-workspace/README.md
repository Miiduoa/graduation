# 平台管理工作台驗收

這輪將學校接入、學校管理、人員授權、店家審核、課班掛靠、社群檢舉與操作紀錄收進 `/admin` 的同一個工作台。`/admin/ops` 與 `/admin/school-review` 的舊網址保留目的工作與學校選取，進入後更新為工作台網址。

## 瀏覽器驗證範圍

`scripts/admin-workspace-browser` 直接打包應用程式的 `AdminWorkspace`、實際子元件、共用按鈕／欄位及 CSS。登入狀態、API 回應與周邊網站外框使用測試替身；外框沿用正式頁面的版面樣式。畫面內的學校、店家、帳號與申請內容全是合成資料。

檢查會攔截並在本機回應所有瀏覽器要求。未列入的 API、錯誤的工作階段標頭、非預期欄位與任何外部請求都會使檢查失敗。這些檢查驗證前端流程與請求契約，不代表已通過正式登入或後端權限驗收。

| 流程 | 檢查內容 |
| --- | --- |
| 工作總覽 | 學校、店家、掛靠與檢舉待辦；讀取失敗顯示未知件數並可獨立重試 |
| 學校接入 | 填寫理由並確認核准 → 從回執指定該校管理員 → 重新查核授權後確認開通 |
| 人員授權 | 保留選定學校；首次授權為學校管理員；實際送出一次授權請求 |
| 店家管理 | 意向與進駐案件分流；理由欄位取得焦點；確認後帶入當前版本 |
| 案件導覽 | 從待辦直接開啟指定案件；瀏覽器返回可回到原工作總覽 |
| 舊網址 | 保留 `tab`、`school`、`tenantId` 與原有 fragment 的目的頁面 |
| 草稿與鍵盤 | 離開未儲存學校資料時確認；取消保留內容；鍵盤選單與略過導覽正常移動焦點 |
| 身分更新 | 重驗／登出時收起審核表單；訪客與非管理員不請求管理資料 |
| 版面 | 1440、390、320px 各跑淺色與深色；無水平溢出、單一主標題、導覽點按範圍至少 44px |

## 執行

使用專案的 Node 22 與已安裝的 workspace dependencies。瀏覽器執行環境需有 Python Playwright、Chromium 與中文字型。

```sh
python -m pip install playwright==1.57.0
python scripts/admin-workspace-browser/run.py
```

需要指定執行檔時可使用 `ADMIN_BROWSER_NODE`、`ADMIN_BROWSER_CHROMIUM`。`ADMIN_BROWSER_OUTPUT` 可指定產出目錄；預設為不提交的 `tmp/admin-workspace-browser`。腳本可以從其他工作目錄執行。

只打包元件而不啟動瀏覽器：

```sh
node scripts/admin-workspace-browser/build.mjs
```

產出包含：

- `build.json`：Git HEAD、每個實際打包輸入的 SHA-256 與彙總雜湊。工作目錄有未提交修改時，也能辨識真正驗證的原始碼。
- `report.json`：執行狀態、瀏覽器版本、成功斷言、錯誤與截圖清單。
- `screenshots/`：只有瀏覽器實際完成操作後才會產生的畫面。

## 本機執行限制

2026-11-06 的工作環境可完成元件打包與 Python 語法檢查；環境恢復後的打包使用 Node 24.22.1，GitHub workflow 使用專案指定的 Node 22.23.4。Chromium 啟動被主機拒絕建立 socket（`process_singleton_posix.cc:297`, `Operation not permitted`），因此本機沒有取得版面截圖，也沒有將瀏覽器斷言標記為通過。

正式驗收應以目前提交重新執行腳本，保存 `report.json` 與對應畫面。完成真實校方／店家帳號、正式後端、原生裝置與輔助科技驗收前，不應將這份合成資料檢查當作正式服務驗收。
