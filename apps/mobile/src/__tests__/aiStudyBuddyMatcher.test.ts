import {
  courseOverlapScore,
  complementarityScore,
  scheduleOverlapScore,
  learningStyleScore,
  matchStudyBuddies,
  findInstantHelp,
  suggestStudyTeam,
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

describe('findInstantHelp / 即時求助', () => {
  test('只回傳線上 + 該科比我強的人', () => {
    const result = findInstantHelp({
      courseId: 71378,
      myStrength: 55,
      candidates: DEMO_BUDDY_CANDIDATES,
    });
    expect(result.length).toBeGreaterThan(0);
    for (const r of result) {
      const profile = DEMO_BUDDY_CANDIDATES.find((c) => c.uid === r.buddyUid)!;
      expect(profile.isOnlineNow).toBe(true);
      expect(r.theirStrength).toBeGreaterThan(55);
    }
  });

  test('按 helpScore 排序，速度快 + gap 大 = 排前面', () => {
    const result = findInstantHelp({
      courseId: 71378,
      myStrength: 40,
      candidates: DEMO_BUDDY_CANDIDATES,
    });
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].helpScore).toBeGreaterThanOrEqual(result[i].helpScore);
    }
  });

  test('沒人線上 → 回空陣列', () => {
    const allOffline = DEMO_BUDDY_CANDIDATES.map((c) => ({ ...c, isOnlineNow: false }));
    const result = findInstantHelp({
      courseId: 71378,
      myStrength: 30,
      candidates: allOffline,
    });
    expect(result).toEqual([]);
  });

  test('我比所有人強 → 沒有可以幫我的人', () => {
    const result = findInstantHelp({
      courseId: 71378,
      myStrength: 99,
      candidates: DEMO_BUDDY_CANDIDATES,
    });
    expect(result).toEqual([]);
  });
});

describe('suggestStudyTeam / 多人組隊', () => {
  test('預設組 3 人', () => {
    const team = suggestStudyTeam(DEMO_ME_PROFILE, DEMO_BUDDY_CANDIDATES);
    expect(team.members.length).toBeLessThanOrEqual(3);
    expect(team.synergyScore).toBeGreaterThanOrEqual(0);
    expect(team.synergyScore).toBeLessThanOrEqual(100);
  });

  test('teamSize 自訂', () => {
    const team = suggestStudyTeam(DEMO_ME_PROFILE, DEMO_BUDDY_CANDIDATES, { teamSize: 4 });
    expect(team.members.length).toBeLessThanOrEqual(4);
  });

  test('teamSize 上限 5', () => {
    const team = suggestStudyTeam(DEMO_ME_PROFILE, DEMO_BUDDY_CANDIDATES, { teamSize: 99 });
    expect(team.members.length).toBeLessThanOrEqual(5);
  });

  test('每位成員都有 role 與 individualScore', () => {
    const team = suggestStudyTeam(DEMO_ME_PROFILE, DEMO_BUDDY_CANDIDATES, { teamSize: 3 });
    for (const m of team.members) {
      expect(m.role).toBeDefined();
      expect(typeof m.individualScore).toBe('number');
      expect(m.reasoning.length).toBeGreaterThan(0);
    }
  });

  test('成員不會重複', () => {
    const team = suggestStudyTeam(DEMO_ME_PROFILE, DEMO_BUDDY_CANDIDATES, { teamSize: 4 });
    const ids = team.members.map((m) => m.buddyUid);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('多樣化：3 人組通常有不同 role', () => {
    const team = suggestStudyTeam(DEMO_ME_PROFILE, DEMO_BUDDY_CANDIDATES, { teamSize: 3 });
    const distinctRoles = new Set(team.members.map((m) => m.role)).size;
    expect(distinctRoles).toBeGreaterThanOrEqual(2);
  });
});
