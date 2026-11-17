# 公開職涯資料的來源設定與可用性

`/career/data?school=pu`（含 `tw-pu` 別名）在 web 的 Node.js runtime 讀取 `schools/pu/settings/careerSources`，依來源選擇過濾公開資料。訪客不需登入。

部署 web 時須確認既有的 `FIREBASE_SERVICE_ACCOUNT_JSON` 已提供給 web runtime，內容為 `campus-one-tw` 的有效服務帳戶，且可讀取該設定文件；只提供給 Functions runtime 並不足夠。本次修正不新增或修改環境變數、權限或規則。憑證初始化失敗會由既有 Admin 初始化程式記住，修正部署憑證後須重啟 web process。不要把憑證放入前端或提交到版本控制。

來源設定採每個 process 一份的 30 秒記憶體快取，合併並行讀取；`pu` 與 `tw-pu` 共用。營運儲存來源選擇後，origin 最多 30 秒更新，既有 HTTP 快取另有最多 30 秒。多個 process 各自讀取，不共用這份記憶體快取。

設定讀取最多等待 5 秒；失敗或逾時後，每 30 秒重試，僅沿用最後成功讀取、未滿 5 分鐘的來源選擇，維持已停用來源的狀態。逾時後才完成的讀取不會更新快取。回應標示 `sourceSettingsStale` 並使用 `no-store`，web／mobile 會說明正使用最近成功的設定。設定成功讀取後即恢復正常；上游資料保留原有獨立快取。

冷啟動時沒有有效憑證、讀不到設定且沒有成功快取，或設定快取已超過 5 分鐘時，回傳不含內部細節的 503 並禁止 HTTP 快取。不以預設全開來源作為故障備援。web／mobile 會顯示整份公開職涯資訊讀取失敗，保留重新整理與官方連結，不顯示「目前沒有」或「部分」失敗。

部署後以未登入請求確認 endpoint 回傳 200 與預期來源；若為 503，先確認 web runtime 憑證與設定讀取是否可用，避免將設定故障誤判為校方沒有公告。
