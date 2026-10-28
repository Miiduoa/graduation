/** 校方學分試算表的累計欄位；小計不能作為畢業採計或審核結果。 */
export const PU_CREDIT_OVERVIEW_FIELDS = [
  'required', 'elective', 'externalElective', 'generalOld', 'generalNew',
  'subtotal', 'totalRequired', 'minorDouble',
] as const;

export type PuCreditOverviewField = typeof PU_CREDIT_OVERVIEW_FIELDS[number];
export type PuCreditOverview = {
  version: 1;
  source: 'pu-credit-review';
  totals: Record<PuCreditOverviewField, number | null>;
  coverage: { status: 'complete' | 'partial'; missingFields: PuCreditOverviewField[] };
};

export type PuCreditOverviewSnapshot = {
  ownerUid: string;
  schoolId: 'pu';
  fetchedAt: string;
  overview: PuCreditOverview;
};

export const PU_CREDIT_OVERVIEW_LABELS: Record<PuCreditOverviewField, string> = {
  required: '必修', elective: '選修', externalElective: '外系選修',
  generalOld: '通識・六大學群', generalNew: '通識・四大向度',
  subtotal: '校方回報學分小計', totalRequired: '校方列示畢業應修總學分', minorDouble: '輔系／雙主修',
};

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** 驗證已解析的數值，並只留下公開欄位；缺值與校方明示的 0 分開處理。 */
export function normalizePuCreditOverview(value: unknown): PuCreditOverview | null {
  const row = object(value);
  const rawTotals = object(row?.totals);
  const coverage = object(row?.coverage);
  if (row?.version !== 1 || row.source !== 'pu-credit-review' || !rawTotals || !coverage)
    return null;
  const totals = {} as PuCreditOverview['totals'];
  for (const field of PU_CREDIT_OVERVIEW_FIELDS) {
    const amount = rawTotals[field];
    if (amount !== null && (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 1000))
      return null;
    totals[field] = amount as number | null;
  }
  const missingFields = PU_CREDIT_OVERVIEW_FIELDS.filter((field) => totals[field] === null);
  if (missingFields.length === PU_CREDIT_OVERVIEW_FIELDS.length ||
      !Array.isArray(coverage.missingFields) ||
      coverage.missingFields.length !== missingFields.length ||
      new Set(coverage.missingFields).size !== missingFields.length ||
      coverage.missingFields.some((field) => !missingFields.includes(field as PuCreditOverviewField)) ||
      coverage.status !== (missingFields.length ? 'partial' : 'complete')) return null;
  return {
    version: 1, source: 'pu-credit-review', totals,
    coverage: { status: missingFields.length ? 'partial' : 'complete', missingFields },
  };
}

export const PU_CREDIT_REVIEW_URL = 'https://alcat.pu.edu.tw/grade_review/main.php';
export const PU_CREDIT_OVERVIEW_NOTE =
  '校方小計為成績及格取得的學分，不等於畢業採計。各類別依校方原欄位列示，不自行相加；抵免、重修、外系上限及畢業條件仍須核對校方審核。';
