import { StrictMode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { ClubCheckIn } from './ClubCheckIn';
import { callClubPortal } from './clubPortalService';
vi.mock('./clubPortalService', () => ({ callClubPortal: vi.fn() }));
vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,AA') },
}));
vi.mock('./ClubScanner', () => ({ ClubScanner: () => <span>相機掃描 QR</span> }));
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
});
test('離線簽到先暫存，連線後送出並確認才清除，重載可恢復', async () => {
  vi.mocked(callClubPortal).mockResolvedValue({ success: true, office: false });
  const confirmed = vi.fn();
  const props = {
    uid: 'one',
    schoolId: 'pu',
    groupId: 'club',
    eventId: 'event',
    officer: true,
    onConfirmed: confirmed,
  };
  const view = render(<ClubCheckIn {...props} />);
  fireEvent.change(screen.getByLabelText('掃描器輸入 QR 或學號後四碼'), {
    target: { value: '1234' },
  });
  fireEvent.click(screen.getByRole('button', { name: '確認簽到' }));
  expect(screen.getByText('1 筆待送出')).toBeTruthy();
  expect(callClubPortal).not.toHaveBeenCalled();
  view.unmount();
  render(<ClubCheckIn {...props} />);
  await screen.findByText('1 筆待送出');
  fireEvent(window, new Event('online'));
  await waitFor(() => expect(confirmed).toHaveBeenCalledOnce());
  expect(callClubPortal).toHaveBeenCalledWith('one', 'pu', {
    action: 'checkIn',
    groupId: 'club',
    eventId: 'event',
    checkInCode: '1234',
  });
  expect(screen.getByText('0 筆待送出')).toBeTruthy();
});
test('伺服器拒絕或撤權時保留待送出，不顯示假成功', async () => {
  vi.mocked(callClubPortal).mockRejectedValue(new Error('沒有社團管理權限'));
  localStorage.setItem(
    JSON.stringify(['club-check-in', 'one', 'pu', 'club', 'event']),
    JSON.stringify(['1234']),
  );
  const confirmed = vi.fn();
  render(
    <ClubCheckIn
      uid="one"
      schoolId="pu"
      groupId="club"
      eventId="event"
      officer
      onConfirmed={confirmed}
    />,
  );
  await screen.findByText('1 筆待送出');
  fireEvent.click(screen.getByRole('button', { name: '重送待送出簽到' }));
  await screen.findByText(/沒有社團管理權限/);
  expect(confirmed).not.toHaveBeenCalled();
  expect(screen.getByText('1 筆待送出')).toBeTruthy();
});

test.each(['簽到碼無效', '網路暫時中斷'])(
  '%s 保留失敗項目，後續仍送出並可個別刪除',
  async (message) => {
    const key = JSON.stringify(['club-check-in', 'one', 'pu', 'club', 'event']);
    localStorage.setItem(key, JSON.stringify(['bad', 'good']));
    vi.mocked(callClubPortal)
      .mockRejectedValueOnce(new Error(message))
      .mockResolvedValue({ success: true, office: false });
    const confirmed = vi.fn();
    render(
      <ClubCheckIn
        uid="one"
        schoolId="pu"
        groupId="club"
        eventId="event"
        officer
        onConfirmed={confirmed}
      />,
    );
    await screen.findByText('2 筆待送出');
    fireEvent.click(screen.getByRole('button', { name: '重送待送出簽到' }));
    await waitFor(() => expect(confirmed).toHaveBeenCalledOnce());
    expect(vi.mocked(callClubPortal).mock.calls.map((args) => args[2]?.checkInCode)).toEqual([
      'bad',
      'good',
    ]);
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(['bad']);
    expect(screen.getByText(new RegExp(message))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '刪除第 1 筆失敗簽到' }));
    expect(localStorage.getItem(key)).toBe('[]');
  },
);

test('暫時失敗紀錄可在重載後重送成功', async () => {
  const key = JSON.stringify(['club-check-in', 'one', 'pu', 'club', 'event']);
  localStorage.setItem(key, '["1234"]');
  vi.mocked(callClubPortal)
    .mockRejectedValueOnce(new Error('網路暫時中斷'))
    .mockResolvedValue({ success: true, office: false });
  const props = {
    uid: 'one',
    schoolId: 'pu',
    groupId: 'club',
    eventId: 'event',
    officer: true,
    onConfirmed: vi.fn(),
  };
  const view = render(<ClubCheckIn {...props} />);
  fireEvent.click(screen.getByRole('button', { name: '重送待送出簽到' }));
  await screen.findByText(/網路暫時中斷/);
  view.unmount();
  render(<ClubCheckIn {...props} />);
  fireEvent.click(screen.getByRole('button', { name: '重送待送出簽到' }));
  await waitFor(() => expect(props.onConfirmed).toHaveBeenCalledOnce());
  expect(localStorage.getItem(key)).toBe('[]');
});

test('已連線開頁自動送出既存佇列，同步期間重複連線事件不重送', async () => {
  const key = JSON.stringify(['club-check-in', 'one', 'pu', 'club', 'event']);
  localStorage.setItem(key, '["1234"]');
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  let finish!: (value: { success: true; office: false }) => void;
  vi.mocked(callClubPortal).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const confirmed = vi.fn();
  render(
    <StrictMode>
      <ClubCheckIn
        uid="one"
        schoolId="pu"
        groupId="club"
        eventId="event"
        officer
        onConfirmed={confirmed}
      />
    </StrictMode>,
  );
  await waitFor(() => expect(callClubPortal).toHaveBeenCalledOnce());
  fireEvent(window, new Event('online'));
  fireEvent(window, new Event('online'));
  expect(callClubPortal).toHaveBeenCalledOnce();
  expect(localStorage.getItem(key)).toBe('["1234"]');
  finish({ success: true, office: false });
  await waitFor(() => expect(confirmed).toHaveBeenCalledOnce());
  expect(localStorage.getItem(key)).toBe('[]');
  expect(screen.getByText('0 筆待送出')).toBeTruthy();
});
