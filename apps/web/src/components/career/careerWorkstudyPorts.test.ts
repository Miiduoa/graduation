import { expect, test, vi } from 'vitest';
import { loadPersonalTimetable } from '@/lib/timetable/store';
import { createCareerWorkstudyPorts } from './careerWorkstudyPorts';
import { courses } from '@campus/shared/testFixtures/careerWorkstudy';
vi.mock('@/lib/firebase', () => ({ getDb: vi.fn() }));
vi.mock('@/lib/timetable/store', () => ({ loadPersonalTimetable: vi.fn() }));
const ports = createCareerWorkstudyPorts({ schoolId: 'pu', uid: 'student', transport: vi.fn() });
test('missing timetable stays unknown', async () => {
  vi.mocked(loadPersonalTimetable).mockResolvedValue({ courses: [] } as never);
  expect(await ports.loadCourses()).toBeNull();
});
test('saved courses remain available for conflict checks', async () => {
  vi.mocked(loadPersonalTimetable).mockResolvedValue({ courses } as never);
  expect(await ports.loadCourses()).toEqual(courses);
});
test('read failure propagates so the view shows unknown', async () => {
  vi.mocked(loadPersonalTimetable).mockRejectedValue(new Error('offline'));
  await expect(ports.loadCourses()).rejects.toThrow('offline');
});
