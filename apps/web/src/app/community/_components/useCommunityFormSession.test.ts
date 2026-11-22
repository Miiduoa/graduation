import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { COMMUNITY_FORM_WAIT_MS, useCommunityCompletionFocus, useCommunityFormSession } from './useCommunityFormSession';

it('retains a queued write immediately and after the wait notice, then permits retry after failure', async () => {
  vi.useFakeTimers();
  try {
    const close = vi.fn();
    const saved = vi.fn();
    let reject!: (error: Error) => void;
    const write = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
    const { result } = renderHook(() => useCommunityFormSession(close));

    act(() => {
      void result.current.submit(write, saved, '寫入失敗');
      result.current.requestClose();
      void result.current.submit(write, saved, '寫入失敗');
    });
    expect(close).toHaveBeenLastCalledWith('retain');
    expect(result.current.busy).toBe(true);
    expect(result.current.slow).toBe(false);

    act(() => { vi.advanceTimersByTime(COMMUNITY_FORM_WAIT_MS); });
    expect(result.current.slow).toBe(true);
    act(() => {
      result.current.requestClose();
      void result.current.submit(write, saved, '寫入失敗');
    });
    expect(close).toHaveBeenNthCalledWith(2, 'retain');
    expect(write).toHaveBeenCalledOnce();

    await act(async () => reject(new Error('deadline-exceeded')));
    expect(result.current.busy).toBe(false);
    expect(result.current.slow).toBe(false);
    expect(result.current.error).toBe('寫入失敗');
    expect(saved).not.toHaveBeenCalled();
    act(() => result.current.requestClose());
    expect(close).toHaveBeenLastCalledWith('retain');

    write.mockResolvedValueOnce(undefined);
    await act(async () => result.current.submit(write, saved, '寫入失敗'));
    expect(write).toHaveBeenCalledTimes(2);
    expect(saved).toHaveBeenCalledOnce();
    expect(result.current.error).toBe('');
  } finally {
    vi.useRealTimers();
  }
});

it.each(['null', 'inert', 'hidden document'])('checks %s focus after the completion render', (position) => {
  const opener = document.createElement('button');
  const elsewhere = document.createElement('button');
  document.body.append(opener, elsewhere);
  const { result, rerender, unmount } = renderHook(() => useCommunityCompletionFocus({ current: opener }));
  // Focus changes after the completion is scheduled, before the DOM update.
  result.current();
  if (position === 'inert') {
    elsewhere.focus();
    elsewhere.setAttribute('inert', '');
  }
  const missingFocus = position === 'null'
    ? vi.spyOn(document, 'activeElement', 'get').mockReturnValue(null)
    : undefined;
  const hidden = position === 'hidden document'
    ? vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    : undefined;
  try {
    rerender();
    missingFocus?.mockRestore();
    expect(document.activeElement).toBe(position === 'hidden document' ? document.body : opener);
  } finally {
    hidden?.mockRestore();
    unmount();
    opener.remove();
    elsewhere.remove();
  }
});
