# 成大、北大上線前檢查（給晉瑋）

這份是程式已就緒、但還沒寫入正式庫、也還沒部署之後，上線給學生每天用之前要過的清單。點餐開關維持關。

## 這次程式已做的

- 課表匯入用各校官方節次：成大 0、1–9、N、A–D；北大 1–13（晚上 10 節 18:30 起）。學校資料彼此隔離。
- 公車：成大預設臺南市、北大預設新北市（三峽）；校園站名是搜尋提示，不是已核對的 TDX 站牌代碼。
- 公告：成大全校／教務處／學務處公開列表、北大校網／教務處。排程仍只寫 `pu`。成大／北大每天 dry-run 探測，來源壞掉（HTTP 失敗或非 SPA 抽出 0 筆）會讓 probe job 失敗。
- 餐廳：公開目錄、只顯示資料與來源網址、`info_only`、不能點餐。Firestore 沒資料時用程式內目錄。種子腳本碰到正式專案會停止。

## 上線前還差

1. **公告 dry-run**：GitHub Actions `Campus announcement sync` 用 `workflow_dispatch`，school=`ncku`、write=false，再跑一次 `ntpu`。對過標題、連結、處室。北大 `new.ntpu.edu.tw/news` 是前端頁，抽出 0 筆是預期，不要當成已接上。
2. **公告寫入**：確認 `schools/{schoolId}/announcements` 與 `announcement-sources` 路徑、服務帳戶只寫這兩處。把 `CAMPUS_ANNOUNCEMENT_SYNC_SCHOOLS` 設成 `pu,ncku` 或 `pu,ncku,ntpu`。不要一次掃全部示範校。
3. **公告健康**：寫入後看 `announcement-sources.status`。成大 iWeb 應是 `healthy` 且有筆數；北大 SPA 若一直 `parse_empty`，要另找可抓的 HTML 列表或 RSS，不要假裝有公告。
4. **餐廳營業時間**：成大光復／敬業時間在 https://sites.google.com/view/ncku-cafeteria ，程式目前標「待補」。北大心湖其他櫃位（C 區等）尚未列入，找到官方頁再加，不要猜。
5. **正式庫種子**：需要寫入 `schools/ncku/cafeterias`、`schools/ntpu/cafeterias` 時，只用本機模擬器或測試專案驗證 `scripts/seed-cafeterias.js`。`SCHOOL_ID=ncku` 或 `ntpu`。禁止對 `campus-one-tw` 跑種子。
6. **公車站名**：用臺南「成功大學」、新北「國立臺北大學」實查 TDX／nuni.tw 閘道，確認有站牌再跟學生說「學校站牌」。現在只是搜尋提示。
7. **課表抽樣**：成大貼「第 0 節」「N-5」「A-B」；北大貼晚上 10–13 節。確認格子時間不是靜宜的 08:10／18:05。
8. **隔離抽樣**：成大帳號看不到北大公告／餐廳；北大看不到成大。快取 key 含 schoolId。
9. **部署**：這次沒部署。上線要走既有 web／mobile 發佈流程，不要順手打開 `ONLINE_ORDERING_ENABLED`。
10. **robots／禮貌**：成大、北大來源已走現有間隔與 User-Agent。若校網擋 GitHub IP，probe 會紅，改用核准後的固定出口，不要提高頻率。

## 正式庫寫入範圍（核准後）

只准：

- `schools/ncku/announcements/*`
- `schools/ncku/announcement-sources/*`
- `schools/ntpu/announcements/*`
- `schools/ntpu/announcement-sources/*`

餐廳正式庫不是這次排程會寫的。沒核准就維持程式內公開目錄。
