import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { CreditAuditScreen } from '../screens/CreditAuditScreen';
import CreditSummaryScreen from '../screens/CreditSummaryScreen';
import { rootNavigateMeScreen } from '../app/rootNavigation';
import { SchoolCreditOverviewError } from '../services/ownedSchoolCreditOverview';
import type { Grade } from '../data/types';
import type { PuCreditOverviewSnapshot } from '@campus/shared/src/puCreditOverview';
import {
  collapseRetakeAttempts,
  computeReferenceGpa,
  isPassed,
  numericScore,
  semesterWeightedAverage,
} from '../screens/creditAudit/creditMath';
import { filterScopedGrades, isProvidenceUniversitySchool } from '../screens/creditAudit/gradeScope';
import { mapPuOfficialGrades } from '../data/apiAdapters/PUAdapter';
import { mapNchuOfficialGrades } from '../data/apiAdapters/NCHUAdapter';

const mockListGrades = jest.fn<Promise<Grade[]>, [string, string | undefined, string | undefined]>();
const mockLoadSchoolCreditOverview = jest.fn();
/** 刻意保留：確認舊的未驗證 getGPA 不會覆寫本頁參考 GPA。 */
const mockGetGPA = jest.fn<
  Promise<{ gpa: number; totalCredits: number; totalPoints: number }>,
  [string, string | undefined]
>();
let mockHasDataSource = true;
let mockAuth: {
  user: { uid: string } | null;
  profile: { uid: string; schoolId: string; department?: string; role?: string } | null;
  loading?: boolean;
  profileLoading?: boolean;
  tokenExpired?: boolean;
} = {
  user: { uid: 'user-a' },
  profile: { uid: 'user-a', schoolId: 'pu', department: '資訊管理學系', role: 'student' },
};
let mockSchool = { id: 'pu', name: '靜宜大學', shortName: '靜宜' };

jest.mock('../state/auth', () => ({ useAuth: () => mockAuth }));
jest.mock('../app/rootNavigation', () => ({ rootNavigateMeScreen: jest.fn() }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: mockSchool }) }));
jest.mock('../services/ownedSchoolCreditOverview', () => ({
  ...jest.requireActual('../services/ownedSchoolCreditOverview'),
  loadOwnedSchoolCreditOverview: (...args: unknown[]) => mockLoadSchoolCreditOverview(...args),
}));
jest.mock('../services/demoSession', () => ({
  shouldBlockForNoLogin: () => false,
  isDemoUid: () => false,
}));
jest.mock('../data', () => ({
  hasDataSource: () => mockHasDataSource,
  getDataSource: () => ({
    listGrades: (...args: [string, string | undefined, string | undefined]) =>
      mockListGrades(...args),
    getGPA: (...args: [string, string | undefined]) => mockGetGPA(...args),
  }),
}));
jest.mock('../ui/navigationTheme', () => ({
  TAB_BAR_CONTENT_BOTTOM_PADDING: 80,
  useTabBarContentBottomPadding: () => 80,
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) =>
    require('react').useEffect(() => {
      const cleanup = callback();
      return typeof cleanup === 'function' ? cleanup : undefined;
    }, [callback]),
}));

function grade(patch: Partial<Grade> = {}): Grade {
  return {
    id: 'grade-1',
    userId: 'user-a',
    schoolId: 'pu',
    courseId: 'csim101',
    courseCode: 'CSIM101',
    courseName: '資料庫管理',
    courseType: '必修',
    credits: 3,
    semester: '1131',
    score: 88,
    gradePoint: 3.3,
    publishedAt: '2000-01-01T00:00:00Z',
    ...patch,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function schoolCreditOverview(subtotal = 71.5): PuCreditOverviewSnapshot {
  return {
    ownerUid: 'user-a', schoolId: 'pu', fetchedAt: '2026-10-28T00:00:00Z',
    overview: {
      version: 1, source: 'pu-credit-review',
      totals: { required: 40.5, elective: 20, externalElective: 3, generalOld: 0,
        generalNew: 8, subtotal, totalRequired: 128, minorDouble: null },
      coverage: { status: 'partial', missingFields: ['minorDouble'] },
    },
  };
}

async function expandFirstSemester(view: ReturnType<typeof render>) {
  const header = await view.findByLabelText(/展開明細/);
  await act(async () => {
    fireEvent.press(header);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockHasDataSource = true;
  mockAuth = {
    user: { uid: 'user-a' },
    profile: { uid: 'user-a', schoolId: 'pu', department: '資訊管理學系', role: 'student' },
  };
  mockSchool = { id: 'pu', name: '靜宜大學', shortName: '靜宜' };
  mockListGrades.mockResolvedValue([grade()]);
  mockLoadSchoolCreditOverview.mockReset().mockRejectedValue(new SchoolCreditOverviewError('unavailable'));
  // 若仍被呼叫，會回傳「他校誇大」數值；UI 不得採用
  mockGetGPA.mockResolvedValue({ gpa: 9.9, totalCredits: 999, totalPoints: 9999 });
});

test('helpers preserve score 0, ungraded, retake collapse and division-by-zero average', () => {
  expect(numericScore(grade({ score: 0, grade: undefined }))).toBe(0);
  expect(isPassed(grade({ score: 0, grade: undefined }))).toBe(false);
  expect(numericScore(grade({ score: undefined, grade: undefined, letterGrade: undefined }))).toBe(
    null,
  );
  expect(isPassed(grade({ score: undefined, grade: undefined }))).toBe(false);

  const collapsed = collapseRetakeAttempts([
    grade({ id: 'a', score: 40, semester: '1121' }),
    grade({ id: 'b', score: 75, semester: '1131' }),
  ]);
  expect(collapsed.collapsed).toBe(1);
  expect(collapsed.kept).toHaveLength(1);
  expect(collapsed.kept[0].score).toBe(75);

  expect(semesterWeightedAverage([grade({ score: 80, credits: 0 })])).toBeNull();
  expect(semesterWeightedAverage([grade({ score: 0, credits: 2 })])).toBe(0);
  expect(isProvidenceUniversitySchool('pu')).toBe(true);
  expect(isProvidenceUniversitySchool('tw-pu')).toBe(true);
  expect(isProvidenceUniversitySchool('ncku')).toBe(false);
  expect(
    filterScopedGrades(
      [
        grade(),
        grade({ id: 'other', userId: 'user-b', courseName: '他人' }),
        grade({ id: 'school', schoolId: 'ncku', courseName: '他校' }),
        grade({ id: 'bare', schoolId: undefined as unknown as string, courseName: '無校' }),
      ],
      'user-a',
      'pu',
    ).map((g) => g.id),
  ).toEqual(['grade-1']);
});

test('filter accepts real PU/NCHU adapter shapes without publishedAt; rejects unscoped legacy', () => {
  const puRows = mapPuOfficialGrades(
    [
      {
        semester: '1131',
        courseName: '靜宜校務課',
        credits: 3,
        score: 88,
        courseType: '必修',
      },
    ],
    { studentId: 'user-a', schoolId: 'tw-pu', gradeSource: 'school-official' },
  );
  const nchuRows = mapNchuOfficialGrades(
    [
      {
        courseId: 'N1',
        courseName: '中興校務課',
        credits: 2,
        grade: 90,
        gradePoint: 4,
        semester: '1131',
      },
    ],
    { studentId: 'user-a', schoolId: 'tw-nchu' },
  );

  expect(puRows[0].publishedAt).toBeUndefined();
  expect(puRows[0].schoolId).toBe('tw-pu');
  expect(puRows[0].gradeSource).toBe('school-official');
  expect(filterScopedGrades(puRows, 'user-a', 'pu').map((g) => g.courseName)).toEqual([
    '靜宜校務課',
  ]);

  expect(nchuRows[0].publishedAt).toBeUndefined();
  expect(filterScopedGrades(nchuRows, 'user-a', 'tw-nchu').map((g) => g.courseName)).toEqual([
    '中興校務課',
  ]);

  // 無 schoolId／無來源語意／無 publishedAt 的 legacy → 拒絕
  expect(
    filterScopedGrades(
      [
        {
          id: 'legacy',
          userId: 'user-a',
          courseId: 'x',
          courseName: '無範圍',
          credits: 1,
          semester: '1131',
          score: 70,
        },
      ],
      'user-a',
      'pu',
    ),
  ).toEqual([]);

  // Firebase 未發布（未來）→ 拒絕
  const future = Date.now() + 60_000;
  expect(
    filterScopedGrades(
      [grade({ id: 'future', publishedAt: new Date(future).toISOString() })],
      'user-a',
      'pu',
      Date.now(),
    ),
  ).toEqual([]);
});

test('reference GPA uses validated rows only; mixed school / missing points / zero-credit', () => {
  const mixed = filterScopedGrades(
    [
      grade({ id: 'ok', gradePoint: 3.0, credits: 2 }),
      grade({ id: 'other-school', schoolId: 'ncku', gradePoint: 4.0, credits: 10 }),
      grade({
        id: 'unpublished',
        publishedAt: new Date(Date.now() + 120_000).toISOString(),
        gradePoint: 4.0,
        credits: 10,
      }),
    ],
    'user-a',
    'pu',
  );
  expect(mixed.map((g) => g.id)).toEqual(['ok']);
  const gpa = computeReferenceGpa(mixed);
  expect(gpa).toEqual({
    gpa: 3.0,
    totalCredits: 2,
    totalPoints: 6,
    retakeCollapsed: 0,
    gradePointScale: null,
  });

  expect(computeReferenceGpa([grade({ gradePoint: undefined, gradePoints: undefined })])).toBeNull();
  expect(computeReferenceGpa([grade({ gradePoint: 0, credits: 2, score: 50 })])).toEqual({
    gpa: 0,
    totalCredits: 2,
    totalPoints: 0,
    retakeCollapsed: 0,
    gradePointScale: null,
  });
  expect(computeReferenceGpa([grade({ gradePoint: 4, credits: 0 })])).toBeNull();
});

test('CreditAuditScreen renders nonempty scoped grades and local read time', async () => {
  const view = render(<CreditAuditScreen />);
  await view.findByText(/本機讀取時間/);
  expect(view.getByText(/非校方正式更新時間/)).toBeTruthy();
  expect(view.getByText('參考畢業門檻（靜宜模型）')).toBeTruthy();
  await expandFirstSemester(view);
  expect(view.getByText('資料庫管理')).toBeTruthy();
  expect(view.queryByText(/campusCreditAudit/)).toBeNull();
});

test('PU adapter-shaped rows without publishedAt still render nonempty', async () => {
  mockListGrades.mockResolvedValue(
    mapPuOfficialGrades(
      [{ semester: '1131', courseName: 'E校園微積分', credits: 3, score: 85, courseType: '必修' }],
      { studentId: 'user-a', schoolId: 'tw-pu', gradeSource: 'school-official' },
    ),
  );
  const view = render(<CreditAuditScreen />);
  await expandFirstSemester(view);
  expect(view.getByText('E校園微積分')).toBeTruthy();
  expect(view.getByText(/本頁參考 GPA/)).toBeTruthy();
  expect(view.getByText('4.00')).toBeTruthy();
  expect(view.getByText('/ 4.30')).toBeTruthy();
  expect(view.getByLabelText('開啟靜宜大學學則績點對照')).toBeTruthy();
  expect(view.queryByText('/ 4.00')).toBeNull();
  expect(mockGetGPA).not.toHaveBeenCalled();
});

test('read failure shows recoverable error then successful retry clears it', async () => {
  mockListGrades.mockRejectedValueOnce(new Error('network down'));
  const view = render(<CreditAuditScreen />);
  await view.findByText(/network down/);
  expect(view.queryByText('尚無可用的修課紀錄')).toBeNull();
  expect(view.queryByText(/本機讀取時間/)).toBeNull();

  mockListGrades.mockResolvedValueOnce([grade()]);
  await act(async () => {
    fireEvent.press(view.getByText('重試'));
  });
  await view.findByText(/本機讀取時間/);
  await expandFirstSemester(view);
  expect(view.getByText('資料庫管理')).toBeTruthy();
  expect(view.queryByText(/network down/)).toBeNull();
});

test('missing grade points keeps rows and marks reference GPA unavailable; getGPA cannot override', async () => {
  mockListGrades.mockResolvedValue([
    grade({ gradePoint: undefined, gradePoints: undefined, score: 88 }),
  ]);
  const view = render(<CreditAuditScreen />);
  await view.findByText('參考 GPA 暫時無法計算');
  expect(view.getByText(/不會以 0 代替/)).toBeTruthy();
  expect(view.queryByText('9.90')).toBeNull();
  expect(view.queryByText('0.00')).toBeNull();
  expect(mockGetGPA).not.toHaveBeenCalled();
  await expandFirstSemester(view);
  expect(view.getByText('資料庫管理')).toBeTruthy();
});

test('reference GPA label uses page records; ignores unscoped getGPA bait', async () => {
  mockListGrades.mockResolvedValue([grade({ gradePoint: 2.0, credits: 2, score: 70 })]);
  const view = render(<CreditAuditScreen />);
  await view.findByText(/本頁參考 GPA/);
  await view.findByText('2.00');
  expect(view.getByText(/依本頁已接受列加權/)).toBeTruthy();
  expect(view.getByText(/非正式累計/)).toBeTruthy();
  // 無已知一致尺度 → 不注入 /4.00
  expect(view.queryByText('/ 4.00')).toBeNull();
  expect(view.queryByText('9.90')).toBeNull();
  expect(view.queryByLabelText('開啟靜宜大學學則績點對照')).toBeNull();
  expect(mockGetGPA).not.toHaveBeenCalled();
});

test('GPA refuses to blend different or partly unknown point scales', () => {
  const known = grade({ id: 'known', gradePoint: 4, gradePointScale: 4.3 });
  expect(computeReferenceGpa([
    known, grade({ id: 'other-scale', courseId: 'other', gradePoint: 4, gradePointScale: 4 }),
  ])).toBeNull();
  expect(computeReferenceGpa([
    known, grade({ id: 'unknown-scale', courseId: 'other', gradePoint: 4 }),
  ])).toBeNull();
});

test('Pass plus numeric zero yields GPA 0 from numeric credits only; retakes count both in GPA', async () => {
  const rows = mapPuOfficialGrades(
    [
      { semester: '1121', courseName: '程式設計', credits: 3, score: 0 },
      { semester: '1131', courseName: '程式設計', credits: 3, score: 0 },
      { semester: '1131', courseName: '專題實作', credits: 2, score: 'Pass' },
    ],
    { studentId: 'user-a', schoolId: 'tw-pu', gradeSource: 'school-official' },
  );
  expect(computeReferenceGpa(rows)).toEqual({
    gpa: 0,
    totalCredits: 6,
    totalPoints: 0,
    retakeCollapsed: 1,
    gradePointScale: 4.3,
  });
  mockListGrades.mockResolvedValue(rows);
  const view = render(<CreditAuditScreen />);
  await view.findByText('0.00');
  expect(view.getByText('/ 4.30')).toBeTruthy();
  expect(view.getByText(/符號通過／未通過不納入平均/)).toBeTruthy();
  expect(view.getByText(/重複修課合併 1 筆/)).toBeTruthy();
});

test('late school response A→B→A never restores B records or clears newer busy', async () => {
  const first = deferred<Grade[]>();
  mockListGrades.mockReturnValueOnce(first.promise);
  const view = render(<CreditAuditScreen />);

  const second = deferred<Grade[]>();
  mockSchool = { id: 'ncku', name: '國立成功大學', shortName: '成大' };
  mockListGrades.mockReturnValueOnce(second.promise);
  view.rerender(<CreditAuditScreen />);

  const third = deferred<Grade[]>();
  mockSchool = { id: 'pu', name: '靜宜大學', shortName: '靜宜' };
  mockListGrades.mockReturnValueOnce(third.promise);
  view.rerender(<CreditAuditScreen />);

  await act(async () => {
    first.resolve([grade({ courseName: '過期 A 成績' })]);
  });
  expect(view.queryByText('過期 A 成績')).toBeNull();

  await act(async () => {
    second.resolve([
      grade({
        schoolId: 'ncku',
        courseName: '過期 B 成績',
        courseCode: 'NCKU1',
        courseId: 'n1',
      }),
    ]);
  });
  expect(view.queryByText('過期 B 成績')).toBeNull();
  expect(view.getByText(/載入成績資料中/)).toBeTruthy();

  await act(async () => {
    third.resolve([grade({ courseName: '最終 A 成績', id: 'final-a', courseCode: 'FINAL' })]);
  });
  await view.findByText(/本機讀取時間/);
  await expandFirstSemester(view);
  expect(view.getByText('最終 A 成績')).toBeTruthy();
  expect(view.queryByText('過期 B 成績')).toBeNull();
});

test('unmount ignores late grade resolution', async () => {
  const pending = deferred<Grade[]>();
  mockListGrades.mockReturnValueOnce(pending.promise);
  const view = render(<CreditAuditScreen />);
  view.unmount();
  await act(async () => {
    pending.resolve([grade({ courseName: '卸載後不該出現' })]);
  });
});

test('other school shows scoped totals without PU thresholds or graduation met copy', async () => {
  mockSchool = { id: 'ncku', name: '國立成功大學', shortName: '成大' };
  mockListGrades.mockResolvedValue([
    grade({
      schoolId: 'ncku',
      courseName: '成大微積分',
      courseType: '必修',
      courseCode: 'MATH101',
    }),
  ]);
  const view = render(<CreditAuditScreen />);
  await view.findByText(/尚未設定畢業規則/);
  expect(view.queryByText('切換系所')).toBeNull();
  expect(view.queryByText(/參考已達標|畢業門檻 128/)).toBeNull();
  expect(view.queryByText(/靜宜大學（一般系所）/)).toBeNull();
  expect(view.queryByText('/ 4.00')).toBeNull();
  expect(view.queryByText(/靜宜績點依學則/)).toBeNull();
  await expandFirstSemester(view);
  expect(view.getByText('成大微積分')).toBeTruthy();
});

test('unknown PU department does not claim automatic official detection', async () => {
  mockAuth = {
    user: { uid: 'user-a' },
    profile: { uid: 'user-a', schoolId: 'pu', department: '', role: 'student' },
  };
  const view = render(<CreditAuditScreen />);
  await waitFor(() => {
    expect(view.getAllByText(/尚未對應到明確系所|門檻未驗證/).length).toBeGreaterThan(0);
  });
  expect(view.queryByText(/已根據 E 校園資料自動偵測/)).toBeNull();
  await expandFirstSemester(view);
  expect(view.getByText('資料庫管理')).toBeTruthy();
});

test('ungraded and zero-credit rows stay distinct in semester details', async () => {
  mockListGrades.mockResolvedValue([
    grade({
      id: 'zero-score',
      courseName: '零分重修課',
      courseCode: 'Z1',
      score: 0,
      gradePoint: 0,
      credits: 2,
      semester: '1131',
    }),
    grade({
      id: 'ungraded',
      courseName: '尚未評分課',
      courseCode: 'U1',
      score: undefined,
      grade: undefined,
      letterGrade: undefined,
      gradePoint: undefined,
      credits: 3,
      semester: '1131',
    }),
    grade({
      id: 'zero-credit',
      courseName: '零學分體育',
      courseCode: 'PE1',
      courseType: '體育',
      score: 90,
      gradePoint: 4,
      credits: 0,
      semester: '1131',
    }),
  ]);
  const view = render(<CreditAuditScreen />);
  await expandFirstSemester(view);
  expect(view.getByText('零分重修課')).toBeTruthy();
  expect(view.getByText('尚未評分課')).toBeTruthy();
  expect(view.getByText('零學分體育')).toBeTruthy();
  expect(view.getAllByText('0').length).toBeGreaterThan(0);
  expect(view.getAllByText('未評分').length).toBeGreaterThan(0);
  expect(view.getByText(/加權平均：0\.0/)).toBeTruthy();
  // 僅零分課有學分+績點 → 參考 GPA 0.00 合法
  await view.findByText('0.00');
});

test('offline school cache notice does not claim fresh school update', async () => {
  mockListGrades.mockResolvedValue(
    mapPuOfficialGrades(
      [{ semester: '1131', courseName: '離線快取課', credits: 2, score: 80 }],
      { studentId: 'user-a', schoolId: 'tw-pu', gradeSource: 'school-official-offline' },
    ),
  );
  const view = render(<CreditAuditScreen />);
  await view.findByText(/離線快取的校務成績，不是這次即時校方更新/);
  await expandFirstSemester(view);
  expect(view.getByText('離線快取課')).toBeTruthy();
});

test('CreditSummaryScreen failure then retry; non-PU summary omits PU graduation claim', async () => {
  mockListGrades.mockRejectedValueOnce(new Error('summary offline'));
  const summary = render(<CreditSummaryScreen />);
  await summary.findByText(/summary offline/);
  expect(summary.getByText(/不是「沒有成績」/)).toBeTruthy();

  mockListGrades.mockResolvedValueOnce([grade()]);
  await act(async () => {
    fireEvent.press(summary.getByText('重新讀取'));
  });
  await waitFor(() => expect(summary.getByText(/粗估已修/)).toBeTruthy());
  summary.unmount();

  mockSchool = { id: 'ncku', name: '國立成功大學', shortName: '成大' };
  mockListGrades.mockResolvedValue([
    grade({ schoolId: 'ncku', courseName: '成大課', courseCode: 'N1', courseId: 'n1' }),
  ]);
  const other = render(<CreditSummaryScreen />);
  await other.findByText('修課學分加總');
  expect(other.getAllByText(/未套用畢業門檻|沒有套用靜宜/).length).toBeGreaterThan(0);
  expect(other.queryByText(/總學分已達標/)).toBeNull();
});

test('CreditSummaryScreen reconnect action opens the existing school login screen', async () => {
  mockLoadSchoolCreditOverview.mockRejectedValueOnce(new SchoolCreditOverviewError('reconnect'));
  const view = render(<CreditSummaryScreen />);
  fireEvent.press(await view.findByLabelText('重新連線學校帳號'));
  expect(rootNavigateMeScreen).toHaveBeenCalledWith('SSOLogin');
});

test.each(['profile-loading', 'token-expired', 'wrong-profile-user', 'wrong-profile-school'])(
  'CreditSummaryScreen hides school totals for %s and cannot restore a pending old read',
  async (condition) => {
    mockLoadSchoolCreditOverview.mockResolvedValueOnce(schoolCreditOverview());
    const view = render(<CreditSummaryScreen />);
    await view.findByText('71.5 學分');
    const pending = deferred<PuCreditOverviewSnapshot>();
    mockLoadSchoolCreditOverview.mockReturnValueOnce(pending.promise);
    fireEvent.press(view.getByLabelText('更新校方學分累計'));
    expect(view.getByText('71.5 學分')).toBeTruthy();

    const readyAuth = mockAuth;
    if (condition === 'profile-loading') mockAuth = { ...readyAuth, profileLoading: true };
    else if (condition === 'token-expired') mockAuth = { ...readyAuth, tokenExpired: true };
    else if (condition === 'wrong-profile-user')
      mockAuth = { ...readyAuth, profile: { ...readyAuth.profile!, uid: 'user-b' } };
    else mockAuth = { ...readyAuth, profile: { ...readyAuth.profile!, schoolId: 'nthu' } };
    view.rerender(<CreditSummaryScreen />);
    expect(view.queryByTestId('school-credit-overview')).toBeNull();
    expect(view.queryByText('71.5 學分')).toBeNull();

    await act(async () => { pending.resolve(schoolCreditOverview(74.5)); });
    expect(view.queryByTestId('school-credit-overview')).toBeNull();
    expect(view.queryByText('74.5 學分')).toBeNull();
    expect(mockLoadSchoolCreditOverview).toHaveBeenCalledTimes(2);

    mockLoadSchoolCreditOverview.mockResolvedValueOnce(schoolCreditOverview(92));
    mockAuth = readyAuth;
    view.rerender(<CreditSummaryScreen />);
    expect(await view.findByText('92 學分')).toBeTruthy();
    expect(view.queryByText('71.5 學分')).toBeNull();
    expect(view.queryByText('74.5 學分')).toBeNull();
    expect(mockLoadSchoolCreditOverview).toHaveBeenCalledTimes(3);
  },
);
