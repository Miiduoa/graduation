# Campus App API 文件

本文件描述 Campus App 的 Firebase Cloud Functions API 端點。

## 目錄

- [認證](#認證)
- [公告與活動](#公告與活動)
- [群組管理](#群組管理)
- [圖書館服務](#圖書館服務)
- [座位預約](#座位預約)
- [收藏功能](#收藏功能)
- [使用者資料](#使用者資料)
- [餐廳訂餐](#餐廳訂餐)
- [宿舍服務](#宿舍服務)
- [列印服務](#列印服務)
- [健康中心](#健康中心)
- [校車服務](#校車服務)
- [iCal 訂閱](#ical-訂閱)
- [SSO 單一登入](#sso-單一登入)

---

## 基本資訊

### Base URL

```
https://asia-east1-YOUR_PROJECT_ID.cloudfunctions.net
```

### 認證方式

大部分 API 需要 Firebase Authentication。在 HTTP 請求中加入：

```
Authorization: Bearer <firebase_id_token>
```

對於 Callable Functions，使用 Firebase SDK 自動處理認證。

### 回應格式

所有 API 回應皆為 JSON 格式。

成功回應：
```json
{
  "success": true,
  "data": { ... }
}
```

錯誤回應：
```json
{
  "error": {
    "code": "error_code",
    "message": "錯誤訊息"
  }
}
```

---

## SSO 單一登入

### GET /getSSOConfig

取得學校 SSO 公開設定。回應不包含任何 `clientSecret`、憑證或私鑰欄位。

**Query 參數**

| 參數 | 類型 | 必填 | 說明 |
|-----|-----|-----|-----|
| schoolId | string | 是 | 學校 ID |

**回應範例**

```json
{
  "schoolId": "ntust",
  "schoolName": "國立臺灣科技大學",
  "ssoConfig": {
    "provider": "oidc",
    "name": "台科大單一登入",
    "enabled": true,
    "scopes": ["openid", "profile", "email"]
  },
  "emailDomain": "mail.ntust.edu.tw",
  "allowEmailLogin": true
}
```

### POST /createCustomToken

此端點已停用，會回傳 `410 Gone`。請改用 `POST /startSSOAuth` 初始化一次性登入交易，再以 `POST /verifySSOCallback` 完成驗證與 token 簽發。

### POST /startSSOAuth

建立一次性 SSO 驗證交易，綁定 `state`、`redirectUri` 與有效期限。

**Body 參數**

| 參數 | 類型 | 必填 | 說明 |
|-----|-----|-----|-----|
| schoolId | string | 是 | 學校 ID |
| provider | string | 是 | SSO 類型 (oidc/cas/saml) |
| redirectUri | string | 是 | 必須在 allowlist 內的 callback URL |
| state | string | 是 | 前端產生的 anti-CSRF state |
| codeChallenge | string | OIDC 必填 | PKCE challenge |
| nonce | string | OIDC 建議 | OIDC nonce |

**回應範例**

```json
{
  "transactionId": "sso_tx_abc123",
  "expiresAt": "2026-03-20T12:34:56.000Z"
}
```

### POST /verifySSOCallback

處理 SSO 回調驗證，只接受有效且未重複使用的交易。

**Body 參數**

| 參數 | 類型 | 必填 | 說明 |
|-----|-----|-----|-----|
| schoolId | string | 是 | 學校 ID |
| provider | string | 是 | SSO 類型 (oidc/cas/saml) |
| transactionId | string | 是 | `startSSOAuth` 回傳的一次性交易 ID |
| redirectUri | string | 是 | 必須與初始化交易時相同 |
| state | string | 是 | 必須與初始化交易時相同 |
| code | string | OIDC 必填 | OIDC authorization code |
| codeVerifier | string | OIDC 必填 | PKCE verifier |
| ticket | string | CAS 必填 | CAS ticket |
| SAMLResponse | string | SAML 必填 | SAML Response |

**回應範例**

```json
{
  "customToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "uid": "abc123",
  "isNewUser": true
}
```

---

## 使用者資料

### getUserProfile (Callable)

取得當前使用者資料。

**無需參數**

**回應範例**

```json
{
  "uid": "abc123",
  "displayName": "王小明",
  "email": "user@school.edu.tw",
  "studentId": "M11234567",
  "department": "資訊工程系",
  "stats": {
    "groupsCount": 5,
    "favoriteCount": 12
  }
}
```

### updateUserProfile (Callable)

更新使用者資料。

**參數**

| 參數 | 類型 | 必填 | 說明 |
|-----|-----|-----|-----|
| displayName | string | 否 | 顯示名稱 |
| photoURL | string | 否 | 頭像 URL |
| department | string | 否 | 系所 |
| studentId | string | 否 | 學號 |

**回應範例**

```json
{
  "success": true
}
```

### exportUserData (Callable)

匯出使用者所有資料（GDPR 合規）。

**無需參數**

**回應範例**

```json
{
  "exportedAt": "2024-01-15T10:30:00Z",
  "user": { ... },
  "favorites": [ ... ],
  "groups": [ ... ],
  "notifications": [ ... ]
}
```

### deleteUserAccount (Callable)

永久刪除帳號。

**參數**

| 參數 | 類型 | 必填 | 說明 |
|-----|-----|-----|-----|
| confirmation | string | 是 | 必須為 "DELETE_MY_ACCOUNT" |

**回應範例**

```json
{
  "success": true
}
```

---

## 群組管理

### createGroup (Callable)

建立新群組。

**參數**

| 參數 | 類型 | 必填 | 說明 |
|-----|-----|-----|-----|
| name | string | 是 | 群組名稱 |
| description | string | 否 | 群組描述 |
| type | string | 是 | 類型 (course/club/study) |
| schoolId | string | 是 | 學校 ID |
| isPrivate | boolean | 否 | 是否為私人群組 |

**回應範例**

```json
{
  "success": true,
  "groupId": "group123",
  "joinCode": "ABC123"
}
```

### joinGroupByCode (Callable)

使用邀請碼加入群組。

**參數**

| 參數 | 類型 | 必填 | 說明 |
|-----|-----|-----|-----|
| joinCode | string | 是 | 加入碼（6 位英數字） |

**回應範例**

```json
{
  "success": true,
  "groupId": "group123",
  "groupName": "資料結構"
}
```

### leaveGroup (Callable)

離開群組。

**參數**

| 參數 | 類型 | 必填 | 說明 |
|-----|-----|-----|-----|
| groupId | string | 是 | 群組 ID |

**回應範例**

```json
{
  "success": true
}
```

---

## 圖書館服務

### searchBooks (Callable)

搜尋館藏。

**參數**

| 參數 | 類型 | 必填 | 說明 |
|-----|-----|-----|-----|
| schoolId | string | 是 | 學校 ID |
| query | string | 否 | 搜尋關鍵字 |
| limit | number | 否 | 筆數限制（預設 20） |
| offset | number | 否 | 偏移量 |

**回應範例**

```json
{
  "books": [
    {
      "id": "book123",
      "title": "資料結構與演算法",
      "author": "王大明",
      "isbn": "978-xxx-xxx",
      "availableCopies": 3
    }
  ],
  "total": 1
}
```

### borrowBook (Callable)

借閱圖書。

**參數**

| 參數 | 類型 | 必填 | 說明 |
|-----|-----|-----|-----|
| schoolId | string | 是 | 學校 ID |
| bookId | string | 是 | 圖書 ID |

**回應範例**

```json
{
  "success": true,
  "loanId": "loan123",
  "dueAt": "2024-01-29T00:00:00Z"
}
```

### returnBook (Callable)

歸還圖書。

**參數**

| 參數 | 類型 | 必填 | 說明 |
|-----|-----|-----|-----|
| schoolId | string | 是 | 學校 ID |
| loanId | string | 是 | 借閱 ID |

**回應範例**

```json
{
  "success": true
}
```

### renewBook (Callable)

續借圖書（最多 2 次）。

**參數**

| 參數 | 類型 | 必填 | 說明 |
|-----|-----|-----|-----|
| schoolId | string | 是 | 學校 ID |
| loanId | string | 是 | 借閱 ID |

**回應範例**

```json
{
  "success": true,
  "newDueAt": "2024-02-05T00:00:00Z",
  "renewCount": 1
}
```

---

## 座位預約

### reserveSeat (Callable)

預約圖書館座位。

**參數**

| 參數 | 類型 | 必填 | 說明 |
|-----|-----|-----|-----|
| schoolId | string | 是 | 學校 ID |
| seatId | string | 是 | 座位 ID |
| date | string | 是 | 日期 (YYYY-MM-DD) |
| startTime | string | 是 | 開始時間 (HH:mm) |
| endTime | string | 是 | 結束時間 (HH:mm) |

**回應範例**

```json
{
  "success": true,
  "reservationId": "res123"
}
```

### cancelSeatReservation (Callable)

取消座位預約。

**參數**

| 參數 | 類型 | 必填 | 說明 |
|-----|-----|-----|-----|
| schoolId | string | 是 | 學校 ID |
| reservationId | string | 是 | 預約 ID |

**回應範例**

```json
{
  "success": true
}
```

---

## 收藏功能

### toggleFavorite (Callable)

切換收藏狀態。

**參數**

| 參數 | 類型 | 必填 | 說明 |
|-----|-----|-----|-----|
| itemType | string | 是 | 類型 (announcement/event/poi/menu) |
| itemId | string | 是 | 項目 ID |
| schoolId | string | 否 | 學校 ID |

**回應範例**

```json
{
  "success": true,
  "favorited": true
}
```

### getFavorites (Callable)

取得收藏列表。

**參數**

| 參數 | 類型 | 必填 | 說明 |
|-----|-----|-----|-----|
| itemType | string | 否 | 篩選類型 |

**回應範例**

```json
{
  "favorites": [
    {
      "id": "announcement_123",
      "itemType": "announcement",
      "itemId": "123",
      "createdAt": "2024-01-15T10:00:00Z"
    }
  ]
}
```

---

## 餐廳訂餐

### createOrder (Callable)

建立訂單。

**參數**

| 參數 | 類型 | 必填 | 說明 |
|-----|-----|-----|-----|
| schoolId | string | 是 | 學校 ID |
| merchantId | string | 是 | 店家 ID |
| items | array | 是 | 訂購項目 |
| pickupTime | string | 否 | 取餐時間 |
| note | string | 否 | 備註 |
| paymentMethod | string | 否 | 支付方式 |

**items 格式**

```json
[
  {
    "menuItemId": "item1",
    "name": "雞排飯",
    "price": 80,
    "quantity": 1,
    "options": ["加辣"]
  }
]
```

**回應範例**

```json
{
  "success": true,
  "orderId": "order123",
  "total": 84
}
```

### updateOrderStatus (Callable)

更新訂單狀態（店家使用）。

**參數**

| 參數 | 類型 | 必填 | 說明 |
|-----|-----|-----|-----|
| schoolId | string | 是 | 學校 ID |
| orderId | string | 是 | 訂單 ID |
| status | string | 是 | 狀態 |

**狀態值**

- `confirmed` - 已確認
- `preparing` - 準備中
- `ready` - 可取餐
- `completed` - 已完成
- `cancelled` - 已取消

### cancelOrder (Callable)

取消訂單。

**參數**

| 參數 | 類型 | 必填 | 說明 |
|-----|-----|-----|-----|
| schoolId | string | 是 | 學校 ID |
| orderId | string | 是 | 訂單 ID |
| reason | string | 否 | 取消原因 |

---

## 宿舍服務

### submitRepairRequest (Callable)

提交報修請求。

**參數**

| 參數 | 類型 | 必填 | 說明 |
|-----|-----|-----|-----|
| schoolId | string | 是 | 學校 ID |
| dormitory | string | 是 | 宿舍名稱 |
| room | string | 是 | 房號 |
| category | string | 是 | 報修類別 |
| description | string | 是 | 問題描述 |
| urgency | string | 否 | 緊急程度 (low/normal/high) |
| images | array | 否 | 圖片 URL |

**回應範例**

```json
{
  "success": true,
  "requestId": "repair123"
}
```

### registerPackageArrival (Callable)

登記包裹到達（管理員使用）。

**參數**

| 參數 | 類型 | 必填 | 說明 |
|-----|-----|-----|-----|
| schoolId | string | 是 | 學校 ID |
| recipientId | string | 是 | 收件人 UID |
| trackingNumber | string | 否 | 追蹤號碼 |
| courier | string | 否 | 物流公司 |
| location | string | 否 | 放置地點 |
| locker | string | 否 | 置物櫃編號 |

### confirmPackagePickup (Callable)

確認領取包裹。

**參數**

| 參數 | 類型 | 必填 | 說明 |
|-----|-----|-----|-----|
| schoolId | string | 是 | 學校 ID |
| packageId | string | 是 | 包裹 ID |

### reserveWashingMachine (Callable)

預約洗衣機。

**參數**

| 參數 | 類型 | 必填 | 說明 |
|-----|-----|-----|-----|
| schoolId | string | 是 | 學校 ID |
| dormitory | string | 是 | 宿舍名稱 |
| machineId | string | 是 | 洗衣機 ID |
| startTime | string | 是 | 開始時間 |

---

## 列印服務

### submitPrintJob (Callable)

提交列印任務。

**參數**

| 參數 | 類型 | 必填 | 說明 |
|-----|-----|-----|-----|
| schoolId | string | 是 | 學校 ID |
| printerId | string | 是 | 印表機 ID |
| fileName | string | 是 | 檔案名稱 |
| fileUrl | string | 是 | 檔案 URL |
| copies | number | 否 | 份數（預設 1） |
| color | boolean | 否 | 彩色（預設 false） |
| duplex | boolean | 否 | 雙面（預設 false） |
| pages | number | 否 | 頁數（預設 1） |

**回應範例**

```json
{
  "success": true,
  "jobId": "job123",
  "cost": 5,
  "estimatedTime": 1
}
```

### cancelPrintJob (Callable)

取消列印任務。

**參數**

| 參數 | 類型 | 必填 | 說明 |
|-----|-----|-----|-----|
| schoolId | string | 是 | 學校 ID |
| jobId | string | 是 | 任務 ID |

---

## 健康中心

### bookHealthAppointment (Callable)

預約門診。

**參數**

| 參數 | 類型 | 必填 | 說明 |
|-----|-----|-----|-----|
| schoolId | string | 是 | 學校 ID |
| date | string | 是 | 日期 (YYYY-MM-DD) |
| time | string | 是 | 時間 (HH:mm) |
| department | string | 是 | 科別 |
| doctorId | string | 否 | 醫師 ID |
| symptoms | string | 否 | 症狀描述 |
| note | string | 否 | 備註 |

**回應範例**

```json
{
  "success": true,
  "appointmentId": "appt123"
}
```

### cancelHealthAppointment (Callable)

取消預約。

**參數**

| 參數 | 類型 | 必填 | 說明 |
|-----|-----|-----|-----|
| schoolId | string | 是 | 學校 ID |
| appointmentId | string | 是 | 預約 ID |
| reason | string | 否 | 取消原因 |

### getHealthRecords (Callable)

取得健康紀錄。

**參數**

| 參數 | 類型 | 必填 | 說明 |
|-----|-----|-----|-----|
| schoolId | string | 是 | 學校 ID |
| limit | number | 否 | 筆數限制（預設 20） |

---

## 校車服務

### getBusArrivals (Callable)

取得公車到站資訊。

**參數**

| 參數 | 類型 | 必填 | 說明 |
|-----|-----|-----|-----|
| schoolId | string | 是 | 學校 ID |
| stopId | string | 是 | 站點 ID |

**回應範例**

```json
{
  "arrivals": [
    {
      "id": "arr1",
      "routeId": "route1",
      "routeName": "校園環線",
      "stopId": "stop1",
      "stopName": "校門口",
      "estimatedArrival": "2024-01-15T10:35:00Z",
      "crowdLevel": "medium"
    }
  ]
}
```

### subscribeBusAlert (Callable)

訂閱到站提醒。

**參數**

| 參數 | 類型 | 必填 | 說明 |
|-----|-----|-----|-----|
| schoolId | string | 是 | 學校 ID |
| routeId | string | 是 | 路線 ID |
| stopId | string | 是 | 站點 ID |
| alertBefore | number | 否 | 提前幾分鐘提醒（預設 5） |

**回應範例**

```json
{
  "success": true,
  "alertId": "alert123"
}
```

### unsubscribeBusAlert (Callable)

取消訂閱到站提醒。

**參數**

| 參數 | 類型 | 必填 | 說明 |
|-----|-----|-----|-----|
| alertId | string | 是 | 提醒 ID |

---

## iCal 訂閱

### GET /calendarSubscribe

取得 iCal 格式行事曆。

**Query 參數**

| 參數 | 類型 | 必填 | 說明 |
|-----|-----|-----|-----|
| schoolId | string | 是 | 學校 ID |
| userId | string | 否 | 使用者 UID（取得個人化內容） |
| type | string | 否 | 類型 (all/events/assignments/registered) |

**回應**

Content-Type: `text/calendar`

可直接使用 webcal:// 訂閱或下載 .ics 檔案。

**範例 URL**

```
webcal://asia-east1-your-project.cloudfunctions.net/calendarSubscribe?schoolId=ntust&type=events
```

---

## 通知管理

### sendTestNotification (Callable)

發送測試通知。

**無需參數**

**回應範例**

```json
{
  "success": true,
  "sent": 1,
  "total": 1
}
```

### sendCustomNotification (Callable)

發送自訂通知（僅限管理員）。

**參數**

| 參數 | 類型 | 必填 | 說明 |
|-----|-----|-----|-----|
| targetUids | array | 是 | 目標使用者 UID 陣列 |
| title | string | 是 | 通知標題 |
| body | string | 是 | 通知內容 |
| data | object | 否 | 附加資料 |

---

## 錯誤代碼

| 代碼 | 說明 |
|-----|-----|
| unauthenticated | 未登入 |
| permission-denied | 權限不足 |
| not-found | 資源不存在 |
| already-exists | 資源已存在 |
| failed-precondition | 前置條件不滿足 |
| invalid-argument | 參數錯誤 |
| internal | 內部錯誤 |

---

## 版本歷史

### v2.6.0 (2026-03)

- 新增列印服務 API
- 新增健康中心預約 API
- 新增宿舍服務 API（報修、包裹、洗衣機）
- 新增校車到站提醒

### v2.5.0

- 新增 SSO 認證 API
- 新增 GDPR 資料匯出/刪除 API
- 新增圖書館服務 API

### v2.0.0

- 完整重構，使用 Firebase Functions v2
- 新增群組管理 API
- 新增收藏功能 API
- 新增訂餐 API
