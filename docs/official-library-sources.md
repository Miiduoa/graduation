# 圖書館入口來源與介接狀態

更新：2026-10-14

校園服務的官網連結、館藏入口、借閱登入與空間預約是不同功能；不要將圖書館官網當作館藏 API，也不要從其他校園沿用借閱資料。

| 校園 | 經校方網站確認的服務 | 來源 |
| --- | --- | --- |
| 靜宜大學 | 圖書館官網、WebPac 館藏查詢 | https://library.pu.edu.tw/ 、 https://webpacx.lib.pu.edu.tw/ |
| 國立清華大學 | Primo 館藏查詢、讀者帳號、開館時間、空間預約 | https://www.lib.nthu.edu.tw/ 、 https://www.lib.nthu.edu.tw/use/hours.html 、 https://libsms.lib.nthu.edu.tw/build/ |
| 國立中興大學 | Primo 本館館藏查詢、開放時間 | https://www.lib.nchu.edu.tw/ 、 https://www.lib.nchu.edu.tw/service.php?cID=35 |
| 東吳大學 | 官方 Primo 館藏入口、開放時間 | https://www.lib.scu.edu.tw/ 、 https://www.lib.scu.edu.tw/CMS/Page/12 |
| 長庚大學 | iGrid／館藏總覽、開放時間 | https://www.cgu.edu.tw/library/ 、 https://web20.lib.cgu.edu.tw/ |
| 國立嘉義大學 | 館藏／個人借閱官方入口、開館時間與 Summon 資源探索 | https://www.ncyu.edu.tw/lib/ 、 https://libaleph.ncyu.edu.tw/F 、 https://ncyu.summon.serialssolutions.com/za-CN/ |

清華與中興的 Primo 網址，來自各校圖書館官網「進階檢索」或「館藏查詢」連結。校方使用第三方 Ex Libris 網域提供查詢，並不代表本站已取得館藏或讀者帳號 API 權限。

其他已收錄學校的官網入口請參閱 `packages/shared/src/officialLibraries.ts`。其中若 `catalogUrl` 等於 `websiteUrl`，僅表示已收錄官網、**尚未核對獨立館藏深層連結**。新校園需先查驗學校識別與官方來源才可加入對應；不可單靠上次顯示的校名推定。

目前仍未介接其他學校的館藏檢索回傳、即時借閱狀態、館內座位、續借及預約 API。此類資料須以校方授權、穩定 API、正式契約及帳號驗證為前提，未取得時應引導至校方服務，不得顯示虛構的可借數、空位數或完成狀態。
