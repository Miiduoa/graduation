import { useSyncExternalStore, type AnchorHTMLAttributes } from 'react';
import type { PersonalImportRecord } from '@campus/shared';
import type { HomeData } from '../../../apps/web/src/lib/homeOverview';
import {
  PERSONAL_IMPORT_CHANGE,
  personalImportsStorageKey,
  readPersonalImports,
} from '../../../apps/web/src/lib/personalImports';

// These are explicit data/session/router boundaries. Calendar components,
// storage validation, event creation, editing and Web Locks remain production code.
export const fixtureOptions = new URLSearchParams(location.search);
const schools = [
  { id: 'pu', code: 'PU', name: '靜宜大學', shortName: '靜宜', status: 'open' },
  { id: 'nchu', code: 'NCHU', name: '國立中興大學', shortName: '中興', status: 'open' },
];
const listeners = new Set<() => void>();
let state = { schoolId: 'pu', uid: 'synthetic-calendar-one' };
let failNextSave = false;
const ledger = {
  writeAttempts: [] as { key: string; outcome: 'saved' | 'failed' }[],
  requests: [] as string[],
  navigations: [] as string[],
};
const originalSetItem = Storage.prototype.setItem;
Storage.prototype.setItem = function (key: string, value: string) {
  if (this === localStorage && key.startsWith('campus.personal-imports.v1:')) {
    if (failNextSave) {
      failNextSave = false;
      ledger.writeAttempts.push({ key, outcome: 'failed' });
      throw new DOMException('Synthetic storage quota failure', 'QuotaExceededError');
    }
    ledger.writeAttempts.push({ key, outcome: 'saved' });
  }
  return originalSetItem.call(this, key, value);
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const snapshot = () => state;
function useFixture() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
function update(next: typeof state) {
  state = next;
  const params = new URLSearchParams(location.search);
  params.set('campus', state.schoolId);
  history.replaceState(history.state, '', `${location.pathname}?${params}`);
  listeners.forEach((listener) => listener());
}

function record(
  schoolId: string,
  id: string,
  title: string,
  date: string,
  startTime: string,
  endTime: string,
  location: string,
): PersonalImportRecord {
  return {
    id,
    title,
    date,
    startTime,
    endTime,
    location,
    kind: 'events',
    schoolId,
    academicYear: '',
    semester: '',
    allDay: false,
    batchId: 'synthetic-calendar-batch',
    importedAt: '2027-12-01T00:00:00Z',
    source: { type: 'paste', line: 1, rawText: '明示合成行程，僅供介面驗收。' },
  };
}

export function seedCalendar() {
  const longTitle = '跨週行程標題用於驗收'.repeat(20);
  const pu = [
    {
      ...record('pu', 'synthetic-multiweek', longTitle, '2028-04-02', '09:00', '10:00', '校園'),
      endDate: '2028-04-16',
    },
    record(
      'pu',
      'synthetic-april-morning',
      '跨校專題小組進度討論與期末成果展示準備',
      '2028-04-17',
      '08:00',
      '09:00',
      '校園',
    ),
    record('pu', 'synthetic-april-noon', '午間討論', '2028-04-09', '12:00', '13:00', '校園'),
    record('pu', 'synthetic-april-extra', '傍晚討論', '2028-04-09', '17:00', '18:00', '校園'),
    record('pu', 'synthetic-april-lunch', '午餐會議', '2028-04-16', '12:00', '13:00', '校園'),
    record('pu', 'synthetic-april-review', '成果檢討', '2028-04-16', '17:00', '18:00', '校園'),
    record(
      'pu',
      'synthetic-study',
      '小組討論與專題進度整理',
      '2028-01-18',
      '10:00',
      '11:00',
      '資訊大樓 302',
    ),
    record(
      'pu',
      'synthetic-library',
      '到圖書館借閱研究方法參考書',
      '2028-01-18',
      '14:00',
      '15:00',
      '蓋夏圖書館',
    ),
    record(
      'pu',
      'synthetic-long-title',
      '和同學一起確認下週簡報分工與需要補充的實作畫面',
      '2028-01-18',
      '16:30',
      '17:30',
      '校園討論室',
    ),
    record('pu', 'synthetic-january-end', '月底整理', '2028-01-31', '09:00', '10:00', '圖書館'),
    record('pu', 'synthetic-february', '二月安排', '2028-02-29', '09:00', '10:00', '校園'),
  ];
  const nchu = [
    record(
      'nchu',
      'synthetic-other-school',
      '中興校園行程',
      '2028-01-18',
      '11:00',
      '12:00',
      '圖書館',
    ),
  ];
  for (const [uid, schoolId, records] of [
    ['synthetic-calendar-one', 'pu', pu],
    ['synthetic-calendar-one', 'nchu', nchu],
    [
      'synthetic-calendar-two',
      'pu',
      [
        record(
          'pu',
          'synthetic-other-owner',
          '另一個帳號的安排',
          '2028-01-18',
          '13:00',
          '14:00',
          '校園',
        ),
      ],
    ],
  ] as const) {
    const key = personalImportsStorageKey({ owner: `school:${uid}`, schoolId });
    if (!localStorage.getItem(key)) {
      originalSetItem.call(localStorage, key, JSON.stringify({ version: 1, records }));
    }
  }
  const params = new URLSearchParams(location.search);
  params.set('campus', state.schoolId);
  history.replaceState(history.state, '', `${location.pathname}?${params}`);
}

export const switchSchool = () =>
  update({ ...state, schoolId: state.schoolId === 'pu' ? 'nchu' : 'pu' });
export const switchAccount = () =>
  update({
    ...state,
    uid:
      state.uid === 'synthetic-calendar-one' ? 'synthetic-calendar-two' : 'synthetic-calendar-one',
  });
export const prepareSaveFailure = () => {
  failNextSave = true;
};
export const refreshStorage = () => window.dispatchEvent(new Event(PERSONAL_IMPORT_CHANGE));

export function useAuth() {
  const current = useFixture();
  return { user: { uid: current.uid }, loading: false, error: null };
}
export const useNuniSession = () => ({
  session: null,
  loading: false,
  error: null,
  pendingLogout: false,
});
export const useOptionalNuniSession = useNuniSession;
export function useSelectedSchool() {
  const current = useFixture();
  return {
    schools,
    selectedSchool: schools.find((school) => school.id === current.schoolId),
    selectedSchoolId: current.schoolId,
    loading: false,
    catalogStatus: 'ready',
    selectSchool: (schoolId: string) => update({ ...state, schoolId }),
  };
}
export const useOptionalSelectedSchool = useSelectedSchool;
export const useSearchParams = () => {
  useFixture();
  return new URLSearchParams(location.search);
};
export const usePathname = () => '/calendar';
export const useRouter = () => ({
  push: (href: string) => {
    ledger.navigations.push(href);
  },
  replace: (href: string) => {
    ledger.navigations.push(href);
  },
});
export default function Link({
  href = '/',
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        event.preventDefault();
        ledger.navigations.push(String(href));
      }}
    >
      {children}
    </a>
  );
}
export async function loadHomeData(_uid: string): Promise<HomeData> {
  return {
    courses: [],
    unreadCount: 0,
    tasks:
      state.schoolId === 'pu'
        ? [
            {
              id: 'synthetic-course-task',
              courseId: 'synthetic-course',
              courseName: '資料結構',
              title: '實作報告繳交',
              dueAt: '2028-01-18T23:59:00+08:00',
            },
          ]
        : [],
  };
}
export const browserRequest = async () => {
  ledger.requests.push('unexpected-platform-api');
  throw new Error('Platform network is disabled in the calendar fixture');
};
window.fetch = async (input) => {
  ledger.requests.push(String(input));
  throw new Error(`Unexpected network request in calendar fixture: ${String(input)}`);
};
Object.assign(window, {
  __calendarQA: {
    snapshot: () => ({
      ...ledger,
      state,
      failNextSave,
      records: readPersonalImports({ owner: `school:${state.uid}`, schoolId: state.schoolId }),
    }),
  },
});
