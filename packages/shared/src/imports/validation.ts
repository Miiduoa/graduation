import {
  PERIOD_PROFILE_TITLES,
  isPeriodProfileId,
  mapClockToPeriodSlots,
  periodCount,
  periodLabelAt,
  periodSlots,
  periodTimes,
  type PeriodProfileId,
} from '../timetable/periods';
import type { ImportIssue, PersonalImportOptions, PersonalImportRow } from './types';

export function normalizePersonalImportText(value: string): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\uFEFF/g, '')
    .trim();
}

export function isPersonalImportDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1) return false;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= days;
}

export function isPersonalImportTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function profileOf(
  options: Pick<PersonalImportOptions, 'periodProfile'> = {},
): PeriodProfileId | undefined {
  return isPeriodProfileId(options.periodProfile) ? options.periodProfile : undefined;
}

function periodGuide(profile: PeriodProfileId): string {
  const labels = periodSlots(profile).map((slot) => slot.label).join('、');
  return `${PERIOD_PROFILE_TITLES[profile]}節次 ${labels}`;
}

/** Only exact period boundaries are converted; a nearby clock time is not evidence of a period. */
export function mapPersonalImportPeriods(
  row: PersonalImportRow,
  options: Pick<PersonalImportOptions, 'periodProfile'> = {},
): PersonalImportRow {
  const profile = profileOf(options);
  if (row.kind !== 'timetable' || !profile) return row;
  const mapped = mapClockToPeriodSlots(row.startTime, row.endTime, profile);
  // A complete clock range can remain outside the grid. Mapping just one end
  // would turn an otherwise valid range into an incomplete period selection.
  if (!mapped.start || !mapped.end) return row;
  return {
    ...row,
    ...(row.startPeriod === undefined && mapped.start ? { startPeriod: mapped.start } : {}),
    ...(row.endPeriod === undefined && mapped.end ? { endPeriod: mapped.end } : {}),
  };
}

export function validatePersonalImportRow(
  row: PersonalImportRow,
  options: Pick<PersonalImportOptions, 'periodProfile'> = {},
): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const error = (code: string, field: keyof PersonalImportRow, message: string) =>
    issues.push({ code, field, message, severity: 'error', rowId: row.id });
  if (!row || typeof row !== 'object')
    return [
      { code: 'invalid-row', severity: 'error', message: '資料格式不完整，請重新建立草稿。' },
    ];
  for (const field of ['id', 'title', 'schoolId', 'academicYear', 'semester'] as const) {
    if (typeof row[field] !== 'string')
      error('invalid-field-type', field, '欄位格式不正確，請重新確認資料。');
  }
  for (const field of [
    'courseCode',
    'teacher',
    'className',
    'location',
    'linkedCourseId',
    'startTime',
    'endTime',
    'grade',
    'date',
    'endDate',
    'periodLabel',
  ] as const) {
    if (row[field] !== undefined && typeof row[field] !== 'string')
      error('invalid-field-type', field, '欄位格式不正確，請重新確認資料。');
  }
  if (row.allDay !== undefined && typeof row.allDay !== 'boolean')
    error('invalid-field-type', 'allDay', '請確認是否為全天活動。');
  if (issues.length) return issues;
  if (!['timetable', 'grades', 'events'].includes(row.kind))
    error('invalid-kind', 'kind', '請選擇資料種類。');
  if (!row.id?.trim()) error('missing-id', 'id', '這筆資料缺少識別碼，請重新建立草稿。');
  if (!row.title?.trim()) error('missing-title', 'title', '請填寫課程或活動名稱。');
  if (row.title?.length > 200) error('long-title', 'title', '名稱請縮短至 200 個字以內。');
  if (!row.schoolId?.trim()) error('missing-school', 'schoolId', '請選擇這份資料所屬的學校。');
  if (row.kind !== 'events') {
    if (!/^\d{2,4}$/.test(row.academicYear))
      error('invalid-year', 'academicYear', '請填寫學年度，例如 115 或 2026。');
    if (!row.semester?.trim() || row.semester.length > 30)
      error('invalid-semester', 'semester', '請填寫學期。');
  }
  for (const field of [
    'courseCode',
    'teacher',
    'className',
    'location',
    'linkedCourseId',
    'periodLabel',
  ] as const) {
    if (row[field] && row[field]!.length > 300)
      error('long-field', field, '欄位內容請縮短至 300 個字以內。');
  }
  if (row.kind === 'timetable') {
    const mapped = mapPersonalImportPeriods(row, options);
    const profile = profileOf(options);
    const slots = profile ? periodCount(profile) : undefined;
    if (!Number.isInteger(row.dayOfWeek) || row.dayOfWeek! < 1 || row.dayOfWeek! > 7)
      error(
        'invalid-weekday',
        'dayOfWeek',
        '請確認上課日（星期一至日）。',
      );
    const hasPeriods = mapped.startPeriod !== undefined || mapped.endPeriod !== undefined;
    const hasClockRange = !!row.startTime && !!row.endTime;
    if (hasPeriods || (!hasClockRange && (profile || !row.periodLabel?.trim()))) {
      for (const field of ['startPeriod', 'endPeriod'] as const) {
        if (
          !Number.isInteger(mapped[field]) ||
          mapped[field]! < 1 ||
          mapped[field]! > (slots ?? 99)
        )
          error(
            'invalid-period',
            field,
            profile
              ? `請確認${periodGuide(profile)}；時間不符節次時需要手動修正。`
              : '請確認學校原始節次，或改填完整上課時間。',
          );
      }
    }
    if (
      mapped.startPeriod !== undefined &&
      mapped.endPeriod !== undefined &&
      mapped.startPeriod > mapped.endPeriod
    )
      error('reversed-periods', 'endPeriod', '結束節次不能早於開始節次。');
    for (const field of ['startTime', 'endTime'] as const) {
      if (row[field] && !isPersonalImportTime(row[field]!))
        error('invalid-time', field, '時間格式請使用 24 小時制，例如 09:10。');
      if (!profile && !hasPeriods && !row.periodLabel?.trim() && !row[field])
        error('missing-time', field, '請填寫完整的開始與結束時間。');
    }
    if (row.startTime && row.endTime && row.endTime <= row.startTime)
      error('reversed-times', 'endTime', '結束時間必須晚於開始時間。');
    if (profile) {
      const times = periodTimes(profile);
      if (
        row.startTime &&
        mapped.startPeriod &&
        times[mapped.startPeriod - 1]?.[0] !== row.startTime
      )
        error(
          'period-time-conflict',
          'startTime',
          `開始時間與所選節次（${periodLabelAt(mapped.startPeriod, profile)}）不一致，請確認。`,
        );
      if (
        row.endTime &&
        mapped.endPeriod &&
        times[mapped.endPeriod - 1]?.[1] !== row.endTime
      )
        error(
          'period-time-conflict',
          'endTime',
          `結束時間與所選節次（${periodLabelAt(mapped.endPeriod, profile)}）不一致，請確認。`,
        );
    } else {
      issues.push({
        code: 'personal-timetable-only',
        severity: 'warning',
        rowId: row.id,
        message: '已保留原始時間與節次；這所學校尚未設定課表格線，不會換算成節次格子。',
      });
    }
  }
  if (row.kind === 'grades') {
    if (!Number.isFinite(row.credits) || row.credits! < 0 || row.credits! > 40)
      error('invalid-credits', 'credits', '請填寫原始成績單上的學分數（0 至 40）。');
    if (!row.grade?.trim()) error('missing-grade', 'grade', '請填寫原始成績，例如 85、A 或通過。');
    else if (row.grade.length > 40) error('invalid-grade', 'grade', '成績內容過長，請確認欄位。');
    else if (
      /^-?\d+(?:\.\d+)?$/.test(row.grade) &&
      (Number(row.grade) < 0 || Number(row.grade) > 100)
    )
      error('invalid-grade', 'grade', '數字成績應介於 0 至 100；其他計分制請保留原始文字並確認。');
  }
  if (row.kind === 'events') {
    if (!row.date || !isPersonalImportDate(row.date))
      error('invalid-date', 'date', '請填寫完整且有效的日期，例如 2026-10-20。');
    if (row.endDate && !isPersonalImportDate(row.endDate))
      error('invalid-date', 'endDate', '請確認活動結束日期。');
    if (!row.allDay) {
      for (const field of ['startTime', 'endTime'] as const) {
        if (!row[field] || !isPersonalImportTime(row[field]!))
          error('invalid-time', field, '請填寫 24 小時制時間，例如 18:00。');
      }
      if (
        row.date &&
        row.startTime &&
        row.endTime &&
        `${row.endDate || row.date}T${row.endTime}` <= `${row.date}T${row.startTime}`
      )
        error('reversed-event', 'endTime', '結束時間必須晚於開始時間；跨日活動請補上結束日期。');
    } else {
      if (row.startTime || row.endTime)
        error('all-day-time-conflict', 'allDay', '全天活動不需要時間；請清除時間或取消全天。');
      if (row.endDate && row.date && row.endDate <= row.date)
        error('reversed-event', 'endDate', '全天活動的結束日期不包含當天，必須晚於開始日期。');
    }
  }
  if (row.kind !== 'events' && !row.courseCode?.trim())
    issues.push({
      code: 'missing-course-code',
      severity: 'warning',
      field: 'courseCode',
      rowId: row.id,
      message: '沒有課號，先保留為個人資料；不會自動連結到同名課程。',
    });
  return issues;
}
