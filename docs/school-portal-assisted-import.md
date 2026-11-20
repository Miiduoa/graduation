# 手機校務網頁輔助匯入

## 使用者流程

從訪客首頁或學校登入頁選「在 App 內開啟校務網站匯入」，選課表／成績並同意開啟校方網站。本人在校方頁面完成登入、驗證碼或多因素驗證，開啟自己的資料列表後按「讀取這頁表格」。程式只讀取當下的可見表格與標題文字，不必另存 HTML。

選取辨識到的表格後，可修改學年度、學期與 CSV 文字，重新整理預覽、取消不要的資料列，再按確認匯入。沿用共用解析器、驗證與既有 appendPersonalImports 的帳號／校園隔離、mutex、重複資料／衝突檢查。成功畫面使用實際新增與重複筆數，提供進入既有匯入紀錄編輯、以及二次確認的本批撤回。沒有另建平行的資料庫，也不提高任何校方或課班權限。

## 資料界線

- 使用現有 react-native-webview 與 expo-crypto，無新增相依套件。
- 校務帳密由本人填在校方網頁；擷取腳本不讀 Cookie、storage、密碼或其他輸入欄位，不攔截表單或網路回應。
- 只接受目前學校 HTTPS 根網域及其子網域；拒絕 userinfo、非預設 port、特殊 URI、跨校與假冒尾綴網域。每次主動擷取有 nonce、當前頁面 origin 驗證與 12 秒逾時。
- 輸出只允許經過文字跳脫的 table/tr/td/th/h2 與有限 rowspan/colspan。原頁面腳本、連結、圖片及事件屬性不跨進原生端。
- 同來源 frame 可讀；跨來源 frame 不繞過，會提示可能不完整。圖片課表、canvas、非表格頁或不允許內嵌瀏覽器的認證，仍需既有檔案／截圖入口。
- 關閉、離開畫面、帳號／學校切換會卸載頁面，拒絕晚到回應；App 進背景會取消未完成的擷取。
- WebView 使用 incognito、禁止共用與第三方 Cookie、停用檔案存取、地理位置與混合內容。不宣稱所有 OS 均已實機驗證清除 Cookie；禁止把這項旗標當作永久性資料銷毀證明。
- 擷取及未儲存的核對內容只保留於此流程記憶體。已確認的資料寫入既有個人匯入空間；若使用者先前已開啟個人雲端同步，仍依原有同意設定同步。這不是校務背景登入／排程同步。

## 已核對的官方入口與尚待驗收項目

2026-10-27 僅核對官方入口，不等於四校真實登入後擷取已通過：

| 校園 | 入口 | 官方出處／驗收狀態 |
|---|---|---|
| 靜宜 | https://alcat.pu.edu.tw/ | 沿用既有校務入口；真機網頁匯入待驗證 |
| 中興 | https://portal.nchu.edu.tw/ | https://www.nchu.edu.tw/default/mid/690；真機與授權帳號待驗證 |
| 政大 | https://i.nccu.edu.tw/ | https://www.g.nccu.edu.tw/activate；真機與授權帳號待驗證 |
| 中央 | https://portal.ncu.edu.tw/ | https://portal.ncu.edu.tw/about/howto；真機與授權帳號待驗證 |

其他校園不顯示此實驗入口，但既有檔案匯入保持可用。別把官網入口已設定，寫成已支援跨校一鍵同步。

## 驗證

新增 54 個案例：網址／訊息協定 25、真實 jsdom DOM 擷取 12、原生畫面流程 17。協定 25 個案例已在本機以 Node runner 執行通過；只替換 runner 匯入，斷言與核心程式不變。DOM、RN Jest、全專案型別與 build 必須以本 PR 最新 SHA 的 CI 為準。

原生測試 mock WebView bridge 與持久化呼叫，使用實際共用校務表格解析與資料驗證。它驗證流程，不等於真實校務登入、OS Cookie 或 iOS/Android WebView 的實機網路驗收。

```sh
pnpm --filter web exec vitest run src/lib/portalCapture.test.ts src/lib/portalCapture.dom.test.ts
pnpm --filter mobile test src/__tests__/SchoolPortalImport.test.tsx src/__tests__/GuestLoginScreens.test.tsx --ci
pnpm typecheck
```

上線前：分別用本人授權的 iOS／Android 校務帳號測量從啟動到正確匯入的操作步數、成功率、欄位錯誤率與中斷恢復；測試外部 SSO、新視窗、frame、驗證碼、斷網、App 前背景切換與資料撤回。不保留學號密碼、Cookie、網路 HAR 或其他同學的資料作為測試樣本。

## 競品比較的驗收原則

本次解決「必須離開 App 另存檔案」的操作成本，不宣稱全面超越。課查查開發者在 App Store 所列能力包含校務系統／截圖／ICS 匯入、週次、小工具與跨裝置；不同產品的宣傳清單不是實測證據。Campus One 必須以相同學校、相同課表／成績、相同裝置測試完整流程，而不是用提交數或單元測試數取代產品勝負。

未涵蓋：其他學校帳密自動連接器、背景同步、推播、小工具、Web 跨來源擷取、原生瀏覽器完整 E2E。不得降低既有 CI、略過失敗測試或自動部署未驗證來源。
