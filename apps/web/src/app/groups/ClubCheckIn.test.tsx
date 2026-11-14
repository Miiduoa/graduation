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
  await screen.findByText('沒有社團管理權限');
  expect(confirmed).not.toHaveBeenCalled();
  expect(screen.getByText('1 筆待送出')).toBeTruthy();
});
