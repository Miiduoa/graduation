import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppHeader } from './AppHeader';

const state = vi.hoisted(() => ({
  pathname: '/library',
  search: 'campus=pu',
  schoolId: 'pu' as string | null,
  campusLoading: false,
  context: 'session-a' as string | null,
  loading: false,
  pendingLogout: false,
  ask: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => state.pathname,
  useSearchParams: () => new URLSearchParams(state.search),
}));
vi.mock('./SchoolSelector', () => ({ SchoolSelector: () => null }));
vi.mock('./CampusServiceMenu', () => ({ CampusServiceMenu: () => null }));
vi.mock('./AuthGuard', () => ({
  useAuth: () => ({ user: null, loading: false, error: null, signOutUser: vi.fn() }),
}));
vi.mock('./SelectedSchoolProvider', () => ({
  useOptionalSelectedSchool: () => ({
    selectedSchool:
      !state.campusLoading && state.schoolId ? { id: state.schoolId, name: state.schoolId } : null,
    selectedSchoolId: state.campusLoading ? null : state.schoolId,
    catalogStatus: 'ready',
    loading: state.campusLoading,
  }),
}));
vi.mock('@/features/nuni/Session', () => {
  const session = () => ({
    session: state.context ? { context: state.context, platformAccountId: state.context } : null,
    loading: state.loading,
    error: null,
    pendingLogout: state.pendingLogout,
    logout: vi.fn(),
  });
  return { useNuniSession: session, useOptionalNuniSession: session };
});
vi.mock('@/lib/functionsUrl', async (original) => ({
  ...(await original<typeof import('@/lib/functionsUrl')>()),
  areFunctionsConfigured: () => false,
}));
vi.mock('@/features/nuni/Assistant', async () => {
  const { VoiceDictationButton } = await import('./VoiceDictationButton');
  return {
    Conversation: ({
      inlineDraft,
    }: {
      inlineDraft: { text: string; setText: (value: string) => void };
    }) => (
      <form
        aria-label="傳送問題"
        onSubmit={(event) => {
          event.preventDefault();
          state.ask(inlineDraft.text);
        }}
      >
        <label>
          問題
          <textarea
            value={inlineDraft.text}
            onChange={(event) => inlineDraft.setText(event.target.value)}
          />
        </label>
        <VoiceDictationButton onTranscript={inlineDraft.setText} />
        <button type="submit">送出問題</button>
        <a href="/library?campus=pu" onClick={(event) => event.preventDefault()}>
          查看參考服務
        </a>
      </form>
    ),
  };
});

beforeEach(() => {
  state.pathname = '/library';
  state.search = 'campus=pu';
  state.schoolId = 'pu';
  state.campusLoading = false;
  state.context = 'session-a';
  state.loading = false;
  state.pendingLogout = false;
  state.ask.mockReset();
  window.history.replaceState({}, '', '/library?campus=pu');
  Element.prototype.scrollIntoView = vi.fn();
  sessionStorage.clear();
});

afterEach(() => vi.unstubAllGlobals());

it('refreshes disclosure clearance after the header moves and releases its layout observers', () => {
  let onResize: (() => void) | undefined;
  const observe = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        onResize = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  const view = render(<AppHeader />);
  const navigation = screen.getByRole('banner');
  const account = navigation.querySelector<HTMLDetailsElement>('details')!;
  const trigger = account.querySelector('summary')!;
  let bottom = 96;
  const geometry = vi
    .spyOn(navigation, 'getBoundingClientRect')
    .mockImplementation(() => ({ bottom }) as DOMRect);
  try {
    expect(observe).toHaveBeenCalledWith(navigation);
    expect(observe).toHaveBeenCalledWith(navigation.parentElement);
    act(() => trigger.focus());
    account.open = true;
    fireEvent(account, new Event('toggle'));
    expect(navigation.style.getPropertyValue('--navigation-header-bottom')).toBe('96px');
    expect(document.activeElement).toBe(trigger);

    // A banner above the header can change its position without a header resize.
    bottom = 144;
    act(() => onResize?.());
    expect(navigation.style.getPropertyValue('--navigation-header-bottom')).toBe('144px');
    expect(document.activeElement).toBe(trigger);

    bottom = -20;
    fireEvent(window, new Event('scroll'));
    expect(navigation.style.getPropertyValue('--navigation-header-bottom')).toBe('0px');
    view.unmount();
    // Header clearance and the independently sized mobile bar both release.
    expect(disconnect).toHaveBeenCalledTimes(2);
    bottom = 220;
    fireEvent(window, new Event('resize'));
    fireEvent(window, new Event('scroll'));
    fireEvent(account, new Event('toggle'));
    expect(navigation.style.getPropertyValue('--navigation-header-bottom')).toBe('0px');
  } finally {
    view.unmount();
    geometry.mockRestore();
  }
});

it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }])(
  'keeps the account menu open when a link opens in a different tab or window: %o',
  (modifier) => {
    render(<AppHeader />);
    const trigger = screen.getByLabelText('帳號');
    const menu = trigger.closest('details')!;
    fireEvent.click(trigger);
    const link = screen.getByRole('link', { name: '我的帳號' });
    fireEvent.click(link, modifier);
    expect(menu.open).toBe(true);
    fireEvent.click(link);
    expect(menu.open).toBe(false);
  },
);

it('keeps the assistant draft and voice session when a link has not navigated this tab', async () => {
  const start = vi.fn();
  const abort = vi.fn();
  vi.stubGlobal(
    'SpeechRecognition',
    class {
      start = start;
      abort = abort;
    },
  );
  const view = render(<AppHeader />);
  fireEvent.click(screen.getByRole('button', { name: '開啟校園助理' }));
  const field = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: '問題' });
  fireEvent.change(field, { target: { value: '我還在安排明天的課程' } });
  fireEvent.click(screen.getByRole('button', { name: '使用語音輸入' }));
  const reference = screen.getByRole('link', { name: '查看參考服務' });
  fireEvent.click(reference, { metaKey: true });
  // A cancelled ordinary link is not a completed navigation either.
  fireEvent.click(reference);
  expect(screen.getByRole('dialog', { name: '校園助理' })).toBeTruthy();
  expect(field.value).toBe('我還在安排明天的課程');
  expect(abort).not.toHaveBeenCalled();
  expect(state.ask).not.toHaveBeenCalled();
  state.pathname = '/calendar';
  view.rerender(<AppHeader />);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(abort).toHaveBeenCalledOnce();
});

it('opens the actual account conversation without a search detour, recording, or automatic submission', async () => {
  const start = vi.fn();
  const abort = vi.fn();
  vi.stubGlobal(
    'SpeechRecognition',
    class {
      start = start;
      abort = abort;
    },
  );
  render(<AppHeader />);
  expect(screen.queryByRole('form', { name: '傳送問題' })).toBeNull();
  const trigger = screen.getByRole('button', { name: '開啟校園助理' });
  fireEvent.click(trigger);
  const field = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: '問題' });
  await waitFor(() => expect(document.activeElement).toBe(field));
  expect(window.location.pathname + window.location.search).toBe('/library?campus=pu');
  expect(screen.queryByRole('searchbox')).toBeNull();
  expect(start).not.toHaveBeenCalled();
  expect(state.ask).not.toHaveBeenCalled();

  fireEvent.change(field, { target: { value: '幫我確認借書後的讀書安排' } });
  fireEvent.click(screen.getByRole('button', { name: '使用語音輸入' }));
  expect(start).toHaveBeenCalledOnce();
  fireEvent.keyDown(field, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(abort).toHaveBeenCalledOnce();

  fireEvent.click(trigger);
  const resumed = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: '問題' });
  expect(resumed.value).toBe('幫我確認借書後的讀書安排');
  expect(start).toHaveBeenCalledOnce();
  expect(state.ask).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '送出問題' }));
  expect(state.ask).toHaveBeenCalledExactlyOnceWith('幫我確認借書後的讀書安排');
});

it('resumes a login-return assistant only after the account is ready, and respects closing it', async () => {
  const start = vi.fn();
  vi.stubGlobal(
    'SpeechRecognition',
    class {
      start = start;
      abort = vi.fn();
    },
  );
  state.loading = true;
  window.history.replaceState({}, '', '/library?campus=pu#campus-assistant-entry');
  const view = render(<AppHeader />);
  expect(screen.queryByRole('dialog')).toBeNull();
  state.loading = false;
  view.rerender(<AppHeader />);
  const field = await screen.findByRole('textbox', { name: '問題' });
  await waitFor(() => expect(document.activeElement).toBe(field));
  expect(screen.getByRole('dialog', { name: '校園助理' })).toBeTruthy();
  expect(start).not.toHaveBeenCalled();
  expect(state.ask).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '關閉校園助理' }));
  expect(window.location.hash).toBe('');
  view.rerender(<AppHeader />);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('keeps a requested assistant open while the first campus resolves without offering a temporary input', async () => {
  state.pathname = '/life';
  state.search = '';
  state.schoolId = null;
  state.campusLoading = true;
  window.history.replaceState({}, '', '/life');
  const start = vi.fn();
  vi.stubGlobal(
    'SpeechRecognition',
    class {
      start = start;
      abort = vi.fn();
    },
  );
  const view = render(<AppHeader />);
  fireEvent.click(screen.getByRole('button', { name: '開啟校園助理' }));
  const panel = screen.getByRole('dialog', { name: '校園助理' });
  await screen.findByText('正在確認瀏覽校園…');
  expect(screen.queryByRole('searchbox')).toBeNull();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('button', { name: '使用語音輸入' })).toBeNull();

  state.campusLoading = false;
  state.schoolId = 'pu';
  view.rerender(<AppHeader />);
  const field = await screen.findByRole('textbox', { name: '問題' });
  expect(screen.getByRole('dialog', { name: '校園助理' })).toBe(panel);
  await waitFor(() => expect(document.activeElement).toBe(field));
  expect(start).not.toHaveBeenCalled();
  expect(state.ask).not.toHaveBeenCalled();

  fireEvent.change(field, { target: { value: '已確認校園的問題' } });
  state.schoolId = 'nthu';
  view.rerender(<AppHeader />);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByDisplayValue('已確認校園的問題')).toBeNull();
});

it.each(['account', 'route'] as const)(
  'does not carry an unresolved campus opening across a different %s',
  async (changed) => {
    state.search = '';
    state.schoolId = null;
    state.campusLoading = true;
    const view = render(<AppHeader />);
    fireEvent.click(screen.getByRole('button', { name: '開啟校園助理' }));
    await screen.findByText('正在確認瀏覽校園…');
    if (changed === 'account') state.context = 'session-b';
    else state.pathname = '/calendar';
    view.rerender(<AppHeader />);
    state.campusLoading = false;
    state.schoolId = 'pu';
    view.rerender(<AppHeader />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(state.ask).not.toHaveBeenCalled();
  },
);

it('does not reopen or move focus after the pending campus assistant was closed', async () => {
  state.search = '';
  state.schoolId = null;
  state.campusLoading = true;
  const view = render(<AppHeader />);
  const trigger = screen.getByRole('button', { name: '開啟校園助理' });
  fireEvent.click(trigger);
  await screen.findByText('正在確認瀏覽校園…');
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  state.campusLoading = false;
  state.schoolId = 'pu';
  view.rerender(<AppHeader />);
  await act(async () => {});
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(state.ask).not.toHaveBeenCalled();
});

it('does not treat a confirmed all-campus selection as an unresolved campus', async () => {
  state.search = 'campus=all';
  state.schoolId = null;
  const view = render(<AppHeader />);
  fireEvent.click(screen.getByRole('button', { name: '開啟校園助理' }));
  const field = await screen.findByRole('searchbox');
  fireEvent.change(field, { target: { value: '不限校園的搜尋' } });
  state.schoolId = 'pu';
  view.rerender(<AppHeader />);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByDisplayValue('不限校園的搜尋')).toBeNull();
});

it('does not revive a confirmed campus conversation after that campus reloads', async () => {
  const view = render(<AppHeader />);
  fireEvent.click(screen.getByRole('button', { name: '開啟校園助理' }));
  const field = await screen.findByRole('textbox', { name: '問題' });
  fireEvent.change(field, { target: { value: '重新確認校園前的問題' } });
  state.campusLoading = true;
  view.rerender(<AppHeader />);
  expect(screen.queryByRole('dialog')).toBeNull();
  state.campusLoading = false;
  view.rerender(<AppHeader />);
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '開啟校園助理' }));
  expect((await screen.findByRole<HTMLTextAreaElement>('textbox', { name: '問題' })).value).toBe(
    '',
  );
  expect(state.ask).not.toHaveBeenCalled();
});

it('keeps keyboard focus on the page when the first campus resolves after the user moved away', async () => {
  state.search = '';
  state.schoolId = null;
  state.campusLoading = true;
  const content = () => (
    <>
      <button type="button">繼續編輯</button>
      <AppHeader />
    </>
  );
  const view = render(content());
  fireEvent.click(screen.getByRole('button', { name: '開啟校園助理' }));
  await screen.findByText('正在確認瀏覽校園…');
  const edit = screen.getByRole('button', { name: '繼續編輯' });
  edit.focus();
  state.campusLoading = false;
  state.schoolId = 'pu';
  view.rerender(content());
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(edit);
  fireEvent.click(screen.getByRole('button', { name: '開啟校園助理' }));
  await screen.findByRole('textbox', { name: '問題' });
});

it.each(['account', 'campus', 'route'] as const)(
  'discards the old assistant surface when the %s changes',
  async (changed) => {
    const view = render(<AppHeader />);
    fireEvent.click(screen.getByRole('button', { name: '開啟校園助理' }));
    const field = await screen.findByRole('textbox', { name: '問題' });
    fireEvent.change(field, { target: { value: '前一個身分的未送出問題' } });
    if (changed === 'account') state.context = 'session-b';
    if (changed === 'campus') state.schoolId = 'nthu';
    if (changed === 'route') {
      state.pathname = '/calendar';
      window.history.replaceState({}, '', '/calendar?campus=pu');
    }
    view.rerender(<AppHeader />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByDisplayValue('前一個身分的未送出問題')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '開啟校園助理' }));
    expect((await screen.findByRole<HTMLTextAreaElement>('textbox', { name: '問題' })).value).toBe(
      '',
    );
    expect(state.ask).not.toHaveBeenCalled();
  },
);

it('does not take focus from the current page when an assistant finishes loading late', async () => {
  state.loading = true;
  const content = () => (
    <>
      <button type="button">繼續編輯</button>
      <AppHeader />
    </>
  );
  const view = render(content());
  fireEvent.click(screen.getByRole('button', { name: '開啟校園助理' }));
  await screen.findByText('正在確認登入狀態…');
  const edit = screen.getByRole('button', { name: '繼續編輯' });
  edit.focus();
  state.loading = false;
  view.rerender(content());
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(edit);
  fireEvent.click(screen.getByRole('button', { name: '開啟校園助理' }));
  await screen.findByRole('textbox', { name: '問題' });
});

it('preserves the current service, filters and campus in the guest assistant login return', async () => {
  state.context = null;
  state.pathname = '/life';
  state.search = 'campus=pu&group=travel&q=公車';
  window.history.replaceState({}, '', '/life?campus=pu&group=travel&q=%E5%85%AC%E8%BB%8A');
  render(<AppHeader />);
  fireEvent.click(screen.getByRole('button', { name: '開啟校園助理' }));
  const login = await screen.findByRole('link', { name: '登入後，接著詢問校園助理' });
  const url = new URL(login.getAttribute('href')!, window.location.origin);
  const destination = new URL(url.searchParams.get('returnUrl')!, window.location.origin);
  expect(destination.pathname).toBe('/life');
  expect(destination.hash).toBe('#campus-assistant-entry');
  expect(destination.searchParams.get('group')).toBe('travel');
  expect(destination.searchParams.get('q')).toBe('公車');
  expect(destination.searchParams.get('schoolId')).toBe('pu');
  expect(destination.searchParams.get('campus')).toBe('pu');
  expect(url.searchParams.get('schoolId')).toBe('pu');
});
