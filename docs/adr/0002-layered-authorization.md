# ADR 0002 — Layered authorization

- Status: Accepted
- Context: Campus One 有 student、teacher、staff、department head、admin 等不同角色。

## Context

只在 UI 隱藏按鈕不能保護資料。Deep link、直接 API 呼叫或 client bug 都可能繞過畫面層。

反過來只靠 backend rule，又會讓使用者一直撞到「看得到但不能做」的操作。

## Decision

權限分成多層：

1. role-aware tab / route
2. UI permission
3. repository / service boundary
4. backend authorization
5. Firestore / Storage security rules

Client 層負責正確產品體驗；server / rules 層負責真正的資料安全。

## Consequences

### Positive

- UX 與安全責任分開。
- deep link / message action 不必信任畫面是否曾顯示。
- Firestore rules 可作為最後一道資料防線並獨立測試。

### Trade-offs

- 同一個 permission 可能需要在多層有對應表達。
- 若沒有 shared contract 與 tests，角色規則仍可能 drift。

## Review rule

新增敏感功能時，code review 不能只問「按鈕有沒有藏起來」，還要確認 backend authorization 與 rules 是否存在對應限制。