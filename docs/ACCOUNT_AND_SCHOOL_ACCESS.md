# Campus One 帳號、學校資格與店家進駐

## 帳號與權限

Web 和 App 的 Campus One Google 登入交換同一個 Nuni API 平台 session。首次登入建立平台帳號，後續以同一個 Google issuer/subject 找回原帳號，不因相同 email 自動合併帳號。

| 範圍             | 身分如何取得                                        | 不會因此取得的權限                 |
| ---------------- | --------------------------------------------------- | ---------------------------------- |
| 瀏覽校園         | 選擇想看的校園                                      | 校籍、課程成員、校方或平台管理權限 |
| Campus One 帳號  | Google 登入／首次建帳                               | 學校身分或全域教師權限             |
| 學校資格         | 提交合作學校配發的信箱，由 API 判定學校並交校方驗證 | 正式課表、成績或任意教職員職務     |
| 課程成員         | API 回傳每門課的學生、協同教師或負責教師身分        | 其他課程、學校或平台權限           |
| 店家申請人       | 平台帳號申請特定場域、校區與門市                    | 審核權、其他店家或校方權限         |
| 核准店家         | 場域管理者審核後，API 回傳本人有權管理的門市        | 自動營業、線上收款或平台管理權限   |
| 校方／平台管理者 | 後端既有職務與授權                                  | 不接受註冊表單自選管理員           |

一個平台帳號可以同時有多校資格。每校保留 `pending`、`verified`、`rejected` 或 `revoked` 狀態；校區選擇不作為授權依據。課程權限、場域權限和校務資料連線分別由各自服務確認。

學校登入是目前保留的校務資料連線，與平台登入分開。App 不再用 Google 平台登入建立 Firebase 身分；舊校務流程仍保留，不偽造 Firebase user 來開啟校務頁面。這個階段不代表全部舊功能已遷移至同一後端。 現有正式課表／成績連線仍限靜宜，App 的 SchoolProvider 與校務登入固定 `pu`；尚未具備多校私人校務 session 切換。後端以登入者本人、有效校籍及本人擁有的校務 session 授權，瀏覽選校不能改變這些條件。

## 使用流程

1. Web `/login`、App「Campus One 帳號」均以 Google 繼續；取消、失效或未配置會停在可重試的狀態。
2. 帳號頁可查看各校資格並提出信箱申請。只送 `claimedEmail`；學校由 API 的合作學校資料決定。沒有寄送驗證信、取得學生身分或完成核准的假提示。
3. API 若已存在同帳號、同校申請，回傳原紀錄與狀態；被拒絕或撤銷的紀錄不會被畫面改成待審核。
4. 店家從 Web `/merchant` 或 App「店家」進入，選擇 API 實際開放的場域與校區，送出營業資料，查看本人申請及審核說明。
5. 核准與營業分開顯示。菜單、營運設定與收款資格尚未完成時顯示實際缺項。此批新增介面提供申請、進度及門市狀態；營運設定、菜單編輯、訂單管理與店員邀請尚未移植到此介面。

## 兩端的狀態規則

- 每次資料請求綁定畫面開啟時的 session context；舊帳號回應不得寫入新帳號畫面。
- 確認帳號、登出未完成、讀取錯誤時隱藏受保護資料，不把失敗清單顯示成「沒有資格／沒有申請」。
- 申請未收到有效回執時，保留原資料與原 idempotency key。重試收到 4xx 也不能反推先前交易沒有完成。
- Native 平台 handle 僅存 SecureStore，身分／角色每次還原皆由伺服器確認。AsyncStorage 只另存非敏感的登出意圖旗標，避免 Keychain/Keystore 寫入失敗後恢復舊帳號。
- 登出須取得 `signedOut: true` 或確認 session 已失效才視為完成。所有本機儲存媒介與網路同時失效時，無法保證把意圖保存到下一個程序；當次畫面仍遮蔽資料並顯示未完成。

## 原生設定與驗收

App 的 Google 原生模組需要重新編譯，不能由 JavaScript 更新獨立加入舊 binary。iOS 使用 GoogleSignIn 9 的 nonce API；Android 使用 Credential Manager，server client ID 與 nonce 由登入交易 API 提供。

- iOS：設定 `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`，在 `apps/mobile` 執行 `pnpm native:configure-google`，再執行 `pnpm native:check-google`。既有 `ios/` 目錄不會只因 app.config 改動自動同步。不得以 Web client ID 代替 iOS client ID。
- Android：需登記實際 application ID 與簽章指紋；開發、內測與商店簽章應分別驗證。
- Google 登入未配置時，App 明示此版本尚不可登入並提供 Web 入口，不呈現可成功的假操作。
- Web 登入需要既有的 API、Google callback 及 BFF 設定；客戶端不含 Google client secret。

發布前仍須驗證真實帳號 Web/App 回到同一 platform account、原生取消／重開、跨校拒絕授權、店家實際審核、部署後回執與實機。單元測試、來源比對及本機測試 API 畫面不代表這些發布條件已完成。

API 契約來源：`deploy/nuni-api/source.json` 固定來源加四份 patch，還原 tree `6776b19a7cea998728469c3091c0ea7c264f6aa3`。本文描述本 PR 的實作範圍，不是正式環境狀態報告。
