import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StudentCardCheck } from './StudentCardCheck';

const token = 'Q'.repeat(32);
const fetchMock = vi.fn();
const firstVerificationId = '11111111-1111-4111-8111-111111111111';
const nextVerificationId = '22222222-2222-4222-8222-222222222222';
const randomUUID = vi.fn();

function receipt(verifiedAt = Date.now()) {
  return Response.json({ schoolName: '靜宜大學', maskedId: '•••• 6789', verifiedAt });
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('crypto', { randomUUID });
  fetchMock.mockReset();
  randomUUID.mockReset();
  randomUUID.mockReturnValueOnce(firstVerificationId).mockReturnValue(nextVerificationId);
  window.history.replaceState({}, '', '/student-card/verify#' + token);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('waits for an explicit check and removes the token from the address bar', async () => {
  fetchMock.mockResolvedValue(receipt());
  render(<StudentCardCheck />);
  expect(window.location.hash).toBe('');
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '核對這張卡' }));
  expect(await screen.findByText('學號已核對')).toBeTruthy();
  expect(screen.getByText('•••• 6789')).toBeTruthy();
  expect(fetchMock.mock.calls[0][1]).toMatchObject({
    body: JSON.stringify({ token, verificationId: firstVerificationId }),
    cache: 'no-store',
    redirect: 'error',
    credentials: 'omit',
  });
});

it('offers a fresh scan for used codes and makes no request for malformed codes', async () => {
  fetchMock.mockResolvedValue(Response.json({}, { status: 410 }));
  const { unmount } = render(<StudentCardCheck />);
  fireEvent.click(screen.getByRole('button', { name: '核對這張卡' }));
  expect(await screen.findByText('需要新的驗證碼')).toBeTruthy();
  unmount();
  fetchMock.mockClear();
  window.location.hash = 'bad';
  render(<StudentCardCheck />);
  expect(screen.getByText('需要新的驗證碼')).toBeTruthy();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('clears the result when leaving the page', async () => {
  fetchMock.mockResolvedValue(receipt());
  render(<StudentCardCheck />);
  fireEvent.click(screen.getByRole('button', { name: '核對這張卡' }));
  await screen.findByText('學號已核對');
  act(() => window.dispatchEvent(new Event('pagehide')));
  expect(screen.queryByText('•••• 6789')).toBeNull();
});

it('times out an unresponsive scan and offers retry', async () => {
  vi.useFakeTimers();
  fetchMock.mockImplementation(
    (_url, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        );
      }),
  );
  render(<StudentCardCheck />);
  fireEvent.click(screen.getByRole('button', { name: '核對這張卡' }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(screen.getByRole('button', { name: '再試一次' })).toBeTruthy();
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
});

it('ignores a late reply after the page has been hidden', async () => {
  let respond!: (value: Response) => void;
  fetchMock.mockImplementation(
    () =>
      new Promise((resolve) => {
        respond = resolve;
      }),
  );
  render(<StudentCardCheck />);
  fireEvent.click(screen.getByRole('button', { name: '核對這張卡' }));
  act(() => window.dispatchEvent(new Event('pagehide')));
  await act(async () => respond(receipt()));
  await waitFor(() => expect(screen.queryByText('•••• 6789')).toBeNull());
});

it('keeps the scanned code through the Strict Mode effect replay', async () => {
  fetchMock.mockResolvedValue(receipt());
  render(
    <StrictMode>
      <StudentCardCheck />
    </StrictMode>,
  );
  fireEvent.click(screen.getByRole('button', { name: '核對這張卡' }));
  expect(await screen.findByText('學號已核對')).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each([429, 503])(
  'reuses the verification ID after a temporary HTTP %i response',
  async (status) => {
    fetchMock.mockResolvedValueOnce(Response.json({}, { status })).mockResolvedValueOnce(receipt());
    render(<StudentCardCheck />);
    fireEvent.click(screen.getByRole('button', { name: '核對這張卡' }));
    fireEvent.click(await screen.findByRole('button', { name: '再試一次' }));
    expect(await screen.findByText('學號已核對')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[0][1].body);
    expect(randomUUID).toHaveBeenCalledTimes(1);
  },
);

it('reuses the verification ID after a network failure', async () => {
  fetchMock
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValueOnce(receipt());
  render(<StudentCardCheck />);
  fireEvent.click(screen.getByRole('button', { name: '核對這張卡' }));
  fireEvent.click(await screen.findByRole('button', { name: '再試一次' }));
  expect(await screen.findByText('學號已核對')).toBeTruthy();
  expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[0][1].body);
});

it('allows retry after a stalled request and keeps the original receipt lifetime', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-06T15:00:00Z'));
  const verifiedAt = Date.now();
  let oldReply!: (response: Response) => void;
  fetchMock
    .mockImplementationOnce(() => new Promise((resolve) => (oldReply = resolve)))
    .mockResolvedValueOnce(receipt(verifiedAt));
  render(<StudentCardCheck />);
  fireEvent.click(screen.getByRole('button', { name: '核對這張卡' }));
  await act(() => vi.advanceTimersByTimeAsync(15_000));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '再試一次' }));
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(screen.getByText('學號已核對')).toBeTruthy();
  expect(screen.getByText('核對時間').nextElementSibling?.querySelector('time')?.dateTime).toBe(
    new Date(verifiedAt).toISOString(),
  );
  expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[0][1].body);
  await act(async () => oldReply(receipt(Date.now())));
  await act(() => vi.advanceTimersByTimeAsync(45_000));
  expect(screen.getByText('需要新的驗證碼')).toBeTruthy();
  expect(screen.queryByText('•••• 6789')).toBeNull();
});

it('expires a pending check at the original deadline and ignores its late reply', async () => {
  vi.useFakeTimers();
  let respond!: (response: Response) => void;
  fetchMock.mockImplementation(() => new Promise((resolve) => (respond = resolve)));
  render(<StudentCardCheck />);
  await act(() => vi.advanceTimersByTimeAsync(55_000));
  fireEvent.click(screen.getByRole('button', { name: '核對這張卡' }));
  await act(() => vi.advanceTimersByTimeAsync(5_000));
  expect(screen.getByText('需要新的驗證碼')).toBeTruthy();
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => respond(receipt()));
  expect(screen.queryByText('學號已核對')).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('accepts a new scan while the previous aborted request is still pending', async () => {
  let oldReply!: (response: Response) => void;
  fetchMock
    .mockImplementationOnce(() => new Promise((resolve) => (oldReply = resolve)))
    .mockResolvedValueOnce(receipt());
  render(<StudentCardCheck />);
  fireEvent.click(screen.getByRole('button', { name: '核對這張卡' }));
  const nextToken = 'R'.repeat(32);
  act(() => {
    window.history.replaceState({}, '', '/student-card/verify#' + nextToken);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '核對這張卡' }));
  expect(await screen.findByText('學號已核對')).toBeTruthy();
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
    token: nextToken,
    verificationId: nextVerificationId,
  });
  await act(async () => oldReply(Response.json({}, { status: 410 })));
  expect(screen.getByText('學號已核對')).toBeTruthy();
  expect(window.location.hash).toBe('');
});

it.each(['unmasked ID', 'stale receipt', 'oversized body', 'invalid JSON'])(
  'rejects an invalid success response with %s',
  async (kind) => {
    const value = { schoolName: '靜宜大學', maskedId: '•••• 6789', verifiedAt: Date.now() };
    if (kind === 'unmasked ID') value.maskedId = '412345678';
    if (kind === 'stale receipt') value.verifiedAt -= 61_000;
    fetchMock.mockResolvedValue(
      kind === 'oversized body'
        ? new Response(' '.repeat(2_049))
        : kind === 'invalid JSON'
          ? new Response('{invalid')
          : Response.json(value),
    );
    render(<StudentCardCheck />);
    fireEvent.click(screen.getByRole('button', { name: '核對這張卡' }));
    expect(await screen.findByText('需要新的驗證碼')).toBeTruthy();
    expect(screen.queryByText('學號已核對')).toBeNull();
    expect(screen.queryByText('412345678')).toBeNull();
  },
);
