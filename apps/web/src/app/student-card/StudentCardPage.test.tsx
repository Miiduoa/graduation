import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
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
  expect(screen.getByRole('link', { name: '登入學校帳號' }).getAttribute('href')).toContain(
    'student-card',
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
