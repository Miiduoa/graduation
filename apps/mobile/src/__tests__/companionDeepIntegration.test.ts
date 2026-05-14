/**
 * @jest-environment node
 *
 * 對 signalAggregator + achievements + rubricScoring + riskRadar + discussionEngine + questionBank
 * 的完整測試，驗證精靈/花園/LMS 與全 APP 功能深度結合。
 */
import {
  aggregateCompanionEvents,
  evaluateAchievements,
  evaluateRubric,
  computeStudentRiskRadar,
  computeThreadMetric,
  computeUserContributions,
  drawQuestionsForQuiz,
  checkQuestionBankHealth,
  type CompanionEvent,
  type Rubric,
  type CourseRiskInput,
  type DiscussionThread,
  type QuestionBank,
} from '@campus/shared';

// ─────────────────────────────────────────────────────────
// signalAggregator
// ─────────────────────────────────────────────────────────

describe('signalAggregator', () => {
  test('多種事件依日期聚合', () => {
    const events: CompanionEvent[] = [
      { eventId: 'e1', kind: 'assignment_submitted', at: '2026-05-13T10:00:00Z' },
      { eventId: 'e2', kind: 'meal_ordered', at: '2026-05-13T12:00:00Z', payload: { vendorId: 'v1', balanced: true } },
      { eventId: 'e3', kind: 'library_borrow', at: '2026-05-13T15:00:00Z' },
      { eventId: 'e4', kind: 'poi_visited', at: '2026-05-13T16:00:00Z', payload: { poiId: 'd305' } },
    ];
    const r = aggregateCompanionEvents(events);
    expect(r.days).toHaveLength(1);
    expect(r.days[0].assignmentsSubmitted).toBe(1);
    expect(r.days[0].mealsOrdered).toBe(1);
    expect(r.days[0].distinctVendors).toBe(1);
    expect(r.days[0].libraryActions).toBe(1);
    expect(r.days[0].campusVisitsCount).toBe(1);
    expect(r.lifetimeCounters['distinctPoiVisited']).toBe(1);
    expect(r.lifetimeCounters['balancedMealDays']).toBe(1);
  });

  test('重複 eventId 會去重', () => {
    const events: CompanionEvent[] = [
      { eventId: 'dup', kind: 'attendance_checkin', at: '2026-05-13T09:00:00Z' },
      { eventId: 'dup', kind: 'attendance_checkin', at: '2026-05-13T09:00:00Z' },
    ];
    const r = aggregateCompanionEvents(events);
    expect(r.days[0].attendanceCheckins).toBe(1);
  });

  test('一週步數 ≥ 35000 → highStepWeeks +1', () => {
    const events: CompanionEvent[] = Array.from({ length: 5 }, (_, i) => ({
      eventId: `s${i}`,
      kind: 'steps_logged',
      at: `2026-05-${11 + i}T09:00:00Z`,
      payload: { steps: 8000 },
    }));
    const r = aggregateCompanionEvents(events);
    expect(r.lifetimeCounters['highStepWeeks']).toBeGreaterThanOrEqual(1);
  });

  test('hibernate 標記會吃進當天', () => {
    const r = aggregateCompanionEvents([
      { eventId: 'h', kind: 'mark_hibernate', at: '2026-05-13T00:00:00Z' },
    ]);
    expect(r.days[0].hibernated).toBe(true);
  });

  test('同店家當日只計一次 distinct，但 mealsOrdered 累加', () => {
    const events: CompanionEvent[] = [
      { eventId: 'm1', kind: 'meal_ordered', at: '2026-05-13T12:00:00Z', payload: { vendorId: 'v1' } },
      { eventId: 'm2', kind: 'meal_ordered', at: '2026-05-13T18:00:00Z', payload: { vendorId: 'v1' } },
      { eventId: 'm3', kind: 'meal_ordered', at: '2026-05-13T19:00:00Z', payload: { vendorId: 'v2' } },
    ];
    const r = aggregateCompanionEvents(events);
    expect(r.days[0].mealsOrdered).toBe(3);
    expect(r.days[0].distinctVendors).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────
// achievements
// ─────────────────────────────────────────────────────────

describe('achievements', () => {
  test('借滿 5 本書 → 解鎖書蟲', () => {
    const r = evaluateAchievements({
      progress: { libraryBorrowCount: 5 },
      alreadyUnlocked: new Set(),
    });
    expect(r.newlyUnlocked.some((u) => u.id === 'bookworm')).toBe(true);
  });

  test('已解鎖過不會再次觸發', () => {
    const r = evaluateAchievements({
      progress: { libraryBorrowCount: 10 },
      alreadyUnlocked: new Set(['lib_5_books']),
    });
    expect(r.newlyUnlocked.some((u) => u.id === 'bookworm')).toBe(false);
  });

  test('closestPending 取百分比最高 3 個', () => {
    const r = evaluateAchievements({
      progress: {
        libraryBorrowCount: 4, // 80%
        distinctVendorsLifetime: 8, // 80%
        groupOrderJoinedLifetime: 2, // 67%
        encouragementsSentLifetime: 1, // 10%
      },
      alreadyUnlocked: new Set(),
    });
    expect(r.closestPending).toHaveLength(3);
    expect(r.closestPending[0].percent).toBeGreaterThanOrEqual(r.closestPending[1].percent);
  });
});

// ─────────────────────────────────────────────────────────
// rubricScoring
// ─────────────────────────────────────────────────────────

const RUBRIC: Rubric = {
  id: 'r1',
  title: 'Final Report',
  criteria: [
    {
      id: 'c1',
      title: '內容深度',
      weight: 40,
      levels: [
        { id: 'l1', label: '優', points: 4 },
        { id: 'l2', label: '良', points: 3 },
        { id: 'l3', label: '可', points: 2 },
        { id: 'l4', label: '差', points: 1 },
      ],
    },
    {
      id: 'c2',
      title: '結構清晰',
      weight: 30,
      levels: [
        { id: 'l1', label: '優', points: 4 },
        { id: 'l4', label: '差', points: 1 },
      ],
    },
    {
      id: 'c3',
      title: '參考資料',
      weight: 30,
      levels: [
        { id: 'l1', label: '優', points: 4 },
        { id: 'l3', label: '可', points: 2 },
      ],
    },
  ],
};

describe('rubricScoring', () => {
  test('全優 → 100', () => {
    const r = evaluateRubric(RUBRIC, [
      { criterionId: 'c1', levelId: 'l1' },
      { criterionId: 'c2', levelId: 'l1' },
      { criterionId: 'c3', levelId: 'l1' },
    ]);
    expect(r.totalScore).toBe(100);
  });

  test('部分等級 → 加權後合理', () => {
    const r = evaluateRubric(RUBRIC, [
      { criterionId: 'c1', levelId: 'l2', comment: '論述紮實但缺實例' }, // 3/4 of 40% = 30
      { criterionId: 'c2', levelId: 'l1' }, // 100% of 30% = 30
      { criterionId: 'c3', levelId: 'l3' }, // 2/4 of 30% = 15
    ]);
    expect(r.totalScore).toBe(75);
    expect(r.feedbackSummary).toContain('論述紮實');
  });

  test('weight 加總非 100 自動正規化', () => {
    const rubric: Rubric = {
      id: 'r2',
      title: '',
      criteria: [
        { id: 'a', title: 'A', weight: 1, levels: [{ id: 'top', label: '頂', points: 10 }] },
        { id: 'b', title: 'B', weight: 1, levels: [{ id: 'top', label: '頂', points: 10 }] },
      ],
    };
    const r = evaluateRubric(rubric, [
      { criterionId: 'a', levelId: 'top' },
      { criterionId: 'b', levelId: 'top' },
    ]);
    expect(r.totalScore).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────
// riskRadar
// ─────────────────────────────────────────────────────────

describe('riskRadar', () => {
  test('一切正常 → low risk', () => {
    const courses: CourseRiskInput[] = [
      {
        courseId: 'c1',
        courseName: '資料庫',
        attendanceRate: 0.95,
        missedAssignments: 0,
        totalAssignments: 5,
        lowQuizScores: 0,
        daysSinceLastActivity: 1,
        currentScore: 88,
      },
    ];
    const r = computeStudentRiskRadar(courses);
    expect(r.overallLevel).toBe('low');
  });

  test('多項警示 → critical', () => {
    const courses: CourseRiskInput[] = [
      {
        courseId: 'c1',
        courseName: '資料庫',
        attendanceRate: 0.4,
        missedAssignments: 4,
        totalAssignments: 5,
        lowQuizScores: 3,
        daysSinceLastActivity: 14,
        currentScore: 45,
      },
    ];
    const r = computeStudentRiskRadar(courses);
    expect(r.overallLevel).toBe('critical');
    expect(r.perCourse[0].recommendations.some((x) => x.target === 'counseling')).toBe(true);
  });

  test('≥ 2 門 high 升級為 critical', () => {
    const c: CourseRiskInput = {
      courseId: 'c1',
      courseName: 'A',
      attendanceRate: 0.55,
      missedAssignments: 3,
      totalAssignments: 5,
      lowQuizScores: 2,
      daysSinceLastActivity: 6,
      currentScore: 58,
    };
    const r = computeStudentRiskRadar([
      c,
      { ...c, courseId: 'c2', courseName: 'B' },
    ]);
    expect(r.overallLevel).toBe('critical');
  });

  test('topConcerns 列出最危險的事實', () => {
    const r = computeStudentRiskRadar([
      {
        courseId: 'c1',
        courseName: '演算法',
        attendanceRate: 0.3,
        missedAssignments: 5,
        totalAssignments: 5,
        lowQuizScores: 4,
        daysSinceLastActivity: 20,
        currentScore: 30,
      },
    ]);
    expect(r.topConcerns.length).toBeGreaterThan(0);
    expect(r.topConcerns[0]).toContain('演算法');
  });
});

// ─────────────────────────────────────────────────────────
// discussionEngine
// ─────────────────────────────────────────────────────────

const SAMPLE_THREAD: DiscussionThread = {
  id: 't1',
  authorUid: 'stu1',
  title: 'SQL JOIN 怎麼用？',
  postedAt: '2026-05-10T10:00:00Z',
  viewCount: 35,
  replies: [
    {
      id: 'r1',
      authorUid: 'stu2',
      postedAt: '2026-05-10T11:00:00Z',
      textLength: 150,
      upvotes: 4,
      markedUseful: 2,
    },
    {
      id: 'r2',
      authorUid: 'stu3',
      postedAt: '2026-05-10T12:00:00Z',
      textLength: 80,
      upvotes: 1,
      markedUseful: 0,
      endorsedByTeacher: true,
    },
  ],
};

describe('discussionEngine', () => {
  test('熱度 + 解決分 + best reply', () => {
    const m = computeThreadMetric(SAMPLE_THREAD);
    expect(m.heat).toBeGreaterThan(0);
    expect(m.resolvedScore).toBe(100); // 有 endorsed
    expect(m.topAnswerUid).toBe('stu3'); // teacher endorsed wins
  });

  test('沒 endorsed → resolved 依 useful', () => {
    const m = computeThreadMetric({
      ...SAMPLE_THREAD,
      replies: [
        { id: 'r1', authorUid: 'a', postedAt: '', textLength: 100, upvotes: 0, markedUseful: 1 },
      ],
    });
    expect(m.resolvedScore).toBe(25);
  });

  test('user contributions 合作分排序', () => {
    const r = computeUserContributions([SAMPLE_THREAD]);
    expect(r[0].cooperationScore).toBeGreaterThan(0);
    expect(r.map((u) => u.uid)).toContain('stu2');
    expect(r.map((u) => u.uid)).toContain('stu3');
  });
});

// ─────────────────────────────────────────────────────────
// questionBank
// ─────────────────────────────────────────────────────────

const BANK: QuestionBank = {
  id: 'b1',
  schoolId: 's1',
  title: '資料庫題庫',
  entries: [
    { id: 'q1', type: 'single_choice', prompt: 'easy 1', difficulty: 1, topic: 'SQL', options: [] },
    { id: 'q2', type: 'single_choice', prompt: 'easy 2', difficulty: 1, topic: 'SQL', options: [] },
    { id: 'q3', type: 'single_choice', prompt: 'med 1', difficulty: 2, topic: 'JOIN', options: [] },
    { id: 'q4', type: 'multiple_choice', prompt: 'med 2', difficulty: 2, topic: 'JOIN', options: [] },
    { id: 'q5', type: 'essay', prompt: 'hard 1', difficulty: 3, topic: 'NORMALIZATION' },
    { id: 'q6', type: 'short_answer', prompt: 'hard 2', difficulty: 3, topic: 'NORMALIZATION' },
  ],
};

describe('questionBank', () => {
  test('依難度分布抽題（seed 固定可重現）', () => {
    const r = drawQuestionsForQuiz(BANK, {
      count: 4,
      difficultyDistribution: { 1: 0.5, 2: 0.25, 3: 0.25 },
      seed: 42,
    });
    expect(r).toHaveLength(4);
    expect(new Set(r.map((q) => q.id)).size).toBe(4);
  });

  test('topic 過濾', () => {
    const r = drawQuestionsForQuiz(BANK, { count: 2, topics: ['JOIN'], seed: 1 });
    expect(r).toHaveLength(2);
    r.forEach((q) => expect(q.topic).toBe('JOIN'));
  });

  test('排除 ID', () => {
    const r = drawQuestionsForQuiz(BANK, {
      count: 5,
      excludeIds: new Set(['q1', 'q2']),
      seed: 7,
    });
    expect(r.find((q) => q.id === 'q1' || q.id === 'q2')).toBeUndefined();
  });

  test('健康檢查 → 題庫過小要警告', () => {
    const r = checkQuestionBankHealth({ ...BANK, entries: BANK.entries.slice(0, 3) });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  test('無 difficulty 3 → 警告缺難題', () => {
    const r = checkQuestionBankHealth({
      ...BANK,
      entries: BANK.entries.filter((q) => q.difficulty !== 3),
    });
    expect(r.warnings.some((w) => w.includes('難題'))).toBe(true);
  });
});
