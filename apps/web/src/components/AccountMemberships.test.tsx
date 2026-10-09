import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import { AccountMemberships } from './AccountMemberships';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/features/nuni/Session', () => ({ browserRequest: mocks.request }));
const receipt = {
  membershipId: 'pm_11111111-1111-4111-8111-111111111111',
  tenantId: 'school-a',
  state: 'pending',
  created: true,
};
const refresh = vi.fn();
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.request.mockImplementation(async (_path, _context, input) =>
    input ? receipt : { memberships: [] },
  );
});
async function form() {
  const view = render(
    <AccountMemberships key="context-a" context="context-a" refreshAccount={refresh} />,
  );
  await screen.findByRole('form', { name: '申請學校資格' });
  return view;
}
function fill(email = 'Student@school.edu.tw') {
  fireEvent.change(screen.getByLabelText('學校配發的電子郵件'), { target: { value: email } });
}
function submit() {
  fireEvent.submit(screen.getByRole('form', { name: '申請學校資格' }));
}

it('submits only the school-issued email and reports pending verification before refreshing real memberships', async () => {
  await form();
  fill();
  submit();
  await screen.findByText('申請已收件，等待學校驗證。送出申請不會授予學生、教師或管理權限。');
  expect(mocks.request).toHaveBeenCalledWith('memberships', 'context-a', {
    claimedEmail: 'student@school.edu.tw',
  });
  await waitFor(() =>
    expect(mocks.request.mock.calls.filter((call) => call[2] === undefined)).toHaveLength(2),
  );
  expect(screen.queryByText(/已寄出|驗證信|信箱已驗證/)).toBeNull();
});
it('blocks invalid input before issuing a request', async () => {
  await form();
  fill('not-an-email');
  submit();
  expect(screen.getByRole('alert').textContent).toBe('請填寫學校配發的完整電子郵件地址。');
  expect(mocks.request).toHaveBeenCalledTimes(1);
});
it('prevents same-tick duplicate requests and retries an unknown response with its original email', async () => {
  await form();
  const pending = deferred<unknown>();
  mocks.request.mockImplementationOnce(() => pending.promise);
  fill('Student@school.edu.tw');
  act(() => {
    submit();
    submit();
  });
  expect(mocks.request.mock.calls.filter((call) => call[2])).toHaveLength(1);
  await act(async () => pending.reject(new NuniError(0, 'NETWORK_ERROR')));
  expect((screen.getByLabelText('學校配發的電子郵件') as HTMLInputElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('學校配發的電子郵件'), {
    target: { value: 'other@school.edu.tw' },
  });
  fireEvent.click(screen.getByRole('button', { name: '重試確認申請' }));
  await screen.findByText('申請已收件，等待學校驗證。送出申請不會授予學生、教師或管理權限。');
  const writes = mocks.request.mock.calls.filter((call) => call[2]);
  expect(writes).toHaveLength(2);
  expect(writes[1][2]).toEqual(writes[0][2]);
});
it('allows correction after a definite school-email mismatch', async () => {
  await form();
  mocks.request.mockRejectedValueOnce(new NuniError(400, 'MEMBERSHIP_CLAIM_INVALID'));
  fill('me@gmail.com');
  submit();
  await screen.findByText(
    '這個信箱無法對應目前開放資格申請的合作學校。請確認學校配發的信箱，或聯絡該校管理者。',
  );
  expect((screen.getByLabelText('學校配發的電子郵件') as HTMLInputElement).disabled).toBe(false);
  fill('me@school.edu.tw');
  submit();
  await screen.findByText('申請已收件，等待學校驗證。送出申請不會授予學生、教師或管理權限。');
  expect(mocks.request).toHaveBeenCalledWith('memberships', 'context-a', {
    claimedEmail: 'me@school.edu.tw',
  });
});
it.each(['pending', 'verified', 'rejected', 'revoked'])(
  'describes the existing %s record without promising a new verification',
  async (state) => {
    await form();
    mocks.request.mockResolvedValueOnce({ ...receipt, state, created: false });
    fill();
    submit();
    await screen.findByText(/未建立重複申請；如需更正/);
    expect(screen.queryByText(/申請已收件，等待/)).toBeNull();
  },
);
it('does not offer an application form while membership reads fail', async () => {
  mocks.request.mockRejectedValueOnce(new NuniError(503, 'UNAVAILABLE'));
  render(<AccountMemberships context="context-a" refreshAccount={refresh} />);
  await screen.findByText('目前無法讀取學校資格，請稍後再試。');
  expect(screen.queryByRole('form')).toBeNull();
});
it('drops a successful response from a previous account and clears its draft', async () => {
  const view = await form();
  const late = deferred<unknown>();
  mocks.request.mockImplementationOnce(() => late.promise);
  fill();
  submit();
  view.rerender(
    <AccountMemberships key="context-b" context="context-b" refreshAccount={refresh} />,
  );
  await screen.findByRole('form', { name: '申請學校資格' });
  await act(async () => late.resolve(receipt));
  expect(screen.queryByText(/申請已收件，等待/)).toBeNull();
  expect((screen.getByLabelText('學校配發的電子郵件') as HTMLInputElement).value).toBe('');
  expect(mocks.request.mock.calls.filter((call) => call[1] === 'context-b')).toHaveLength(1);
});
it('hides the application after a session change and asks for account verification', async () => {
  await form();
  mocks.request.mockRejectedValueOnce(new NuniError(409, 'SESSION_CHANGED'));
  fill();
  submit();
  await screen.findByText('登入已失效或帳號已變更，學校資格已隱藏。');
  expect(screen.queryByRole('form')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新確認帳號' }));
  expect(refresh).toHaveBeenCalledOnce();
});
it('retains the confirmed receipt if the follow-up list read fails without showing an editable form', async () => {
  await form();
  mocks.request
    .mockResolvedValueOnce(receipt)
    .mockRejectedValueOnce(new NuniError(503, 'UNAVAILABLE'));
  fill();
  submit();
  await screen.findByText('目前無法讀取學校資格，請稍後再試。');
  expect(screen.getByText(/申請已收件，等待學校驗證/)).toBeTruthy();
  expect(screen.queryByRole('form')).toBeNull();
});
