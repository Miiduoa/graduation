import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ClubDirectory } from './ClubDirectory';
import { callClubPortal } from './clubPortalService';
vi.mock('./clubPortalService', () => ({ callClubPortal: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams('schoolId=pu&tab=mine'),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it('loads the callable directory independently of the legacy trial flag and hides controls on failure', async () => {
  vi.mocked(callClubPortal)
    .mockRejectedValueOnce(new Error('尚未啟用'))
    .mockResolvedValueOnce({ success: true, office: true, clubs: [] });
  render(
    <ClubDirectory uid="student" schoolId="pu">
      <p>既有會籍</p>
    </ClubDirectory>,
  );
  expect(screen.getByText('既有會籍')).toBeTruthy();
  fireEvent.click(screen.getByText('找社團'));
  expect(screen.queryByText('課外組／平台維運（依本校授權）')).toBeNull();
  expect(await screen.findByText('社團服務暫時無法使用，請稍後重試。')).toBeTruthy();
  expect(screen.queryByText('課外組／平台維運（依本校授權）')).toBeNull();
  await act(async () => fireEvent.click(screen.getByText('重新讀取社團資料')));
  expect(await screen.findByText('課外組／平台維運（依本校授權）')).toBeTruthy();
  expect(callClubPortal).toHaveBeenCalledWith('student', 'pu', { action: 'directory' });
});
