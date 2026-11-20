# 固定來源接線候選

`production-source-security.patch` 是供審查的 nuni-prod 來源差異，基於 `deploy/nuni-api/security/source.json` 所固定的 `add9614a93c65b4587ca5649a83803614c786f28`。使用 `scripts/platform-public-agent/prepare-security-source-candidate.py` 只能對本工作樹 `output/` 內的隔離 checkout 套用；腳本核對來源 tree、patch SHA-256 和套用後 tree。此 patch 為零上下文格式，不能用於其他基底。patch 套用後的 Git tree 記於 JSON；測試會核對所有 Agent 模組與本目錄程式一致。

此差異把現有平台 session、公開靜宜地點目錄、資料庫與路由接到既有 Fastify app。功能必須經由測試注入選項才會註冊，預設關閉；沒有 runtime 環境開關，也未配置或啟用正式 Groq provider；傳輸僅供受控測試注入。公開目錄是有日期的快照，不是即時資訊。patch 不包含 migration 或資料庫權限變更，不可直接作為可部署版本。

正式接線仍需核實現行來源與 Fly 配置、決定並審查 migration 編號及相容回滾、確認 runtime role 最小權限、接線經授權的 provider 和產品 session、完成日誌與來源新鮮度審查，並通過必要審查與部署程序。舊映像不認得新增 migration manifest；回滾必須先準備相容映像。

2026-11-03 官方 npm audit 對 archived workspace 的 production lock 找到 56 個公告，其中 API 的 `@fastify/otel@0.20.1 > minimatch@10.2.5` 受 GHSA-g3hv-75wg-m249 影響。官方修補為 11.0.1，超出上游宣告的 `^10.2.4`；未強制跨 major，必須取得相容修補或完成具體相容性與安全審查。其他公告位於 archived web/mobile 鎖定樹，不能直接推定現行部署版本。
