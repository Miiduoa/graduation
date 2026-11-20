# ADR 0003 — AI as an advisory layer

- Status: Accepted
- Context: Campus One 有摘要、問答、風險提示與下一步建議等 AI 路徑。

## Context

AI 能把分散資訊整理成建議，但模型輸出不是校務權威資料，也不應直接取得所有使用者資料或跳過既有角色權限。

如果把 AI 放在核心資料真相之上，模型錯誤會直接變成產品狀態錯誤。

## Decision

AI 維持 advisory layer：

- context 必須先通過既有授權與 retriever 邊界；
- model 產生 suggestion / draft / candidate action；
- 高敏感 write 需要使用者確認或授權角色確認；
- 課程、成績、訊息、導航等 domain state 仍由一般程式與資料來源管理；
- provider 不可用時，核心產品不應因此完全失效。

## Consequences

### Positive

- 模型 hallucination 不直接改變權威資料。
- provider 可替換。
- 非 AI flow 仍可以單獨測試。

### Trade-offs

- action flow 多一層 confirmation / queue。
- AI 看不到未被授權的「全部上下文」，回答能力有意受到限制。

## Rejected alternative

**讓 agent 直接操作所有資料**：開發 demo 可能更快，但 audit、authorization 與錯誤恢復邊界不成立。