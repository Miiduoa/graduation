import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StudentCardCheck } from './StudentCardCheck';

const token = 'Q'.repeat(32);
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  window.history.replaceState({}, '', '/student-card/verify#' + token);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('waits for an explicit check and removes the token from the address bar', async () => {
  fetchMock.mockResolvedValue(Response.json({ schoolName: '靜宜大學', maskedId: '•••• 6789' }));
  render(<StudentCardCheck />);
  expect(window.location.hash).toBe('');
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '核對這張卡' }));
  expect(await screen.findByText('學號已核對')).toBeTruthy();
  expect(screen.getByText('•••• 6789')).toBeTruthy();
  expect(fetchMock.mock.calls[0][1]).toMatchObject({
    body: JSON.stringify({ token }),
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
  fetchMock.mockResolvedValue(Response.json({ schoolName: '靜宜大學', maskedId: '•••• 6789' }));
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
  await act(async () => respond(Response.json({ schoolName: '靜宜大學', maskedId: '•••• 6789' })));
  await waitFor(() => expect(screen.queryByText('•••• 6789')).toBeNull());
});
