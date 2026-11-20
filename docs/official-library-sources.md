# 圖書館入口來源與介接狀態

更新：2026-10-24

校園服務的官網連結、館藏入口、借閱登入與空間預約是不同功能；不要將圖書館官網當作館藏 API，也不要從其他校園沿用借閱資料。靜宜保留既有的 App 內 OPAC 查詢；本次新增的彰師大、北商大、東海與輔大功能僅轉介至官方系統，**不含**本地即時館藏／可借狀態、讀者帳號 API、座位或預約整合。

| 校園 | 經校方網站確認的服務 | 來源 |
| --- | --- | --- |
| 靜宜大學 | 圖書館官網、WebPac 館藏查詢 | https://library.pu.edu.tw/ 、 https://webpacx.lib.pu.edu.tw/ |
| 國立清華大學 | Primo 館藏查詢、讀者帳號、開館時間、空間預約 | https://www.lib.nthu.edu.tw/ 、 https://www.lib.nthu.edu.tw/use/hours.html 、 https://libsms.lib.nthu.edu.tw/build/ |
| 國立中興大學 | Primo 本館館藏查詢、開放時間 | https://www.lib.nchu.edu.tw/ 、 https://www.lib.nchu.edu.tw/service.php?cID=35 |
| 東吳大學 | 官方 Primo 館藏入口、開放時間 | https://www.lib.scu.edu.tw/ 、 https://www.lib.scu.edu.tw/CMS/Page/12 |
| 長庚大學 | iGrid／館藏總覽、開放時間 | https://www.cgu.edu.tw/library/ 、 https://web20.lib.cgu.edu.tw/ |
| 國立嘉義大學 | 館藏／個人借閱官方入口、開館時間與 Summon 資源探索 | https://www.ncyu.edu.tw/lib/ 、 https://libaleph.ncyu.edu.tw/F 、 https://ncyu.summon.serialssolutions.com/za-CN/ |
| 國立臺北大學 | 官方 WebPAC 館藏、個人借閱、空間預約、電子資源與開館時間 | https://library.ntpu.edu.tw/ 、 https://wpac.lib.ntpu.edu.tw/webpac/search.cfm 、 https://ireserve.lib.ntpu.edu.tw/sm/home_web.do |
| 臺北醫學大學 | 官方 WebPAC 館藏、開館時間與電子資源 | https://library.tmu.edu.tw/Forms/Form0200/Form0200.aspx 、 https://libelis.tmu.edu.tw/webpacIndex.jsp 、 https://jumper.tmu.edu.tw/ |
| 中原大學 | 張靜愚紀念圖書館館藏、個人借閱與續借官方入口 | https://lib.cycu.edu.tw/ 、 https://cylis.lib.cycu.edu.tw/search*cht 、 https://cylis.lib.cycu.edu.tw/patroninfo*cht |
| 國立彰化師範大學 | WebPACX 館藏深層搜尋（2026-10-24 瀏覽器實測） | https://olis.ncue.edu.tw/ 、 https://webpacx.ncue.edu.tw/search?searchInput=…&searchField=…；欄位 FullText／TI／PN／SU／ISBN |
| 國立臺北商業大學 | WebPACX 館藏深層搜尋（2026-10-24 瀏覽器實測） | https://library.ntub.edu.tw/ 、 https://webpacx.ntub.edu.tw/search?searchInput=…&searchField=…；欄位同 WebPACX |
| 東海大學 | WebPACX 館藏深層搜尋（2026-10-24 瀏覽器實測） | https://lis.thu.edu.tw/ 、 https://webpac.lib.thu.edu.tw/search?searchInput=…&searchField=…；欄位同 WebPACX |
| 輔仁大學 | Sierra 館藏查詢與讀者帳號（2026-10-24 瀏覽器實測；非 WebPACX） | 官網 https://home.lib.fju.edu.tw/ ；入口頁 https://home.lib.fju.edu.tw/TC/webpac ；表單送至 https://library.lib.fju.edu.tw:444/search~S0*cht/ （searchtype／searcharg／SORT=D／extended=0；searcharg 上限 75）；讀者 https://library.lib.fju.edu.tw:444/patroninfo*cht |

清華與中興的 Primo 網址，來自各校圖書館官網「進階檢索」或「館藏查詢」連結。校方使用第三方 Ex Libris 網域提供查詢，並不代表本站已取得館藏或讀者帳號 API 權限。

彰師大、北商大、東海的 WebPACX 首頁為 React 動態表單；實際查詢路徑與欄位代碼依結果頁核對，共用介面的 Title／Author／Subject 會轉成 TI／PN／SU，不可把 Title 等字面值直接當作 `searchField`。輔大為獨立 Sierra GET 表單，`searchtype` 的 Y／t／a／d／i 分別代表關鍵字／題名／作者／主題／ISBN，與 WebPACX 參數不同。

其他已收錄學校的官網入口請參閱 `packages/shared/src/officialLibraries.ts`。其中若 `catalogUrl` 等於 `websiteUrl`，僅表示已收錄官網、**尚未核對獨立館藏深層連結**。新校園需先查驗學校識別與官方來源才可加入對應；不可單靠上次顯示的校名推定。

目前仍未介接其他學校的館藏檢索回傳、即時借閱狀態、館內座位、續借及預約 API。此類資料須以校方授權、穩定 API、正式契約及帳號驗證為前提，未取得時應引導至校方服務，不得顯示虛構的可借數、空位數或完成狀態。
