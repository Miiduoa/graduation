import {
  courseOverlapScore,
  complementarityScore,
  scheduleOverlapScore,
  learningStyleScore,
  matchStudyBuddies,
  DEMO_BUDDY_CANDIDATES,
  DEMO_ME_PROFILE,
  type StudentBuddyProfile,
} from '../services/aiStudyBuddyMatcher';

const baseMe: StudentBuddyProfile = {
  uid: 'me',
  displayName: 'Me',
  enrolledCourseIds: [1, 2, 3, 4],
  courseStrength: { 1: 80, 2: 50, 3: 30, 4: 60 },
  freeTimeSlots: [10, 11, 12, 13, 14],
  primaryStyle: 'visual',
};

describe('aiStudyBuddyMatcher / sub-scores', () => {
  test('courseOverlapScore: 完全相同的修課給 100', () => {
    const them = { ...baseMe, uid: 't' };
    expect(courseOverlapScore(baseMe, them).score).toBe(100);
    expect(courseOverlapScore(baseMe, them).sharedCourseIds).toEqual([1, 2, 3, 4]);
  });

  test('courseOverlapScore: 完全沒共同課給 0', () => {
    const them: StudentBuddyProfile = {
      ...baseMe,
      uid: 't',
      enrolledCourseIds: [99, 100],
      courseStrength: {},
    };
    expect(courseOverlapScore(baseMe, them).score).toBe(0);
  });

  test('complementarityScore: 完美互補 (gap ~30) 給高分', () => {
    const them: StudentBuddyProfile = {
      ...baseMe,
      uid: 't',
      courseStrength: { 1: 50, 2: 80, 3: 60, 4: 30 }, // gap 30, 30, 30, 30
    };
    const out = complementarityScore(baseMe, them);
    expect(out.score).toBeGreaterThanOrEqual(85);
    expect(out.complementCourses.length).toBe(4);
  });

  test('complementarityScore: 全部強弱差距過大時降分', () => {
    const meExtreme: StudentBuddyProfile = {
      ...baseMe,
      courseStrength: { 1: 95, 2: 95, 3: 95, 4: 95 },
    };
    const them: StudentBuddyProfile = {
      ...baseMe,
      uid: 't',
      courseStrength: { 1: 5, 2: 5, 3: 5, 4: 5 }, // gap 90 各題
    };
    const out = complementarityScore(meExtreme, them);
    expect(out.score).toBeLessThan(50);
  });

  test('scheduleOverlapScore: 6h 以上滿分', () => {
    const them: StudentBuddyProfile = {
      ...baseMe,
      uid: 't',
      freeTimeSlots: [10, 11, 12, 13, 14, 15, 16, 17],
    };
    const out = scheduleOverlapScore(baseMe, them);
    expect(out.overlapHours).toBeGreaterThanOrEqual(5);
    expect(out.score).toBeGreaterThanOrEqual(80);
  });

  test('scheduleOverlapScore: 完全不重疊給 0', () => {
    const them: StudentBuddyProfile = {
      ...baseMe,
      uid: 't',
      freeTimeSlots: [50, 51, 52],
    };
    expect(scheduleOverlapScore(baseMe, them).score).toBe(0);
  });

  test('learningStyleScore: 互補組合給高分', () => {
    const them: StudentBuddyProfile = { ...baseMe, uid: 't', primaryStyle: 'reading' };
    expect(learningStyleScore(baseMe, them)).toBe(90);
  });

  test('learningStyleScore: 同質組合給中等分', () => {
    const them: StudentBuddyProfile = { ...baseMe, uid: 't', primaryStyle: 'visual' };
    expect(learningStyleScore(baseMe, them)).toBe(65);
  });
});

describe('matchStudyBuddies / 整合', () => {
  test('回傳結果有限制 topN 且按分數排序', () => {
    const result = matchStudyBuddies(DEMO_ME_PROFILE, DEMO_BUDDY_CANDIDATES, { topN: 3 });
    expect(result.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].overallScore).toBeGreaterThanOrEqual(result[i].overallScore);
    }
  });

  test('預設過濾沒共同課的人', () => {
    const onlyOneSharedCourse: StudentBuddyProfile = {
      uid: 'noShare',
      displayName: 'X',
      enrolledCourseIds: [88888],
      courseStrength: {},
      freeTimeSlots: [],
      primaryStyle: 'visual',
    };
    const result = matchStudyBuddies(DEMO_ME_PROFILE, [onlyOneSharedCourse]);
    expect(result.length).toBe(0);
  });

  test('每個結果應該至少有 1 個 reason 或 caution', () => {
    const result = matchStudyBuddies(DEMO_ME_PROFILE, DEMO_BUDDY_CANDIDATES);
    expect(result.length).toBeGreaterThan(0);
    for (const r of result) {
      expect(r.reasons.length + r.cautions.length).toBeGreaterThan(0);
      expect(r.overallScore).toBeGreaterThanOrEqual(0);
      expect(r.overallScore).toBeLessThanOrEqual(100);
    }
  });

  test('不會把自己當成 buddy', () => {
    const result = matchStudyBuddies(
      DEMO_ME_PROFILE,
      [...DEMO_BUDDY_CANDIDATES, DEMO_ME_PROFILE],
    );
    expect(result.find((r) => r.buddyUid === DEMO_ME_PROFILE.uid)).toBeUndefined();
  });
});
