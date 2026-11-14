import type { PersonalImportRecord } from './imports/types';
import { taipeiParts } from './taipeiTime';

export const CAMPUS_STAGE_OPTIONS = [
  { value: 'unspecified', label: '先不設定' },
  { value: 'year-1', label: '大一' },
  { value: 'year-2', label: '大二' },
  { value: 'year-3', label: '大三' },
  { value: 'year-4', label: '大四以上' },
  { value: 'graduate', label: '研究生' },
  { value: 'other', label: '其他身分' },
] as const;
export const CAMPUS_FOCUS_OPTIONS = [
  { value: 'balanced', label: '課業與生活' },
  { value: 'study', label: '課業優先' },
  { value: 'life', label: '生活優先' },
] as const;
export const CAMPUS_LIVING_OPTIONS = [
  { value: 'unspecified', label: '先不設定' },
  { value: 'commute', label: '通勤' },
  { value: 'dorm', label: '學校宿舍' },
  { value: 'off-campus', label: '校外居住' },
] as const;
export const CAMPUS_GOAL_OPTIONS = [
  { value: 'settle-in', label: '熟悉校園' },
  { value: 'coursework', label: '跟上課業' },
  { value: 'project', label: '專題與合作' },
  { value: 'internship', label: '準備實習' },
  { value: 'graduate-study', label: '準備升學' },
  { value: 'career', label: '準備求職' },
  { value: 'campus-life', label: '參與校園生活' },
] as const;
export const CAMPUS_PHASE_OPTIONS = [
  { value: 'orientation', label: '開學準備' },
  { value: 'midterms', label: '期中準備' },
  { value: 'finals', label: '期末準備' },
  { value: 'break', label: '假期安排' },
] as const;

type OptionValue<T extends readonly { value: string }[]> = T[number]['value'];
export type CampusStage = OptionValue<typeof CAMPUS_STAGE_OPTIONS>;
export type CampusFocus = OptionValue<typeof CAMPUS_FOCUS_OPTIONS>;
export type CampusLiving = OptionValue<typeof CAMPUS_LIVING_OPTIONS>;
export type CampusGoal = OptionValue<typeof CAMPUS_GOAL_OPTIONS>;
export type CampusPhaseKind = OptionValue<typeof CAMPUS_PHASE_OPTIONS>;

/** Self-described interests only; this shape never establishes membership or authority. */
export type CampusPersonalizationPreferences = {
  version: 1;
  stage: CampusStage;
  focus: CampusFocus;
  living: CampusLiving;
  goals: CampusGoal[];
  phaseOverride: {
    kind: CampusPhaseKind;
    startDate: string;
    /** Inclusive, unlike the exclusive endDate of an imported all-day event. */
    endDate: string;
  } | null;
  configured: boolean;
};

export type CampusRecommendation = {
  id: string;
  title: string;
  description: string;
  reason: string;
  href: string;
  category: 'study' | 'life' | 'growth';
};
export type CampusRecommendationResult = {
  phase: {
    kind: CampusPhaseKind | 'regular';
    label: string;
    reason: string;
    source: 'manual' | 'event' | 'default';
  };
  recommendations: CampusRecommendation[];
};

const DAY_MS = 86_400_000;
const OFFSET_MS = 8 * 60 * 60 * 1000;
const PHASE_LABELS: Record<CampusPhaseKind | 'regular', string> = {
  regular: '日常安排',
  orientation: '開學準備',
  midterms: '期中準備',
  finals: '期末準備',
  break: '假期安排',
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function option<T extends readonly { value: string }[]>(
  value: unknown,
  options: T,
  fallback: OptionValue<T>,
): OptionValue<T> {
  return options.some((item) => item.value === value) ? (value as OptionValue<T>) : fallback;
}

/** Strict Gregorian date; Date.parse alone silently accepts February 30. */
function dayNumber(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const year = Number(value.slice(0, 4));
  if (year < 1900 || year > 2200) return null;
  const stamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value
    ? stamp / DAY_MS
    : null;
}

export function createDefaultCampusPreferences(): CampusPersonalizationPreferences {
  return {
    version: 1,
    stage: 'unspecified',
    focus: 'balanced',
    living: 'unspecified',
    goals: [],
    phaseOverride: null,
    configured: false,
  };
}

export function normalizeCampusPreferences(value: unknown): CampusPersonalizationPreferences {
  const defaults = createDefaultCampusPreferences();
  if (!record(value) || value.version !== 1) return defaults;
  const goals = Array.isArray(value.goals)
    ? [
        ...new Set(
          value.goals.filter((goal): goal is CampusGoal =>
            CAMPUS_GOAL_OPTIONS.some((item) => item.value === goal),
          ),
        ),
      ].slice(0, 3)
    : [];
  let phaseOverride: CampusPersonalizationPreferences['phaseOverride'] = null;
  if (record(value.phaseOverride)) {
    const { kind, startDate, endDate } = value.phaseOverride;
    const start = dayNumber(startDate);
    const end = dayNumber(endDate);
    if (
      CAMPUS_PHASE_OPTIONS.some((item) => item.value === kind) &&
      start !== null &&
      end !== null &&
      end >= start &&
      end - start < 90
    ) {
      phaseOverride = {
        kind: kind as CampusPhaseKind,
        startDate: startDate as string,
        endDate: endDate as string,
      };
    }
  }
  return {
    version: 1,
    stage: option(value.stage, CAMPUS_STAGE_OPTIONS, defaults.stage),
    focus: option(value.focus, CAMPUS_FOCUS_OPTIONS, defaults.focus),
    living: option(value.living, CAMPUS_LIVING_OPTIONS, defaults.living),
    goals,
    phaseOverride,
    configured: value.configured === true,
  };
}

const NON_EXAM_EVENT =
  /準備|複習|讀書|檢討|報告|作業|提醒|取消|延期|停考|免考|不考|不需|不用|沒有|模擬|公告|說明|注意事項|講座|講習|報名|\b(?:prepar\w*|review|revis\w*|practice|cancel\w*|postpon\w*|reminder|report|assignment|presentation|essay|project|notice|announcement|no)\b/i;

function examKind(title: string): 'midterms' | 'finals' | null {
  if (NON_EXAM_EVENT.test(title)) return null;
  const midterms = /期中(?:考(?:試)?|測驗)|\bmid[ -]?terms?(?:\s+exams?)?\b/i.test(title);
  const finals = /期末(?:考(?:試)?|測驗)|\bfinal\s+exams?\b/i.test(title);
  // A summary mentioning both periods is not one dated exam.
  return midterms === finals ? null : midterms ? 'midterms' : 'finals';
}

function eventInterval(event: PersonalImportRecord): { start: number; end: number } | null {
  const startDay = dayNumber(event.date);
  const endDay = event.endDate === undefined ? startDay : dayNumber(event.endDate);
  if (startDay === null || endDay === null || endDay < startDay) return null;
  const startBase = startDay * DAY_MS - OFFSET_MS;
  if (event.allDay === true) {
    if (event.startTime || event.endTime) return null;
    const end = (event.endDate === undefined ? startDay + 1 : endDay) * DAY_MS - OFFSET_MS;
    return end > startBase && end - startBase <= 90 * DAY_MS ? { start: startBase, end } : null;
  }
  if (event.allDay !== undefined && event.allDay !== false) return null;
  const clock = (value: unknown) =>
    typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
      ? (Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5))) * 60_000
      : null;
  const startTime = clock(event.startTime);
  const endTime = clock(event.endTime);
  if (startTime === null || endTime === null) return null;
  const start = startBase + startTime;
  const end = endDay * DAY_MS - OFFSET_MS + endTime;
  return end > start && end - start <= 90 * DAY_MS ? { start, end } : null;
}

function currentPhase(
  preferences: CampusPersonalizationPreferences,
  now: Date,
  events: readonly PersonalImportRecord[],
  schoolId: string | null,
): CampusRecommendationResult['phase'] {
  const fallback: CampusRecommendationResult['phase'] = {
    kind: 'regular',
    label: PHASE_LABELS.regular,
    source: 'default',
    reason: '依照你選擇的重點安排，也可以設定近期的準備期間。',
  };
  const parts = taipeiParts(now);
  if (!parts) return fallback;
  const today = Date.UTC(parts.year, parts.month - 1, parts.day) / DAY_MS;
  const manual = preferences.phaseOverride;
  if (manual && today >= dayNumber(manual.startDate)! && today <= dayNumber(manual.endDate)!) {
    return {
      kind: manual.kind,
      label: PHASE_LABELS[manual.kind],
      source: 'manual',
      reason: `你設定的${PHASE_LABELS[manual.kind]}期間：${manual.startDate} 至 ${manual.endDate}。`,
    };
  }
  const nowMs = now.getTime();
  const candidates = events
    .flatMap((event) => {
      if (
        !record(event) ||
        event.kind !== 'events' ||
        event.schoolId !== (schoolId ?? 'personal') ||
        typeof event.title !== 'string' ||
        event.title.length > 240
      )
        return [];
      const title = event.title.trim();
      const kind = examKind(title);
      const interval = eventInterval(event);
      if (!kind || !interval || nowMs >= interval.end) return [];
      // Calendar-day horizon in Taipei, independent of browser/server timezone.
      if (dayNumber(event.date)! - today > 14) return [];
      return [{ kind, title, date: event.date!, ...interval }];
    })
    .sort((a, b) => a.start - b.start || a.end - b.end || a.title.localeCompare(b.title));
  const exam = candidates[0];
  return exam
    ? {
        kind: exam.kind,
        label: PHASE_LABELS[exam.kind],
        source: 'event',
        reason:
          exam.start <= nowMs
            ? `你的行程「${exam.title}」正在進行，依這筆行程調整準備重點。`
            : `你的行程「${exam.title}」在 ${exam.date}，可以先安排考前準備。`,
      }
    : fallback;
}

type Candidate = CampusRecommendation & { score: number };

/** Supplements the existing next-class/deadline priorities; never creates an event or grants access. */
export function buildCampusRecommendations(input: {
  preferences: CampusPersonalizationPreferences;
  now: Date;
  events: readonly PersonalImportRecord[];
  schoolId: string | null;
}): CampusRecommendationResult {
  const preferences = normalizeCampusPreferences(input.preferences);
  const phase = currentPhase(preferences, input.now, input.events, input.schoolId);
  const candidates = new Map<string, Candidate>();
  const campus = input.schoolId && input.schoolId !== 'personal' ? input.schoolId : 'all';
  const add = (
    id: string,
    title: string,
    description: string,
    reason: string,
    href: string,
    category: CampusRecommendation['category'],
    score: number,
  ) => {
    const focusBoost =
      preferences.focus === 'study' && category === 'study'
        ? 20
        : preferences.focus === 'life' && category === 'life'
          ? 20
          : 0;
    const candidate: Candidate = {
      id,
      title,
      description,
      reason,
      category,
      score: score + focusBoost,
      href: `${href}?campus=${encodeURIComponent(campus)}&schoolId=${encodeURIComponent(campus)}`,
    };
    if (!candidates.has(id) || candidates.get(id)!.score < candidate.score)
      candidates.set(id, candidate);
  };
  const timetable = (reason: string, score: number) =>
    add(
      'timetable',
      '整理接下來的課表',
      '確認上課時間與教室，讓每天的安排有依據。',
      reason,
      '/timetable',
      'study',
      score,
    );
  const calendar = (title: string, reason: string, score: number) =>
    add(
      'calendar',
      title,
      '把日期與準備時段放進個人行程，儲存前先確認時間。',
      reason,
      '/calendar',
      'study',
      score,
    );
  const credits = (reason: string, score: number) =>
    add(
      'credits',
      '檢查修課與學分規劃',
      '整理已修紀錄與待修課程，再核對學校的畢業規定。',
      reason,
      '/credit-planner',
      'study',
      score,
    );
  const map = (reason: string, score: number) =>
    add('map', '先熟悉校園動線', '找教室、大樓與行政服務的位置。', reason, '/map', 'life', score);
  const project = (reason: string, score: number) => calendar('拆解專題里程碑', reason, score);
  const schoolInfo = (reason: string, score: number) =>
    add(
      'career-resources',
      '查學校職涯資源',
      '從學校官網確認實習、徵才與職涯服務資訊。',
      reason,
      '/school-info',
      'growth',
      score,
    );
  const events = (reason: string, score: number) =>
    add(
      'events',
      '看看校園活動',
      '查看公開活動與講座，挑選想參與的內容。',
      reason,
      '/events',
      'life',
      score,
    );

  timetable('讓上課時間成為每天安排的起點。', 20);
  calendar('整理近期重要日期', '先把近期日期放在一起。', 15);
  events('課業之外，也保留認識校園的空間。', 10);
  if (phase.kind === 'midterms' || phase.kind === 'finals') {
    calendar('排出考前複習時間', phase.reason, 140);
    add(
      'coursework',
      '整理各科教材與待辦',
      '進入已加入的課程，確認教材、作業和測驗資訊。',
      phase.reason,
      '/classroom',
      'study',
      120,
    );
  } else if (phase.kind === 'orientation') {
    timetable(phase.reason, 140);
    map(phase.reason, 120);
  } else if (phase.kind === 'break') {
    calendar('安排假期中的重要日期', phase.reason, 140);
    events('你正在安排假期，可以看看想參與的活動。', 90);
  }

  const stage = CAMPUS_STAGE_OPTIONS.find((item) => item.value === preferences.stage)!.label;
  const stageReason = `依你設定的${stage}階段，提供這個整理方向。`;
  if (preferences.stage === 'year-1') {
    map(stageReason, 65);
    timetable(stageReason, 60);
  }
  if (preferences.stage === 'year-2') {
    credits(stageReason, 65);
    events(stageReason, 55);
  }
  if (preferences.stage === 'year-3') {
    project(stageReason, 65);
    schoolInfo(stageReason, 60);
    credits(stageReason, 55);
  }
  if (preferences.stage === 'year-4') {
    credits(stageReason, 65);
    calendar('整理升學或求職的重要日期', stageReason, 60);
  }
  if (preferences.stage === 'graduate') {
    add(
      'library',
      '查找研究與課程參考資料',
      '搜尋館藏，再前往學校圖書館確認借閱方式。',
      stageReason,
      '/library',
      'study',
      65,
    );
    calendar('安排研究與報告時程', stageReason, 60);
  }

  for (const goal of preferences.goals) {
    const label = CAMPUS_GOAL_OPTIONS.find((item) => item.value === goal)!.label;
    const reason = `你目前想「${label}」。`;
    switch (goal) {
      case 'settle-in':
        map(reason, 85);
        break;
      case 'coursework':
        add(
          'coursework',
          '整理各科教材與待辦',
          '進入已加入的課程，確認教材、作業和測驗資訊。',
          reason,
          '/classroom',
          'study',
          85,
        );
        break;
      case 'project':
        project(reason, 85);
        break;
      case 'internship':
        schoolInfo(reason, 85);
        break;
      case 'graduate-study':
        calendar('整理報名、面試與備審日期', reason, 85);
        break;
      case 'career':
        calendar('安排履歷與作品準備', reason, 85);
        break;
      case 'campus-life':
        events(reason, 85);
        break;
    }
  }
  if (preferences.living === 'commute')
    add(
      'bus',
      '確認通勤路線與站牌',
      '出發前查看路線與站牌資訊。',
      '你設定的生活方式是通勤。',
      '/bus',
      'life',
      75,
    );
  if (preferences.living === 'dorm')
    add(
      'dormitory',
      '查看宿舍服務',
      '確認所選校園的宿舍資訊與可使用服務。',
      '你設定住在學校宿舍。',
      '/dormitory',
      'life',
      75,
    );
  if (preferences.living === 'off-campus' || preferences.focus === 'life') {
    const hour = taipeiParts(input.now)?.hour24;
    const mealTime = hour !== undefined && ((hour >= 11 && hour < 14) || (hour >= 17 && hour < 20));
    add(
      'food',
      '看看餐飲選擇',
      '查看餐飲資訊，再決定接下來的用餐安排。',
      mealTime
        ? '現在接近用餐時段，也留一點時間照顧生活。'
        : '依你設定的生活重點，方便先找餐飲資訊。',
      '/food',
      'life',
      mealTime ? 70 : 55,
    );
  }
  return {
    phase,
    recommendations: [...candidates.values()]
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, 3)
      .map(({ score: _score, ...recommendation }) => recommendation),
  };
}
