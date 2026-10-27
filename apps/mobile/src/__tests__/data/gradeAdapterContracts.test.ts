import { NCHUAdapter, mapNchuOfficialGrades } from '../../data/apiAdapters/NCHUAdapter';
import {
  PUAdapter,
  mapPuOfficialGrades,
  puScoreToGradePoint,
} from '../../data/apiAdapters/PUAdapter';
import { filterScopedGrades } from '../../screens/creditAudit/gradeScope';
import {
  computeCreditTotals,
  computeReferenceGpa,
  isUngraded,
  numericScore,
  scoreDisplay,
} from '../../screens/creditAudit/creditMath';
import {
  getAnyCachedGrades,
  getCachedGrades,
  refreshGrades,
  seedCachedGrades,
} from '../../services/puDataCache';

let mockGradeRequester: { uid: string; getIdToken?: () => Promise<string> } | null = {
  uid: 'user-b',
};

jest.mock('../../firebase', () => ({
  ...jest.requireActual('../../firebase'),
  getAuthInstance: () => ({ currentUser: mockGradeRequester }),
}));

jest.mock('../../services/puDataCache', () => {
  const actual = jest.requireActual('../../services/puDataCache') as Record<string, unknown>;
  return {
    ...actual,
    getCachedGrades: jest.fn(),
    getAnyCachedGrades: jest.fn(),
    refreshGrades: jest.fn(),
    seedCachedGrades: jest.fn().mockResolvedValue(undefined),
  };
});

const mockGetCachedGrades = jest.mocked(getCachedGrades);
const mockGetAnyCachedGrades = jest.mocked(getAnyCachedGrades);
const mockRefreshGrades = jest.mocked(refreshGrades);
const mockSeedCachedGrades = jest.mocked(seedCachedGrades);

const ownerlessACache = {
  grades: [
    {
      semester: '1122',
      courseName: 'A-only-SECRET-COURSE',
      courseNameEn: 'SecretA',
      className: 'A',
      courseType: '必修',
      credits: 3,
      score: 99,
    },
  ],
  allSemesters: ['1122'],
  summary: {},
};

beforeEach(() => {
  mockGradeRequester = { uid: 'user-b' };
  mockGetCachedGrades.mockReset();
  mockGetAnyCachedGrades.mockReset();
  mockRefreshGrades.mockReset();
  mockSeedCachedGrades.mockReset().mockResolvedValue(undefined);
  mockGetCachedGrades.mockResolvedValue(ownerlessACache);
  mockGetAnyCachedGrades.mockResolvedValue(ownerlessACache);
});

describe('PU / NCHU grade adapter contracts', () => {
  test('PU semester row identifiers do not count retaken course credits twice; GPA keeps all attempts', () => {
    const rows = mapPuOfficialGrades(
      [
        { semester: '1121', courseName: '程式設計', credits: 3, score: 65 },
        { semester: '1131', courseName: '程式設計', credits: 3, score: 85 },
        { semester: '1131', courseName: '程式設計（二）', credits: 3, score: 80 },
      ],
      { studentId: 'u1', schoolId: 'tw-pu', gradeSource: 'school-official' },
    );
    expect(computeCreditTotals(rows, null)).toMatchObject({
      totalEarned: 6,
      totalCourses: 2,
      retakeCollapsed: 1,
    });
    // 學分去重一次；GPA 含兩次「程式設計」＋一次「程式設計（二）」→ 9 學分
    expect(computeReferenceGpa(rows)).toMatchObject({
      totalCredits: 9,
      retakeCollapsed: 1,
      gradePointScale: 4.3,
    });
  });

  test('real adapter score labels retain Pass and pending; Pass excluded from GPA mean', () => {
    const rows = mapPuOfficialGrades(
      ['Pass', '成績處理中', '0', '88分', ''].map((score, i) => ({
        semester: '1131',
        courseName: `課程${i}`,
        credits: 2,
        score,
      })),
      { studentId: 'u1', schoolId: 'tw-pu', gradeSource: 'school-official' },
    );
    expect(rows.map(numericScore)).toEqual([null, null, 0, null, null]);
    expect(rows.map(scoreDisplay)).toEqual(['Pass', '成績處理中', '0', '88分', '未評分']);
    expect(rows.map(isUngraded)).toEqual([false, true, false, true, true]);
    expect(rows[0].gradePoint).toBeUndefined();
    expect(computeCreditTotals(rows, null)).toMatchObject({
      totalEarned: 2,
      passedCount: 1,
      failedCount: 1,
      ungradedCount: 3,
    });
    // Pass 排除；僅數值 0（績點 0）計入 → GPA 0.00
    expect(computeReferenceGpa(rows)).toEqual({
      gpa: 0,
      totalCredits: 2,
      totalPoints: 0,
      retakeCollapsed: 0,
      gradePointScale: 4.3,
    });
    const nchu = mapNchuOfficialGrades(
      ['Pass', '', '0'].map((grade, i) => ({
        courseId: `c${i}`,
        semester: '1131',
        courseName: `中興${i}`,
        credits: 2,
        grade,
        gradePoint: undefined,
      })),
      { studentId: 'u1', schoolId: 'tw-nchu' },
    );
    expect(nchu.map(numericScore)).toEqual([null, null, 0]);
    expect(computeCreditTotals(nchu, null)).toMatchObject({
      totalEarned: 2,
      passedCount: 1,
      failedCount: 1,
      ungradedCount: 1,
    });
    // 數值 0 缺績點 → 不可用（不捏造）
    expect(computeReferenceGpa(nchu)).toBeNull();
  });

  test('mapPuOfficialGrades binds schoolId + source, 4.3 local GP, omits publishedAt', () => {
    const rows = mapPuOfficialGrades(
      [
        {
          semester: '1122',
          courseName: '程式設計',
          courseNameEn: 'Programming',
          className: 'A',
          courseType: '必修',
          credits: 3,
          score: 92,
        },
        { semester: '1122', courseName: '微積分', credits: 3, score: 85 },
        { semester: '1122', courseName: '英文', credits: 2, score: 59 },
      ],
      {
        studentId: '410000001',
        schoolId: 'tw-pu',
        gradeSource: 'school-official',
      },
    );

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      userId: '410000001',
      schoolId: 'tw-pu',
      gradeSource: 'school-official',
      courseName: '程式設計',
      credits: 3,
      score: 92,
      grade: 92,
      gradePoint: 4.3,
      gradePointScale: 4.3,
      gradePointProvenance: 'local-reference',
      semester: '1122',
    });
    expect(puScoreToGradePoint(92)).toBe(4.3);
    expect(rows[1]).toMatchObject({
      score: 85,
      gradePoint: 4.0,
      gradePointScale: 4.3,
      gradePointProvenance: 'local-reference',
    });
    expect(rows[2]).toMatchObject({
      score: 59,
      gradePoint: 1.3,
      gradePointScale: 4.3,
    });
    expect(rows[0].publishedAt).toBeUndefined();
    expect(filterScopedGrades(rows, '410000001', 'pu')).toHaveLength(3);
  });

  test('mapPuOfficialGrades offline provenance stays distinct from fresh school update', () => {
    const rows = mapPuOfficialGrades(
      [{ semester: '1121', courseName: '離線列', credits: 2, score: 70 }],
      {
        studentId: 'u1',
        schoolId: 'tw-pu',
        gradeSource: 'school-official-offline',
      },
    );
    expect(rows[0].gradeSource).toBe('school-official-offline');
    expect(rows[0].publishedAt).toBeUndefined();
  });

  test('mapNchuOfficialGrades binds schoolId + source from API fields without publishedAt', () => {
    const rows = mapNchuOfficialGrades(
      [
        {
          courseId: 'CS101',
          courseName: '計算機概論',
          credits: 3,
          grade: '85',
          gradePoint: 3.7,
          semester: '1131',
        },
      ],
      { studentId: 'student-nchu', schoolId: 'tw-nchu' },
    );

    expect(rows[0]).toMatchObject({
      id: 'nchu-grade-CS101-1131',
      userId: 'student-nchu',
      schoolId: 'tw-nchu',
      gradeSource: 'school-official',
      courseId: 'CS101',
      grade: 85,
      gradePoint: 3.7,
    });
    expect(rows[0].publishedAt).toBeUndefined();
    expect(filterScopedGrades(rows, 'student-nchu', 'tw-nchu')).toHaveLength(1);
  });

  test('NCHU token belonging to A cannot label its response as signed-in B', async () => {
    const adapter = new NCHUAdapter();
    Object.assign(adapter, { credentials: { accessToken: 'test-a-token', userId: 'user-a' } });
    const request = jest.fn();
    Object.assign(adapter, { request });
    await expect(adapter.listGrades('user-b')).rejects.toThrow('請重新連線學校帳號');
    expect(request).not.toHaveBeenCalled();
  });

  test('NCHU ignores a late response after the same account logs in again', async () => {
    const adapter = new NCHUAdapter();
    Object.assign(adapter, { credentials: { accessToken: 'test-b-token', userId: 'user-b' } });
    let finish!: (value: unknown) => void;
    Object.assign(adapter, {
      request: jest.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ),
    });
    const pending = adapter.listGrades('user-b');
    mockGradeRequester = { uid: 'user-a' };
    mockGradeRequester = { uid: 'user-b' };
    finish({ success: true, data: { grades: [] } });
    await expect(pending).rejects.toThrow('帳號已變更');
  });

  test('NCHUAdapter.listGrades throws on failed response instead of empty-success', async () => {
    const adapter = new NCHUAdapter();
    mockGradeRequester = { uid: 'sid-1' };
    Object.assign(adapter, { credentials: { accessToken: 'test-nchu-token', userId: 'sid-1' } });
    const request = jest.fn().mockResolvedValue({
      success: false,
      error: { message: 'upstream down' },
    });
    (adapter as unknown as { request: typeof request }).request = request;

    await expect(adapter.listGrades('sid-1')).rejects.toThrow(/upstream down|無法讀取校務成績/);
  });

  test('NCHUAdapter.listGrades returns empty array on successful empty payload', async () => {
    const adapter = new NCHUAdapter();
    mockGradeRequester = { uid: 'sid-1' };
    Object.assign(adapter, { credentials: { accessToken: 'test-nchu-token', userId: 'sid-1' } });
    const request = jest.fn().mockResolvedValue({
      success: true,
      data: { grades: [] },
    });
    (adapter as unknown as { request: typeof request }).request = request;

    await expect(adapter.listGrades('sid-1')).resolves.toEqual([]);
  });

  test('NCHUAdapter.listGrades maps successful rows with adapter schoolId', async () => {
    const adapter = new NCHUAdapter();
    expect(adapter.schoolId).toBe('tw-nchu');
    mockGradeRequester = { uid: 'auth-uid' };
    Object.assign(adapter, { credentials: { accessToken: 'test-nchu-token', userId: 'auth-uid' } });
    const request = jest.fn().mockResolvedValue({
      success: true,
      data: {
        grades: [
          {
            courseId: 'M1',
            courseName: '微積分',
            credits: 4,
            grade: 78,
            gradePoint: 3.0,
            semester: '1121',
          },
        ],
      },
    });
    (adapter as unknown as { request: typeof request }).request = request;

    const rows = await adapter.listGrades('auth-uid');
    expect(rows).toHaveLength(1);
    expect(rows[0].schoolId).toBe('tw-nchu');
    expect(rows[0].userId).toBe('auth-uid');
    expect(rows[0].gradeSource).toBe('school-official');
    expect(rows[0].publishedAt).toBeUndefined();
  });
});

const freshBackendGrades = {
  success: true,
  grades: [
    {
      semester: '1131',
      courseName: 'B-backend-COURSE',
      courseNameEn: '',
      class: '',
      courseType: '必修',
      credits: 3,
      score: 88,
    },
  ],
  allSemesters: ['1131'],
  summary: {},
};
function backendAdapter(value: unknown = freshBackendGrades) {
  const adapter = new PUAdapter();
  adapter.setBackendSession('backend-session-b', 'school-student-b', 'B');
  const fetchData = jest.fn().mockResolvedValue(value);
  (adapter as unknown as { fetchData: typeof fetchData }).fetchData = fetchData;
  return { adapter, fetchData };
}

describe('PUAdapter.listGrades authenticated ownership boundary', () => {
  test('rejects an unowned direct session instead of relabeling its grades as another account', async () => {
    const adapter = new PUAdapter();
    adapter.setDirectSession({ loggedIn: true, studentName: 'A' }, 'school-student-a');
    mockRefreshGrades.mockResolvedValue(ownerlessACache);
    await expect(adapter.listGrades('user-b')).rejects.toThrow('請重新連線學校帳號');
    expect(mockRefreshGrades).not.toHaveBeenCalled();
    expect(mockGetCachedGrades).not.toHaveBeenCalled();
    expect(mockGetAnyCachedGrades).not.toHaveBeenCalled();
    expect(mockSeedCachedGrades).not.toHaveBeenCalled();
  });

  test('no server-owned session is unavailable, never empty-success or ownerless cache', async () => {
    await expect(new PUAdapter().listGrades('user-b')).rejects.toThrow('請重新連線學校帳號');
    expect(mockGetCachedGrades).not.toHaveBeenCalled();
    expect(mockGetAnyCachedGrades).not.toHaveBeenCalled();
  });

  test('a restored Firebase account reads its server-owned grades without an in-memory session', async () => {
    mockGradeRequester = { uid: 'user-b', getIdToken: async () => 'restored-user-token' };
    const originalFetch = globalThis.fetch;
    const fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        result: {
          success: true,
          ownerUid: 'user-b',
          schoolId: 'pu',
          source: 'pu-campus',
          dataType: 'grades',
          result: {
            success: true,
            grades: [{ semester: '1151', courseName: '資料庫', credits: 3, score: 88 }],
          },
        },
      }),
    } as Response);
    globalThis.fetch = fetch;
    try {
      const rows = await new PUAdapter().listGrades('user-b', '1151');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        userId: 'user-b',
        schoolId: 'tw-pu',
        gradeSource: 'school-official',
        courseName: '資料庫',
      });
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('getMyAcademicRecords'),
        expect.objectContaining({
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer restored-user-token',
          },
          body: JSON.stringify({ data: { dataType: 'grades' } }),
        }),
      );
      expect(mockGetAnyCachedGrades).not.toHaveBeenCalled();
      expect(mockRefreshGrades).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('keeps fresh backend rows and binds only the authenticated requester', async () => {
    const { adapter } = backendAdapter();
    const rows = await adapter.listGrades('user-b');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: 'user-b',
      schoolId: 'tw-pu',
      courseName: 'B-backend-COURSE',
      gradeSource: 'school-official',
    });
    expect(rows[0].publishedAt).toBeUndefined();
    expect(filterScopedGrades(rows, 'user-b', 'pu')).toHaveLength(1);
    expect(mockGetCachedGrades).not.toHaveBeenCalled();
    expect(mockGetAnyCachedGrades).not.toHaveBeenCalled();
    expect(mockSeedCachedGrades).not.toHaveBeenCalled();
  });

  test('backend failure cannot fall back to the previous account cache', async () => {
    const { adapter } = backendAdapter(null);
    await expect(adapter.listGrades('user-b')).rejects.toThrow('無法讀取校務成績');
    expect(mockRefreshGrades).not.toHaveBeenCalled();
    expect(mockGetAnyCachedGrades).not.toHaveBeenCalled();
  });

  test('a caller uid different from current Firebase identity never starts the read', async () => {
    const { adapter, fetchData } = backendAdapter();
    mockGradeRequester = { uid: 'user-a' };
    await expect(adapter.listGrades('user-b')).rejects.toThrow('請重新連線學校帳號');
    expect(fetchData).not.toHaveBeenCalled();
  });

  test('account round trip and late cache write do not resurrect an old read', async () => {
    const { adapter, fetchData } = backendAdapter();
    let finish!: (value: unknown) => void;
    fetchData.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = adapter.listGrades('user-b');
    mockGradeRequester = { uid: 'user-a' };
    mockGetCachedGrades.mockResolvedValue(ownerlessACache);
    mockGradeRequester = { uid: 'user-b' };
    finish(freshBackendGrades);
    await expect(pending).rejects.toThrow('帳號已變更');
    expect(mockGetCachedGrades).not.toHaveBeenCalled();
    expect(mockSeedCachedGrades).not.toHaveBeenCalled();
  });

  test('only a successful empty payload counts as no school records', async () => {
    const empty = backendAdapter({ success: true, grades: [] });
    await expect(empty.adapter.listGrades('user-b')).resolves.toEqual([]);
    const malformed = backendAdapter({ success: true });
    await expect(malformed.adapter.listGrades('user-b')).rejects.toThrow('無法讀取校務成績');
  });
});
