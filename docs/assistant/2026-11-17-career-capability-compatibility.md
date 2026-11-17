# 職涯服務的 Agent 能力表相容修正

## 問題與版本

2026-11-17 重新查證 main `fd7b2b87ae4368418b61839138d66435d44c2cb5`、#631 `0c60b2333f9e8e01e0cf18460b698d7e568b9a97`、#672 `f3d1f28f4f973becabba0275dafb95da972733f2`、#682 `1082661bb2c46ad0412c8b5528514cf519b4bf03`。現有 open PR 未另外修正此缺漏。

#672 在 `ASSISTANT_SERVICES` 加入 career；#631 新增的 `capabilityDescriptions` 沒有 career。兩者結合時，能力表初始化會存取 `undefined.modes`，在模組載入即拋出 TypeError，連普通 Agent 請求也可能無法載入；TypeScript 同時報 TS1360／TS7053。因此將它列為整合 P1 阻擋，不代表目前正式 main 已發生服務中斷。

前輪本機整合 `9463ed5ca1ff4be24631f47f6dbcd2a8c02707fe` 已找出修正，但未推送。本輪重新獨立重現後，移植最小修補，沒有搬入該整個合併提交或 Today 的 UI 衝突解析。

## 最小變更與依賴

- 本輪基底 `a29d0e6d2770f581eb87d19243a1f72bd6ea2ccd` 結合 #631 與上述 main；依賴 #631，不依賴 #682。
- `assistantServices.ts` 及其測試與 #672 精確版本逐 byte 相同，只同步已存在的職涯項目、別名與路由邊界。沒有重做職涯服務或修改 #672。
- `assistantTaskPlan.ts` 補上 career 的 `handoff` 描述。只允許列出服務／提出開啟原頁；沒有新增資料 reader、申請、承辦或寫入工具。
- 保留 `Record<AssistantServiceId, CapabilityDescription>` 型別要求與所有服務恰好一筆能力描述的回歸，沒有用忽略缺漏、空值預設或弱化檢查掩蓋問題。
- #682 的程式、head 與成功 CI 保持不變。其他正式分支、帳號、資料、部署及 App 5504170 gate 也未改動。

## 可重現驗證

在新隔離分支只同步 #672 清單、尚未加入 mapping 時執行：

```sh
node --test packages/shared/tests/assistantServices.test.cjs packages/shared/tests/assistantTaskPlan.test.cjs
pnpm --filter @campus/shared typecheck
```

實際結果：62 passed／1 module-load failure；型別檢查 TS1360／TS7053。補上描述後，同組測試 79 passed、shared typecheck 通過。原紅燈 logs 保留在本機 evidence，未將它們冒充公開附件。

本批只修正清單／能力表相容性，對未接通的職涯來源不宣稱有查詢或執行能力。實際申請、實習學分與承辦流程仍須依原頁的資料來源、登入與校方授權確認。

PR 的最終精確 head、適用聚合測試、獨立複查與遠端 CI 以 PR 描述為準。維持 Draft；不合併、不部署，不繞過必要 App 核准。
