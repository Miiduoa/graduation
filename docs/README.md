# nuni 文件目錄

第一次了解專案，先看[專案首頁](../README.md)與[兩分鐘導覽](REVIEW_IN_2_MINUTES.md)。要執行、修改或驗證功能，再依下面的用途閱讀。

## 體驗產品

| 想了解的內容                       | 文件                                           |
| ---------------------------------- | ---------------------------------------------- |
| nuni 解決什麼問題、主要操作流程    | [兩分鐘導覽](REVIEW_IN_2_MINUTES.md)           |
| 目前畫面、來源版本與示範資料說明   | [截圖與畫面來源](SCREENSHOTS.md)               |
| 用手機展示 AI 助理規劃、執行與回執 | [手機展示流程](../apps/mobile/DEMO.md)         |
| 平台帳號、學校資格與店家權限       | [帳號與學校資格](ACCOUNT_AND_SCHOOL_ACCESS.md) |

## 開發與維護

| 工作                         | 文件或程式入口                                                                |
| ---------------------------- | ----------------------------------------------------------------------------- |
| 安裝依賴、環境設定與本機執行 | [新機器設定](SETUP_NEW_MACHINE.md)                                            |
| Web 開發、常用指令與目錄     | [Web README](../apps/web/README.md)                                           |
| 手機主程式與原生設定         | [手機原始碼](../apps/mobile/)、[App 設定](../apps/mobile/app.config.ts)       |
| 平台 API 來源、重建與部署    | [Nuni Backend](NUNI_BACKEND.md)、[API 部署目錄](../deploy/nuni-api/README.md) |
| 跨端共用型別與規則           | [Shared package](../packages/shared/)                                         |
| 既有架構取捨                 | [設計決策紀錄](adr/README.md)                                                 |

## 系統與 AI 助理

| 主題                                 | 文件                                                                                                                                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web、手機、平台 API 與校務來源的關係 | [架構說明](ARCHITECTURE_OVERVIEW.md)                                                                                                                                               |
| 帳號、角色與資料流                   | [角色與資料流](APP_ROLE_DATA_FLOW_ARCHITECTURE.md)、[跨角色流程](CROSS_ROLE_DATA_FLOW.md)                                                                                          |
| API 與身分邊界                       | [API 文件](API.md)、[Nuni 身分轉接](NUNI_IDENTITY_ADAPTER.md)                                                                                                                      |
| 助理可以開啟、讀取及執行的範圍       | [服務接通紀錄](assistant/2026-11-07-service-connections.md)                                                                                                                        |
| 課業計畫、個人進度與精確作業入口     | [保存計畫](evidence/agent-saved-plans/README.md)                                                                                                                                   |
| 從作業找空堂，再確認建立準備行程     | [計畫接續執行](assistant/2026-11-08-plan-coursework-execution.md)、[空堂與準備行程](assistant/2026-11-08-coursework-free-time-execution.md)                                        |
| 連續調整空堂日期、鐘點與最低時長     | [空堂條件追問](evidence/agent-class-gap-followups/README.md)                                                                                                                       |
| 真正寫入、讀回核對與中斷恢復         | [執行與回執](assistant/2026-11-07-verified-execution.md)、[手機任務恢復](assistant/2026-11-08-mobile-task-recovery.md)、[多筆行程](assistant/2026-11-08-mobile-batch-execution.md) |
| 校方 LMS 的讀取與繳交界線            | [校方 LMS 唯讀整合](SCHOOL_LMS_READONLY.md)                                                                                                                                        |

## 驗證與發布

| 要核對的事項                   | 文件或紀錄                                                                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| 各輪測試的版本、結果與範圍     | [測試紀錄](TESTING_EVIDENCE.md)、[GitHub Actions](https://github.com/Miiduoa/graduation/actions)                                    |
| 真實元件截圖與受控互動證據     | [畫面來源](SCREENSHOTS.md)、[Evidence 目錄](evidence/)                                                                              |
| 安全設計、資料權限與待處理風險 | [安全說明](SECURITY.md)、[Firebase 資料邊界](architecture/firebase-data-boundaries.md)、[依賴風險清單](DEPENDENCY_RISK_REGISTER.md) |
| Web／平台發布與實際上線版本    | [平台發布紀錄](PLATFORM_RELEASE.md)、[Web 發布](WEB_RELEASE.md)                                                                     |
| 手機發布與上架條件             | [發布準備](RELEASE_READINESS.md)、[商店發布](STORE_RELEASE.md)                                                                      |
| 功能驗收的歷史盤點             | [2026-11-01 驗收快照](PRODUCT_ACCEPTANCE_SNAPSHOT_2026-11-01.md)                                                                    |

## 如何閱讀歷史文件

檔名含日期、`archive/` 下的文件，以及舊 `demo-screenshots/`、`mobile-screenshots/`、`screenshots-v4/`，都保留當時的設計、展示或驗證脈絡。歷史文件可能使用 Campus One 舊名；請先看文件的日期、commit 與適用範圍。

日期文件是特定輪次的紀錄，不是會自動更新的完成清單。「通過測試」「已合併 main」與「已部署」各自需要對應證據。判斷目前行為時，核對正在使用的版本、實際程式與該版本的檢查結果；過去的 `FINAL`、`COMPLETION` 或驗收數字不能直接當作今天的發布狀態。
