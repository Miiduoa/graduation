# 指定訂單取餐行程驗收

```sh
node scripts/build-functions-shared.cjs
node scripts/qa/selected-pickup/build.mjs
python -m pip install playwright==1.57.0
python -m playwright install --with-deps chromium
python scripts/qa/selected-pickup/check.py
```

`check.py` 啟動僅綁定 `127.0.0.1` 的暫時 HTTP 服務，再以 Chromium 操作實際 `FoodWorkspace`、`FoodOrders` 與 `FoodPickupAgent`。服務執行實際 `handleV2`、來源資格檢查、簽章確認、個人行程交易與回執；替換的邊界只有合成身分、訂單、資料庫與模型。所有模型呼叫都會記錄並拒絕，外部網路請求也會拒絕。

三個情境涵蓋 1440px、390px，以及儲存完成後故意不送回確認回應，再重新載入頁面。重新載入必須以原 token 查核，不能再次呼叫規劃或確認。每個情境都檢查預覽前後零寫入、確認後恰好一筆寫入、讀回回執、裝置行程同步及原訂單來源；多個工作區同時存在，不能將選定訂單替換為最新訂單。

服務與瀏覽器固定使用 `Asia/Taipei`，瀏覽器語系為 `zh-TW`。合成訂單的取餐時間固定在 2099 年，避免依執行當日變成過期訂單；確認卡仍以真實簽發時間驗證有效期限。每案使用新瀏覽器 context 與合成帳號，重載案則保留同一分頁的 journal 與裝置儲存，核對原交易只產生一筆行程。

輸出位於 `artifacts/selected-pickup/`，包含瀏覽器截圖、請求與交易證據、兩個 bundle 的 metadata 及來源 SHA256。來源在 bundle 產生後變更會使驗收停止，需重新執行 build。這些證據不代表正式帳號或原生手機驗收。

可用 `SELECTED_PICKUP_QA_NODE` 指定 Node 執行檔，`ASSISTANT_QA_CHROMIUM_EXECUTABLE` 指定已安裝的 Chromium。環境禁止 Chromium 系統呼叫時應在既有 GitHub Actions 工作流程執行；不得將未啟動的瀏覽器列為通過。
