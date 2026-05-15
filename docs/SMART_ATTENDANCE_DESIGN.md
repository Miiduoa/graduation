# 智慧點名設計：TronClass parity + 4 點超越

> 對應引擎：`packages/shared/src/lms/attendanceEngine.ts`
> 對應測試：17 條全綠

## 一、TronClass vs 我們

| 維度 | TronClass | 我們 |
|------|-----------|------|
| 點名方式數 | 3 | **5（多 selfie + multi-factor）** |
| QR 防截圖 | 一次性 QR | **rotating QR（每 3 秒一新）** |
| 反作弊機制 | 基本驗證 | **5 種旗標 + 智慧分析** |
| 出席分析 | 出席率統計 | **習慣性遲到時段偵測、連續缺席警告、AI 推送介入** |
| 後端依賴 | 強依賴 | **純函式引擎，mobile / cloud / web 共用** |

## 二、5 種點名方式

### 1. rotating_qr 動態 QR Code（推薦課堂用）

教師端每 3 秒輪轉一組 QR Code（基於 HOTP-like 演算法 + session secret）。

```ts
import { buildRotatingQrToken } from '@campus/shared';
const token = buildRotatingQrToken(secret, Date.now());
// 學生掃到的 QR 是 'A1B2C3' 這種 6 位 token
```

**防截圖外流**：學生不能截圖傳給沒到場的同學——3 秒就失效。容忍 ±3 秒 clock skew。

### 2. number_code 數字密碼（無相機 fallback）

教師唸 4-6 位代碼，學生輸入。適合大教室、相機不便。

### 3. geofence 地理圍欄

學生 GPS ≤ 教室半徑（預設 50m）才通過。haversine 距離計算純函式。

**反作弊**：
- GPS accuracy > 50m → 標 `low_gps_accuracy`
- 距離超過半徑 → `far_from_classroom`

### 4. selfie_liveness 自拍活體（超越 TronClass）

學生拍自拍 → 跟註冊照算相似度。閾值預設 0.7。

**防代簽**：相似度 < 閾值 → 標 `proxy_attendance_risk`。可選地：拍 1 秒短影片 + 眨眼偵測。

### 5. multi_factor 多重驗證（高利害場合）

期中考 / 期末考用：要求**同時** QR + GPS 通過才算簽到。

```ts
verifyAttendance(claim, {
  method: 'multi_factor',
  multiFactorMethods: ['rotating_qr', 'geofence'],
  geo: { lat, lng, radiusMeters: 30 },
  secret: '...',
  ...
})
```

## 三、智慧分析（這是真正超越的部分）

`analyzeAttendancePattern(records[])` 回傳：

```ts
{
  attendanceRate: 0.78,
  consecutiveAbsent: 2,
  consecutiveLate: 1,
  habituallyLateTimeSlot: '0900',  // 早八常遲到
  alerts: [
    { kind: 'consec_absent', severity: 'medium', message: '已連續 2 次缺席' },
    { kind: 'habitual_late_slot', severity: 'low', message: '09:00 的課常遲到（3 次）' },
  ]
}
```

**4 種智慧警示：**

| 警示 | 觸發條件 | 嚴重度 |
|------|---------|-------|
| consec_absent | 連續缺席 ≥ 2 次 | medium / high |
| consec_late | 連續遲到 ≥ 3 次 | medium |
| habitual_late_slot | 同一時段遲到 ≥ 3 次 | low |
| attendance_low | 出席率 < 70% / < 50% | medium / high |

**串接到既有系統：**
- 警示 → 寫入學習風險雷達（riskRadar）
- 警示 → 觸發精靈 careHint（careHint.kind = 'rest'）→ 用 wellbeing 文案說「最近早八起不來？」
- 警示 → 寫進 inbox 卡片給導師（dept_head 也看得到）

## 四、反作弊旗標完整清單

| 旗標 | 觸發 | 處理 |
|------|------|------|
| `stale_or_forged_qr` | QR token 過期 / 不符 | reject |
| `code_mismatch` | 數字代碼錯 | reject |
| `far_from_classroom` | GPS 超出半徑 | reject |
| `low_gps_accuracy` | GPS accuracy > 50m | warn 但通過 |
| `proxy_attendance_risk` | selfie 相似度不足 | reject |
| `config_error` | session 設定缺欄位 | reject + 通知老師 |
| `session_closed` | 簽到時間超過關門時間 | absent |

## 五、純函式設計（不依賴後端就能跑）

`attendanceEngine.ts` 不碰 I/O。所有驗證、距離計算、模式分析都是純函式。

優點：
1. mobile / cloud function / web 教師端共用
2. 寫單元測試非常簡單（已有 17 條）
3. 學生離線時仍可預先驗證輸入是否正確（避免提交無效 claim）

## 六、整合點

### Mobile（學生端）
- `AttendanceLiveScreen` 依老師指定的 `method` 渲染對應 UI：相機掃 QR / 文字框輸入碼 / 地圖確認位置 / 拍照
- 驗證通過後本地呼叫 `verifyAttendance()` 預檢，再上傳 cloud function
- 寫入 companion signal（`onAttendanceCheckin`）+ 全勤光環成就

### Mobile（教師端）
- `AttendanceLiveScreen` 教師模式：選方法、開啟 session、看即時簽到列表 + 反作弊 flag

### Cloud Function
- `joinLiveSession` callable：server-side 再跑一次 `verifyAttendance()` 確保不被 client 端繞過

### Web 教師端
- `/teacher/course/[id]/attendance` 已存在；可顯示「智慧分析」面板

## 七、測試覆蓋

17 條測試覆蓋：
- rotating_qr 4 條（正常 / token 過期 / 遲到 / 關門後）
- number_code 2 條
- geofence 3 條
- selfie_liveness 2 條
- multi_factor 2 條
- analyzeAttendancePattern 4 條

## 八、口試一句話

> 「我們的智慧點名做了 TronClass 的 3 種（QR、數字、GPS）再加 2 種（selfie 活體、multi-factor），加上純函式的智慧分析引擎，能偵測習慣性遲到時段、連續缺席並串接到學習風險雷達。這對教學現場最有用的不是『又一個點名工具』，而是『點名資料能變成學業預警』。」
