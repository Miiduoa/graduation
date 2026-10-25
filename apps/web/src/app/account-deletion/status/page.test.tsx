import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import DeletionStatusPage from './page';
import {
  COOKIE_ABSENT_COPY,
  INVALID_TOKEN_COPY,
  NUNI_API_ORIGIN,
  PUBLIC_PAGE_INTRO,
  PUBLIC_STATUS_PATH,
  QUERY_UNAVAILABLE_COPY,
  REVOKE_CONFIRM_BODY,
  REVOKED_COPY,
} from './deletionStatus';

const TOKEN = `pd1_${'A'.repeat(42)}A`;
const SHA = 'b'.repeat(64);
const fetchMock = vi.fn<typeof fetch>();

vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children, title, subtitle }: { children: React.ReactNode; title?: string; subtitle?: string }) => (
    <main>
      {title ? <h1>{title}</h1> : null}
      {subtitle ? <p>{subtitle}</p> : null}
      {children}
    </main>
  ),
}));

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

it('renders the unsigned status form without a login gate', () => {
  render(<DeletionStatusPage />);
  expect(screen.getByRole('heading', { name: '刪除進度' })).toBeTruthy();
  expect(screen.getByText(PUBLIC_PAGE_INTRO)).toBeTruthy();
  expect(screen.getByLabelText('查詢碼')).toBeTruthy();
  expect(screen.getByRole('button', { name: '查詢進度' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '用這個瀏覽器保存的查詢碼' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: /^登入$/ })).toBeNull();
  expect(screen.queryByRole('button', { name: '登入校園帳號' })).toBeNull();
  expect(screen.getByRole('link', { name: '隱私資訊' }).getAttribute('href')).toBe('/privacy');
  expect(screen.getByRole('link', { name: '帳號刪除說明' }).getAttribute('href')).toBe(
    '/account-deletion',
  );
  expect(fetchMock).not.toHaveBeenCalled();
});

it('rejects a malformed query code before calling any endpoint', async () => {
  render(<DeletionStatusPage />);
  fireEvent.change(screen.getByLabelText('查詢碼'), { target: { value: 'pd1_short' } });
  fireEvent.click(screen.getByRole('button', { name: '查詢進度' }));
  expect((await screen.findByRole('alert')).textContent).toBe(INVALID_TOKEN_COPY);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('shows public progress without identity fields', async () => {
  fetchMock.mockResolvedValueOnce(
    jsonResponse(200, {
      stage: 'completed-with-retention',
      counts: { pending: 0, deleted: 3, anonymized: 1, retainedWithBasis: 2, failed: 0 },
      updatedAt: '2026-10-25T12:00:00+08:00',
      terminalReceipt: { code: 'completed-with-retention', sha256: SHA },
      personId: 'should-not-render',
    }),
  );
  render(<DeletionStatusPage />);
  fireEvent.change(screen.getByLabelText('查詢碼'), { target: { value: TOKEN } });
  fireEvent.click(screen.getByRole('button', { name: '查詢進度' }));
  expect(await screen.findByTestId('deletion-status-result')).toBeTruthy();
  expect(screen.getByRole('heading', { name: '已完成，部分資料依法保留' })).toBeTruthy();
  expect(screen.getByText(/已刪除 3 類、已匿名化 1 類、依法保留 2 類/)).toBeTruthy();
  expect(screen.getByText(SHA)).toBeTruthy();
  expect(screen.getByText(/部分資料依法保留，保留的類別數見上/)).toBeTruthy();
  expect(screen.queryByText('should-not-render')).toBeNull();
  expect(fetchMock.mock.calls[0]?.[0]).toBe(`${NUNI_API_ORIGIN}${PUBLIC_STATUS_PATH}`);
});

it('uses the browser-saved query code without asking the visitor to sign in', async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse(404, {}));
  render(<DeletionStatusPage />);
  fireEvent.click(screen.getByRole('button', { name: '用這個瀏覽器保存的查詢碼' }));
  expect((await screen.findByRole('alert')).textContent).toBe(COOKIE_ABSENT_COPY);
  expect(screen.queryByRole('heading', { name: /^登入$/ })).toBeNull();
});

it('revokes a pasted query code after the existing confirmation', async () => {
  fetchMock
    .mockResolvedValueOnce(
      jsonResponse(200, {
        stage: 'working',
        counts: { pending: 1, deleted: 0, anonymized: 0, retainedWithBasis: 0, failed: 0 },
        updatedAt: '2026-10-25T12:00:00+08:00',
      }),
    )
    .mockResolvedValueOnce(jsonResponse(200, {}));
  render(<DeletionStatusPage />);
  fireEvent.change(screen.getByLabelText('查詢碼'), { target: { value: TOKEN } });
  fireEvent.click(screen.getByRole('button', { name: '查詢進度' }));
  expect(await screen.findByTestId('deletion-status-result')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '撤銷查詢碼' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(REVOKED_COPY));
  expect(window.confirm).toHaveBeenCalledWith(REVOKE_CONFIRM_BODY);
  expect(screen.queryByTestId('deletion-status-result')).toBeNull();
});

it('keeps a failed lookup on this page instead of sending the visitor to login', async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: { message: QUERY_UNAVAILABLE_COPY } }));
  render(<DeletionStatusPage />);
  fireEvent.change(screen.getByLabelText('查詢碼'), { target: { value: TOKEN } });
  fireEvent.click(screen.getByRole('button', { name: '查詢進度' }));
  expect((await screen.findByRole('alert')).textContent).toBe(QUERY_UNAVAILABLE_COPY);
  expect(screen.queryByRole('heading', { name: /^登入$/ })).toBeNull();
});
