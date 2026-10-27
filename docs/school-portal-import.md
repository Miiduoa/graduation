# App 校務網站本人匯入

## 完整前景流程

登入入口 → 選取課表或成績 → 明確同意開啟校方網站 → 使用者自行登入及通過驗證 → 按「讀取目前課表／成績」→ 選擇表格 → 檢視、修正或排除每筆 → 再次確認 → 既有 appendPersonalImports → 顯示真實新增／重複數 → 開啟原匯入紀錄。

保留原有學號直連、Google 登入與檔案匯入，不把表格內容當作學籍認證或課班權限。頁面沒有表格、來源不支援或讀取失敗時不顯示空課表成功。

## 校園入口與實測狀態

配置靜宜、臺大與清華的校方入口。這只是已核對的網站入口，不是三校私有校務頁、所有登入方式或真機匯入已驗收的聲明；介面標示試行。未知校園不提供猜測的登入網址。

- 靜宜：https://alcat.pu.edu.tw/（沿用專案既有校務來源）
- 臺大：https://my.ntu.edu.tw/；官方說明 https://www.cc.ntu.edu.tw/english/services/serv_e05.asp
- 清華：https://www.ccxp.nthu.edu.tw/ccxp/INQUIRE/；官方說明 https://net.nthu.edu.tw/netsys/gapp%3Anew_gapp

校務網站的身分、驗證碼、多因素驗證或不支援內嵌瀏覽時不繞過；跨網域登入、新視窗與無法存取的框架可導致流程不支援。保留原本檔案匯入路徑。

## 隱私及來源邊界

- 帳密由使用者在校方網站輸入；本功能沒有代填、攔截請求、讀 cookie/storage、讀表單 value 或傳送帳密至 Campus One 的實作。
- 僅按下讀取後才執行一次擷取；只序列化可見表格的文字與 rowspan/colspan，移除輸入元件、隱藏內容、腳本、任意 HTML 屬性。可讀相同 origin 的 frame，不能讀跨 origin frame。
- 導覽只允許所選學校的 HTTPS 網域，拒絕 userinfo、異常 port、假後綴及非 HTTPS scheme。originWhitelist 使用 * 是為了由 onShouldStartLoadWithRequest 統一拒絕，而非讓未列入內建清單的 URL 自動送往 OS。初始網址也從固定配置取得。
- 這是主頁導覽及擷取來源限制，不宣稱阻斷學校頁面所有第三方子資源。校方頁面仍能執行自己的 JavaScript。資料不是伺服器認證的校務紀錄。
- 一次性隨機讀取識別、native event URL、10 秒期限與當前頁面一致才接收；切頁、逾時、離開、切帳號／校園及背景切換均取消未完成讀取。
- WebView 使用 incognito、關閉共享 cookies／第三方 cookies／快取／表單保存／file access／mixed content。不同 OS 的登入 Cookie 隔離與釋放仍需實機確認，不宣稱完整系統 Cookie 清除或永久免登入。
- 只將明確確認的個人紀錄交給既有 ledger，資料仍依 owner、schoolId 隔離；已啟用的個人資料同步可能依原設定同步新增紀錄。不可把此流程描述成永不上傳任何課表資料。
- 不保存完整網頁網址（可能含 session query）、原 HTML、密碼或校務 cookie；來源名稱只有校名與本人核對標記。

## 驗證

已在工作環境執行：核心 strict TypeScript 編譯；20 項 Node 網址／單次回應驗證；9 項 Chromium 本機 HTML fixture 擷取測試（可見文字、輸入欄位排除、隱藏內容、登入表格排除、巢狀表格、跨列、超長儲存格拒絕、無表格、同來源 frame）。未連線私有校務帳號。

另加入 Web Vitest 網址／DOM／解析整合測試，以及 Mobile Jest 明確同意、選表、編輯、確認儲存、失敗重試、重複回執、同 tick 鎖、scope 切換與逾時案例；是否通過以本 PR 的 CI 結果為準。既有測試與 CI 門檻不改。

上線驗收仍需三校本人測試帳號的登入、真實課表及成績版面、iOS/Android WebView、鍵盤與縮放、背景回來、記憶體／Cookie 釋放和可及性。未完成前不得宣稱三校帳密直連已全面可用。

本次沒有背景定期校務同步、所有大學支援或 App Store 已發布；這些不可用本機 fixture 與 mock CI 代替驗收。
