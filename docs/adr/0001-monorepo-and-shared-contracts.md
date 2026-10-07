# ADR 0001 — Monorepo and shared contracts

- Status: Accepted
- Context: Campus One 同時有 Mobile、Web、Functions 與共用規則。

## Context

Mobile 與 Web 需要共享角色、資料型別與部分 business rules，但平台 UI、裝置 API 與 framework lifecycle 不相同。

完全拆成多個 repository 會增加 contract drift；反過來把所有邏輯都塞進一個 shared package，又會讓平台邊界模糊。

## Decision

保留 pnpm monorepo：

```text
apps/mobile
apps/web
backend/functions
packages/shared
```

只有跨端必須一致的 contract / rule 進 `packages/shared`。平台 UI、navigation adapter、device capability 與 backend-only secret logic 不放進 shared package。

## Consequences

### Positive

- 同一個 PR 可以一起 review contract 與兩端 consumer。
- TypeScript contract drift 較容易被 typecheck 發現。
- CI 可以針對 Mobile / Web / Functions 分開驗證。

### Trade-offs

- repo 較大。
- dependency graph 需要持續控制。
- shared package 若沒有邊界紀律，很容易變成萬用工具箱。

## Rejected alternatives

**完全分 repo**：目前產品規模不值得承擔版本發布與 contract sync 成本。

**所有 domain code 全部 shared**：會把平台差異藏進大量 abstraction，反而降低可讀性。