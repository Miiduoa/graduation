import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parsePersonalImport, type PersonalImportRecord } from '@campus/shared';
import type { PersonalImportSnapshot } from '@campus/shared/src/imports/sync';
import { browserRequest } from '@/features/nuni/Session';
import {
  changePersonalImport,
  readPersonalImports,
  personalImportsStorageKey,
  readPersonalImportSyncState,
  savePersonalImportBatch,
} from '@/lib/personalImports';
import {
  cancelPersonalImportSync,
  getPersonalImportSyncStatus,
  setPersonalImportSyncEnabled,
  syncPersonalImports,
} from '@/lib/personalImportSync';
import { PersonalImportSyncBridge, PersonalImportSyncPanel } from './PersonalImportSync';
const context = vi.hoisted(() => ({
  scope: { owner: 'platform:one', schoolId: 'pu' },
  loading: false,
  sessionState: {
    session: { platformAccountId: 'one', context: 'context-one' },
    loading: false,
    error: '',
    pendingLogout: false,
  },
}));
vi.mock('@/features/nuni/Session', () => ({
  browserRequest: vi.fn(),
  useOptionalNuniSession: () => context.sessionState,
}));
vi.mock('@/lib/usePersonalImports', () => ({
  usePersonalImportScope: () => ({ scope: context.scope, loading: context.loading }),
}));
const initialScope = { owner: 'platform:one', schoolId: 'pu' };
const now = '2026-10-18T00:00:00.000Z';
let remote: PersonalImportSnapshot;
const rows = () =>
  parsePersonalImport('課程名稱,學分,成績\n資料庫,3,85', {
    kind: 'grades',
    schoolId: 'pu',
    academicYear: '115',
    semester: '1',
  }).rows;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(async () => {
  localStorage.clear();
  context.scope = { ...initialScope };
  context.loading = false;
  context.sessionState = {
    session: { platformAccountId: 'one', context: 'context-one' },
    loading: false,
    error: '',
    pendingLogout: false,
  };
  cancelPersonalImportSync(initialScope);
  remote = { schoolId: 'pu', revision: 0, records: [], updatedAt: null };
  vi.mocked(browserRequest)
    .mockReset()
    .mockImplementation(async (path, _context, input) => {
      if (path === 'personal-imports/read') return structuredClone(remote);
      remote = {
        ...remote,
        records: input!.records as PersonalImportRecord[],
        revision: remote.revision + 1,
        updatedAt: now,
      };
      return structuredClone(remote);
    });
  const queues = new Map<string, Promise<unknown>>();
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: (key: string, action: () => unknown) => {
        const next = (queues.get(key) || Promise.resolve()).then(action);
        queues.set(
          key,
          next.catch(() => {}),
        );
        return next;
      },
    },
  });
  await savePersonalImportBatch(initialScope, rows());
});
const enable = () => {
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: '開啟帳號同步' }));
};
const isDisabled = (name: string) =>
  (screen.getByRole('button', { name }) as HTMLButtonElement).disabled;

describe('personal import synchronization panel', () => {
  it('explains upload scope, requires explicit consent, and pauses without deleting either copy', async () => {
    render(<PersonalImportSyncPanel scope={context.scope} />);
    expect(screen.getByText(/教師／課班欄位與來源文字/)).toBeTruthy();
    expect(browserRequest).not.toHaveBeenCalled();
    expect(isDisabled('開啟帳號同步')).toBe(true);
    enable();
    await waitFor(() => expect(getPersonalImportSyncStatus(initialScope)?.phase).toBe('synced'));
    expect(remote.records).toEqual(readPersonalImports(initialScope));
    expect(remote.records[0].source.rawText).toContain('85');
    fireEvent.click(screen.getByRole('button', { name: '暫停這台裝置同步' }));
    await waitFor(() => expect(readPersonalImportSyncState(initialScope).enabled).toBe(false));
    expect(remote.records).toEqual(readPersonalImports(initialScope));
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    expect(isDisabled('開啟帳號同步')).toBe(true);
  });

  it.each(['school', 'account', 'session'] as const)(
    'does not carry consent to a different %s',
    (change) => {
      const view = render(<PersonalImportSyncPanel scope={context.scope} />);
      fireEvent.click(screen.getByRole('checkbox'));
      expect(isDisabled('開啟帳號同步')).toBe(false);
      if (change === 'school') context.scope = { ...initialScope, schoolId: 'ntu' };
      if (change === 'account') {
        context.scope = { ...initialScope, owner: 'platform:two' };
        context.sessionState.session = { platformAccountId: 'two', context: 'context-two' };
      }
      if (change === 'session')
        context.sessionState.session = {
          ...context.sessionState.session,
          context: 'context-replaced',
        };
      view.rerender(<PersonalImportSyncPanel scope={context.scope} />);
      expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
      expect(isDisabled('開啟帳號同步')).toBe(true);
      expect(browserRequest).not.toHaveBeenCalled();
    },
  );

  it.each(['loading', 'error', 'logout', 'unavailable'] as const)(
    'disables actions while %s and requires consent again after recovery',
    (blocked) => {
      const view = render(<PersonalImportSyncPanel scope={context.scope} />);
      fireEvent.click(screen.getByRole('checkbox'));
      if (blocked === 'loading') context.sessionState.loading = true;
      if (blocked === 'error') context.sessionState.error = 'session unavailable';
      if (blocked === 'logout') context.sessionState.pendingLogout = true;
      view.rerender(
        <PersonalImportSyncPanel scope={context.scope} available={blocked !== 'unavailable'} />,
      );
      expect(isDisabled('開啟帳號同步')).toBe(true);
      expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
      context.sessionState.loading = false;
      context.sessionState.error = '';
      context.sessionState.pendingLogout = false;
      view.rerender(<PersonalImportSyncPanel scope={context.scope} />);
      expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
      expect(browserRequest).not.toHaveBeenCalled();
    },
  );

  it('cancels an in-flight read on session replacement before upload or local application', async () => {
    const reading = deferred<unknown>();
    vi.mocked(browserRequest).mockImplementationOnce(() => reading.promise);
    const view = render(<PersonalImportSyncPanel scope={context.scope} />);
    enable();
    await waitFor(() => expect(browserRequest).toHaveBeenCalledTimes(1));
    context.sessionState.session = { ...context.sessionState.session, context: 'context-replaced' };
    view.rerender(<PersonalImportSyncPanel scope={context.scope} />);
    await act(async () => {
      reading.resolve(structuredClone(remote));
    });
    expect(browserRequest).toHaveBeenCalledTimes(1);
    expect(remote.records).toEqual([]);
    expect(readPersonalImports(initialScope)[0].grade).toBe('85');
    expect(readPersonalImportSyncState(initialScope).base).toBeNull();
    await waitFor(() => expect(isDisabled('立即同步')).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '立即同步' }));
    await waitFor(() => expect(remote.records).toHaveLength(1));
    expect(vi.mocked(browserRequest).mock.calls.at(-1)?.[1]).toBe('context-replaced');
  });

  it('lets the user pause while reading and then stops the upload', async () => {
    const reading = deferred<unknown>();
    vi.mocked(browserRequest).mockImplementationOnce(() => reading.promise);
    render(<PersonalImportSyncPanel scope={context.scope} />);
    enable();
    await waitFor(() => expect(browserRequest).toHaveBeenCalledTimes(1));
    expect(isDisabled('暫停這台裝置同步')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '暫停這台裝置同步' }));
    expect(isDisabled('正在暫停…')).toBe(true);
    await act(async () => {
      reading.resolve(structuredClone(remote));
    });
    await waitFor(() => expect(readPersonalImportSyncState(initialScope).enabled).toBe(false));
    expect(browserRequest).toHaveBeenCalledTimes(1);
    expect(remote.records).toEqual([]);
    expect(readPersonalImports(initialScope)).toHaveLength(1);
  });

  it('shows the request error and supports retry without discarding local changes', async () => {
    vi.mocked(browserRequest).mockRejectedValueOnce(new Error('連線中斷'));
    render(<PersonalImportSyncPanel scope={context.scope} />);
    enable();
    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toContain('連線中斷');
    expect(readPersonalImports(initialScope)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '立即同步' }));
    await waitFor(() => expect(remote.records).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('shows time, term, teacher and class differences and requires an explicit choice', async () => {
    localStorage.clear();
    const eventRows = parsePersonalImport(
      '活動名稱,日期,開始時間,結束時間\n專題討論,2026-10-20,10:00,11:00',
      {
        kind: 'events',
        schoolId: 'pu',
        academicYear: '115',
        semester: '1',
      },
    ).rows;
    await savePersonalImportBatch(initialScope, eventRows);
    await setPersonalImportSyncEnabled(initialScope, true, () => true);
    await syncPersonalImports(initialScope, context.sessionState.session, () => true);
    const original = readPersonalImports(initialScope)[0];
    await changePersonalImport(initialScope, original, {
      ...original,
      startTime: '09:00',
      endTime: '10:00',
      semester: '2',
      teacher: '林老師',
      linkedCourseId: 'class-local',
      courseCode: 'IM001',
      source: { ...original.source, name: 'first.csv', rawText: '本機來源文字' },
    });
    remote = {
      ...remote,
      revision: 2,
      records: [
        {
          ...remote.records[0],
          startTime: '13:00',
          endTime: '14:00',
          teacher: '陳老師',
          linkedCourseId: 'class-remote',
          courseCode: 'IM002',
          source: { ...remote.records[0].source, name: 'second.csv', rawText: '帳號來源文字' },
        },
      ],
    };
    render(<PersonalImportSyncPanel scope={context.scope} />);
    fireEvent.click(screen.getByRole('button', { name: '立即同步' }));
    const table = await screen.findByRole('table', { name: '專題討論的差異' });
    expect(within(table).getByRole('row', { name: '開始時間 09:00 13:00' })).toBeTruthy();
    expect(within(table).getByRole('row', { name: '結束時間 10:00 14:00' })).toBeTruthy();
    expect(within(table).getByRole('row', { name: '學期 2 1' })).toBeTruthy();
    expect(within(table).getByRole('row', { name: '教師 林老師 陳老師' })).toBeTruthy();
    expect(
      within(table).getByRole('row', { name: '課班連結 class-local class-remote' }),
    ).toBeTruthy();
    expect(within(table).getByRole('row', { name: '課程代碼 IM001 IM002' })).toBeTruthy();
    expect(within(table).getByRole('row', { name: '來源檔名 first.csv second.csv' })).toBeTruthy();
    expect(
      within(table).getByRole('row', { name: '來源文字 本機來源文字 帳號來源文字' }),
    ).toBeTruthy();
    expect(isDisabled('確認選擇並同步')).toBe(true);
    expect(readPersonalImports(initialScope)[0].startTime).toBe('09:00');
    expect(remote.records[0].startTime).toBe('13:00');
    fireEvent.change(screen.getByLabelText('保留哪一份'), { target: { value: 'remote' } });
    fireEvent.click(screen.getByRole('button', { name: '確認選擇並同步' }));
    await waitFor(() => expect(readPersonalImports(initialScope)[0].startTime).toBe('13:00'));
    expect(readPersonalImports(initialScope)[0].linkedCourseId).toBe('class-remote');
    await waitFor(() => expect(screen.queryByLabelText('保留哪一份')).toBeNull());
  });

  it('makes an unconfirmable write reviewable and only retires it after the user chooses an entire ledger', async () => {
    const records = readPersonalImports(initialScope);
    const pending = { mutationId: 'sync-unknown-write', expectedRevision: 0, records };
    localStorage.setItem(
      personalImportsStorageKey(initialScope),
      JSON.stringify({ version: 1, records, sync: { enabled: true, base: null, pending } }),
    );
    remote = { schoolId: 'pu', revision: 2, records: [], updatedAt: now };
    vi.mocked(browserRequest).mockImplementation(async (path) => {
      if (path.endsWith('/write'))
        throw Object.assign(new Error('expired mutation'), {
          code: 'PERSONAL_IMPORT_REVISION_CONFLICT',
        });
      return structuredClone(remote);
    });
    render(<PersonalImportSyncPanel scope={context.scope} />);
    fireEvent.click(screen.getByRole('button', { name: '立即同步' }));
    await screen.findByText(/無法確認上次同步是否已送達/);
    expect(screen.getByText(/先下載完整備份，再核對/)).toBeTruthy();
    expect(isDisabled('確認選擇並同步')).toBe(true);
    expect(readPersonalImportSyncState(initialScope).pending).toEqual(pending);
    expect(readPersonalImports(initialScope)).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('保留哪一份'), { target: { value: 'remote' } });
    fireEvent.click(screen.getByRole('button', { name: '確認選擇並同步' }));
    await waitFor(() => expect(readPersonalImportSyncState(initialScope).pending).toBeUndefined());
    expect(readPersonalImports(initialScope)).toEqual([]);
    expect(remote.revision).toBe(2);
    const writes = vi.mocked(browserRequest).mock.calls.filter(([path]) => path.endsWith('/write'));
    expect(writes.every(([, , input]) => input!.mutationId === pending.mutationId)).toBe(true);
  });

  it('keeps edit-versus-delete conflict visible and disables resolution during pending logout', async () => {
    await setPersonalImportSyncEnabled(initialScope, true, () => true);
    await syncPersonalImports(initialScope, context.sessionState.session, () => true);
    const original = readPersonalImports(initialScope)[0];
    await changePersonalImport(initialScope, original, { ...original, grade: '90' });
    remote = { ...remote, revision: 2, records: [] };
    const view = render(<PersonalImportSyncPanel scope={context.scope} />);
    fireEvent.click(screen.getByRole('button', { name: '立即同步' }));
    const table = await screen.findByRole('table', { name: '資料庫的差異' });
    expect(within(table).getByRole('row', { name: '成績 90 已刪除' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('保留哪一份'), { target: { value: 'local' } });
    expect(isDisabled('確認選擇並同步')).toBe(false);
    context.sessionState.pendingLogout = true;
    view.rerender(<PersonalImportSyncPanel scope={context.scope} />);
    expect(isDisabled('確認選擇並同步')).toBe(true);
    expect((screen.getByLabelText('保留哪一份') as HTMLSelectElement).disabled).toBe(true);
    expect(readPersonalImports(initialScope)[0].grade).toBe('90');
    expect(remote.records).toEqual([]);
  });
});

describe('personal import background synchronization', () => {
  it('stays local until opt-in, retries on reconnect, and stops after pausing', async () => {
    const view = render(<PersonalImportSyncBridge />);
    expect(browserRequest).not.toHaveBeenCalled();
    await act(async () => {
      await setPersonalImportSyncEnabled(initialScope, true, () => true);
    });
    vi.mocked(browserRequest).mockRejectedValueOnce(new Error('offline'));
    act(() => window.dispatchEvent(new Event('online')));
    await waitFor(() => expect(getPersonalImportSyncStatus(initialScope)?.phase).toBe('error'));
    act(() => window.dispatchEvent(new Event('online')));
    await waitFor(() => expect(getPersonalImportSyncStatus(initialScope)?.phase).toBe('synced'));
    expect(remote.records).toHaveLength(1);
    await act(async () => {
      await setPersonalImportSyncEnabled(initialScope, false, () => true);
    });
    const calls = vi.mocked(browserRequest).mock.calls.length;
    act(() => window.dispatchEvent(new Event('online')));
    await act(async () => {});
    expect(browserRequest).toHaveBeenCalledTimes(calls);
    view.unmount();
  });

  it('does not retry over a pending conflict and invalidates requests when session is unavailable', async () => {
    await setPersonalImportSyncEnabled(initialScope, true, () => true);
    await syncPersonalImports(initialScope, context.sessionState.session, () => true);
    const original = readPersonalImports(initialScope)[0];
    await changePersonalImport(initialScope, original, { ...original, grade: '90' });
    remote = { ...remote, revision: 2, records: [{ ...remote.records[0], grade: '60' }] };
    const view = render(<PersonalImportSyncBridge />);
    await waitFor(() => expect(getPersonalImportSyncStatus(initialScope)?.phase).toBe('conflict'));
    const calls = vi.mocked(browserRequest).mock.calls.length;
    act(() => {
      window.dispatchEvent(new Event('online'));
      window.dispatchEvent(new Event('focus'));
    });
    expect(browserRequest).toHaveBeenCalledTimes(calls);
    context.sessionState.pendingLogout = true;
    view.rerender(<PersonalImportSyncBridge />);
    act(() => window.dispatchEvent(new Event('online')));
    expect(browserRequest).toHaveBeenCalledTimes(calls);
    view.unmount();
  });
});
