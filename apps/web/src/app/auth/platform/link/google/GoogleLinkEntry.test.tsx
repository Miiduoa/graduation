import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoogleLinkEntry } from './GoogleLinkEntry';

const accountA = 'pa_11111111-1111-4111-8111-111111111111';
const accountB = 'pa_22222222-2222-4222-8222-222222222222';
const contextA = 'a'.repeat(43);
const contextB = 'b'.repeat(43);
const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  refresh: vi.fn(),
  auth: {
    session: null as null | {
      platformAccountId: string;
      context: string;
      isPlatformOperator: boolean;
    },
    loading: false,
    pendingLogout: false,
    error: '',
  },
}));
vi.mock('@/features/nuni/Session', () => ({
  useNuniSession: () => ({ ...mocks.auth, refresh: mocks.refresh }),
}));

function available(overrides: Record<string, unknown> = {}) {
  return {
    platformAccountId: accountA,
    context: contextA,
    currentMethod: 'apple',
    methods: ['apple'],
    googleLink: 'available',
    ...overrides,
  };
}
function linked(overrides: Record<string, unknown> = {}) {
  return available({ methods: ['apple', 'google'], googleLink: 'linked', ...overrides });
}
function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function settle(pending: ReturnType<typeof deferred<Response>>, value: unknown) {
  await act(async () => {
    pending.resolve(response(value));
  });
}
const consentLabel = '我確認要將接下來選擇的 Google 帳號連結到目前的 nuni 帳號。';

beforeEach(() => {
  mocks.auth = {
    session: { platformAccountId: accountA, context: contextA, isPlatformOperator: false },
    loading: false,
    pendingLogout: false,
    error: '',
  };
  mocks.refresh.mockReset().mockResolvedValue(undefined);
  mocks.fetch.mockReset().mockImplementation(async () => response(available()));
  vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Google link status confirmation', () => {
  it('uses a session-bound read before offering a newly confirmed link, even with a forged success URL', async () => {
    const pending = deferred<Response>();
    mocks.fetch.mockReturnValue(pending.promise);
    render(<GoogleLinkEntry result="acknowledged" />);
    expect(screen.getByText('正在核對登入方式…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '前往 Google 授權' })).toBeNull();
    expect(screen.queryByText('Google 已連結')).toBeNull();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/nuni/account/login-methods',
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        redirect: 'error',
        headers: { 'X-Campus-Session': contextA, Accept: 'application/json' },
        signal: expect.any(AbortSignal),
      }),
    );
    await settle(pending, available());
    expect(screen.getByText('目前使用 Apple 登入。')).toBeTruthy();
    expect(screen.getByRole('list', { name: '已連結的登入方式' }).textContent).toContain(
      'Apple 已連結',
    );
    expect(screen.queryByText('Google 已連結')).toBeNull();
    const submit = screen.getByRole('button', { name: '前往 Google 授權' });
    expect(submit.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: consentLabel }));
    expect(submit.hasAttribute('disabled')).toBe(false);
    expect(submit.closest('form')!.getAttribute('action')).toBe('/auth/platform/link/google/start');
    expect(
      submit.closest('form')!.querySelector('input[name="context"]')!.getAttribute('value'),
    ).toBe(contextA);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['unknown', 'cancelled', 'invalid', 'conflict', 'unavailable', 'reauth', 'acknowledged'])(
    'shows server-confirmed current linking after the %s return without retrying the write',
    async (result) => {
      mocks.fetch.mockResolvedValue(response(linked()));
      render(<GoogleLinkEntry result={result} />);
      expect(await screen.findByText('Google 已連結')).toBeTruthy();
      expect(screen.queryByRole('checkbox')).toBeNull();
      expect(screen.queryByRole('button', { name: '前往 Google 授權' })).toBeNull();
      expect(mocks.fetch).toHaveBeenCalledTimes(1);
      expect(mocks.fetch.mock.calls[0][1].method).toBe('GET');
    },
  );

  it('an unlinked unknown result requires new consent and explains replacing an unfinished flow', async () => {
    render(<GoogleLinkEntry result="unknown" />);
    const checkbox = await screen.findByRole('checkbox', { name: consentLabel });
    expect((checkbox as HTMLInputElement).checked).toBe(false);
    expect(
      screen.getByText('目前尚未連結 Google。開始新流程會取代此帳號尚未完成的 Google 綁定。'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: '前往 Google 授權' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(mocks.fetch.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true);
  });

  it.each([
    ['reauth-required', '請使用目前的登入方式重新驗證，再回來連結 Google。'],
    ['restricted', '此帳號目前不支援新增 Google 登入方式。'],
    ['unavailable', '目前無法新增 Google 登入方式。你仍可使用原本的登入方式。'],
  ])('shows %s without a writable form', async (googleLink, message) => {
    mocks.fetch.mockResolvedValue(response(available({ googleLink })));
    render(<GoogleLinkEntry result="" />);
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: '前往 Google 授權' })).toBeNull();
  });

  it('does not offer an operator a form even if availability was returned', async () => {
    mocks.auth.session!.isPlatformOperator = true;
    render(<GoogleLinkEntry result="" />);
    expect(await screen.findByText('此帳號目前不支援新增 Google 登入方式。')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('can show the current Google method while a credential conflict prevents additional linking', async () => {
    mocks.fetch.mockResolvedValue(
      response(
        available({
          currentMethod: 'google',
          methods: ['google'],
          googleLink: 'unavailable',
        }),
      ),
    );
    render(<GoogleLinkEntry result="" />);
    expect(await screen.findByText('目前使用 Google 登入。')).toBeTruthy();
    expect(
      screen.getByText('目前無法新增 Google 登入方式。你仍可使用原本的登入方式。'),
    ).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('clears a verified list during recheck and allows retrying a failed read without a write', async () => {
    mocks.fetch.mockResolvedValueOnce(response(linked()));
    render(<GoogleLinkEntry result="unknown" />);
    await screen.findByText('Google 已連結');
    const pending = deferred<Response>();
    mocks.fetch.mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole('button', { name: '重新確認登入方式' }));
    expect(screen.queryByRole('list', { name: '已連結的登入方式' })).toBeNull();
    await settle(pending, { error: 'unavailable' });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    mocks.fetch.mockResolvedValueOnce(response(available()));
    fireEvent.click(screen.getByRole('button', { name: '重新確認登入方式' }));
    const checkbox = await screen.findByRole('checkbox', { name: consentLabel });
    expect((checkbox as HTMLInputElement).checked).toBe(false);
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    expect(mocks.fetch.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true);
  });

  it.each([401, 409, 503])(
    'conceals identity details when the inventory endpoint returns %s',
    async (status) => {
      mocks.fetch.mockResolvedValue(response({ error: 'private-error-text' }, status));
      render(<GoogleLinkEntry result="acknowledged" />);
      expect(await screen.findByRole('alert')).toBeTruthy();
      expect(screen.queryByRole('list')).toBeNull();
      expect(screen.queryByRole('checkbox')).toBeNull();
      expect(screen.queryByText('private-error-text')).toBeNull();
    },
  );

  it.each([
    { platformAccountId: accountB },
    { context: contextB },
    { methods: ['apple', 'password'] },
    { methods: ['apple', 'apple'] },
    { currentMethod: 'google' },
    { googleLink: 'linked' },
    { methods: ['apple', 'google'] },
    { googleLink: 'unknown' },
  ])('rejects mismatched or malformed inventory %j', async (overrides) => {
    mocks.fetch.mockResolvedValue(response(available(overrides)));
    render(<GoogleLinkEntry result="" />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});

describe('Google link scope and consent lifetime', () => {
  it.each(['account', 'session'])(
    'ignores a late inventory response after changing %s',
    async (change) => {
      const first = deferred<Response>();
      const second = deferred<Response>();
      mocks.fetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      const view = render(<GoogleLinkEntry result="" />);
      const firstSignal = mocks.fetch.mock.calls[0][1].signal as AbortSignal;
      mocks.auth.session = {
        platformAccountId: change === 'account' ? accountB : accountA,
        context: contextB,
        isPlatformOperator: false,
      };
      view.rerender(<GoogleLinkEntry result="" />);
      expect(firstSignal.aborted).toBe(true);
      await settle(first, linked());
      expect(screen.queryByRole('list')).toBeNull();
      expect(screen.queryByRole('checkbox')).toBeNull();
      await settle(
        second,
        available({ platformAccountId: mocks.auth.session.platformAccountId, context: contextB }),
      );
      expect(await screen.findByRole('checkbox')).toBeTruthy();
      expect(screen.queryByText('Google 已連結')).toBeNull();
      expect(mocks.fetch.mock.calls[1][1].headers['X-Campus-Session']).toBe(contextB);
    },
  );

  it('does not resurrect a request when leaving and returning to the original account', async () => {
    const initial = deferred<Response>();
    const middle = deferred<Response>();
    const returned = deferred<Response>();
    mocks.fetch
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(middle.promise)
      .mockReturnValueOnce(returned.promise);
    const view = render(<GoogleLinkEntry result="" />);
    mocks.auth.session = {
      platformAccountId: accountB,
      context: contextB,
      isPlatformOperator: false,
    };
    view.rerender(<GoogleLinkEntry result="" />);
    mocks.auth.session = {
      platformAccountId: accountA,
      context: contextA,
      isPlatformOperator: false,
    };
    view.rerender(<GoogleLinkEntry result="" />);
    await settle(returned, available());
    await settle(initial, linked());
    await settle(middle, linked({ platformAccountId: accountB, context: contextB }));
    expect(await screen.findByRole('checkbox')).toBeTruthy();
    expect(screen.queryByText('Google 已連結')).toBeNull();
  });

  it.each(['loading', 'pendingLogout', 'error', 'signedOut'])(
    'hides verified details and discards consent while %s',
    async (state) => {
      const view = render(<GoogleLinkEntry result="" />);
      fireEvent.click(await screen.findByRole('checkbox', { name: consentLabel }));
      const session = mocks.auth.session;
      if (state === 'loading') mocks.auth.loading = true;
      if (state === 'pendingLogout') mocks.auth.pendingLogout = true;
      if (state === 'error') mocks.auth.error = 'Session cannot be verified';
      if (state === 'signedOut') mocks.auth.session = null;
      view.rerender(<GoogleLinkEntry result="" />);
      expect(screen.queryByRole('list')).toBeNull();
      expect(screen.queryByRole('checkbox')).toBeNull();
      expect(mocks.fetch).toHaveBeenCalledTimes(1);
      mocks.auth = { session, loading: false, pendingLogout: false, error: '' };
      view.rerender(<GoogleLinkEntry result="" />);
      const checkbox = await screen.findByRole('checkbox', { name: consentLabel });
      expect((checkbox as HTMLInputElement).checked).toBe(false);
      expect(mocks.fetch).toHaveBeenCalledTimes(2);
    },
  );

  it('invalidates consent and rereads when the callback result changes', async () => {
    const view = render(<GoogleLinkEntry result="" />);
    fireEvent.click(await screen.findByRole('checkbox', { name: consentLabel }));
    const pending = deferred<Response>();
    mocks.fetch.mockReturnValueOnce(pending.promise);
    view.rerender(<GoogleLinkEntry result="unknown" />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    await settle(pending, available());
    expect(
      ((await screen.findByRole('checkbox', { name: consentLabel })) as HTMLInputElement).checked,
    ).toBe(false);
  });

  it('rejects a duplicate form submit synchronously and rechecks after browser restore', async () => {
    render(<GoogleLinkEntry result="" />);
    fireEvent.click(await screen.findByRole('checkbox', { name: consentLabel }));
    const form = screen.getByRole('button', { name: '前往 Google 授權' }).closest('form')!;
    let first = false;
    let duplicate = true;
    act(() => {
      first = fireEvent.submit(form);
      duplicate = fireEvent.submit(form);
    });
    expect(first).toBe(true);
    expect(duplicate).toBe(false);
    expect(screen.getByRole('button', { name: '正在前往 Google…' }).hasAttribute('disabled')).toBe(
      true,
    );
    const pending = deferred<Response>();
    mocks.fetch.mockReturnValueOnce(pending.promise);
    act(() => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    expect(screen.queryByRole('checkbox')).toBeNull();
    await settle(pending, available());
    expect((screen.getByRole('checkbox', { name: consentLabel }) as HTMLInputElement).checked).toBe(
      false,
    );
    expect(mocks.fetch.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true);
  });

  it('clears the list while hidden and rereads before offering a link on return', async () => {
    render(<GoogleLinkEntry result="" />);
    fireEvent.click(await screen.findByRole('checkbox', { name: consentLabel }));
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    fireEvent(document, new Event('visibilitychange'));
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    const pending = deferred<Response>();
    mocks.fetch.mockReturnValueOnce(pending.promise);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    fireEvent(document, new Event('visibilitychange'));
    expect(screen.queryByRole('checkbox')).toBeNull();
    await settle(pending, linked());
    expect(screen.getByText('Google 已連結')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('aborts an unfinished read on unmount', async () => {
    const pending = deferred<Response>();
    mocks.fetch.mockReturnValue(pending.promise);
    const view = render(<GoogleLinkEntry result="" />);
    const signal = mocks.fetch.mock.calls[0][1].signal as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    await settle(pending, linked());
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('offers retry after a timed-out read even if a transport ignores abort', async () => {
    vi.useFakeTimers();
    const pending = deferred<Response>();
    mocks.fetch.mockReturnValueOnce(pending.promise);
    render(<GoogleLinkEntry result="" />);
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByRole('alert')).toBeTruthy();
    expect((mocks.fetch.mock.calls[0][1].signal as AbortSignal).aborted).toBe(true);
    await settle(pending, linked());
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    vi.useRealTimers();
  });
});
