import {
  collectOnDeviceSchoolContext,
  formatOnDeviceSchoolPrompt,
} from '../../services/onDeviceSchoolContext';
import { loadOfflinePersonalTimetable } from '../../services/personalTimetable';

jest.mock('../../services/personalTimetable', () => ({
  loadOfflinePersonalTimetable: jest.fn(),
}));

const timetable = {
  schoolId: 'pu',
  updatedAt: '2026-10-25T09:00:00.000Z',
  courses: [{ name: '資料庫概論', day: 1, start: 2, end: 3 }],
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(loadOfflinePersonalTimetable).mockResolvedValue(null);
});

test('does not read private caches without a verified account or selected school', async () => {
  await expect(collectOnDeviceSchoolContext({ uid: '', schoolId: 'pu' })).resolves.toMatchObject({
    timetable: { source: 'not-available', courses: [] },
  });
  await expect(collectOnDeviceSchoolContext({ uid: 'alice', schoolId: '' })).resolves.toMatchObject({
    timetable: { source: 'not-available', courses: [] },
  });
  expect(loadOfflinePersonalTimetable).not.toHaveBeenCalled();
});

test('only reads the selected account and campus copy, never a demo schedule', async () => {
  jest.mocked(loadOfflinePersonalTimetable).mockResolvedValue(timetable as never);
  const result = await collectOnDeviceSchoolContext({
    uid: 'alice', schoolId: 'pu', schoolName: '靜宜大學',
  });
  expect(loadOfflinePersonalTimetable).toHaveBeenCalledWith('alice', 'pu');
  expect(result.timetable).toMatchObject({
    source: 'saved-device-copy',
    updatedAt: '2026-10-25T09:00:00.000Z',
    courses: [{ name: '資料庫概論', day: 1, start: 2, end: 3 }],
  });
  const prompt = formatOnDeviceSchoolPrompt(result);
  expect(prompt).toContain('資料庫概論');
  expect(prompt).toContain('不能冒充鐘點或官方');
  expect(prompt).toContain('不是本次即時查詢');
});

test('missing or invalid cached data does not become a fabricated timetable', async () => {
  jest.mocked(loadOfflinePersonalTimetable).mockRejectedValue(new Error('corrupt'));
  const result = await collectOnDeviceSchoolContext({ uid: 'alice', schoolId: 'nthu' });
  expect(result.timetable).toEqual({
    source: 'not-available', updatedAt: null, courses: [],
  });
  expect(formatOnDeviceSchoolPrompt(result)).toContain('無法回答正式課程安排');
});

test('keeps the complete saved course set for offline tools, while limiting model context', async () => {
  const courses = Array.from({ length: 12 }, (_, index) => ({
    name: `測試課程${index + 1}`,
    day: index === 11 ? 5 : 1,
    start: (index % 13) + 1,
    end: (index % 13) + 1,
  }));
  jest.mocked(loadOfflinePersonalTimetable).mockResolvedValue({
    ...timetable, courses,
  } as never);
  const result = await collectOnDeviceSchoolContext({ uid: 'alice', schoolId: 'pu' });
  expect(result.timetable.courses).toHaveLength(12);
  expect(result.timetable.courses[11].name).toBe('測試課程12');
  const prompt = formatOnDeviceSchoolPrompt(result);
  expect(prompt).toContain('測試課程8');
  expect(prompt).not.toContain('測試課程12');
  expect(prompt).toContain('尚有 4 門未列出');
  expect(prompt).toContain('不可據此判定某天沒課');
});
