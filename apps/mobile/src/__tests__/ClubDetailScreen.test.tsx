import React from 'react';
import { act, render } from '@testing-library/react-native';
import { ClubDetailScreen } from '../screens/ClubDetailScreen';
import { callClubPortal } from '../services/clubPortal';
import type { ClubPortalView } from '@campus/shared/src/clubPortal';

let mockUser: { uid: string } | null = { uid: 'student' };
let mockSchool = { id: 'pu' };
let mockSelectionReady = true;
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../state/school', () => ({
  useSchool: () => ({ school: mockSchool, selectionReady: mockSelectionReady }),
}));
jest.mock('../services/clubPortal', () => ({ callClubPortal: jest.fn() }));
jest.mock('../services/clubSummary', () => ({ clubSummaryEnabled: () => false }));
jest.mock('../services/clubExport', () => ({ shareClubCsv: jest.fn() }));
jest.mock('../screens/ClubCheckIn', () => ({ ClubCheckIn: () => null }));

const club = (name: string): ClubPortalView => ({
  success: true,
  office: false,
  status: 'active',
  role: 'member',
  club: {
    id: 'photo',
    name,
    category: '攝影',
    meetingTime: '',
    recruiting: true,
    approval: 'approved',
    joinPolicy: 'review',
    description: '一起記錄生活',
    instagram: '',
    line: '',
    memberCount: 3,
  },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { uid: 'student' };
  mockSchool = { id: 'pu' };
  mockSelectionReady = true;
});

test('club details reuse the existing portal with the active account and browsing school', async () => {
  jest.mocked(callClubPortal).mockResolvedValueOnce(club('攝影社'));
  const view = render(<ClubDetailScreen route={{ params: { groupId: 'photo' } }} />);
  expect(await view.findByText('攝影社')).toBeTruthy();
  expect(callClubPortal).toHaveBeenCalledWith('student', 'pu', {
    action: 'read',
    groupId: 'photo',
  });
  expect(view.queryByText('管理')).toBeNull();
  expect(view.queryByText('課外組／平台維運（依本校授權）')).toBeNull();
});

test('a missing account, incomplete school selection or missing target never requests club data', () => {
  mockUser = null;
  const view = render(<ClubDetailScreen route={{ params: { groupId: 'photo' } }} />);
  expect(view.getByText('登入學校帳號後查看社團資料。')).toBeTruthy();
  mockUser = { uid: 'student' };
  mockSelectionReady = false;
  view.rerender(<ClubDetailScreen route={{ params: { groupId: 'photo' } }} />);
  expect(view.getByText('請返回社團目錄，選擇要查看的社團。')).toBeTruthy();
  mockSelectionReady = true;
  view.rerender(<ClubDetailScreen />);
  expect(callClubPortal).not.toHaveBeenCalled();
});

test('switching account and school withdraws the old portal and ignores its late reply', async () => {
  let finish!: (value: ClubPortalView) => void;
  jest
    .mocked(callClubPortal)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce(club('新校攝影社'));
  const view = render(<ClubDetailScreen route={{ params: { groupId: 'photo' } }} />);
  mockUser = { uid: 'other-student' };
  mockSchool = { id: 'nthu' };
  view.rerender(<ClubDetailScreen route={{ params: { groupId: 'photo' } }} />);
  expect(await view.findByText('新校攝影社')).toBeTruthy();
  await act(async () => finish(club('先前帳號社團')));
  expect(view.queryByText('先前帳號社團')).toBeNull();
  expect(callClubPortal).toHaveBeenLastCalledWith('other-student', 'nthu', {
    action: 'read',
    groupId: 'photo',
  });
});
