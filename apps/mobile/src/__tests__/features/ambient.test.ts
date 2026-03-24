import AsyncStorage from '@react-native-async-storage/async-storage';

import type { AmbientCue, CourseSpace } from '../../data/types';
import { dismissAmbientCue, listAmbientCues, applyAmbientCueVisibilityRules } from '../../features/engagement/ambient';
import { getDataSource } from '../../data/source';

jest.mock('../../data/source', () => ({
  getDataSource: jest.fn(),
}));

jest.mock('../../config/runtime', () => ({
  getRuntimeDataSourcePolicy: jest.fn(() => ({
    requestedMode: 'firebase',
  })),
}));

jest.mock('../../services/release', () => ({
  getReleaseConfig: jest.fn(() => ({
    appEnv: 'production',
  })),
}));

jest.mock('../../services/analytics', () => ({
  analytics: {
    logEvent: jest.fn(),
  },
}));

const mockedGetDataSource = getDataSource as jest.MockedFunction<typeof getDataSource>;

function createCourseSpace(overrides: Partial<CourseSpace> = {}): CourseSpace {
  return {
    id: 'group-1',
    groupId: 'group-1',
    name: '軟體工程',
    unreadCount: 0,
    assignmentCount: 2,
    dueSoonCount: 1,
    quizCount: 0,
    moduleCount: 4,
    activeSessionId: null,
    latestDueAt: new Date(),
    memberCount: 32,
    activeLearnerCount: 6,
    completedAssignmentCount: 11,
    completionRate: 34,
    socialProofUpdatedAt: new Date(),
    schoolId: 'school-1',
    ...overrides,
  };
}

function createCue(overrides: Partial<AmbientCue> = {}): AmbientCue {
  return {
    id: 'cue-1',
    surface: 'today',
    role: 'student',
    signalType: 'course_completion',
    headline: '已有 11 位同學先完成軟體工程',
    body: '先跟上最接近截止的一步。',
    ctaLabel: '前往處理',
    metric: '34% 跟上進度',
    distinctUserCount: 11,
    updatedAt: new Date(),
    dismissKey: 'today.group-1',
    ...overrides,
  };
}

describe('ambient social proof', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockedGetDataSource.mockReset();
  });

  it('filters out low-sample and stale cues', () => {
    const now = new Date('2026-03-21T10:00:00.000Z').getTime();
    const freshCue = createCue();
    const lowSampleCue = createCue({ id: 'cue-2', distinctUserCount: 2 });
    const staleCue = createCue({
      id: 'cue-3',
      updatedAt: new Date('2026-03-19T08:00:00.000Z'),
    });

    const result = applyAmbientCueVisibilityRules([freshCue, lowSampleCue, staleCue], now);

    expect(result.visible).toEqual([freshCue]);
    expect(result.hiddenLowSample).toEqual([lowSampleCue]);
  });

  it('builds a course completion cue from course social proof', async () => {
    mockedGetDataSource.mockReturnValue({
      listCourseSpaces: jest.fn().mockResolvedValue([createCourseSpace()]),
      listAchievements: jest.fn().mockResolvedValue([]),
    } as unknown as ReturnType<typeof getDataSource>);

    const cues = await listAmbientCues({
      schoolId: 'school-1',
      uid: 'user-1',
      role: 'student',
      surface: 'today',
    });

    expect(cues).toHaveLength(1);
    expect(cues[0]?.headline).toContain('已有 11 位同學先完成');
    expect(cues[0]?.distinctUserCount).toBe(11);
  });

  it('suppresses dismissed cues for the current day', async () => {
    mockedGetDataSource.mockReturnValue({
      listCourseSpaces: jest.fn().mockResolvedValue([createCourseSpace()]),
      listAchievements: jest.fn().mockResolvedValue([]),
    } as unknown as ReturnType<typeof getDataSource>);

    const [cue] = await listAmbientCues({
      schoolId: 'school-1',
      uid: 'user-1',
      role: 'student',
      surface: 'today',
    });

    expect(cue).toBeTruthy();

    await dismissAmbientCue({
      dismissKey: cue.dismissKey,
      uid: 'user-1',
      schoolId: 'school-1',
    });

    const cuesAfterDismiss = await listAmbientCues({
      schoolId: 'school-1',
      uid: 'user-1',
      role: 'student',
      surface: 'today',
    });

    expect(cuesAfterDismiss).toEqual([]);
  });
});
