# Testing evidence

這份頁面記錄可從 GitHub Actions 重查的驗證結果。它不是 coverage 百分比宣傳頁，也不把 non-blocking warning 當作已解決。

## Last fully verified baseline

Workflow run: [37661634021](https://github.com/Miiduoa/graduation/actions/runs/37661634021)

該 run 的主要 jobs 全部成功：

| Gate | Evidence |
|---|---|
| Mobile Tests | 105 test suites passed；1319 tests passed；1 suite / 1 test skipped |
| Web Tests | 23 files passed；133 tests passed；1 file / 1 test skipped |
| Functions Tests | 28 suites passed；165 tests passed |
| Firestore Rules Tests | 46 passed；0 failed |
| Expo Doctor | 16 / 16 checks passed |
| EAS profile validation | development / preview / production profile structure passed |
| Web production build | Next.js production build passed |
| Lint + Typecheck | job passed across Mobile / Web / Functions / Shared |
| Security Gates | critical dependency audit gate passed；secret scan job passed |

## What the numbers prove

它們可以證明：

- 大量 Mobile domain / service / architecture behavior 有 regression tests；
- Web 與 backend functions 有獨立 test boundary；
- Firestore / Storage authorization rules 不是只靠人工閱讀；
- Mobile build configuration 至少通過 Expo Doctor 與 EAS profile structural checks；
- Web 可以做 production build；
- critical dependency audit 會阻擋 CI。

它們不能證明：

- 正式 production traffic 下沒有 bug；
- 所有 UI flow 都被 E2E 覆蓋；
- coverage 很高；
- 外部校務、交通、支付或 AI provider 已完成正式 integration；
- 所有 security finding 都已清零。

## Known verification debt

### Mobile test artifact and coverage

最近成功的 baseline run 只執行 Jest 測試，**沒有產生 `lcov.info` 或 Jest JSON 結果檔**。當時 Codecov tokenless upload 失敗、原本的 test artifact 也找不到檔案，不能把綠色 CI 當成 coverage 證據。

目前 main 分支已改成使用 Jest `--json --outputFile=jest-results.json`，並由 CI 驗證通過數、失敗數與實際結果檔，再上傳 `mobile-jest-results` artifact；這個流程是否成功，以修改後的 workflow run 為準。

Codecov 步驟已移除，避免重複發生未產出報告卻宣稱上傳的情況。**尚未收集有效 coverage，也尚未設定 coverage threshold**；未來若要加入，應先修復 Jest coverage 依賴與驗證產物，再設明確 gate。

### Lint warnings

`Lint & Type Check` job 成功，但 log 仍有 warning，例如 `no-explicit-any`、unused eslint directives / variables，以及部分 backend `no-undef` warning。

目前 eslint configuration 沒有把所有 warning 升級成 error，所以「job success」不等於「0 warning」。此外，近期 CI 的 backend `index.js` 曾在學生登入 response 引用未定義的變數；目前已改用獨立 academic response builder 並新增回歸測試。`puScraper.js` 仍有未完成的非匯出 credit-audit 舊路徑，不能把整個 scraper 宣稱為零警告。

### Dependency audit

Security gate 已通過 critical threshold。先前兩個 critical transitive findings 已透過 override 與 refreshed lockfile 修補。

該 baseline run 仍報告 **20 個 dependency findings**（未超過 critical 阻擋門檻），因此不能描述成「0 vulnerabilities」。完整 JSON audit report 由 CI artifact 保存。

### E2E

Maestro workflow 獨立存在，避免把 emulator / UI flow 與 unit tests 混在同一個 job。它不是每個 domain rule 的唯一證據，unit / rules / backend tests 仍各自保留。

## Reproduce locally

```bash
pnpm lint
pnpm typecheck
pnpm --filter mobile test --ci
pnpm --filter web exec vitest run
pnpm --filter functions test --runInBand
pnpm test:rules
```

Mobile build configuration：

```bash
cd apps/mobile
npx expo-doctor
npx expo config --type public --json
```

## Evidence policy

README 或備審若引用測試數字，應附 workflow run 或可重現指令。數字改變時更新這一頁，不在多份文件手動複製不同版本。