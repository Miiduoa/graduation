import { Linking } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { NuniWorkspaceScreen } from '../screens/NuniWorkspaceScreen';
import { NuniError } from '@campus/shared/src/nuni';
import type { NativeNuniState } from '../services/nuniSessionController';

const mockCapability = jest.fn();
let mockAuth: NativeNuniState & {
  signIn: jest.Mock;
  logout: jest.Mock;
  refresh: jest.Mock;
  request: jest.Mock;
};
jest.mock('../state/nuniSession', () => ({ useNuniSession: () => mockAuth }));
jest.mock('../services/nuniGoogle', () => ({
  getGoogleCredentialCapability: () => mockCapability(),
}));
jest.mock('../screens/nuni/NuniCourses', () => ({
  NuniCourses: () => {
    const React = require('react');
    const { TextInput } = require('react-native');
    const [draft, setDraft] = React.useState('');
    return <TextInput testID="course-draft" value={draft} onChangeText={setDraft} />;
  },
}));
jest.mock('../screens/nuni/NuniMerchant', () => ({
  NuniMerchant: () => {
    const { Text } = require('react-native');
    return <Text>我的店家資料</Text>;
  },
}));

const principal = {
  platformAccountId: 'pa_student',
  context: 'account-a',
  isPlatformOperator: false,
};
const membership = (state: string) => ({
  membershipId: `m-${state}`,
  tenantId: `t-${state}`,
  campusName: `學校-${state}`,
  state,
  assurance: 'school-verified',
});
beforeEach(() => {
  mockCapability.mockReturnValue({ available: true });
  mockAuth = {
    session: null,
    loading: false,
    error: '',
    pendingLogout: false,
    signIn: jest.fn().mockResolvedValue('cancelled'),
    logout: jest.fn().mockResolvedValue(undefined),
    refresh: jest.fn().mockResolvedValue(undefined),
    request: jest.fn().mockResolvedValue({ memberships: [] }),
  };
});
afterEach(() => jest.restoreAllMocks());

test('shows registration semantics and catches a failed sign-in instead of leaving an unhandled promise', async () => {
  mockAuth.signIn.mockRejectedValueOnce(new Error('native failure'));
  const view = render(<NuniWorkspaceScreen />);
  expect(view.getByText(/首次使用 Google 繼續時會建立帳號/)).toBeTruthy();
  await act(async () => fireEvent.press(view.getByText('使用 Google 繼續')));
  expect(mockAuth.signIn).toHaveBeenCalledTimes(1);
  expect(view.getByRole('alert')).toHaveTextContent(/操作未完成/);
  await act(async () => fireEvent.press(view.getByText('重新確認登入狀態')));
  expect(mockAuth.refresh).toHaveBeenCalledTimes(1);
  expect(view.getByText('使用 Google 繼續')).toBeTruthy();
});

test('missing native configuration opens the real Web login and never attempts a native login', async () => {
  mockCapability.mockReturnValue({ available: false, reason: 'ios-not-configured' });
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  const view = render(<NuniWorkspaceScreen />);
  expect(view.queryByText('使用 Google 繼續')).toBeNull();
  expect(view.getByText(/這個 App 版本目前無法使用 Google 登入/)).toBeTruthy();
  await act(async () => fireEvent.press(view.getByText('開啟網頁版登入')));
  expect(open).toHaveBeenCalledWith('https://nuni.tw/login');
  expect(mockAuth.signIn).not.toHaveBeenCalled();
});

test.each([{ loading: true }, { error: 'session could not be checked' }, { pendingLogout: true }])(
  'masks existing data whenever session validation is incomplete: %p',
  (patch) => {
    Object.assign(mockAuth, { session: principal }, patch);
    const view = render(<NuniWorkspaceScreen />);
    expect(view.queryByTestId('course-draft')).toBeNull();
    expect(view.queryByText('我的店家資料')).toBeNull();
    expect(mockAuth.request).not.toHaveBeenCalled();
  },
);

test('preserves course drafts across tabs, but resets them and account data when the session changes', async () => {
  mockAuth.session = principal;
  const view = render(<NuniWorkspaceScreen />);
  fireEvent.changeText(view.getByTestId('course-draft'), '帳號 A 的草稿');
  fireEvent.press(view.getByRole('tab', { name: '帳號' }));
  await view.findByText(/目前沒有學校資格紀錄/);
  fireEvent.press(view.getByRole('tab', { name: '課程' }));
  expect(view.getByTestId('course-draft').props.value).toBe('帳號 A 的草稿');
  mockAuth.session = { ...principal, platformAccountId: 'pa_other', context: 'account-b' };
  view.rerender(<NuniWorkspaceScreen />);
  expect(view.getByTestId('course-draft').props.value).toBe('');
  await waitFor(() => expect(mockAuth.request).toHaveBeenCalledWith('memberships', 'account-b'));
});

test('shows every membership state without converting it into a global teacher or administrator role', async () => {
  mockAuth.session = principal;
  mockAuth.request.mockResolvedValue({
    memberships: ['pending', 'verified', 'rejected', 'revoked'].map(membership),
  });
  const view = render(<NuniWorkspaceScreen />);
  fireEvent.press(view.getByRole('tab', { name: '帳號' }));
  await view.findByText('已驗證');
  for (const label of ['待驗證', '已驗證', '未通過', '已撤銷'])
    expect(view.getByText(label)).toBeTruthy();
  expect(view.queryByText('開啟網頁管理工作台')).toBeNull();
  expect(mockAuth.request).toHaveBeenCalledWith('memberships', 'account-a');
});

test('a failed membership read offers retry without reporting no qualifications', async () => {
  mockAuth.session = principal;
  mockAuth.request.mockRejectedValueOnce(new Error('offline'));
  const view = render(<NuniWorkspaceScreen />);
  fireEvent.press(view.getByRole('tab', { name: '帳號' }));
  await view.findByText('目前無法確認學校資格，請重新讀取。');
  expect(view.queryByText(/目前沒有學校資格紀錄/)).toBeNull();
  expect(view.getByLabelText('學校配發信箱').props.editable).toBe(false);
  expect(view.getByRole('button', { name: '申請學校資格' })).toBeDisabled();
  await act(async () => fireEvent.press(view.getByText('重新讀取學校資格')));
  expect(view.getByText(/目前沒有學校資格紀錄/)).toBeTruthy();
});

test('a delayed response from an old account cannot replace the new account membership', async () => {
  mockAuth.session = principal;
  let finish!: (value: unknown) => void;
  mockAuth.request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<NuniWorkspaceScreen />);
  mockAuth.session = { ...principal, platformAccountId: 'pa_other', context: 'account-b' };
  mockAuth.request.mockResolvedValue({ memberships: [membership('verified')] });
  view.rerender(<NuniWorkspaceScreen />);
  fireEvent.press(view.getByRole('tab', { name: '帳號' }));
  await view.findByText('學校-verified');
  await act(async () => finish({ memberships: [membership('pending')] }));
  expect(view.queryByText('學校-pending')).toBeNull();
  expect(view.getByText('學校-verified')).toBeTruthy();
});

test('logout hides data immediately and retries an unconfirmed server logout', async () => {
  mockAuth.session = principal;
  let finish!: () => void;
  mockAuth.logout.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<NuniWorkspaceScreen />);
  fireEvent.press(view.getByRole('tab', { name: '帳號' }));
  await view.findByText('登出 Campus One 帳號');
  fireEvent.press(view.getByText('登出 Campus One 帳號'));
  expect(view.queryByTestId('course-draft')).toBeNull();
  expect(view.queryByText('我的店家資料')).toBeNull();
  Object.assign(mockAuth, { session: null, pendingLogout: true, error: '無法完成登出' });
  await act(async () => finish());
  view.rerender(<NuniWorkspaceScreen />);
  await act(async () => fireEvent.press(view.getByText('重試登出')));
  expect(mockAuth.logout).toHaveBeenCalledTimes(2);
  expect(view.queryByText('使用 Google 繼續')).toBeNull();
});

const membershipReceipt = {
  membershipId: 'pm_11111111-1111-4111-8111-111111111111',
  tenantId: 'school-one',
  state: 'pending',
  created: true,
};

test('membership requests send only normalized school email and report the confirmed server state', async () => {
  mockAuth.session = principal;
  mockAuth.request.mockImplementation(async (_path: string, _context: string, input: unknown) =>
    input ? membershipReceipt : { memberships: [] },
  );
  const view = render(<NuniWorkspaceScreen />);
  fireEvent.press(view.getByRole('tab', { name: '帳號' }));
  await view.findByText(/目前沒有學校資格紀錄/);
  fireEvent.changeText(view.getByLabelText('學校配發信箱'), ' Student@School.edu.tw ');
  await act(async () => fireEvent.press(view.getByRole('button', { name: '申請學校資格' })));
  expect(mockAuth.request).toHaveBeenCalledWith('memberships', 'account-a', {
    claimedEmail: 'student@school.edu.tw',
  });
  expect(view.getByText(/申請已收件，等待學校驗證/)).toBeTruthy();
  expect(view.getByLabelText('學校配發信箱').props.value).toBe('');
});

test('an unknown membership result locks the original payload and retries without granting a role', async () => {
  mockAuth.session = principal;
  let submissions = 0;
  mockAuth.request.mockImplementation(async (_path: string, _context: string, input: unknown) => {
    if (!input) return { memberships: [] };
    if (++submissions === 1) throw new Error('connection lost');
    return { ...membershipReceipt, created: false, state: 'verified' };
  });
  const view = render(<NuniWorkspaceScreen />);
  fireEvent.press(view.getByRole('tab', { name: '帳號' }));
  await view.findByText(/目前沒有學校資格紀錄/);
  fireEvent.changeText(view.getByLabelText('學校配發信箱'), 'Student@School.edu.tw');
  await act(async () => fireEvent.press(view.getByRole('button', { name: '申請學校資格' })));
  expect(view.getByLabelText('學校配發信箱').props.editable).toBe(false);
  expect(view.queryByText(/申請已收件/)).toBeNull();
  await act(async () => fireEvent.press(view.getByRole('button', { name: '重試確認申請' })));
  const writes = mockAuth.request.mock.calls.filter((call: unknown[]) => call[2]);
  expect(writes).toHaveLength(2);
  expect(writes[0]).toEqual(writes[1]);
  expect(view.getByText(/這所學校已有資格紀錄：已驗證/)).toBeTruthy();
  expect(view.queryByText(/申請已收件/)).toBeNull();
  expect(view.queryByText('開啟網頁管理工作台')).toBeNull();
  expect(view.getByLabelText('學校配發信箱').props.editable).toBe(true);
});

test('an unmatched school email is a rejected request that can be corrected', async () => {
  mockAuth.session = principal;
  mockAuth.request.mockImplementation(async (_path: string, _context: string, input: unknown) => {
    if (!input) return { memberships: [] };
    throw new NuniError(400, 'MEMBERSHIP_CLAIM_INVALID');
  });
  const view = render(<NuniWorkspaceScreen />);
  fireEvent.press(view.getByRole('tab', { name: '帳號' }));
  await view.findByText(/目前沒有學校資格紀錄/);
  fireEvent.changeText(view.getByLabelText('學校配發信箱'), 'wrong@example.com');
  await act(async () => fireEvent.press(view.getByRole('button', { name: '申請學校資格' })));
  expect(view.getByText(/這個信箱無法對應目前合作的學校/)).toBeTruthy();
  expect(view.getByLabelText('學校配發信箱').props.editable).toBe(true);
  expect(view.queryByText('重試確認申請')).toBeNull();
});

test('membership lookup in progress disables applications without discarding an existing draft', async () => {
  mockAuth.session = principal;
  let finish!: (value: unknown) => void;
  mockAuth.request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<NuniWorkspaceScreen />);
  fireEvent.press(view.getByRole('tab', { name: '帳號' }));
  expect(view.getByLabelText('學校配發信箱').props.editable).toBe(false);
  expect(view.getByRole('button', { name: '申請學校資格' })).toBeDisabled();
  await act(async () => finish({ memberships: [] }));
  expect(view.getByLabelText('學校配發信箱').props.editable).toBe(true);
});
