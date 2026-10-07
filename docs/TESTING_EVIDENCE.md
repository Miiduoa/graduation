# Testing evidence

這份頁面記錄可從 GitHub Actions 重查的驗證結果。它不是 coverage 百分比宣傳頁，也不把 non-blocking warning 當作已解決。

## Last fully verified baseline

Workflow run: [37649966488](https://github.com/Miiduoa/graduation/actions/runs/37649966488)

該 run 的主要 jobs 全部成功：

| Gate | Evidence |
|---|---|
| Mobile Tests | 93 test suites passed；1212 tests passed；1 suite / 1 test skipped |
| Web Tests | 8 files passed；43 tests passed；1 file / 1 test skipped |
| Functions Tests | 26 suites passed；124 tests passed |
| Firestore Rules Tests | 28 passed；0 failed |
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

### Codecov upload

Mobile test job 中 Codecov upload 目前是 non-blocking，且該 baseline run 顯示 tokenless upload 失敗。

因此 README 不宣稱 coverage 已成功上傳。若要把 coverage 當審查證據，應先完成 token / repository configuration，再把 coverage threshold 變成明確 gate。

### Lint warnings

`Lint & Type Check` job 成功，但 log 仍有 warning，例如 `no-explicit-any`、unused eslint directives / variables，以及部分 backend `no-undef` warning。

目前 eslint configuration 沒有把所有 warning 升級成 error，所以「job success」不等於「0 warning」。

### Dependency audit

Security gate 已通過 critical threshold。先前兩個 critical transitive findings 已透過 override 與 refreshed lockfile 修補。

baseline run 仍報告其他低／中／高 severity dependency findings，因此不能描述成「0 vulnerabilities」。完整 JSON audit report 由 CI artifact 保存。

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