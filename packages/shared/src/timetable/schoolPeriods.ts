export const PERIOD_PROFILE_IDS = ['pu', 'ncku', 'ntpu'] as const;
export type PeriodProfileId = (typeof PERIOD_PROFILE_IDS)[number];

export type SchoolPeriodSlot = {
  index: number;
  label: string;
  start: string;
  end: string;
};

export const PERIOD_PROFILE_SOURCES: Record<PeriodProfileId, { label: string; url: string }> = {
  pu: {
    label: '靜宜大學第 1–13 節',
    url: 'https://acd.pu.edu.tw/',
  },
  ncku: {
    label: '國立成功大學課程／節次時間對照表（113 學年度第 2 學期起）',
    url: 'https://cid-acad.ncku.edu.tw/var/file/42/1042/img/761/1132-TIME.pdf',
  },
  ntpu: {
    label: '國立臺北大學課程查詢系統節次說明',
    url: 'https://sea.cc.ntpu.edu.tw/pls/dev_stud/course_query_eng.time_memo',
  },
};

export const PERIOD_PROFILE_TITLES: Record<PeriodProfileId, string> = {
  pu: '靜宜大學',
  ncku: '國立成功大學',
  ntpu: '國立臺北大學',
};

function slots(rows: ReadonlyArray<readonly [string, string, string]>): readonly SchoolPeriodSlot[] {
  return rows.map(([label, start, end], index) => ({
    index: index + 1,
    label,
    start,
    end,
  }));
}

export const PERIOD_PROFILES: Record<PeriodProfileId, readonly SchoolPeriodSlot[]> = {
  pu: slots([
    ['1', '08:10', '09:00'],
    ['2', '09:10', '10:00'],
    ['3', '10:10', '11:00'],
    ['4', '11:10', '12:00'],
    ['5', '13:10', '14:00'],
    ['6', '14:10', '15:00'],
    ['7', '15:10', '16:00'],
    ['8', '16:10', '17:00'],
    ['9', '17:10', '18:00'],
    ['10', '18:05', '18:55'],
    ['11', '19:00', '19:50'],
    ['12', '19:55', '20:45'],
    ['13', '20:50', '21:40'],
  ]),
  ncku: slots([
    ['0', '07:00', '07:50'],
    ['1', '08:00', '08:50'],
    ['2', '09:00', '09:50'],
    ['3', '10:10', '11:00'],
    ['4', '11:10', '12:00'],
    ['N', '12:10', '13:00'],
    ['5', '13:10', '14:00'],
    ['6', '14:10', '15:00'],
    ['7', '15:20', '16:10'],
    ['8', '16:20', '17:10'],
    ['9', '17:20', '18:10'],
    ['A', '18:20', '19:10'],
    ['B', '19:15', '20:05'],
    ['C', '20:10', '21:00'],
    ['D', '21:05', '21:55'],
  ]),
  ntpu: slots([
    ['1', '08:10', '09:00'],
    ['2', '09:10', '10:00'],
    ['3', '10:10', '11:00'],
    ['4', '11:10', '12:00'],
    ['5', '13:10', '14:00'],
    ['6', '14:10', '15:00'],
    ['7', '15:10', '16:00'],
    ['8', '16:10', '17:00'],
    ['9', '17:10', '18:00'],
    ['10', '18:30', '19:20'],
    ['11', '19:25', '20:15'],
    ['12', '20:25', '21:15'],
    ['13', '21:20', '22:10'],
  ]),
};

export const MAX_PERIOD_SLOTS = Math.max(
  ...Object.values(PERIOD_PROFILES).map((rows) => rows.length),
);

const SCHOOL_PROFILE: Record<string, PeriodProfileId> = {
  pu: 'pu',
  'tw-pu': 'pu',
  ncku: 'ncku',
  ntpu: 'ntpu',
};

export function isPeriodProfileId(value: unknown): value is PeriodProfileId {
  return value === 'pu' || value === 'ncku' || value === 'ntpu';
}

export function periodProfileForSchool(schoolId?: string | null): PeriodProfileId | undefined {
  const id = String(schoolId ?? '').trim();
  return Object.prototype.hasOwnProperty.call(SCHOOL_PROFILE, id) ? SCHOOL_PROFILE[id] : undefined;
}

export function periodSlots(profile: PeriodProfileId = 'pu'): readonly SchoolPeriodSlot[] {
  return PERIOD_PROFILES[profile];
}

export function periodTimes(
  profile: PeriodProfileId = 'pu',
): ReadonlyArray<readonly [string, string]> {
  return periodSlots(profile).map((slot) => [slot.start, slot.end] as const);
}

export function periodCount(profile: PeriodProfileId = 'pu'): number {
  return periodSlots(profile).length;
}

export function periodLabelAt(period: number, profile: PeriodProfileId = 'pu'): string {
  return periodSlots(profile)[period - 1]?.label ?? String(period);
}

export function periodDisplayLabel(period: number, profile: PeriodProfileId = 'pu'): string {
  const slot = periodSlots(profile)[period - 1];
  if (!slot) return `第 ${period} 節`;
  if (profile === 'ncku') return `${slot.label} 節 · ${slot.start}`;
  return `第 ${slot.label} 節 · ${slot.start}`;
}

function labelIndex(profile: PeriodProfileId): Map<string, number> {
  return new Map(periodSlots(profile).map((slot) => [slot.label.toUpperCase(), slot.index]));
}

export function slotIndexForLabel(
  value: string | number,
  profile: PeriodProfileId,
): number | undefined {
  const label = String(value ?? '')
    .trim()
    .replace(/^第/, '')
    .replace(/節$/, '')
    .toUpperCase();
  if (!label) return undefined;
  return labelIndex(profile).get(label);
}

function tokenPattern(profile: PeriodProfileId): string {
  if (profile === 'ncku') return '0|[1-9]|[NABCD]';
  return '[1-9]|1[0-3]';
}

export function parsePeriodRange(
  value: string,
  profile: PeriodProfileId,
): { start: number; end: number; text: string } | null {
  const clean = String(value ?? '')
    .normalize('NFKC')
    .trim();
  if (!clean) return null;
  const token = tokenPattern(profile);
  const range = new RegExp(
    `^(?:第\\s*)?(${token})(?:\\s*節)?\\s*[-–—~～至到]\\s*(?:第\\s*)?(${token})(?:\\s*節)?$`,
    'i',
  ).exec(clean);
  if (range) {
    const start = slotIndexForLabel(range[1], profile);
    const end = slotIndexForLabel(range[2], profile);
    if (start && end && end >= start) return { start, end, text: range[0] };
    return null;
  }
  const single = new RegExp(`^(?:第\\s*)?(${token})(?:\\s*節)?$`, 'i').exec(clean);
  if (single) {
    const start = slotIndexForLabel(single[1], profile);
    if (start) return { start, end: start, text: single[0] };
  }
  const brackets = clean.match(new RegExp(`\\[(${token})\\]`, 'gi'));
  if (brackets && brackets.length) {
    const indexes = brackets
      .map((item) => slotIndexForLabel(item.replace(/[\[\]]/g, ''), profile))
      .filter((item): item is number => typeof item === 'number');
    if (indexes.length && indexes.every((item, i) => i === 0 || item === indexes[i - 1] + 1)) {
      return { start: indexes[0], end: indexes[indexes.length - 1], text: clean };
    }
  }
  return null;
}

export function mapClockToPeriodSlots(
  startTime: string | undefined,
  endTime: string | undefined,
  profile: PeriodProfileId,
): { start?: number; end?: number } {
  const times = periodTimes(profile);
  const start = startTime ? times.findIndex(([time]) => time === startTime) : -1;
  const end = endTime ? times.findIndex(([, time]) => time === endTime) : -1;
  return {
    ...(start >= 0 ? { start: start + 1 } : {}),
    ...(end >= 0 ? { end: end + 1 } : {}),
  };
}
