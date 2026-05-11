# Firebase：正式專案（Blaze）與停用本機 Emulator

本文件對應「手機只連正式專案、報修與列表同一套 Firestore、Functions 部署在可升級 Blaze 的專案」的流程。

## 架構原則

- **同一個 Firebase 專案**同時放 Firestore 與 Cloud Functions 時，`EXPO_PUBLIC_FIREBASE_PROJECT_ID` 與後端 `firebase use` 的專案必須一致；AI 報修（`submitRepairRequest` callable）與宿舍報修列表（`schools/{schoolId}/repairRequests`）才會讀寫同一份資料。
- 若另開「第二個」Firebase 專案只部署 Functions，但 Firestore 留在第一個專案，必須做跨專案 IAM／自訂初始化，**維護成本高**，畢展建議維持**單一正式專案**。

## 停掉 `firebase emulators:start`

- 本 repo 的 `pnpm dev:functions`（`backend/functions` 的 `serve`）**不再**啟動 Functions emulator；日常改動請直接 `firebase deploy --only functions` 到正式（或 staging）專案。
- 若你本機仍開著 `firebase emulators:start`，請在該終端機 **Ctrl+C** 結束。
- **CI / 規則測試**仍使用 `pnpm test:rules`（`firebase emulators:exec --only firestore,storage`），與日常開發分開。

## Blaze 與部署

1. 在 [Firebase Console](https://console.firebase.google.com/) 選專案 → 升級方案為 **Blaze**（付費按量，才能穩定使用完整 Cloud Functions 與外連等能力）。
2. 本機登入並指定專案：
   ```bash
   firebase login
   firebase use --add   # 選你的正式專案 ID，設為 alias 例如 production
   ```
3. 部署 Functions（與規則／索引一併視需求）：
   ```bash
   pnpm --filter functions deploy
   # 或
   firebase deploy --only functions
   ```
4. 部署 Firestore 規則／索引（報修、訂單等讀寫依規則）：
   ```bash
   firebase deploy --only firestore
   ```

## 「小專案」手動複製（精簡程式庫時）

若你希望**另建一個小 repo**只放必要後端、再 deploy 到上述同一個 Firebase 專案，可手動從本專案複製（路徑相對於 repo 根目錄）：

| 用途 | 建議複製內容 |
|------|----------------|
| 校園助理 agent | `backend/functions/agent/` 整包（含 `handlers/`、`tools/`、`executeCampusAssistantCore.js` 等） |
| Callable：報修 | `backend/functions/index.js` 內 **`exports.submitRepairRequest`** 區塊與其依賴（`REGION`、`db`、`HttpsError`、`assertActiveSchoolMember`、`FieldValue` 等頂部共用程式） |
| Callable：助理 | `exports.askCampusAssistant`、`exports.executeAgentWrite` 及相關 `getAgentRunDebug`、`enqueueAssistantAction` 等若你有用到 |
| 訂單（AI 代點） | `exports.createOrder` 區塊（與 `getCafeteriaRef`、`cafeteriaHasActiveOperator` 等依賴） |

`index.js` 體積大、共用多，實務上多數團隊會**整包** `backend/functions` 部署到同一個 Blaze 專案，較少真的拆成極小檔案；拆檔時請用 `node --check index.js` 與一次 staging deploy 驗證。

## 手機 App 環境變數

- 填好 `apps/mobile/.env`（見 `apps/mobile/.env.example`）內所有 `EXPO_PUBLIC_FIREBASE_*`，與**正式專案**一致。
- **不要**設 `EXPO_PUBLIC_USE_CLOUD_FUNCTION_EMULATOR=true`（預設即連雲端）。
- 靜宜適配器（`tw-pu`）的 API base 已改為依 `EXPO_PUBLIC_FIREBASE_PROJECT_ID`（與可選 `EXPO_PUBLIC_CLOUD_FUNCTION_BASE_URL`）組出正式 Cloud Functions URL；`EXPO_PUBLIC_API_ENV=production` 時也會強制走真實資料路徑（見 `apps/mobile/src/config/runtime.ts`）。
