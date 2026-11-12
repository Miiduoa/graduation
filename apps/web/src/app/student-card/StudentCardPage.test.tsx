import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  createAccountDemoPermissions,
  createAccountDemoState,
  type AccountDemoSnapshot,
} from '@campus/shared/src/accountDemo';
import { StudentCardPage } from './StudentCardPage';

const state = vi.hoisted(() => ({
  user: { uid: 'alice', email: 'student@example.edu.tw', isAnonymous: false, getIdToken: vi.fn() },
  signedIn: true,
  schoolId: 'pu',
  profile: {
    displayName: '陳同學 S1234567',
    studentId: 'S1234567',
    department: '資訊管理學系',
    schoolId: 'pu',
    role: 'student',
  },
  read: vi.fn(),
  qr: vi.fn(),
  platform: {
    session: null as { platformAccountId: string; context: string } | null,
    loading: false,
    pendingLogout: false,
    error: '',
  },
  demoRequest: vi.fn(),
}));
vi.mock('@/features/nuni/Session', () => ({
  useOptionalNuniSession: () => state.platform,
  browserRequest: state.demoRequest,
}));
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({ user: state.signedIn ? state.user : null, loading: false }),
}));
vi.mock('@/components/SelectedSchoolProvider', () => ({
  useSelectedSchool: () => ({
    selectedSchoolId: state.schoolId,
    selectedSchool: { id: state.schoolId, name: state.schoolId === 'pu' ? '靜宜大學' : '東海大學' },
    loading: false,
    catalogStatus: 'ready',
    requestedUnavailable: false,
  }),
}));
vi.mock('@/lib/firebase', () => ({
  getAuth: () => ({ currentUser: state.signedIn ? state.user : null }),
  getDb: () => ({}),
}));
vi.mock('firebase/firestore', () => ({
  doc: (...parts: unknown[]) => parts,
  getDocFromServer: state.read,
}));
vi.mock('qrcode', () => ({ default: { toDataURL: state.qr } }));

beforeEach(() => {
  vi.clearAllMocks();
  state.signedIn = true;
  state.schoolId = 'pu';
  state.user.uid = 'alice';
  state.profile.schoolId = 'pu';
  state.profile.role = 'student';
  state.platform.session = null;
  state.platform.loading = false;
  state.platform.pendingLogout = false;
  state.platform.error = '';
  state.demoRequest.mockReset();
  state.user.getIdToken.mockResolvedValue('authenticated-token');
  state.read.mockResolvedValue({ exists: () => true, data: () => state.profile });
  state.qr.mockResolvedValue('data:image/png;base64,cXI=');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      Response.json({
        token: 'a'.repeat(32),
        studentId: 'S7654321',
        expiresAt: Date.now() + 60000,
      }),
    ),
  );
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function ready() {
  await screen.findByRole('button', { name: '取得驗證碼' });
}

it('keeps the profile number out of the card and only reveals it on request', async () => {
  render(<StudentCardPage />);
  await ready();
  const card = screen.getByRole('article', { name: '學生證個人資料' });
  expect(card.textContent).not.toContain('S1234567');
  expect(card.textContent).toContain('•••• 4567');
  expect(card.textContent).toContain('個人檔案');
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '出示學號' }));
  expect(within(screen.getByRole('dialog')).getByText('S1234567')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '收起學生證' }));
  expect(screen.queryByText('S1234567')).toBeNull();
});

it('uses a server number and an opaque fragment in the QR presentation', async () => {
  render(<StudentCardPage />);
  await ready();
  fireEvent.click(screen.getByRole('button', { name: '取得驗證碼' }));
  await screen.findByAltText('供現場核對學號的限時 QR Code');
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText('S7654321')).toBeTruthy();
  expect(within(dialog).queryByText('S1234567')).toBeNull();
  expect(fetch).toHaveBeenCalledWith(
    '/api/student-card/present',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ schoolId: 'pu' }),
      headers: { Authorization: 'Bearer authenticated-token', 'Content-Type': 'application/json' },
      cache: 'no-store',
    }),
  );
  expect(state.qr).toHaveBeenCalledWith(
    window.location.origin + '/student-card/verify#' + 'a'.repeat(32),
    expect.objectContaining({ margin: 4, width: 512 }),
  );
});

it.each(['blur', 'pagehide'])('closes exposed data on %s', async (event) => {
  render(<StudentCardPage />);
  await ready();
  fireEvent.click(screen.getByRole('button', { name: '出示學號' }));
  act(() => window.dispatchEvent(new Event(event)));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByText('S1234567')).toBeNull();
});

it('ignores a delayed result after switching school', async () => {
  let finish!: (value: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { rerender } = render(<StudentCardPage />);
  await ready();
  fireEvent.click(screen.getByRole('button', { name: '取得驗證碼' }));
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  state.schoolId = 'thu';
  rerender(<StudentCardPage />);
  await act(async () =>
    finish(
      Response.json({
        token: 'b'.repeat(32),
        studentId: 'S7654321',
        expiresAt: Date.now() + 60000,
      }),
    ),
  );
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(state.qr).not.toHaveBeenCalled();
  expect(await screen.findByText('請切回帳號所屬學校')).toBeTruthy();
});

it('keeps unsupported identity out of a QR and provides the official destination', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({ error: 'SCHOOL_SIGN_IN_REQUIRED' }, { status: 403 }),
  );
  render(<StudentCardPage />);
  await ready();
  fireEvent.click(screen.getByRole('button', { name: '取得驗證碼' }));
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    '這個帳號目前沒有可核對的校園學號，請使用校方證件。',
  );
  expect(state.qr).not.toHaveBeenCalled();
  expect(screen.getByRole('link', { name: '開啟校方服務' }).getAttribute('href')).toContain(
    'dorac.pu.edu.tw',
  );
});

it('does not restore the card after a hidden-tab transition', async () => {
  let finish!: (value: string) => void;
  state.qr.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<StudentCardPage />);
  await ready();
  fireEvent.click(screen.getByRole('button', { name: '取得驗證碼' }));
  await waitFor(() => expect(state.qr).toHaveBeenCalled());
  vi.mocked(Object.getOwnPropertyDescriptor(document, 'hidden')!.get!).mockReturnValue(true);
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  await act(async () => finish('data:image/png;base64,bGF0ZQ=='));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByAltText('供現場核對學號的限時 QR Code')).toBeNull();
});

it('closes the presentation at its deadline', async () => {
  render(<StudentCardPage />);
  await ready();
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole('button', { name: '出示學號' }));
  await act(async () => vi.advanceTimersByTime(60000));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('leaves school services available to visitors and other roles', async () => {
  state.signedIn = false;
  state.schoolId = 'thu';
  const { rerender } = render(<StudentCardPage />);
  expect(screen.getByRole('link', { name: '登入帳號' }).getAttribute('href')).toBe(
    '/login?returnUrl=' + encodeURIComponent('/student-card?campus=thu'),
  );
  expect(screen.getByRole('link', { name: '開啟校方服務' }).getAttribute('href')).toContain(
    'page.line.me',
  );
  expect(state.read).not.toHaveBeenCalled();
  state.signedIn = true;
  state.schoolId = 'pu';
  state.profile.role = 'teacher';
  rerender(<StudentCardPage />);
  expect(await screen.findByText('學生帳號專用')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '取得驗證碼' })).toBeNull();
});

const demoAccountId = 'pa_12345678-1234-1234-1234-123456789abc';
function accountDemo(overrides: Partial<AccountDemoSnapshot> = {}): AccountDemoSnapshot {
  return {
    accountId: demoAccountId,
    revision: 1,
    profile: {
      displayName: '展示同學',
      schoolId: 'pu',
      schoolName: '靜宜大學',
      studentId: 'DEMO20261112',
      department: '資訊管理學系',
    },
    permissions: createAccountDemoPermissions(true),
    state: createAccountDemoState(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    ...overrides,
  };
}

function signInPlatform() {
  state.signedIn = false;
  state.platform.session = { platformAccountId: demoAccountId, context: 'platform-session-a' };
}

it('shows an account-owned demonstration card for Google platform sign-in without Firebase', async () => {
  signInPlatform();
  state.demoRequest.mockResolvedValue({ demo: accountDemo() });
  render(<StudentCardPage />);
  const card = await screen.findByRole('article', { name: '展示學生證' });
  expect(card.textContent).toContain('展示同學');
  expect(card.textContent).toContain('DEMO');
  expect(card.textContent).not.toContain('DEMO20261112');
  expect(screen.queryByRole('link', { name: '登入帳號' })).toBeNull();
  expect(state.read).not.toHaveBeenCalled();
  expect(state.demoRequest).toHaveBeenCalledWith('account-demo', 'platform-session-a');
  expect(screen.getByRole('link', { name: '展示資料與權限' }).getAttribute('href')).toBe(
    '/demo/account',
  );
});

it('uses a separate DEMO QR payload and never asks the real card service to issue a credential', async () => {
  signInPlatform();
  state.demoRequest.mockResolvedValue({ demo: accountDemo() });
  render(<StudentCardPage />);
  fireEvent.click(await screen.findByRole('button', { name: '出示展示 QR Code' }));
  await screen.findByAltText('DEMO 展示學生證 QR Code');
  expect(state.qr).toHaveBeenCalledWith(
    expect.stringMatching(/^nuni-demo-card:v1:pu:DEMO20261112:\d+$/),
    expect.objectContaining({ margin: 4, width: 512 }),
  );
  expect(fetch).not.toHaveBeenCalled();
  expect(within(screen.getByRole('dialog')).getByText('DEMO20261112')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '收起學生證' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByText('DEMO20261112')).toBeNull();
});

it.each(['disabled', 'expired', 'other-school', 'other-account'] as const)(
  'does not show a demonstration card when its authorization is %s',
  async (condition) => {
    signInPlatform();
    const demo = accountDemo();
    if (condition === 'disabled') demo.permissions.studentCard = false;
    if (condition === 'expired') demo.expiresAt = new Date(Date.now() - 1).toISOString();
    if (condition === 'other-school') demo.profile.schoolId = 'thu';
    if (condition === 'other-account') demo.accountId = 'pa_22345678-1234-1234-1234-123456789abc';
    state.demoRequest.mockResolvedValue({ demo });
    render(<StudentCardPage />);
    await screen.findByRole('heading', {
      name:
        condition === 'disabled'
          ? '學生證展示尚未開啟'
          : condition === 'expired'
            ? '展示資料已到期'
            : condition === 'other-school'
              ? '請切回展示帳號的學校'
              : '暫時無法讀取展示學生證',
    });
    expect(screen.queryByRole('article', { name: '展示學生證' })).toBeNull();
    expect(screen.queryByText('展示同學')).toBeNull();
    expect(state.qr).not.toHaveBeenCalled();
  },
);

it('accepts a canonical school alias while keeping the same account boundary', async () => {
  signInPlatform();
  const demo = accountDemo();
  demo.profile.schoolId = 'tw-pu';
  state.demoRequest.mockResolvedValue({ demo });
  render(<StudentCardPage />);
  expect(await screen.findByRole('article', { name: '展示學生證' })).toBeTruthy();
});

it('cannot restore an old account response after the platform account changes', async () => {
  signInPlatform();
  let finish!: (value: unknown) => void;
  state.demoRequest.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { rerender } = render(<StudentCardPage />);
  await waitFor(() => expect(state.demoRequest).toHaveBeenCalled());
  state.platform.session = {
    platformAccountId: 'pa_22345678-1234-1234-1234-123456789abc',
    context: 'platform-session-b',
  };
  state.demoRequest.mockResolvedValueOnce({ demo: null });
  rerender(<StudentCardPage />);
  await screen.findByRole('link', { name: '登入帳號' });
  await act(async () => finish({ demo: accountDemo() }));
  expect(screen.queryByRole('article', { name: '展示學生證' })).toBeNull();
  expect(screen.queryByText('展示同學')).toBeNull();
});

it.each(['logout', 'context', 'school'] as const)(
  'clears a visible demo QR immediately on %s changes',
  async (change) => {
    signInPlatform();
    state.demoRequest.mockResolvedValue({ demo: accountDemo() });
    const { rerender } = render(<StudentCardPage />);
    fireEvent.click(await screen.findByRole('button', { name: '出示展示 QR Code' }));
    await screen.findByAltText('DEMO 展示學生證 QR Code');
    if (change === 'logout') state.platform.pendingLogout = true;
    if (change === 'context') {
      state.platform.session = { ...state.platform.session!, context: 'platform-session-new' };
      state.demoRequest.mockImplementationOnce(() => new Promise(() => {}));
    }
    if (change === 'school') state.schoolId = 'thu';
    rerender(<StudentCardPage />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('DEMO20261112')).toBeNull();
    await act(async () => {});
  },
);

it('removes the demonstration card when the server authorization expires', async () => {
  vi.useFakeTimers();
  signInPlatform();
  state.demoRequest.mockResolvedValue({
    demo: accountDemo({ expiresAt: new Date(Date.now() + 2000).toISOString() }),
  });
  await act(async () => {
    render(<StudentCardPage />);
  });
  expect(screen.getByRole('article', { name: '展示學生證' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '出示學號' }));
  await act(async () => {
    vi.advanceTimersByTime(3000);
  });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByText('DEMO20261112')).toBeNull();
  expect(screen.queryByRole('article', { name: '展示學生證' })).toBeNull();
  expect(screen.getByRole('heading', { name: '展示資料已到期' })).toBeTruthy();
});

it('falls back to the existing Firebase card when the platform account has no demo grant', async () => {
  state.platform.session = { platformAccountId: demoAccountId, context: 'platform-session-a' };
  state.demoRequest.mockResolvedValue({ demo: null });
  render(<StudentCardPage />);
  await ready();
  expect(screen.getByRole('article', { name: '學生證個人資料' })).toBeTruthy();
  expect(screen.queryByRole('article', { name: '展示學生證' })).toBeNull();
});
