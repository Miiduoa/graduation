# Dependency risk register

記錄依據：[2026-10-08 CI run 37737598320](https://github.com/Miiduoa/graduation/actions/runs/37737598320) 的 `audit-report` artifact，command：`pnpm audit --prod --audit-level moderate --json`。這是初步分流，**不是漏洞已修復的清單**。

當次輸出：**0 critical / 54 high / 33 moderate / 10 low**，共 97 筆 vulnerability findings。報告內 advisory records 數可能與 findings 數不同，因為同一 advisory 可影響不同已安裝版本或依賴路徑。

## Priority for triage

| 依賴家族 | 報告中觀察到的路徑 | 要確認的問題 |
| --- | --- | --- |
| `@grpc/grpc-js` | `backend/functions → firebase-admin → @google-cloud/firestore → google-gax`，也涉及 Mobile Firestore 依賴 | 後端是否受外部輸入觸達；可否在 Firebase / Admin SDK 支援的版本範圍內更新 |
| `protobufjs` | `apps/mobile → firebase → @firebase/firestore → @grpc/proto-loader` | 受影響的版本與生成碼是否在實際裝置或相關工具鏈執行；尋找相容的上游修復 |
| `undici` | `apps/mobile → expo → @expo/cli` | 是否僅建置／開發工具路徑；確認 Expo CLI 更新與 proxy / TLS 攻擊面 |
| `@xmldom/xmldom` | `apps/mobile → expo → @expo/cli → @expo/plist` | 解析的內容是否可被不可信來源控制；上游可用安全版本 |
| `node-forge` | `apps/mobile → expo → @expo/cli` | 是開發、建置還是執行階段；是否存在可安全升級路徑 |

這些是報告中的**間接依賴位置**，不構成「全部都可從網際網路被利用」的判定。修補需確認版本相容性，特別是 Firebase、Expo、React Native 及原生依賴。

## Remediation workflow

1. 保留這份 CI artifact 與 lockfile 對照，不要直接大量升級或使用忽略清單把問題藏起來。
2. 先確認 `backend/functions` 部署時載入的套件與攻擊面，再檢查 Mobile runtime 與 Expo build-time 工具的差別。
3. 針對能安全升級的上游依賴，先在獨立分支更新 lockfile，重跑 Functions、Mobile、Rules、Web，以及 Expo Doctor。
4. 若僅能使用 overrides，必須確認 peer / runtime 相容，不能因 audit 計數下降就視為成功。
5. 新增一筆漏洞的修復或風險接受紀錄時，寫明 advisory、受影響版本、是否可觸達、採取的措施及驗證 run。

## Audit links

- [原始 CI 與可下載 artifact](https://github.com/Miiduoa/graduation/actions/runs/37737598320)
- [GitHub Security Advisories](https://github.com/advisories)
- [Mobile / Functions 的主要依賴和 build profiles](../package.json)

**目前狀態：待分流與修補；未宣稱 97 筆都已處理。**
