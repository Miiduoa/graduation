import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { GroupAssignmentsScreen } from '../screens/GroupAssignmentsScreen';
import { getAnyCachedTCCourses, refreshTCCourses } from '../services/puDataCache';
import { tcFetchHomeworkActivities, type TCCourse } from '../services/tronClassClient';
import { webBrowserOpenWithPuTronClassGate } from '../services/tronClassWebUiGate';

const mockAuth = {
  user: { uid: 'alice' },
  profile: { uid: 'alice', schoolId: 'pu' },
  loading: false,
  profileLoading: false,
  tokenExpired: false,
};
let mockSchool = { id: 'pu', name: '靜宜大學' };
let mockSelected: string | null = 'pu';
jest.mock('../state/auth', () => ({ useAuth: () => mockAuth }));
jest.mock('../state/school', () => ({
  useSchool: () => ({
    school: mockSchool,
    selection: { schoolId: mockSelected },
    selectionReady: true,
  }),
}));
jest.mock('../services/puDataCache', () => ({
  getAnyCachedTCCourses: jest.fn(),
  refreshTCCourses: jest.fn(),
}));
jest.mock('../services/tronClassClient', () => ({ tcFetchHomeworkActivities: jest.fn() }));
jest.mock('../services/tronClassWebUiGate', () => ({
  webBrowserOpenWithPuTronClassGate: jest.fn(),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../ui/navigationTheme', () => ({
  TAB_BAR_CONTENT_BOTTOM_PADDING: 80,
  useTabBarContentBottomPadding: () => 80,
}));

const courses = [{ id: 101, name: '靜宜個人課程' }] as TCCourse[];
beforeEach(() => {
  jest.resetAllMocks();
  mockAuth.profile = { uid: 'alice', schoolId: 'pu' };
  mockSchool = { id: 'pu', name: '靜宜大學' };
  mockSelected = 'pu';
  jest.mocked(webBrowserOpenWithPuTronClassGate).mockResolvedValue(true);
});

test('other campuses open their own LMS and never read the device-wide Providence course cache', async () => {
  mockSelected = 'nthu';
  mockSchool = { id: 'nthu', name: '國立清華大學' };
  const view = render(<GroupAssignmentsScreen />);
  for (const name of ['清大 eLearn', '清大 eeclass']) {
    await act(async () => fireEvent.press(view.getByRole('link', { name })));
  }
  expect(jest.mocked(webBrowserOpenWithPuTronClassGate).mock.calls).toEqual([
    ['https://elearn.nthu.edu.tw/'],
    ['https://eeclass.nthu.edu.tw/'],
  ]);
  expect(getAnyCachedTCCourses).not.toHaveBeenCalled();
  expect(refreshTCCourses).not.toHaveBeenCalled();
  expect(tcFetchHomeworkActivities).not.toHaveBeenCalled();
});

test('a late Providence cache read after switching never starts homework requests', async () => {
  let resolve!: (value: TCCourse[]) => void;
  jest.mocked(getAnyCachedTCCourses).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const view = render(<GroupAssignmentsScreen />);
  mockSchool = { id: 'ntu', name: '國立臺灣大學' };
  mockSelected = mockSchool.id;
  view.rerender(<GroupAssignmentsScreen />);
  await act(async () => resolve(courses));
  expect(view.getByRole('link', { name: 'NTU COOL' })).toBeTruthy();
  expect(tcFetchHomeworkActivities).not.toHaveBeenCalled();
  expect(view.queryByText('靜宜個人課程')).toBeNull();
});

test('Providence assignments require a matching current profile and resolved selection', async () => {
  mockAuth.profile.uid = 'old-account';
  const view = render(<GroupAssignmentsScreen />);
  expect(getAnyCachedTCCourses).not.toHaveBeenCalled();
  mockAuth.profile.uid = 'alice';
  mockSelected = null;
  view.rerender(<GroupAssignmentsScreen />);
  expect(getAnyCachedTCCourses).not.toHaveBeenCalled();
  expect(view.queryByRole('link')).toBeNull();
  jest.mocked(getAnyCachedTCCourses).mockResolvedValue(courses);
  jest.mocked(tcFetchHomeworkActivities).mockResolvedValue([{ id: 42, title: '學期報告' }]);
  mockSelected = 'pu';
  view.rerender(<GroupAssignmentsScreen />);
  await view.findByText('學期報告');
  expect(tcFetchHomeworkActivities).toHaveBeenCalledWith(101);
});
