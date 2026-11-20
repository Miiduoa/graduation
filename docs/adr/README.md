# Architecture Decision Records

ADR 記錄「為什麼採用某個架構方向」，而不是只描述現在的程式長什麼樣。

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-monorepo-and-shared-contracts.md) | Mobile / Web / Backend 保留在 monorepo，跨端規則集中於 shared contracts | Accepted |
| [0002](0002-layered-authorization.md) | 權限採 client guard + backend authorization + security rules 多層邊界 | Accepted |
| [0003](0003-ai-as-advisory-layer.md) | AI 是 advisory layer，高敏感 write 需要確認與授權 | Accepted |

新的重大架構改動若會影響多個 client、資料權限或 deployment boundary，應先補 ADR，再改程式。