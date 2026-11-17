import { normalizeClubProfileText } from '@campus/shared/src/clubProfile';
import { clubEnabled } from './clubService';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { ClubProfile } from './ClubProfile';
import { loadClubProfile } from './clubProfileService';

vi.mock('./clubProfileService', () => ({ loadClubProfile: vi.fn() }));
vi.mock('./clubService', () => ({ clubEnabled: vi.fn() }));
const profile = {
  id: 'club',
  schoolId: 'pu',
  type: 'club' as const,
  role: 'member',
  name: '攝影社',
  description: '週三社課',
  meetingTime: '',
  memberCount: 3,
  announcements: [
    {
      id: 'post',
      title: '社課通知',
      body: '帶相機',
      groupId: 'club',
      kind: 'announcement' as const,
      authorId: 'one',
      authorName: null,
      schoolId: 'pu',
      createdAt: null,
    },
  ],
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(clubEnabled).mockReturnValue(false);
  vi.mocked(loadClubProfile).mockResolvedValue(profile);
});

test.each([
  [undefined, ''],
  [null, ''],
  ['', ''],
  [' \t\n　', ''],
  [' 未提供 ', ''],
  [' 社課時間未提供 ', ''],
  [' 社團尚未提供介紹 ', ''],
  [' 社團尚未提供介紹。 ', ''],
  [' 週三 18:00 ', '週三 18:00'],
  [' 社團介紹\n每週見面 ', '社團介紹\n每週見面'],
  ['社課時間未提供，請洽幹部', '社課時間未提供，請洽幹部'],
  ['社團尚未提供介紹，但歡迎來聊聊', '社團尚未提供介紹，但歡迎來聊聊'],
])('共用社團文字正規化只將空白與完整 placeholder 視為缺值：%s', (value, expected) => {
  expect(normalizeClubProfileText(value)).toBe(expected);
});

test('依規格呈現唯讀社團、真實公告與活動尚未串接的界線', async () => {
  render(<ClubProfile uid="one" schoolId="pu" groupId="club" />);
  await screen.findByRole('heading', { name: '攝影社' });
  expect(screen.getByRole('button', { name: '已加入' }).hasAttribute('disabled')).toBe(true);
  expect(screen.getByText('社課通知')).toBeTruthy();
  expect(screen.getByText('週三社課')).toBeTruthy();
  expect(screen.getByText('目前沒有排定的活動。')).toBeTruthy();
  expect(screen.getByText(/此頁尚未接入社團內部活動/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: '申請加入' })).toBeNull();
  expect(screen.getByRole('link', { name: '查看社團討論與更多公告' }).getAttribute('href')).toBe(
    '/groups/club?schoolId=pu',
  );
});
test('讀取失敗可重試，幹部只看見鎖定管理說明', async () => {
  vi.mocked(loadClubProfile).mockRejectedValueOnce(new Error('network'));
  render(<ClubProfile uid="one" schoolId="pu" groupId="club" />);
  await screen.findByRole('alert');
  vi.mocked(loadClubProfile).mockResolvedValue({ ...profile, role: 'owner' });
  fireEvent.click(screen.getByRole('button', { name: '重新讀取社團資料' }));
  await screen.findByText('這所學校還沒開放社團管理。');
  expect(screen.queryByRole('button', { name: '管理' })).toBeNull();
});
test('切換社團時不顯示先前尚未完成的讀取結果', async () => {
  let finish!: (data: typeof profile) => void;
  vi.mocked(loadClubProfile).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const view = render(<ClubProfile uid="one" schoolId="pu" groupId="old" />);
  view.rerender(<ClubProfile uid="one" schoolId="pu" groupId="new" />);
  await screen.findByText('週三社課');
  await act(async () => finish({ ...profile, name: '舊社團' }));
  expect(screen.queryByText('舊社團')).toBeNull();
});

test.each(['owner', 'admin'])('管理已啟用時，%s 不顯示未開放說明', async (role) => {
  vi.mocked(clubEnabled).mockReturnValue(true);
  vi.mocked(loadClubProfile).mockResolvedValue({ ...profile, role });
  render(<ClubProfile uid="one" schoolId="pu" groupId="club" />);
  await screen.findByText('週三社課');
  expect(screen.queryByText('這所學校還沒開放社團管理。')).toBeNull();
});

test('重新讀取成功後，忽略先前請求延遲回傳的錯誤', async () => {
  let fail!: (error: Error) => void;
  vi.mocked(loadClubProfile).mockReturnValueOnce(
    new Promise((_, reject) => {
      fail = reject;
    }),
  );
  render(<ClubProfile uid="one" schoolId="pu" groupId="club" />);
  fireEvent.click(screen.getByRole('button', { name: '重新讀取社團資料' }));
  await screen.findByRole('heading', { name: '攝影社' });
  await act(async () => fail(new Error('network')));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('社課通知')).toBeTruthy();
});

test.each(['owner', 'admin', 'member'])(
  '舊版介紹頁依既有管理開放條件提供補齊連結：%s',
  async (role) => {
    vi.mocked(clubEnabled).mockReturnValue(true);
    vi.mocked(loadClubProfile).mockResolvedValue({ ...profile, role, description: '' });
    render(<ClubProfile uid="one" schoolId="pu" groupId="club" />);
    await screen.findByText('社團尚未提供介紹。');
    for (const name of ['填寫社課時間', '填寫社團介紹']) {
      const link = screen.queryByRole('link', { name });
      if (role === 'member') expect(link).toBeNull();
      else expect(link?.getAttribute('href')).toBe('/groups/club/club?schoolId=pu');
    }
  },
);

test.each([false, true])('補資料入口僅在管理開放、幹部且該欄位缺資料時顯示：%s', async (enabled) => {
  vi.mocked(clubEnabled).mockReturnValue(enabled);
  const view = render(<ClubProfile uid="one" schoolId="pu" groupId="club" />);
  for (const role of ['owner', 'admin', 'member']) {
    for (const [meetingTime, description, missingTime, missingIntro] of [
      ['  ', '  ', true, true],
      ['週三 18:00', '  ', false, true],
      ['  ', '新版介紹', true, false],
      ['週三 18:00', '新版介紹', false, false],
      ['社課時間未提供', '社團尚未提供介紹', true, true],
      [' \t社課時間未提供\n', ' 社團尚未提供介紹。 ', true, true],
      ['未提供', '未提供', true, true],
      ['社課時間未提供', '新版介紹', true, false],
      ['週三 18:00', '社團尚未提供介紹。', false, true],
      ['社課時間未提供，請洽幹部', '社團尚未提供介紹，但歡迎來聊聊', false, false],
    ] as const) {
      vi.mocked(loadClubProfile).mockResolvedValue({ ...profile, role, meetingTime, description });
      fireEvent.click(screen.getByRole('button', { name: '重新讀取社團資料' }));
      await screen.findByText('攝影社');
      for (const [name, missing] of [
        ['填寫社課時間', missingTime],
        ['填寫社團介紹', missingIntro],
      ] as const) {
        const entry = screen.queryByRole('link', { name });
        const show = enabled && role !== 'member' && missing;
        expect(entry !== null).toBe(show);
      }
      expect(screen.queryByText(/社課時間未提供$/) !== null).toBe(missingTime);
      expect(screen.queryByText('社團尚未提供介紹。') !== null).toBe(missingIntro);
      if (!missingTime) expect(screen.getByText(new RegExp(meetingTime.trim()))).toBeTruthy();
      if (!missingIntro) expect(screen.getByText(description.trim())).toBeTruthy();
    }
  }
  view.unmount();
});

test('儲存後重新讀取或返回介紹頁會顯示最新資料並隱藏補資料入口', async () => {
  vi.mocked(clubEnabled).mockReturnValue(true);
  vi.mocked(loadClubProfile).mockResolvedValue({ ...profile, role: 'admin', description: '' });
  const view = render(<ClubProfile uid="one" schoolId="pu" groupId="club" />);
  await screen.findByRole('link', { name: '填寫社課時間' });
  vi.mocked(loadClubProfile).mockResolvedValue({
    ...profile,
    role: 'admin',
    meetingTime: '週三 18:00',
    description: '新版介紹',
  });
  fireEvent.click(screen.getByRole('button', { name: '重新讀取社團資料' }));
  await screen.findByText('新版介紹');
  expect(screen.getByText(/週三 18:00/)).toBeTruthy();
  expect(screen.queryByRole('link', { name: /填寫社/ })).toBeNull();
  view.unmount();
  render(<ClubProfile uid="one" schoolId="pu" groupId="club" />);
  await screen.findByText('新版介紹');
  expect(screen.getByText(/週三 18:00/)).toBeTruthy();
  expect(screen.queryByRole('link', { name: /填寫社/ })).toBeNull();
  expect(loadClubProfile).toHaveBeenCalledTimes(3);
});
