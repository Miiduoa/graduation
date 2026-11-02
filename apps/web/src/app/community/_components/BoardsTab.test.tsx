import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { BoardsTab } from './BoardsTab';

const mocks = vi.hoisted(() => ({
  auth: { user: { uid: 'student' } as { uid: string } | null, loading: false },
  access: { status: 'denied' as 'loading' | 'allowed' | 'denied' | 'error', authorizationEpoch: 1, isAuthorized: vi.fn(), retry: vi.fn() },
  create: vi.fn(),
  subscribe: vi.fn(),
  list: vi.fn(),
  subscriptions: vi.fn(),
}));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => mocks.auth }));
vi.mock('./useBoardCreationAccess', () => ({ useBoardCreationAccess: () => mocks.access }));
vi.mock('@/lib/community/firestore', () => ({
  listBoards: mocks.list,
  listSubscribedBoardIds: mocks.subscriptions,
  groupBoardsByType: (boards: unknown[]) => ({ topic: boards }),
  CAMPUS_BOARD_TYPE_LABEL: { topic: '主題', department: '系所', course: '課程', anon: '匿名' },
  subscribeToBoard: mocks.subscribe,
  unsubscribeFromBoard: vi.fn(),
  createBoard: mocks.create,
}));
const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
const scrollIntoView = vi.fn();
const descriptors = ['showModal', 'close'].map((name) => [name, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name)] as const);
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); } });
});
afterAll(() => {
  if (originalScrollIntoView) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView);
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  for (const [name, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
});
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  scrollIntoView.mockClear();
  mocks.auth.user = { uid: 'student' };
  mocks.auth.loading = false;
  mocks.access = { status: 'denied', authorizationEpoch: 1, isAuthorized: vi.fn(() => false), retry: vi.fn() };
  mocks.create.mockReset().mockResolvedValue('new-board');
  mocks.subscribe.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('alert', vi.fn());
  mocks.list.mockReset().mockResolvedValue([]);
  mocks.subscriptions.mockReset().mockResolvedValue([]);
});
it('replaces a failed initial read with a retry state, then shows the actual board', async () => {
  mocks.list.mockRejectedValueOnce(new Error('permission denied')).mockResolvedValue([{ id: 'science', name: '科學討論', type: 'topic' }]);
  render(<BoardsTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('尚無任何看板')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新讀取' }));
  expect(await screen.findByText('科學討論')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(mocks.list).toHaveBeenCalledTimes(2);
});
it('treats a failed subscription read as unavailable, not an empty subscription list', async () => {
  mocks.list.mockResolvedValue([{ id: 'science', name: '科學討論', type: 'topic' }]);
  mocks.subscriptions.mockRejectedValue(new Error('offline'));
  render(<BoardsTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: '訂閱' })).toBeNull();
});

it('does not send ordinary members into a board creation flow they cannot use', async () => {
  mocks.list.mockResolvedValue([]);
  render(<BoardsTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  await screen.findByText('尚無任何看板');
  expect(screen.queryByRole('button', { name: /建立看板/ })).toBeNull();
  expect(screen.queryByText('建立看板，開始一個校園話題。')).toBeNull();
});

function allow() {
  const guard = vi.fn(() => true);
  mocks.access = { status: 'allowed', authorizationEpoch: mocks.access.authorizationEpoch + 1, isAuthorized: guard, retry: vi.fn() };
  return guard;
}
function deferred<T = string>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function openCreate() {
  const trigger = await screen.findByRole('button', { name: /建立看板/ });
  await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false));
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = screen.getByRole('dialog', { name: '建立看板' });
  fireEvent.change(within(dialog).getByRole('textbox', { name: '看板名稱' }), { target: { value: '讀書討論' } });
  return dialog;
}

it('keeps existing board subscriptions available to ordinary members', async () => {
  mocks.list.mockResolvedValue([{ id: 'science', name: '科學討論', type: 'topic' }]);
  render(<BoardsTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  fireEvent.click(await screen.findByRole('button', { name: '訂閱' }));
  await waitFor(() => expect(mocks.subscribe).toHaveBeenCalledExactlyOnceWith('student', 'pu', 'science'));
  expect(screen.queryByRole('button', { name: /建立看板/ })).toBeNull();
  expect(screen.getByRole('link', { name: /科學討論/ }).getAttribute('href')).toBe('/community/board/science?schoolId=pu');
});

it('shows permission loading and a separate retry without hiding the readable boards', async () => {
  mocks.access.status = 'loading';
  mocks.list.mockResolvedValue([{ id: 'science', name: '科學討論', type: 'topic' }]);
  const view = render(<BoardsTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  await screen.findByText('科學討論');
  expect(screen.getByText('正在確認看板管理權限…')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /建立看板/ })).toBeNull();
  mocks.access.status = 'error';
  view.rerender(<BoardsTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  fireEvent.click(screen.getByRole('button', { name: '重新確認權限' }));
  expect(mocks.access.retry).toHaveBeenCalledOnce();
  expect(screen.getByText('科學討論')).toBeTruthy();
});

it('creates once and reports success only for the currently authorized scope', async () => {
  allow();
  const pending = deferred();
  mocks.create.mockReturnValue(pending.promise);
  render(<BoardsTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  const dialog = await openCreate();
  const submit = within(dialog).getByRole('button', { name: '建立' });
  fireEvent.click(submit);
  fireEvent.click(submit);
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith({ schoolId: 'pu', name: '讀書討論', type: 'topic', rules: '', defaultAnonymous: false, createdBy: 'student' });
  expect((within(dialog).getByText('關閉視窗', { selector: 'button' }) as HTMLButtonElement).disabled).toBe(false);
  await act(async () => pending.resolve('new-board'));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByText('已建立「讀書討論」看板。')).toBeTruthy();
});

it('cancels without a write, restores focus, and starts with a fresh form', async () => {
  allow();
  render(<BoardsTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  const dialog = await openCreate();
  fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
  const trigger = screen.getByRole('button', { name: /建立看板/ });
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  expect((screen.getByRole('textbox', { name: '看板名稱' }) as HTMLInputElement).value).toBe('');
  expect(mocks.create).not.toHaveBeenCalled();
});

it('checks live authorization before submitting even before the permission render changes', async () => {
  const guard = allow();
  render(<BoardsTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  const dialog = await openCreate();
  guard.mockReturnValue(false);
  fireEvent.click(within(dialog).getByRole('button', { name: '建立' }));
  expect(mocks.create).not.toHaveBeenCalled();
});

it('closes on revocation and ignores a late success even after permission is restored', async () => {
  const guard = allow();
  const pending = deferred();
  mocks.create.mockReturnValue(pending.promise);
  const view = render(<BoardsTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  const dialog = await openCreate();
  fireEvent.click(within(dialog).getByRole('button', { name: '建立' }));
  guard.mockReturnValue(false);
  mocks.access = { ...mocks.access, status: 'denied', authorizationEpoch: mocks.access.authorizationEpoch + 1 };
  view.rerender(<BoardsTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  expect(screen.queryByRole('dialog')).toBeNull();
  allow();
  view.rerender(<BoardsTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  expect(screen.queryByRole('dialog')).toBeNull();
  const reads = mocks.list.mock.calls.length;
  await act(async () => pending.resolve('old-board'));
  expect(screen.queryByText(/已建立/)).toBeNull();
  expect(mocks.list).toHaveBeenCalledTimes(reads);
});

it.each(['account', 'school', 'logout'] as const)('isolates an open form and a late rejection after %s changes', async (change) => {
  const guard = allow();
  const pending = deferred();
  mocks.create.mockReturnValue(pending.promise);
  const view = render(<BoardsTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  const dialog = await openCreate();
  fireEvent.click(within(dialog).getByRole('button', { name: '建立' }));
  guard.mockReturnValue(false);
  if (change === 'account') mocks.auth.user = { uid: 'other' };
  if (change === 'logout') mocks.auth.user = null;
  allow();
  if (change === 'logout') mocks.access.status = 'denied';
  view.rerender(<BoardsTab schoolId={change === 'school' ? 'nthu' : 'pu'} schoolSearch="" />);
  expect(screen.queryByRole('dialog')).toBeNull();
  await act(async () => pending.reject(new Error('late failure')));
  expect(screen.queryByText(/這次建立未獲允許|尚未確認是否建立|已建立/)).toBeNull();
  expect(window.alert).not.toHaveBeenCalled();
});

it('reports a real permission rejection and requires permission rechecking', async () => {
  allow();
  mocks.create.mockRejectedValue({ code: 'permission-denied' });
  render(<BoardsTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  const dialog = await openCreate();
  fireEvent.click(within(dialog).getByRole('button', { name: '建立' }));
  await screen.findByText('這次建立未獲允許，請重新確認這所學校的管理權限。');
  expect(screen.queryByText(/已建立/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新確認權限' }));
  expect(mocks.access.retry).toHaveBeenCalledOnce();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('does not submit a second non-idempotent create after an unconfirmed result', async () => {
  allow();
  mocks.create.mockRejectedValue(new Error('connection lost'));
  render(<BoardsTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  const dialog = await openCreate();
  fireEvent.click(within(dialog).getByRole('button', { name: '建立' }));
  await screen.findByText('尚未確認是否建立。請回到看板清單重新讀取，確認結果後再操作。');
  expect(within(dialog).queryByRole('button', { name: '建立' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '回看板清單確認' }));
  expect(mocks.create).toHaveBeenCalledOnce();
  await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
});

it('lets a pending write leave the dialog without allowing a duplicate or reporting late success', async () => {
  allow();
  const pending = deferred();
  mocks.create.mockReturnValue(pending.promise);
  render(<BoardsTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  const dialog = await openCreate();
  fireEvent.click(within(dialog).getByRole('button', { name: '建立' }));
  expect(screen.getByText('正在建立看板，請勿重複送出。關閉視窗不會撤回建立要求。')).toBeTruthy();
  fireEvent.click(within(dialog).getByText('關閉視窗', { selector: 'button' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByText('已關閉視窗，沒有撤回建立要求。請重新讀取看板確認結果。')).toBeTruthy();
  const trigger = screen.getByRole('button', { name: /建立看板/ });
  expect((trigger as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(trigger);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(mocks.create).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '重新讀取看板' }));
  await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
  await act(async () => pending.resolve('late-board'));
  expect(screen.queryByText('已建立「讀書討論」看板。')).toBeNull();
  expect((screen.getByRole('button', { name: /建立看板/ }) as HTMLButtonElement).disabled).toBe(false);
});

it.each(['close', 'escape'] as const)('keeps an unconfirmed result blocked after %s leaves the dialog', async (method) => {
  allow();
  mocks.create.mockRejectedValue(new Error('unknown outcome'));
  render(<BoardsTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  const dialog = await openCreate();
  fireEvent.click(within(dialog).getByRole('button', { name: '建立' }));
  await within(dialog).findByText(/尚未確認是否建立/);
  if (method === 'close') fireEvent.click(within(dialog).getByRole('button', { name: '關閉視窗' }));
  else fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '重新讀取並檢視清單' }));
  expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' });
  const trigger = screen.getByRole('button', { name: /建立看板/ });
  expect((trigger as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(trigger);
  expect(mocks.create).toHaveBeenCalledOnce();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('keeps an unconfirmed create blocked until reviewing the list completes', async () => {
  allow();
  const read = deferred<unknown[]>();
  mocks.create.mockRejectedValue(new Error('unknown outcome'));
  render(<BoardsTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  const dialog = await openCreate();
  fireEvent.click(within(dialog).getByRole('button', { name: '建立' }));
  await within(dialog).findByText(/尚未確認是否建立/);
  mocks.list.mockReturnValueOnce(read.promise);
  fireEvent.click(within(dialog).getByRole('button', { name: '回看板清單確認' }));
  expect((screen.getByRole('button', { name: /建立看板/ }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => read.resolve([{ id: 'new-board', name: '讀書討論', type: 'topic' }]));
  await screen.findByRole('link', { name: /讀書討論/ });
  expect((screen.getByRole('button', { name: /建立看板/ }) as HTMLButtonElement).disabled).toBe(false);
  expect(mocks.create).toHaveBeenCalledOnce();
});

it('keeps a late rejection after closing pending creation in the review flow', async () => {
  allow();
  const pending = deferred();
  mocks.create.mockReturnValue(pending.promise);
  render(<BoardsTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  const dialog = await openCreate();
  fireEvent.click(within(dialog).getByRole('button', { name: '建立' }));
  fireEvent.click(within(dialog).getByText('關閉視窗', { selector: 'button' }));
  await act(async () => pending.reject(new Error('unknown outcome')));
  expect((screen.getByRole('button', { name: /建立看板/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(mocks.create).toHaveBeenCalledOnce();
});

it('keeps review required after a list failure and releases it only after a successful retry', async () => {
  allow();
  mocks.create.mockRejectedValue(new Error('unknown outcome'));
  render(<BoardsTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  const dialog = await openCreate();
  fireEvent.click(within(dialog).getByRole('button', { name: '建立' }));
  await within(dialog).findByText(/尚未確認是否建立/);
  mocks.list.mockRejectedValueOnce(new Error('read unavailable'));
  fireEvent.click(within(dialog).getByRole('button', { name: '回看板清單確認' }));
  await screen.findByText('暫時無法讀取看板，請確認連線後重試。');
  expect((screen.getByRole('button', { name: /建立看板/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText(/已重新讀取清單/)).toBeNull();
  mocks.list.mockResolvedValueOnce([{ id: 'maybe-created', name: '讀書討論', type: 'topic' }]);
  fireEvent.click(screen.getByRole('button', { name: /^重新讀取$/ }));
  await screen.findByRole('link', { name: /讀書討論/ });
  expect(screen.getByText('已重新讀取清單。請先檢查是否已有剛才的看板，再決定是否建立。')).toBeTruthy();
  expect((screen.getByRole('button', { name: /建立看板/ }) as HTMLButtonElement).disabled).toBe(false);
  expect(mocks.create).toHaveBeenCalledOnce();
});

it('keeps a dismissed permission failure blocked until a new authorized epoch is observed', async () => {
  allow();
  mocks.create.mockRejectedValue({ code: 'permission-denied' });
  const view = render(<BoardsTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  const dialog = await openCreate();
  fireEvent.click(within(dialog).getByRole('button', { name: '建立' }));
  await within(dialog).findByText(/這次建立未獲允許/);
  fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));
  expect((screen.getByRole('button', { name: /建立看板/ }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '重新確認權限' }));
  expect(mocks.access.retry).toHaveBeenCalledOnce();
  expect((screen.getByRole('button', { name: /建立看板/ }) as HTMLButtonElement).disabled).toBe(true);
  mocks.access.status = 'loading';
  view.rerender(<BoardsTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  expect(screen.queryByRole('button', { name: /建立看板/ })).toBeNull();
  allow();
  view.rerender(<BoardsTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  expect((screen.getByRole('button', { name: /建立看板/ }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.queryByText(/這次建立未獲允許/)).toBeNull();
});

it('does not let a review started under an old role unlock creation after revocation and regrant', async () => {
  const guard = allow();
  const read = deferred<unknown[]>();
  mocks.create.mockRejectedValue(new Error('unknown outcome'));
  const view = render(<BoardsTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  const dialog = await openCreate();
  fireEvent.click(within(dialog).getByRole('button', { name: '建立' }));
  await within(dialog).findByText(/尚未確認是否建立/);
  mocks.list.mockReturnValueOnce(read.promise);
  fireEvent.click(within(dialog).getByRole('button', { name: '回看板清單確認' }));
  guard.mockReturnValue(false);
  mocks.access.status = 'denied';
  mocks.access.authorizationEpoch += 1;
  view.rerender(<BoardsTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  allow();
  view.rerender(<BoardsTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  await act(async () => read.resolve([]));
  expect((screen.getByRole('button', { name: /建立看板/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText(/已重新讀取清單/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新讀取並檢視清單' }));
  await waitFor(() => expect((screen.getByRole('button', { name: /建立看板/ }) as HTMLButtonElement).disabled).toBe(false));
  expect(mocks.create).toHaveBeenCalledOnce();
});

it('retains an unresolved outcome for the same account and school across role revocation', async () => {
  const guard = allow();
  const pending = deferred();
  mocks.create.mockReturnValue(pending.promise);
  const view = render(<BoardsTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  const dialog = await openCreate();
  fireEvent.click(within(dialog).getByRole('button', { name: '建立' }));
  guard.mockReturnValue(false);
  mocks.access.status = 'denied';
  mocks.access.authorizationEpoch += 1;
  view.rerender(<BoardsTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  await act(async () => pending.reject(new Error('unknown outcome')));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByText(/尚未確認是否建立/)).toBeNull();
  allow();
  view.rerender(<BoardsTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  expect((screen.getByRole('button', { name: /建立看板/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('button', { name: '重新讀取並檢視清單' })).toBeTruthy();
  expect(screen.queryByText(/已建立/)).toBeNull();
});

it('restores visible focus to a usable reload action after Escape closes a pending write', async () => {
  allow();
  mocks.create.mockReturnValue(new Promise(() => {}));
  render(<BoardsTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  const dialog = await openCreate();
  fireEvent.click(within(dialog).getByRole('button', { name: '建立' }));
  fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));
  const reload = screen.getByRole('button', { name: '重新讀取看板' });
  expect(document.activeElement).toBe(reload);
  expect((reload as HTMLButtonElement).disabled).toBe(false);
  expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' });
  expect((screen.getByRole('button', { name: /建立看板/ }) as HTMLButtonElement).disabled).toBe(true);
});

it('keeps recovery focus when a late rejection replaces the focused reload action', async () => {
  allow();
  const pending = deferred();
  mocks.create.mockReturnValue(pending.promise);
  render(<BoardsTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  const dialog = await openCreate();
  fireEvent.click(within(dialog).getByRole('button', { name: '建立' }));
  fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '重新讀取看板' }));
  await act(async () => pending.reject({ code: 'permission-denied' }));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '重新確認權限' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('does not take focus back when the user has left recovery before a late rejection', async () => {
  allow();
  const pending = deferred();
  mocks.create.mockReturnValue(pending.promise);
  render(<BoardsTab schoolId="pu" schoolSearch="?schoolId=pu" />);
  const dialog = await openCreate();
  fireEvent.click(within(dialog).getByRole('button', { name: '建立' }));
  fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));
  const search = screen.getByRole('searchbox');
  search.focus();
  scrollIntoView.mockClear();
  await act(async () => pending.reject({ code: 'permission-denied' }));
  expect(document.activeElement).toBe(search);
  expect(screen.getByRole('button', { name: '重新確認權限' })).toBeTruthy();
  expect(scrollIntoView).not.toHaveBeenCalled();
});
