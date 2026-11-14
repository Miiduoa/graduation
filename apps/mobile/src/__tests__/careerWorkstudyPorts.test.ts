import { getDocFromServer } from 'firebase/firestore';
import { loadPersonalTimetable } from '../services/personalTimetable';
import { createCareerWorkstudyPorts } from '../components/career/careerWorkstudyPorts';
import { courses } from '../../../../packages/shared/testFixtures/careerWorkstudy';
jest.mock('firebase/firestore', () => ({ getDocFromServer: jest.fn(), doc: jest.fn() }));
jest.mock('../firebase', () => ({ getDb: () => ({}) }));
jest.mock('../services/personalTimetable', () => ({ loadPersonalTimetable: jest.fn() }));
const load = () => createCareerWorkstudyPorts({ schoolId: 'pu', uid: 'student', transport: jest.fn() }).loadCourses();
beforeEach(() => jest.resetAllMocks());
test('missing cloud timetable stays unknown', async () => {
  (getDocFromServer as jest.Mock).mockResolvedValue({ exists: () => false });
  expect(await load()).toBeNull();
  expect(getDocFromServer).toHaveBeenCalledTimes(2);
});
test('cloud failure stays unknown even if the general loader has cached courses', async () => {
  (loadPersonalTimetable as jest.Mock).mockResolvedValue({ courses });
  (getDocFromServer as jest.Mock).mockRejectedValue(new Error('offline'));
  expect(await load()).toBeNull();
  expect(getDocFromServer).toHaveBeenCalledTimes(1);
  expect(loadPersonalTimetable).not.toHaveBeenCalled();
});
test.each([{ saved: [] }, { saved: courses }])('confirmed cloud courses are available only when nonempty (%j)', async ({ saved }) => {
  (getDocFromServer as jest.Mock).mockResolvedValue({ exists: () => true, data: () => ({ schoolId: 'pu', courses: saved }) });
  expect(await load()).toEqual(saved.length ? saved : null);
});
test('missing local timetable stays unknown', async () => {
  (loadPersonalTimetable as jest.Mock).mockResolvedValue({ courses: [] });
  expect(await createCareerWorkstudyPorts({ schoolId: 'pu', uid: null, transport: jest.fn() }).loadCourses()).toBeNull();
});
