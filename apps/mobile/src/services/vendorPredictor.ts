/**
 * Vendor Predictor — 餐廳營運預測引擎（純函式）
 *
 * 設計動機（見 docs/REALITY_AUDIT_2026_05_15.md adjustment 4）：
 *   原 aiVendorNextAction 的建議常常是「該補貨」「準備餐」之類老闆早就知道的廢話。
 *   真實 ROI 高的建議是基於 weekly pattern 的 **預測**：
 *     「上週同時段你賣 26 份，目前少 30%（18 份），預計 13:00 會回升到 20 份」
 *     「上週週三 12:00-13:00 峰值是 14 單／30 分；今天 12:15 已收 11 單 → 比預期快 18%」
 *
 * 接到 UI 後，餐廳老闆能在中午前就知道今天是「特殊日」還是「正常日」，提早調整人力 / 備料。
 *
 * 純函式：給歷史 weekly snapshot + 今日當下進度 → 回傳預測級建議
 */

export interface VendorHourBucket {
  /** 0-167，week-hour index（0=週日 00:00） */
  weekHour: number;
  orderCount: number;
  revenue: number;
}

export interface VendorHistory {
  /** 過去 N 週的 hourly bucket（按 weekHour 平均） */
  weeklyAverage: VendorHourBucket[];
  /** 樣本週數（信心度用） */
  sampleWeeks: number;
}

export interface TodaySoFar {
  /** 今日各 hour 已收訂單（依 weekHour 對齊） */
  hourlyOrders: VendorHourBucket[];
  /** 當下時間 */
  now: Date;
}

export type VendorInsightKind =
  | 'on_track'         // 在預期範圍（±15%）
  | 'overperforming'   // 比預期多 15%+
  | 'underperforming'  // 比預期少 15%+
  | 'peak_starting'    // 預期 30 分內進尖峰
  | 'peak_ending'      // 預期 30 分內離尖峰
  | 'unusual_pattern'  // 與歷史差距 > 50%，建議檢查（活動 / 雨天 / 系統異常）
  | 'insufficient_data'; // 樣本太少

export interface VendorInsight {
  kind: VendorInsightKind;
  /** 0-100 信心 */
  confidence: number;
  /** 人話標題（給 hero / push） */
  title: string;
  /** 人話 body（給 dashboard） */
  body: string;
  /** 數字佐證（給「為什麼？」展開） */
  evidence: {
    historicalAverage?: number;
    currentValue?: number;
    deviationPercent?: number;
    expectedNextHour?: number;
  };
}

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

export function currentWeekHour(now: Date): number {
  return now.getDay() * 24 + now.getHours();
}

export function sumOrdersInWindow(buckets: VendorHourBucket[], from: number, to: number): number {
  return buckets
    .filter((b) => b.weekHour >= from && b.weekHour < to)
    .reduce((a, b) => a + b.orderCount, 0);
}

export function findPeakHours(weekly: VendorHourBucket[]): number[] {
  if (weekly.length === 0) return [];
  const sorted = [...weekly].sort((a, b) => b.orderCount - a.orderCount);
  const threshold = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.15))]?.orderCount ?? 0;
  return weekly.filter((b) => b.orderCount >= threshold && b.orderCount > 0).map((b) => b.weekHour);
}

// ─────────────────────────────────────────────────────────
// 主入口
// ─────────────────────────────────────────────────────────

export function predictVendorStatus(
  history: VendorHistory,
  today: TodaySoFar,
): VendorInsight {
  const { sampleWeeks, weeklyAverage } = history;

  if (sampleWeeks < 2 || weeklyAverage.length === 0) {
    return {
      kind: 'insufficient_data',
      confidence: 0,
      title: '資料不足，先觀察一陣子',
      body: `目前只累積 ${sampleWeeks} 週歷史，至少需要 2 週才開始給預測建議。`,
      evidence: {},
    };
  }

  const now = today.now;
  const curHour = currentWeekHour(now);

  // 1. 比較「今日截至目前 vs 歷史同時段截至同小時」
  //    取 (週幾 00:00 到 currentHour) 的累積數
  const dayStart = now.getDay() * 24;
  const histDayCumulative = sumOrdersInWindow(weeklyAverage, dayStart, curHour + 1);
  const todayCumulative = today.hourlyOrders.reduce((a, b) => a + b.orderCount, 0);

  if (histDayCumulative === 0 && todayCumulative === 0) {
    return {
      kind: 'on_track',
      confidence: 70,
      title: '尚無歷史資料 / 今日尚未開賣',
      body: '今日尚未進入該時段的歷史峰值。',
      evidence: { historicalAverage: 0, currentValue: 0 },
    };
  }

  const deviationPercent = histDayCumulative > 0
    ? Math.round(((todayCumulative - histDayCumulative) / histDayCumulative) * 100)
    : 0;

  // 2. 預測下一小時
  const nextHourBucket = weeklyAverage.find((b) => b.weekHour === curHour + 1);
  const expectedNextHour = nextHourBucket?.orderCount ?? 0;

  // 3. 判斷尖峰開始 / 結束
  const peakHours = findPeakHours(weeklyAverage);
  const isCurrentPeak = peakHours.includes(curHour);
  const isNextPeak = peakHours.includes(curHour + 1);
  const isPrevPeak = peakHours.includes(curHour - 1);

  // 信心度依樣本數
  const baseConfidence = Math.min(90, 30 + sampleWeeks * 10);

  // 邏輯分支：
  // - |deviation| > 50 → unusual_pattern
  // - !isCurrentPeak && isNextPeak → peak_starting
  // - isCurrentPeak && !isNextPeak && isPrevPeak → peak_ending（已在尖峰末端）
  // - deviation > 15 → overperforming
  // - deviation < -15 → underperforming
  // - 其他 → on_track

  if (Math.abs(deviationPercent) > 50) {
    return {
      kind: 'unusual_pattern',
      confidence: baseConfidence,
      title: deviationPercent > 0 ? `🔥 今天爆量！比平常多 ${deviationPercent}%` : `⚠ 今天異常清淡，比平常少 ${Math.abs(deviationPercent)}%`,
      body: `歷史同時段 ${histDayCumulative} 單，今日 ${todayCumulative} 單。可能是活動 / 天氣 / 系統異常，建議檢查。`,
      evidence: {
        historicalAverage: histDayCumulative,
        currentValue: todayCumulative,
        deviationPercent,
        expectedNextHour,
      },
    };
  }

  if (!isCurrentPeak && isNextPeak) {
    return {
      kind: 'peak_starting',
      confidence: baseConfidence,
      title: `⏰ 30 分鐘內進尖峰，預期 ${expectedNextHour} 單`,
      body: `下一小時通常是 ${expectedNextHour} 單峰值。建議現在備餐 + 開出第二爐。`,
      evidence: {
        historicalAverage: histDayCumulative,
        currentValue: todayCumulative,
        deviationPercent,
        expectedNextHour,
      },
    };
  }

  if (isCurrentPeak && !isNextPeak) {
    return {
      kind: 'peak_ending',
      confidence: baseConfidence,
      title: '🏁 30 分鐘內離尖峰',
      body: '本時段尖峰即將結束，可開始收拾 + 安排下一時段準備。',
      evidence: {
        historicalAverage: histDayCumulative,
        currentValue: todayCumulative,
        deviationPercent,
        expectedNextHour,
      },
    };
  }

  if (deviationPercent > 15) {
    return {
      kind: 'overperforming',
      confidence: baseConfidence,
      title: `📈 比預期快 ${deviationPercent}%`,
      body: `歷史同時段 ${histDayCumulative} 單，今日已 ${todayCumulative}。下一小時預計 ${expectedNextHour} 單，建議加快備餐節奏。`,
      evidence: {
        historicalAverage: histDayCumulative,
        currentValue: todayCumulative,
        deviationPercent,
        expectedNextHour,
      },
    };
  }

  if (deviationPercent < -15) {
    return {
      kind: 'underperforming',
      confidence: baseConfidence,
      title: `📉 比預期慢 ${Math.abs(deviationPercent)}%`,
      body: `歷史同時段 ${histDayCumulative} 單，今日 ${todayCumulative}。下一小時預計 ${expectedNextHour} 單，可考慮推回頭客 loyalty 訊息。`,
      evidence: {
        historicalAverage: histDayCumulative,
        currentValue: todayCumulative,
        deviationPercent,
        expectedNextHour,
      },
    };
  }

  return {
    kind: 'on_track',
    confidence: baseConfidence,
    title: '✅ 進度與往常一致',
    body: `歷史 ${histDayCumulative} vs 今日 ${todayCumulative}（差 ${deviationPercent}%）。下一小時預計 ${expectedNextHour} 單。`,
    evidence: {
      historicalAverage: histDayCumulative,
      currentValue: todayCumulative,
      deviationPercent,
      expectedNextHour,
    },
  };
}
