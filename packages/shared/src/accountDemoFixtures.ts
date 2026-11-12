import { sha256 } from 'js-sha256';
import {
  createAccountDemoPermissions,
  createAccountDemoState,
  parseAccountDemoProfile,
  type AccountDemoProfile,
} from './accountDemo';
import { personalImportKey } from './imports/records';
import { validatePersonalImportSyncRecords } from './imports/sync';
import type { PersonalImportRecord } from './imports/types';
import { periodProfileForSchool, periodSlots } from './timetable/schoolPeriods';

export const ACCOUNT_DEMO_SEED_TAG = 'nuni-account-demo-v1';
export const ACCOUNT_DEMO_SOURCE_NAME = 'nuni 帳號展示資料（合成）';
const ACCOUNT_ID = /^pa_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type AccountDemoFixtureCourse = {
  id: string;
  title: string;
  ownerAccountId: string;
  memberRole: 'student' | 'owner-teacher';
  unit: { id: string; title: string; position: number };
  materials: { id: string; title: string; body: string }[];
  assignments: { id: string; title: string; instructions: string; dueAt: string }[];
  quiz: { id: string; title: string; prompt: string; dueAt: string };
};

/** IDs depend on the account and school, never an email or a shared login credential. */
export function accountDemoId(accountId: string, schoolId: string, prefix: string, key: string) {
  const digest = sha256(`${ACCOUNT_DEMO_SEED_TAG}\u0000${accountId}\u0000${schoolId}\u0000${key}`);
  const variant = ((parseInt(digest[16]!, 16) & 3) | 8).toString(16);
  return `${prefix}_${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-${variant}${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function localDate(now: Date) {
  if (!Number.isFinite(now.getTime())) throw new Error('展示日期無效。');
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function nextDate(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function createAccountDemoFixtures(input: {
  accountId: string;
  schoolId: string;
  displayName: string;
  schoolName: string;
  department?: string;
  now: Date;
}) {
  const { accountId, schoolId, now } = input;
  if (
    !ACCOUNT_ID.test(accountId) ||
    !/^[a-z0-9][a-z0-9-]{1,79}$/.test(schoolId) ||
    schoolId === 'personal'
  ) {
    throw new Error('請提供已核實的帳號 ID 與正式校園 ID。');
  }
  const day = localDate(now);
  const month = Number(day.slice(5, 7));
  const academicYear = String(Number(day.slice(0, 4)) - (month >= 8 ? 1911 : 1912));
  const semester = month >= 2 && month <= 7 ? '2' : '1';
  const stamp = now.toISOString();
  const id = (prefix: string, key: string) => accountDemoId(accountId, schoolId, prefix, key);
  const namespace = sha256(`${ACCOUNT_DEMO_SEED_TAG}\u0000${accountId}\u0000${schoolId}`).slice(
    0,
    16,
  );
  const fixtureOwnerId = id('pa', 'teacher-without-credentials');
  const profile: AccountDemoProfile = parseAccountDemoProfile({
    displayName: input.displayName,
    schoolId,
    schoolName: input.schoolName,
    studentId: `DEMO${namespace.slice(0, 12).toUpperCase()}`,
    department: input.department ?? '資訊管理學系 · 展示資料',
  });
  const courseSpecs = [
    {
      key: 'database',
      title: '資料庫系統',
      code: 'DEMO-IM301',
      owner: fixtureOwnerId,
      memberRole: 'student' as const,
      unit: '資料建模與 SQL',
      materials: [
        [
          '從點餐流程畫出 ER 圖',
          '本教材為合成展示資料。\n\n以校園點餐為例：一個帳號可以建立多筆訂單，一筆訂單含多個品項。請區分訂單、訂單明細、餐點、店家與帳號，標出主鍵、外鍵和關聯基數。訂單的當時售價應保存於明細，不能隨菜單改價而改動歷史訂單。',
        ],
        [
          'SQL JOIN 與交易練習',
          '本教材為合成展示資料。\n\n練習一：使用 JOIN 列出訂單、店家名稱及金額。練習二：查出沒有訂單的帳號。練習三：說明建立訂單和扣除庫存為何應在同一筆交易中完成。重複請求應依操作識別碼回傳同一結果。',
        ],
      ],
      assignments: [
        [
          '校園點餐 ER 圖',
          '這是展示作業。畫出帳號、店家、餐點、訂單與明細的 ER 圖；標示主外鍵與關聯基數，並說明如何保存訂購時的價格。可直接在作業中以文字描述設計。',
          2,
        ],
        [
          'JOIN 查詢與交易說明',
          '這是展示作業。寫出查詢每家店當日訂單金額的 SQL，並用 150 字說明重複點擊下單與庫存併發時，資料庫如何維持一致。',
          5,
        ],
      ],
      quiz: [
        '關聯資料庫小測驗',
        '這是展示測驗。請回答：1. 主鍵與外鍵有何差別？2. 為什麼訂單明細要保存當時價格？3. LEFT JOIN 適合用來找什麼資料？',
        4,
      ],
    },
    {
      key: 'security',
      title: '資訊安全與 AI 代理',
      code: 'DEMO-IM402',
      owner: fixtureOwnerId,
      memberRole: 'student' as const,
      unit: '帳號授權與可靠執行',
      materials: [
        [
          'Google 登入與校園身分',
          '本教材為合成展示資料。\n\n登入證明目前操作的帳號，課程成員與校園資格決定可看的資料。選擇學校不等於取得該校權限。AI 工具必須重新向伺服器核對帳號、資料擁有者及操作範圍。',
        ],
        [
          '從使用者請求到執行收據',
          '本教材為合成展示資料。\n\n可靠代理的步驟：讀取有權使用的來源、整理具體提案、取得使用者確認、以相同操作識別碼執行、讀回保存的紀錄。網路逾時時先查核結果，不立即重複建立。',
        ],
      ],
      assignments: [
        [
          'AI 代理權限設計',
          '這是展示作業。以代訂午餐為情境，列出資料讀取、備單、確認、下單與取消的權限。說明登出、換帳號、關閉權限時應如何處理尚未執行的提案。',
          3,
        ],
        [
          '設計可重試的操作',
          '這是展示作業。畫出新增行程逾時後的處理流程，包含同一操作識別碼、讀回確認、重複回覆，以及無法確定是否成功時的畫面提示。',
          7,
        ],
      ],
      quiz: [
        '登入與授權小測驗',
        '這是展示測驗。請回答：1. Google 登入為何不自動等於校方教師？2. 為什麼不能只用前端按鈕隱藏控制權限？3. API 逾時後為何應先查核？',
        5,
      ],
    },
    {
      key: 'project',
      title: 'nuni 專題實作',
      code: 'DEMO-IM499',
      owner: accountId,
      memberRole: 'owner-teacher' as const,
      unit: '專題展示與驗收',
      materials: [
        [
          '一天的校園助理展示',
          '本教材為合成展示資料。\n\n展示順序：詢問今天的課表、查找近期作業、安排準備時間、查看學生證、確認午餐與宿舍資訊。每一段都先說使用者要解決什麼問題，再展示操作結果。',
        ],
        [
          '展示前核對清單',
          '本教材為合成展示資料。\n\n確認帳號、校園、近期截止日、展示學生證與網路狀態。確認 AI 回答有資料來源、動作有確認卡、結果可再次讀回。課班僅供本帳號展示，沒有連接校方課程名冊。',
        ],
      ],
      assignments: [
        [
          '錄製三分鐘任務展示',
          '這是展示作業。挑選一個學生任務，錄製從提出需求到確認結果的流程。內容包含使用的資料、確認步驟與完成回執。',
          4,
        ],
        [
          '整理展示回饋',
          '這是展示作業。記錄三個使用者操作時遇到的問題，對每項列出現象、預期行為、修改與驗證方式。',
          7,
        ],
      ],
      quiz: [
        '任務完成判斷',
        '這是展示測驗。列出三種只能算提出建議、不能算已完成任務的情況，並說明真正完成時應提供什麼證據。',
        6,
      ],
    },
  ];
  const courses: AccountDemoFixtureCourse[] = courseSpecs.map((course) => ({
    id: id('cw', course.key),
    title: `${course.title}（展示）`,
    ownerAccountId: course.owner,
    memberRole: course.memberRole,
    unit: { id: id('cwu', `${course.key}:unit`), title: course.unit, position: 1 },
    materials: course.materials.map(([title, body], index) => ({
      id: id('cwm', `${course.key}:material:${index}`),
      title: title!,
      body: body!,
    })),
    assignments: course.assignments.map(([title, instructions, days], index) => ({
      id: id('cwa', `${course.key}:assignment:${index}`),
      title: String(title),
      instructions: String(instructions),
      dueAt: new Date(`${nextDate(day, Number(days))}T23:59:00+08:00`).toISOString(),
    })),
    quiz: {
      id: id('cwq', `${course.key}:quiz`),
      title: String(course.quiz[0]),
      prompt: String(course.quiz[1]),
      dueAt: new Date(`${nextDate(day, Number(course.quiz[2]))}T23:59:00+08:00`).toISOString(),
    },
  }));
  const batchId = `${ACCOUNT_DEMO_SEED_TAG}:${namespace}`;
  const rows: PersonalImportRecord[] = [];
  const base = (key: string, title: string) => ({
    id: `${batchId}:${key}`,
    title,
    schoolId,
    academicYear,
    semester,
    batchId,
    importedAt: stamp,
    source: {
      type: 'paste' as const,
      name: ACCOUNT_DEMO_SOURCE_NAME,
      line: rows.length + 1,
      rawText: `合成展示資料：${title}`,
    },
  });
  const periods = periodSlots(periodProfileForSchool(schoolId) ?? 'pu');
  const schedule = [
    [0, 1, 3, 4, '展示教室 A201'],
    [1, 2, 5, 6, '展示教室 B302'],
    [2, 3, 7, 8, '專題討論室'],
    [1, 4, 3, 4, '展示教室 B302'],
    [0, 5, 1, 2, '展示教室 A201'],
  ] as const;
  for (const [courseIndex, dayOfWeek, startPeriod, endPeriod, location] of schedule) {
    const course = courses[courseIndex]!,
      spec = courseSpecs[courseIndex]!;
    rows.push({
      ...base(`timetable:${courseIndex}:${dayOfWeek}`, course.title),
      kind: 'timetable',
      courseCode: spec.code,
      teacher: course.memberRole === 'student' ? '展示授課者' : input.displayName,
      className: '個人展示課班',
      location,
      dayOfWeek,
      credits: 3,
      linkedCourseId: course.id,
      ...(periodProfileForSchool(schoolId) ? { startPeriod, endPeriod } : {}),
      startTime: periods[startPeriod - 1]!.start,
      endTime: periods[endPeriod - 1]!.end,
    });
  }
  const events = [
    ['討論 AI 代理展示流程（展示）', 1, '12:10', '12:40', '專題討論室'],
    ['準備資料庫作業（展示）', 2, '18:00', '19:00', '個人讀書時段'],
    ['口頭報告彩排（展示）', 3, '16:00', '17:00', '專題討論室'],
  ] as const;
  events.forEach(([title, days, startTime, endTime, location], index) => {
    rows.push({
      ...base(`event:${index}`, title),
      kind: 'events',
      date: nextDate(day, days),
      startTime,
      endTime,
      location,
      allDay: false,
    });
  });
  ['程式設計（展示）', '資料結構（展示）', '系統分析（展示）'].forEach((title, index) => {
    rows.push({
      ...base(`grade:${index}`, title),
      kind: 'grades',
      academicYear: semester === '1' ? String(Number(academicYear) - 1) : academicYear,
      semester: semester === '1' ? '2' : '1',
      courseCode: `DEMO-PAST-${index + 1}`,
      credits: 3,
      grade: ['88', '92', '90'][index]!,
    });
  });
  return {
    seedTag: ACCOUNT_DEMO_SEED_TAG,
    accountId,
    schoolId,
    createdAt: stamp,
    expiresAt: new Date(now.getTime() + 30 * 86_400_000).toISOString(),
    profile,
    permissions: createAccountDemoPermissions(true),
    state: createAccountDemoState(),
    fixtureOwner: {
      id: fixtureOwnerId,
      displayName: `展示授課者 ${namespace.slice(0, 6).toUpperCase()}`,
    },
    courses,
    records: validatePersonalImportSyncRecords(rows, schoolId),
  };
}

/** Preserve every existing row, including edited demo data; reruns only add missing identities. */
export function mergeAccountDemoRecords(existing: unknown, incoming: unknown, schoolId: string) {
  const current = validatePersonalImportSyncRecords(existing, schoolId);
  const candidates = validatePersonalImportSyncRecords(incoming, schoolId);
  const ids = new Set(current.map((row) => row.id));
  const keys = new Set(current.map(personalImportKey));
  const added = candidates.filter((row) => {
    const key = personalImportKey(row);
    if (ids.has(row.id) || keys.has(key)) return false;
    ids.add(row.id);
    keys.add(key);
    return true;
  });
  return {
    records: validatePersonalImportSyncRecords([...current, ...added], schoolId),
    added: added.length,
  };
}
