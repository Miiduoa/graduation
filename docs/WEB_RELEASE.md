# nuni.tw Web 發布

2026-10-09 00:32（Asia/Taipei），Campus One `ddbbed104b444cb95b85c82681fbc0cb85385e54` 已部署至 https://nuni.tw，Fly release 33。

- 映像索引：`registry.fly.io/nuni-web@sha256:3fa29f4d816dfca7b16e3070b5d1dad7bc3269309c3e85d2459e4a277e34ffe1`
- amd64 映像：`sha256:b02402cfe2da2a32910e32ea5e607cb9377c90755628c7e93eda9e48172c187f`
- 兩台既有 nrt 主機均回傳同一 revision，健康檢查通過。維持每台 512 MB／shared CPU 1。
- 原有 Nuni API、資料庫、網域、登入 secrets 保留；沒有啟用付款或遷移帳號。

## 執行方式

新版 Next.js 使用 Node 22，舊版使用原映像內的 Node 24。兩個程序由 `deploy/web/start.cjs` 管理；舊程序僅綁定 loopback 3001。新路由及資產優先，公開法務、支援、帳號刪除頁與未被新版接手的路由轉到舊服務。Google callback 以密封交易中的 state 選擇處理器，保留進行中的舊登入。

`/health/ready` 檢查兩個 Web 程序並回傳部署 revision；它不代表學校 provider、資料庫權限或登入後的角色功能驗收。

建置使用 `deploy/web/Dockerfile.nuni`，平台為 `linux/amd64`。必須傳入六個正式 `NEXT_PUBLIC_FIREBASE_*` build arguments（API_KEY、AUTH_DOMAIN、PROJECT_ID、STORAGE_BUCKET、MESSAGING_SENDER_ID、APP_ID）與 `CAMPUS_RELEASE_SHA`。Firebase browser 設定是公開識別資訊；Google client secret、BFF session secret 等私密設定只沿用 Fly secrets，不可放進 build arguments。`CAMPUS_LEGACY_ENABLED=true` 同時存在於建置與執行環境，以確保 rewrite manifest 和 callback proxy 一致。

部署已驗證並推送的映像：

```sh
fly deploy -a nuni-web -c deploy/web/fly.nuni.toml \
  --image registry.fly.io/nuni-web@sha256:3fa29f4d816dfca7b16e3070b5d1dad7bc3269309c3e85d2459e4a277e34ffe1 \
  --strategy rolling --max-concurrent 1 --wait-timeout 180s
```

## 驗證紀錄

- production Docker build 通過；路由與登入服務專項 52 項、readiness 6 項、程序管理 16 項通過。
- 真實容器 HTTP smoke 59/59：41 個新舊 JS／CSS、原帳號回應、公開頁面、合法與錯誤 Origin 的空登入 POST。
- 新舊 callback state 分流實測通過；未匹配的舊登入仍交給舊處理器。
- 本機 120 個請求、20 個並行連線全成功；512 MB 限額內記憶體峰值 344,772,608 bytes，OOM 0。
- 公開正式站 33/33：新版首頁、主要入口、舊帳號／法務路由、匿名 session、Nuni API，以及 Google 起始轉址的正式 callback 和安全 cookie。
- 正式瀏覽器已呈現新版，首頁 console error 0。
- 已修正 Next.js 收到 SIGTERM／SIGINT 後的 143／130 正常結束碼判定；新版完整容器經 docker stop 正常退出 0。非預期退出及其他錯誤仍使容器失敗。相關 16 項程序測試已加入 CI。

未使用使用者憑證完成 Google 授權、登入後的所有角色操作或原生商店上架。這些驗收仍在 `STORE_RELEASE.md` 追蹤。

## 回復

以下回復 release 31 的完整 Web 映像及當時配置。既有 Fly secrets 保持原值；不需要變更 DNS 或資料庫。

```sh
fly deploy -a nuni-web -c deploy/web/fly.nuni.rollback.toml \
  --image registry.fly.io/nuni-web@sha256:120b9d015a94810d6180bce0af6f03442963fd7fd52c0570235d2f54609c208c \
  --strategy rolling --max-concurrent 1 --wait-timeout 180s
```

此指令會切回原 Nuni 首頁。回復後需確認兩台主機健康、公開首頁及帳號路由；不能只看部署命令退出碼。此次已保存映像與配置，未在正式站執行回復演練。
