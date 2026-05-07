import {
  listNextBestActions,
  listPulseAggregates,
  listRiskSnapshots,
  submitPulseReport,
} from '../../data/campusAgentSource';
import { listCourseSpaces, listInboxTasks } from '../../data/courseSpaceSource';
import { submitCrowdReport } from '../../services/campusPulseEngine';
import type { InboxTask } from '../../data/types';

jest.mock('../../firebase', () => ({
  getDb: jest.fn(),
  getFunctionsInstance: jest.fn(),
  isFirebaseMockMode: jest.fn(() => true),
}));

jest.mock('../../data/courseSpaceSource', () => ({
  listCourseSpaces: jest.fn(),
  listInboxTasks: jest.fn(),
}));

jest.mock('../../services/campusPulseEngine', () => ({
  submitCrowdReport: jest.fn().mockResolvedValue(undefined),
}));

const mockedListInboxTasks = listInboxTasks as jest.MockedFunction<typeof listInboxTasks>;
const mockedListCourseSpaces = listCourseSpaces as jest.MockedFunction<typeof listCourseSpaces>;
const mockedSubmitCrowdReport = submitCrowdReport as jest.MockedFunction<typeof submitCrowdReport>;

function inboxTask(overrides: Partial<InboxTask>): InboxTask {
  return {
    id: 'task',
    kind: 'assignment',
    groupId: 'course-1',
    groupName: 'Course',
    title: 'Task',
    subtitle: 'Task subtitle',
    priority: 5,
    ...overrides,
  };
}

describe('campusAgentSource', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedListCourseSpaces.mockResolvedValue([]);
  });

  it('sorts derived next best actions by priority and keeps evidence', async () => {
    mockedListInboxTasks.mockResolvedValue([
      inboxTask({ id: 'later', title: 'Read announcement', priority: 4, kind: 'group' }),
      inboxTask({
        id: 'urgent',
        title: 'Submit lab',
        priority: 0,
        assignmentId: 'assignment-1',
        dueAt: new Date('2026-05-01T04:00:00.000Z'),
      }),
    ]);

    const actions = await listNextBestActions('user-1', 'school-1');

    expect(actions.map((action) => action.id)).toEqual(['inbox:urgent', 'inbox:later']);
    expect(actions[0]).toMatchObject({
      title: 'Submit lab',
      urgency: 'critical',
      requiresConfirmation: false,
      source: 'inbox',
    });
    expect(actions[0].evidenceRefs[0]).toMatchObject({
      type: 'course',
      id: 'assignment-1',
      label: 'Submit lab',
    });
  });

  it('derives a warning risk snapshot from urgent executable actions', async () => {
    mockedListInboxTasks.mockResolvedValue([
      inboxTask({ id: 'critical', priority: 0, dueAt: new Date('2026-05-01T04:00:00.000Z') }),
      inboxTask({ id: 'high', priority: 2 }),
      inboxTask({ id: 'low', priority: 5 }),
    ]);

    const [snapshot] = await listRiskSnapshots('user-1', 'school-1');

    expect(snapshot).toMatchObject({
      userId: 'user-1',
      schoolId: 'school-1',
      level: 'warning',
      score: 51,
    });
    expect(snapshot.recommendedActions).toHaveLength(3);
    expect(snapshot.signals[0].title).toBe('Task');
  });

  it('returns seeded anonymous pulse aggregates when cloud data is unavailable', async () => {
    const aggregates = await listPulseAggregates('school-1');

    expect(aggregates).toHaveLength(3);
    expect(aggregates.every((aggregate) => aggregate.schoolId === 'school-1')).toBe(true);
    expect(aggregates.map((aggregate) => aggregate.locationId)).toEqual([
      'lib_main',
      'cafe_main',
      'parking_main',
    ]);
  });

  it('falls back to local pulse reporting in mock mode', async () => {
    await submitPulseReport({
      schoolId: 'school-1',
      locationId: 'lib_main',
      level: 4,
    });

    expect(mockedSubmitCrowdReport).toHaveBeenCalledWith('lib_main', 4);
  });
});
