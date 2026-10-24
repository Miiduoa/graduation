# 2026-10-24 資安修補與發布證據

## 授權邊界

使用者個人資料中的 `primaryRole` 曾能由客戶端寫入，登入後角色解析又優先採用該欄位。修補同時封鎖個人資料的角色權威欄位寫入，並讓伺服器只以受保護的 `users.role` 與校籍、教學來源等證據解析角色。既有合法管理員不會被批次降權。

校籍角色證據另要求 `status` 明確為 `active`，避免已停用的管理員或編輯校籍再次取得高權限。缺少或未知狀態不授權；獨立教學證據與受保護的合法管理員角色仍可使用。

貼文、訊息與通知的七處欄位白名單改用 `affectedKeys()`，包含欄位新增、修改與刪除；一般按讚、留言數、已讀與反應仍有允許案例。

驗證：原規則的六項攻擊回歸全部失敗；修補後六項通過。整合主分支跨校隔離修正後，在候選 cf6c46c 的完整 Firestore／Storage 與交易、通知、帳號刪除、活動及群組權限套件 162 項通過；Functions 1,052 項、Web 2,475 項及 App 2,962 項通過。Web 與 App 各有一項既有略過項目。共用角色解析十三項及伺服器發出 claims 的專項測試通過。這些是合成帳號與模擬環境證據，沒有對正式使用者內容執行攻擊。

## 正式 Firestore 修補

2026-10-24 14:42（Asia/Taipei）已發布並讀回確認：

- 原規則：`projects/campus-one-tw/rulesets/7ca7a802-d456-438c-9648-815fc0a806a6`
- 修補規則：`projects/campus-one-tw/rulesets/4625ffb2-a281-4d15-8872-227e62e9d039`
- 修補後來源 SHA-256：`c6de7ad4d2ecb879458dd6df2f80fb46515d96c6b86526b8e9923d067be9d802`

正式修補從當時的已部署規則產生，只套用七處欄位檢查及個人資料授權區塊，保留其餘規則。該實際修補檔另外在獨立模擬環境通過六項攻擊與正常操作回歸，雲端編譯成功後才切換 release；切換前重新比對原 ruleset 與更新時間，切換後驗證來源雜湊。原 ruleset 保留供回復。

15:40 再次讀回正式規則，現為 `projects/campus-one-tw/rulesets/12a50536-47b9-417a-9973-7a4c2322a616`，SHA-256 `e0963b43b1edb7c04490e6be5bb80cc533808f7fc7f597ce7ae30031a812567f`，與主分支 `933a9d310e75ccb1cfe6d35d798564b4f689204f` 的完整規則逐位元組相同。PR #168 已保留本次正式安全修補；不以較舊的最小修補覆蓋後續規則。

只讀角色盤點在當時未找到高權限 `role`／`primaryRole` 記錄；只查詢這兩個欄位，沒有讀取訊息、健康或成績內容。這不等於沒有發生過攻擊。若後續發現已被污染的權威角色，應依獨立角色來源核對，再修正資料與 Auth claims；不能單靠這次程式修補撤銷已發出的權限。

## 套件與輸入防護

| 稽核範圍 | 修補前 critical／high／moderate／low | 套件更新後 |
|---|---|---|
| 全 workspace | 0／37／77／11 | 0／4／5／0 |
| workspace 正式依賴 | 0／6／13／3 | 0／4／3／0 |
| Functions 獨立 npm 正式依賴 | 0／2／9／1 | 0／1／8／0 |

兩份鎖檔分別稽核，不能以 workspace 結果代替 Functions 部署包。保留 React／Expo 版本契約及 xmlbuilder2 所需的 js-yaml 3 相容性；Express 4 與 5 各使用同 major 的已修補 body-parser。

`decode-uri-component` 安全版改採 ESM，舊 `query-string` 直接呼叫 CommonJS 載入結果會失敗。以版本控管的 pnpm patch 修正實際套件互通性，保留安全版；用真正的 Node、React Navigation 與 Metro iOS 模組圖驗證，沒有用測試替身掩蓋執行環境問題。文件閱讀器亦以更新後的 fflate 重新打包，Web／App 產物位元組一致，並通過來源與授權資訊檢查。

Zod 3 的已知大型陣列記憶體風險由共用工具入口在 schema 解析前限制陣列、鍵數、深度、節點及 UTF-8 總量；模型工具參數、工具呼叫數與供應商回應另有界限。此為相容性緩解，沒有把 Zod 3 宣稱為上游修補版。

尚餘四項 high 涉及 Metro 的 image-size（兩項）、Expo CLI 的 node-forge 及 Zod 3。工具鏈是否能接觸不可信資料與正式服務是否包含該依賴需分開判斷；沒有直接跨 major 強制替換。任何暫時接受均列於 `dependency-risk-acceptance.json`，精確綁定告警、稽核範圍、路徑及版本或 range，具期限與證據；critical 一律阻擋，不能豁免。

本次九筆範圍精確的處置期限為 2026-10-31。image-size／node-forge 保留為建置工具風險，不能視為上游已修補；Zod 的輸入與供應商串流防護有攻擊回歸。正式 Web 的新舊程序實際解析均不含 image-size／node-forge，Functions 獨立正式依賴亦不含這兩個工具。新增依賴路徑、版本或 range 會使既有處置失效；所有原始稽核報告仍保留。

## 新舊 Web 執行環境

只讀核對正式主機發現：新版 Next.js 為 16.4.2，仍服務舊路由的獨立層為 16.2.11。後者不在本 workspace 鎖檔內；npm 告警包含 critical，但個別可利用條件依作業系統、路由與功能設定而異，沒有對正式站執行利用。

進一步盤點舊層實際模組樹，告警共 5 critical、5 high、3 moderate、1 low；除 Next.js 外，包含 sharp 0.35.0 及 source-map-js 1.2.1。新版 Web 層實際模組樹在該次 npm 稽核無告警。發布檢查涵蓋新舊層所有 Next、sharp、source-map-js 安裝實例，並要求兩個程序在 512 MB 限制下健康啟動。

舊層修補須從封存的 `Miiduoa/nuni-prod` 來源重建、核對路由及帳號契約，不能將另一個重寫中的專案視為既有正式來源，也不能只在舊編譯產物上替換框架套件。封存來源以路由、套件雜湊與產物結構綁定，原始映像沒有 OCI source 標籤，不能宣稱原始 Git commit 已密碼學證明。修補後來源樹為 `48f4e7e2d70d0446624b69498680d0749540a3ac`，immutable image 為 `registry.fly.io/nuni-web@sha256:2be2cd9152f6214987eecd6e14c25cb4ea5897e2737517879c5134b39057650a`，已發布並由 Dockerfile.nuni 固定。Next 16.4.2、sharp 0.35.5、source-map-js 1.2.2；獨立盤點實際 31 個套件名稱，當次 npm advisories 為零。11 項實際來源與 TLS 帳號契約驗收通過，另有 7 項來源準備安全測試通過。正式 rollout 仍須通過精確 main SHA 的完整 CI、512 MB 雙程序啟動、每台 machine digest 與公開 readiness 檢查，發布收據另外保存。

## 正式 API 執行環境

正式 `nuni-api` 映像 `sha256:be815455fbb2ccce844b69f004e416e44465e3421f9da654d0cd5db8379c3dc2` 的來源標籤為 Git tree `b0a10ac814cd03fbfb45132566035acce8339f17`；已與保留的來源樹核對。這不是目前預設 v20 或較新的 composed 候選，重建必須以實際正式來源為基準。

實際安裝套件盤點有 178 個名稱，npm 稽核為 0 critical、18 high 告警條目（13 個不同 GHSA），涉及 Fastify、Zod 4、fast-uri、gRPC 與 brace-expansion；另有 10 moderate、5 low。告警均有特定觸發條件，沒有對正式 API 執行利用，也不能把存在的正式依賴視為純開發依賴排除。此層另做相容版本更新：Fastify 5.12.7、Zod 4.6.7、fast-uri 3.1.9／4.2.3、gRPC 1.14.5、brace-expansion 5.0.12、Node 24.22.1。

由實際正式來源套用可驗證 patch 重建，不改用舊 v20 或新版 composed 候選。第一版 deps-only 樹 `d006ec857bd1b5be5b0281c94077d61f9af51d05` 的實際 178 個套件名稱，獨立 npm 稽核為零 advisories。實際原始 CMD 驗收另發現既有錯誤邊界把破損 JSON 轉成 500，已限定兩個 Fastify parser code 與 status 400 修正，最終樹 `add9614a93c65b4587ca5649a83803614c786f28`，固定本機映像 `sha256:217edc8742b80f621ad81377804088d51981df350fec545ba2c77ac92e147300`。最終映像獨立原始 CMD 驗收 27／27 通過，涵蓋 schema gate、登入／撤銷、普通帳號拒絕 operator 權限、400／401／403／422／安全 500、UID1000。六項新增 HTTP inject 契約亦通過。

SQL 與 runtime-grant matrix 位元組保留，沒有正式資料庫遷移或權限切換。完整 API 回歸正以相同環境比較原 production tree 與 deps-only 樹；既有失敗不可改稱通過，新增差異必須處理後才能 rollout。此文件紀錄 source candidate；最終稽核、完整比較及正式 image-only 發布收據另存。正式 rollout 保留原設定、密鑰與 rollback image，更新停止中的第二台 machine 時必須使用 skip-start。

## App 發布邊界

App 的角色與內容寫入立即受到正式 Firestore 新規則保護。JS 套件互通性與文件閱讀器修補已通過真實 Metro 與 CI；這不代表商店 binary 已更新。只讀核對 EAS 專案 `8955b97c-802c-463c-bd1d-d5f02e30a966`：production 無既有 OTA update、未安裝 expo-updates、已提交 iOS plist 與 production runtime／URL 不一致，不能安全發送 OTA。既有 Android build 13 是較早來源，iOS 無 EAS build；EAS submissions 為零亦不能證明手動商店發布狀態。須以新原生 binary、裝置與商店發布證據個別確認；不可宣稱既有手機已收到新版套件。

## 持續檢查

GitHub Dependabot 漏洞通知與安全更新已啟用。新增每週依賴更新設定與 CodeQL；CI 保留全 workspace、正式 workspace 及 Functions 三份報告，阻擋 critical 與沒有精確有效處置的 high。稽核服務錯誤、結構錯誤或遺失告警不會視為通過。

Google API 金鑰告警已核對確切設定鍵及 Google API Keys API 的限制。它是 Firebase 公開識別設定，未開放 Generative Language API，已按 false positive 註記原因；資料授權仍由規則與伺服器負責。參考 [Firebase API key 說明](https://firebase.google.com/docs/projects/api-keys)。

此文件不是整個產品、實體裝置或商店的全面安全認證。正式服務的實際版本與本次發布後檢查需個別記錄。
