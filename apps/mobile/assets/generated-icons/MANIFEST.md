# 產生圖示資產說明（generated-icons）

## 語意對照（精簡）

| 檔名 | 語意 |
|------|------|
| ic_tab_today | 今天 Tab（日程／太陽） |
| ic_tab_study | 學習 Tab |
| ic_tab_campus | 校園 Tab／地圖 |
| ic_tab_messages | 訊息 Tab |
| ic_profile | 個人／大頭貼占位 |
| ic_close | 關閉 |
| ic_chevron_forward | 列表尾端前往 |
| ic_session_expired_clock | 登入逾時 |
| ic_warning_triangle | 全域錯誤 |
| ic_search / ic_clear_circle | 搜尋列／清除 |
| ic_ai_sparkles | AI 捷徑按鈕 |
| ic_navigate_pin / ic_ar_glasses | 地圖導航／AR |
| ic_*（餐廳、圖書館等） | 校園 Hub 服務磚 |

完整提示詞與 id 清單見專案根目錄 **`scripts/button-icons-manifest.json`**。

## 指令

佔位 PNG（stdlib，與 Flux 無關）：

```bash
python3 scripts/seed-button-icon-placeholders.py
```

本地 ComfyUI + Flux.1 Dev 批次輸出（未啟動 ComfyUI 會退出並提示）：

```bash
python3 scripts/generate-button-icons-comfyui.py
python3 scripts/generate-button-icons-comfyui.py --width 768 --height 768 --only ic_tab_today ic_tab_study
```

建議產出後視覺稿線再縮放至約 **96×96** 或 **128×128** logical 對應之 @3x 資產策略（若以單一 PNG 套所有密度，維持向量級邊緣銳利度即可）。

## 整合進度（本機此版）

**已改為 `AppActionIcon`（100% 向量替換於下列區塊）**

- 底部 **FloatingTabBar**（四情境 Tab）
- **HeaderDrawer**（頭像區、關閉、所有列表列與 chevron）
- **HeaderAvatarButton**（訪客狀態）
- **App.tsx** 登入過期／錯誤邊界警示圖
- **CampusHubScreen**（搜尋列、AI 鈕、地圖卡、服務磚）

**仍為 Ionicons／尚未批次替換（待下一輪）**

- `SmartDashboardScreen.tsx` 等儀表板大量動態圖示
- `campusOs.tsx`（AI 覆蓋層動態 icon prop）
- 交通、餐廳、課程、付款等深層詳情頁之零碎圖示
- 其餘約 **50+** 畫面檔案中散落的 `<Ionicons />`（可用 `rg "Ionicons" apps/mobile/src` 追蹤）

下一輪建議：擴充 manifest、以 `ionicon → ic_*` 對照表或 `VectorOrAppIcon` 輔助元件漸進替換。
