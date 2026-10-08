# Testing evidence

這頁記錄 **2026-10-08（台灣時間）** 可從 GitHub Actions 重新核對的結果。測試數量會隨程式重構改變；請以 workflow run 為準，不要拿不同 commit 的數字互相比較。

## Last fully verified CI baseline

主分支最近一次已完成、各主要 job 成功的基準：[CI run 37737598320](https://github.com/Miiduoa/graduation/actions/runs/37737598320)，commit `16fd78a608e7ed54ba555013403163beed530ad7`。這是當次執行的結果，不代表往後所有 commit 都通過。

| Gate | 這次實際紀錄 |
| --- | --- |
| Mobile Jest | 93 suites passed、1 suite skipped；**1212 tests passed、1 skipped** |
| Web Vitest | 8 files passed、1 skipped；**43 tests passed、1 skipped**；產出 V8 coverage report |
| Functions Jest | 30 suites passed；**138 tests passed** |
| Firestore Rules / emulator | **28 tests passed、0 failed** |
| Expo Doctor | **16/16 checks passed** |
| EAS build profiles | development / preview / production 設定結構驗證通過 |
| Web production build | 成功 |
| Lint and Type Check | 工作成功，但不代表沒有 warning |
| Security gates | Gitleaks job 成功；production dependency audit 在 critical 門檻下成功 |
| Mobile test report | `mobile-jest-results` artifact 已產生並由 CI 驗證；**不是 coverage report** |

[全部 workflow jobs](https://github.com/Miiduoa/graduation/actions/runs/37737598320) · [Mobile result artifact](https://github.com/Miiduoa/graduation/actions/runs/37737598320#artifacts)

### 這些通過結果能證明什麼

能重跑 Mobile／Web／Functions 的自動測試、Firestore 規則檢查、Web 建置與 Expo 設定檢查。Mobile 的 JSON 報告由 CI 驗證有非零測試量且失敗數為零，再作為 artifact 保存。

**它們不能證明**原生 iOS / Android 二進位已能建置與安裝、所有 UI flow 都已實測、外部校務或支付服務已正式整合，也不能當成上線環境沒有資安問題的證明。

## Security audit: not a clean bill of health

同一個 CI 執行 `pnpm audit --prod --audit-level critical`；該 run 的報告顯示 **97 筆 vulnerability findings：10 low、33 moderate、54 high、0 critical**。因 blocking threshold 是 `critical`，job 成功 **不等於沒有弱點**。

此數字反映 2026-10-08 當下的 advisory database、lockfile 和 workspace 依賴解析；不同日期重新執行可能不同。完整原始 JSON 放在該 run 的 `audit-report` artifact（保存期限有限）。

優先查核路徑記於 [Dependency risk register](DEPENDENCY_RISK_REGISTER.md)。尤其 `firebase-admin → @google-cloud/firestore → google-gax → @grpc/grpc-js` 與 `firebase → @firebase/firestore → @grpc/proto-loader → protobufjs`。即使多數是 transitive dependencies，也不能因未直接 import 就當成已修復。

## Native E2E is separate and not yet verified

Maestro 是獨立的 macOS simulator workflow，不包含在上述 CI Summary 的八個成功 gate 中。

[Maestro run 37736759823](https://github.com/Miiduoa/graduation/actions/runs/37736759823) 是舊版 workflow，當時檢查仍在 native build 階段，**不能標示為 E2E passed**。

後續 [workflow 修正 commit 61af487](https://github.com/Miiduoa/graduation/commit/61af48701c63d0b8fae585037716d1125d97e54d) 已將測試 App ID 改為 development bundle ID、建置後要求 simulator 安裝、確認 Metro readiness，並取消 `continue-on-error`。這些修改仍需要一次新的 macOS runner 執行才能確認；流程寫對不等於已跑通。

## Remaining verification debt

- **Mobile coverage**：雖已有 Jest JSON 結果，仍未產出可用的 lcov 或 coverage threshold。Web 有 V8 coverage report，不應拿來冒充 Mobile coverage。
- **Runtime / engines**：CI 以 Node 22 執行，但 `backend/functions` 仍宣告 Node 20，安裝會出現 `Unsupported engine` warning；Firebase Functions 的正式執行階段也需依部署環境確認。
- **Warnings**：CI 的成功狀態不表示 ESLint 警告、Node deprecation warnings 或所有 high-severity security findings 都已清除。
- **E2E**：直到新版 Maestro 確認完成 iOS binary build、安裝、Metro 啟動和 UI flow，不應聲稱可在乾淨的 macOS runner 跑完流程。
- **資料與環境**：部分功能使用合成資料或示範環境；測試只驗證對應邊界，不代表正式校務介接已開通。

## Reproduce

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm --filter mobile test --ci --json --outputFile=jest-results.json
pnpm --filter web exec vitest run --coverage
pnpm --filter functions test --runInBand
pnpm test:rules
pnpm audit --prod --audit-level moderate
```

Expo configuration only（非 iOS / Android 原生建置）：

```bash
cd apps/mobile
npx expo-doctor
npx expo config --type public --json
```

## Evidence policy

每次更新測試數、弱點數或已知限制，應同時附上對應的 CI run 和 commit。若最新版測試正在執行或失敗，維持可確認的 baseline，清楚註明差異；不要把「上一版成功」寫成「目前全部成功」。
