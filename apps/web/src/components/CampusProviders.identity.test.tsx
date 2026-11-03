import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CampusProviders } from './CampusProviders';
import { campusDraftIdentity, scopeStorageKey, useCampusDraft } from './CampusDraftProvider';
import { useSelectedSchool } from './SelectedSchoolProvider';

const identity = vi.hoisted(() => ({
  uid: null as string | null,
  platformAccountId: 'platform-a' as string | null,
  authLoading: false,
  loading: false,
  error: null as string | null,
  pendingLogout: false,
}));
const replace = vi.hoisted(() => vi.fn());
vi.mock('./AuthGuard', () => ({
  useAuth: () => ({ user: identity.uid ? { uid: identity.uid } : null, loading: identity.authLoading }),
}));
vi.mock('@/features/nuni/Session', () => ({
  NuniSessionProvider: ({ children }: { children: ReactNode }) => children,
  useNuniSession: () => ({
    session: identity.platformAccountId ? { platformAccountId: identity.platformAccountId } : null,
    loading: identity.loading, error: identity.error, pendingLogout: identity.pendingLogout,
  }),
}));
vi.mock('./imports/PersonalImportSync', () => ({ PersonalImportSyncBridge: () => null }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams('campus=school-a'),
  useRouter: () => ({ replace }),
}));
function Probe() {
  const draft = useCampusDraft('assistant');
  const school = useSelectedSchool();
  return <>
    <input aria-label="草稿" value={draft.text} onChange={(event) => draft.setText(event.target.value)} />
    <button onClick={() => school.selectSchool('school-b')}>換校</button>
    <output>{school.selectedSchoolId}</output>
  </>;
}
function View() {
  return <CampusProviders><Probe /></CampusProviders>;
}
const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const [name, descriptor] of [['showModal', originalShowModal], ['close', originalClose]] as const) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
});
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) { this.removeAttribute('open'); },
  });
  Object.assign(identity, { uid: null, platformAccountId: 'platform-a', authLoading: false, loading: false, error: null, pendingLogout: false });
  localStorage.clear();
  sessionStorage.clear();
  replace.mockReset();
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ schools: [
    { id: 'school-a', name: '甲校' }, { id: 'school-b', name: '乙校' },
  ] }))));
});

for (const kind of ['platform', 'firebase'] as const) {
  it(`${kind} identity change clears drafts and cancels the pending school change`, async () => {
    if (kind === 'firebase') identity.uid = 'firebase-a';
    const view = render(<View />);
    await screen.findByText('school-a');
    fireEvent.change(screen.getByLabelText('草稿'), { target: { value: '帳號 A 草稿' } });
    fireEvent.click(screen.getByText('換校'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    if (kind === 'platform') identity.platformAccountId = 'platform-b';
    else identity.uid = 'firebase-b';
    view.rerender(<View />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect((screen.getByLabelText('草稿') as HTMLInputElement).value).toBe('');
    expect(screen.getByText('school-a')).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });
}

for (const pending of ['authLoading', 'loading', 'error', 'pendingLogout'] as const) {
  it(`hides drafts and does not restore storage while ${pending}`, async () => {
    const view = render(<View />);
    await screen.findByText('school-a');
    fireEvent.change(screen.getByLabelText('草稿'), { target: { value: '未送出內容' } });
    Object.assign(identity, { [pending]: pending === 'error' ? '無法確認' : true });
    view.rerender(<View />);
    expect((screen.getByLabelText('草稿') as HTMLInputElement).value).toBe('');
    view.unmount();
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    render(<View />);
    await waitFor(() => expect(screen.getByLabelText('草稿')).toBeTruthy());
    const key = scopeStorageKey(campusDraftIdentity(null, 'platform-a'), 'school-a');
    expect(getItem.mock.calls.some(([value]) => value === key)).toBe(false);
    getItem.mockRestore();
  });
}

it('restores the same platform account draft after navigating away and returning', async () => {
  const view = render(<View />);
  await screen.findByText('school-a');
  fireEvent.change(screen.getByLabelText('草稿'), { target: { value: '跨頁保留' } });
  view.unmount();
  render(<View />);
  await waitFor(() => expect((screen.getByLabelText('草稿') as HTMLInputElement).value).toBe('跨頁保留'));
});
