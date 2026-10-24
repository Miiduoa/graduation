import { loadNuniRecentTeacherFeedback } from '../services/nuniRecentFeedback';

function classesStub(handlers: {
  list: () => Promise<
    Array<{ id: string; title: string; state: string; memberRole: string }>
  >;
  assignments: (id: string) => Promise<unknown[]>;
  quizzes: (id: string) => Promise<unknown[]>;
}) {
  return handlers as never;
}

describe('loadNuniRecentTeacherFeedback', () => {
  it('orders mixed Taipei wall times and UTC feedback by their actual instant', async () => {
    const result = await loadNuniRecentTeacherFeedback(
      classesStub({
        list: async () => [
          { id: 'cw_a', title: '資料結構', state: 'active', memberRole: 'student' },
        ],
        assignments: async () => [
          {
            id: 'cwa_older', title: '較早回饋',
            mySubmission: {
              teacherFeedback: '舊稿回饋', reviewedAt: '2026-10-11T10:00:00',
              submittedAt: '2026-10-11T03:00:00Z',
            },
          },
          {
            id: 'cwa_newer', title: '較新回饋',
            mySubmission: {
              teacherFeedback: '新稿回饋', reviewedAt: '2026-10-11T03:00:00Z',
              submittedAt: '2026-10-11T10:00:00',
            },
          },
        ],
        quizzes: async () => [],
      }),
    );
    expect(result.items.map(({ id, stale }) => ({ id, stale }))).toEqual([
      { id: 'cwa_newer', stale: false },
      { id: 'cwa_older', stale: true },
    ]);
  });

  it('returns recent-first feedback with stale marking and opens by course/activity ids', async () => {
    const result = await loadNuniRecentTeacherFeedback(
      classesStub({
        list: async () => [
          {
            id: 'cw_a',
            title: '資料結構',
            state: 'active',
            memberRole: 'student',
          },
          {
            id: 'cw_b',
            title: '授課課',
            state: 'active',
            memberRole: 'owner-teacher',
          },
        ],
        assignments: async (id) =>
          id === 'cw_a'
            ? [
                {
                  id: 'cwa_old',
                  title: '舊回饋作業',
                  mySubmission: {
                    teacherFeedback: '針對舊稿',
                    reviewedAt: '2026-10-08T02:00:00.000Z',
                    submittedAt: '2026-10-09T04:00:00.000Z',
                  },
                },
                {
                  id: 'cwa_new',
                  title: '新回饋作業',
                  mySubmission: {
                    teacherFeedback: '主鍵清楚',
                    reviewedAt: '2026-10-10T02:00:00.000Z',
                    submittedAt: '2026-10-09T04:00:00.000Z',
                  },
                },
              ]
            : [],
        quizzes: async () => [
          {
            id: 'cwq_1',
            title: '小考',
            myResponse: {
              teacherFeedback: '作答完整',
              reviewedAt: '2026-10-11T02:00:00.000Z',
              submittedAt: '2026-10-10T04:00:00.000Z',
            },
          },
        ],
      }),
    );
    expect(result.studiedCourseCount).toBe(1);
    expect(result.failedCourseIds).toEqual([]);
    expect(result.items.map((row) => row.id)).toEqual(['cwq_1', 'cwa_new', 'cwa_old']);
    expect(result.items[2]?.stale).toBe(true);
    expect(result.items[0]?.stale).toBe(false);
  });

  it('reports partial course failures without claiming an empty success', async () => {
    const result = await loadNuniRecentTeacherFeedback(
      classesStub({
        list: async () => [
          { id: 'cw_ok', title: '成功課', state: 'active', memberRole: 'student' },
          { id: 'cw_bad', title: '失敗課', state: 'active', memberRole: 'student' },
        ],
        assignments: async (id) => {
          if (id === 'cw_bad') throw new Error('denied');
          return [
            {
              id: 'cwa_ok',
              title: '作業',
              mySubmission: {
                teacherFeedback: '很好',
                reviewedAt: '2026-10-10T02:00:00.000Z',
                submittedAt: '2026-10-09T04:00:00.000Z',
              },
            },
          ];
        },
        quizzes: async () => [],
      }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.failedCourseIds).toEqual(['cw_bad']);
  });

  it('surfaces total list failure to the caller', async () => {
    await expect(
      loadNuniRecentTeacherFeedback(
        classesStub({
          list: async () => {
            throw Object.assign(new Error('session'), { status: 401 });
          },
          assignments: async () => [],
          quizzes: async () => [],
        }),
      ),
    ).rejects.toBeTruthy();
  });
});
