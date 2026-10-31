import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { NuniAssignment, NuniUnit, NuniWorkspace } from '@campus/shared/src/nuni';
import { NuniError } from '@campus/shared/src/nuni';
import { CourseLearningPath } from './CourseLearningPath';

const state = vi.hoisted(() => ({ request: vi.fn(), refresh: vi.fn(), context: 'a'.repeat(43) }));
vi.mock('./Session', () => ({
  browserRequest: (...args: unknown[]) => state.request(...args),
  useNuniSession: () => ({
    session: {
      context: state.context,
      platformAccountId: 'pa_11111111-1111-4111-8111-111111111111',
    },
    refresh: state.refresh,
  }),
}));

const workspaceId = 'cw_11111111-1111-4111-8111-111111111111';
const unit: NuniUnit = {
  id: 'cwu_22222222-2222-4222-8222-222222222222',
  workspaceId,
  title: '第 01 週｜基礎',
  position: 0,
  createdAt: '2026-10-10T00:00:00Z',
};
const workspace: NuniWorkspace = { id: workspaceId, title: '資料庫', state: 'active', memberRole: 'student' };
const assignment: NuniAssignment = {
  id: 'cwa_44444444-4444-4444-8444-444444444444',
  workspaceId,
  title: '關聯式模型練習',
  instructions: '完成課堂練習',
  state: 'open',
  createdAt: '2026-10-10T00:00:00Z',
  closedAt: null,
  dueAt: '2026-10-29T15:59:00.000Z',
  unitId: unit.id,
  unitTitle: unit.title,
  submissionCount: 0,
  mySubmission: null,
};
const material = {
  id: 'cwm_33333333-3333-4333-8333-333333333333',
  workspaceId,
  title: '第一週課前閱讀',
  body: '請先閱讀',
  unitId: unit.id,
  unitTitle: unit.title,
  createdByPlatformAccountId: 'pa_11111111-1111-4111-8111-111111111111',
  createdAt: '2026-10-10T00:00:00Z',
};
const olderMaterial = {
  ...material,
  id: 'cwm_55555555-5555-4555-8555-555555555555',
  title: '更早的課前閱讀',
  createdAt: '2026-09-01T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  state.context = 'a'.repeat(43);
  state.request.mockImplementation(async (path: string) => {
    if (path.endsWith('/materials/page')) return { materials: [material], nextCursor: null };
    if (path.endsWith('/quizzes')) return { quizzes: [] };
    throw new Error('Unexpected request: ' + path);
  });
});

it('organizes real lessons by unit, shows receipt-based pending work and links to the actual course item', async () => {
  const onNavigate = vi.fn();
  render(
    <CourseLearningPath
      workspace={workspace}
      assignments={[assignment]}
      units={[unit]}
      unitsError=""
      reloadUnits={vi.fn()}
      onUnitCreated={vi.fn()}
      onNavigate={onNavigate}
    />,
  );
  const link = await screen.findByRole('link', { name: /關聯式模型練習/ });
  expect(link.getAttribute('href')).toBe(`#assignment-${assignment.id}`);
  fireEvent.click(link);
  fireEvent.click(link);
  expect(onNavigate).toHaveBeenCalledTimes(2);
  expect(onNavigate).toHaveBeenCalledWith('assignments');
  expect((await screen.findByRole('link', { name: /第一週課前閱讀/ })).getAttribute('href')).toBe(`#material-${material.id}`);
  expect(await screen.findByText('0 / 1')).toBeTruthy();
  expect(screen.getByText('可處理的待辦').previousElementSibling?.textContent).toBe('1');
  expect(screen.getByText(/教材閱讀不會自動標記完成/)).toBeTruthy();
  expect(link.textContent).toContain('2026/10/29 下午11:59');
});

it('creates a unit using the authenticated course API and only reports success after a receipt', async () => {
  const onUnitCreated = vi.fn();
  state.request.mockImplementation(async (path: string, context: string, input?: Record<string, unknown>) => {
    if (path.endsWith('/materials/page')) return { materials: [], nextCursor: null };
    if (path.endsWith('/quizzes')) return { quizzes: [] };
    if (path.endsWith('/units') && input?.title) return { ...unit, title: input.title };
    throw new Error('Unexpected request: ' + path);
  });
  render(
    <CourseLearningPath
      workspace={{ ...workspace, memberRole: 'owner-teacher' }}
      assignments={[]}
      units={[]}
      unitsError=""
      reloadUnits={vi.fn()}
      onUnitCreated={onUnitCreated}
    />,
  );
  fireEvent.click(screen.getByText('建立新章節'));
  fireEvent.change(screen.getByLabelText('章節名稱'), { target: { value: '第 01 週｜基礎' } });
  fireEvent.submit(screen.getByLabelText('章節名稱').closest('form')!);
  await waitFor(() => expect(onUnitCreated).toHaveBeenCalledWith(unit));
  expect(screen.getByText(/章節已建立，現在可以將新內容歸入/)).toBeTruthy();
  const call = state.request.mock.calls.find(([path, , input]) => path.endsWith('/units') && input?.title);
  expect(call?.[1]).toBe('a'.repeat(43));
  expect(call?.[2].idempotencyKey).toEqual(expect.any(String));
});

it('does not invent completion metrics when unit or activity API reads are missing', async () => {
  state.request.mockRejectedValue(new Error('Network unavailable'));
  const reloadUnits = vi.fn();
  render(
    <CourseLearningPath
      workspace={workspace}
      assignments={[assignment]}
      units={null}
      unitsError="連線中斷"
      reloadUnits={reloadUnits}
      onUnitCreated={vi.fn()}
    />,
  );
  await screen.findByText(/部分內容尚未載入，暫時無法顯示完整進度/);
  expect(screen.queryByText('已繳交或作答')).toBeNull();
  expect(screen.getByRole('link', { name: /關聯式模型練習/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '重試章節清單' }));
  expect(reloadUnits).toHaveBeenCalledOnce();
});

it('continues materials pages so path links reach older items and marks counts incomplete', async () => {
  state.request.mockImplementation(async (path: string, _context?: string, _input?: unknown, _method?: unknown, query?: { cursor?: string }) => {
    if (path.endsWith('/quizzes')) return { quizzes: [] };
    if (path.endsWith('/materials/page')) {
      if (!query?.cursor) return { materials: [material], nextCursor: 'older-page' };
      if (query.cursor === 'older-page') return { materials: [olderMaterial], nextCursor: null };
    }
    throw new Error(path);
  });
  const onNavigate = vi.fn();
  render(
    <CourseLearningPath
      workspace={workspace}
      assignments={[]}
      units={[unit]}
      unitsError=""
      reloadUnits={vi.fn()}
      onUnitCreated={vi.fn()}
      onNavigate={onNavigate}
    />,
  );
  expect(await screen.findByRole('link', { name: /第一週課前閱讀/ })).toBeTruthy();
  expect(screen.getByText(/教材尚有較早頁面未載入/)).toBeTruthy();
  expect(screen.getByText(/1 教材（尚未載完）/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '繼續載入較早教材' }));
  expect(
    state.request.mock.calls
      .filter(([path]) => path === `class-workspaces/${workspaceId}/materials/page`)
      .map(([, , , , query]) => query?.cursor),
  ).toEqual([undefined, 'older-page']);
  const older = await screen.findByRole('link', { name: /更早的課前閱讀/ });
  expect(older.getAttribute('href')).toBe(`#material-${olderMaterial.id}`);
  fireEvent.click(older);
  expect(onNavigate).toHaveBeenCalledWith('materials');
  expect(screen.queryByText(/尚未載完/)).toBeNull();
});

it('keeps path rows and retries after a later materials page failure', async () => {
  let olderAttempts = 0;
  state.request.mockImplementation(async (path: string, _context?: string, _input?: unknown, _method?: unknown, query?: { cursor?: string }) => {
    if (path.endsWith('/quizzes')) return { quizzes: [] };
    if (path.endsWith('/materials/page')) {
      if (!query?.cursor) return { materials: [material], nextCursor: 'older-page' };
      olderAttempts += 1;
      if (olderAttempts === 1) throw new TypeError('Failed to fetch');
      return { materials: [olderMaterial], nextCursor: null };
    }
    throw new Error(path);
  });
  render(
    <CourseLearningPath
      workspace={workspace}
      assignments={[]}
      units={[unit]}
      unitsError=""
      reloadUnits={vi.fn()}
      onUnitCreated={vi.fn()}
    />,
  );
  await screen.findByRole('link', { name: /第一週課前閱讀/ });
  fireEvent.click(screen.getByRole('button', { name: '繼續載入較早教材' }));
  expect(await screen.findByRole('button', { name: '重試載入較早教材' })).toBeTruthy();
  expect(screen.getByRole('link', { name: /第一週課前閱讀/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '重試載入較早教材' }));
  expect(await screen.findByRole('link', { name: /更早的課前閱讀/ })).toBeTruthy();
});

it('restarts path materials after an invalid cursor without retrying the broken cursor', async () => {
  const cursors: Array<string | undefined> = [];
  state.request.mockImplementation(async (path: string, _context?: string, _input?: unknown, _method?: unknown, query?: { cursor?: string }) => {
    if (path.endsWith('/quizzes')) return { quizzes: [] };
    if (path.endsWith('/materials/page')) {
      cursors.push(query?.cursor);
      if (!query?.cursor) {
        if (cursors.filter((value) => value === undefined).length === 1) {
          return { materials: [material], nextCursor: 'older-page' };
        }
        return { materials: [material, olderMaterial], nextCursor: null };
      }
      throw new NuniError(422, 'CLASS_WORKSPACE_MATERIAL_CURSOR_INVALID');
    }
    throw new Error(path);
  });
  render(
    <CourseLearningPath
      workspace={workspace}
      assignments={[]}
      units={[unit]}
      unitsError=""
      reloadUnits={vi.fn()}
      onUnitCreated={vi.fn()}
    />,
  );
  await screen.findByRole('link', { name: /第一週課前閱讀/ });
  fireEvent.click(screen.getByRole('button', { name: '繼續載入較早教材' }));
  expect(await screen.findByRole('button', { name: '重新讀取教材' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '重試載入較早教材' })).toBeNull();
  expect(screen.getByRole('link', { name: /第一週課前閱讀/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '重新讀取教材' }));
  expect(await screen.findByRole('link', { name: /更早的課前閱讀/ })).toBeTruthy();
  expect(cursors).toEqual([undefined, 'older-page', undefined]);
});

it('restarts path materials after an A→B→A cursor cycle', async () => {
  const cursors: Array<string | undefined> = [];
  state.request.mockImplementation(async (path: string, _context?: string, _input?: unknown, _method?: unknown, query?: { cursor?: string }) => {
    if (path.endsWith('/quizzes')) return { quizzes: [] };
    if (path.endsWith('/materials/page')) {
      cursors.push(query?.cursor);
      if (!query?.cursor) {
        if (cursors.filter((value) => value === undefined).length === 1) {
          return { materials: [material], nextCursor: 'cursor-a' };
        }
        return { materials: [material, olderMaterial], nextCursor: null };
      }
      if (query.cursor === 'cursor-a') {
        return {
          materials: [{ ...olderMaterial, id: 'cwm_66666666-6666-4666-8666-666666666666', title: '中間頁課前閱讀' }],
          nextCursor: 'cursor-b',
        };
      }
      if (query.cursor === 'cursor-b') {
        return {
          materials: [
            {
              ...olderMaterial,
              id: 'cwm_77777777-7777-4777-8777-777777777777',
              title: '循環頁課前閱讀',
            },
          ],
          nextCursor: 'cursor-a',
        };
      }
    }
    throw new Error(path);
  });
  render(
    <CourseLearningPath
      workspace={workspace}
      assignments={[]}
      units={[unit]}
      unitsError=""
      reloadUnits={vi.fn()}
      onUnitCreated={vi.fn()}
    />,
  );
  await screen.findByRole('link', { name: /第一週課前閱讀/ });
  fireEvent.click(screen.getByRole('button', { name: '繼續載入較早教材' }));
  await screen.findByRole('link', { name: /中間頁課前閱讀/ });
  fireEvent.click(screen.getByRole('button', { name: '繼續載入較早教材' }));
  expect(await screen.findByRole('button', { name: '重新讀取教材' })).toBeTruthy();
  expect(screen.getByText(/教材暫時無法繼續載入/)).toBeTruthy();
  expect(cursors).toEqual([undefined, 'cursor-a', 'cursor-b']);
  fireEvent.click(screen.getByRole('button', { name: '重新讀取教材' }));
  expect(await screen.findByRole('link', { name: /更早的課前閱讀/ })).toBeTruthy();
  expect(cursors).toEqual([undefined, 'cursor-a', 'cursor-b', undefined]);
});

it('evicts known materials when a later page is denied', async () => {
  state.request.mockImplementation(async (path: string, _context?: string, _input?: unknown, _method?: unknown, query?: { cursor?: string }) => {
    if (path.endsWith('/quizzes')) return { quizzes: [] };
    if (path.endsWith('/materials/page')) {
      if (!query?.cursor) return { materials: [material], nextCursor: 'older-page' };
      throw new NuniError(403, 'REQUEST_FAILED');
    }
    throw new Error(path);
  });
  render(
    <CourseLearningPath
      workspace={workspace}
      assignments={[]}
      units={[unit]}
      unitsError=""
      reloadUnits={vi.fn()}
      onUnitCreated={vi.fn()}
    />,
  );
  await screen.findByRole('link', { name: /第一週課前閱讀/ });
  fireEvent.click(screen.getByRole('button', { name: '繼續載入較早教材' }));
  await screen.findByRole('alert');
  expect(screen.queryByRole('link', { name: /第一週課前閱讀/ })).toBeNull();
});

it('does not claim quiz completion metrics when quizzes hit the legacy 100 cap', async () => {
  const quizzes = Array.from({ length: 100 }, (_, index) => ({
    id: `cwq_11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
    workspaceId,
    title: `測驗 ${index + 1}`,
    prompt: '作答',
    state: 'open' as const,
    createdAt: '2026-10-10T00:00:00Z',
    closedAt: null,
    dueAt: null,
    unitId: unit.id,
    unitTitle: unit.title,
    responseCount: 0,
    myResponse: null,
  }));
  state.request.mockImplementation(async (path: string) => {
    if (path.endsWith('/materials/page')) return { materials: [material], nextCursor: null };
    if (path.endsWith('/quizzes')) return { quizzes };
    throw new Error(path);
  });
  render(
    <CourseLearningPath
      workspace={workspace}
      assignments={[assignment]}
      units={[unit]}
      unitsError=""
      reloadUnits={vi.fn()}
      onUnitCreated={vi.fn()}
    />,
  );
  await screen.findByRole('link', { name: /第一週課前閱讀/ });
  expect(screen.getByText(/目前已載入 100 份測驗，清單與進度可能不完整/)).toBeTruthy();
  expect(screen.queryByText('已繳交或作答')).toBeNull();
});

it('ignores a pending later materials page after refresh', async () => {
  let finishOlder!: (value: unknown) => void;
  state.request.mockImplementation(async (path: string, _context?: string, _input?: unknown, _method?: unknown, query?: { cursor?: string }) => {
    if (path.endsWith('/quizzes')) return { quizzes: [] };
    if (path.endsWith('/materials/page')) {
      if (!query?.cursor) return { materials: [material], nextCursor: 'older-page' };
      return new Promise((resolve) => {
        finishOlder = resolve;
      });
    }
    throw new Error(path);
  });
  render(
    <CourseLearningPath
      workspace={workspace}
      assignments={[]}
      units={[unit]}
      unitsError=""
      reloadUnits={vi.fn()}
      onUnitCreated={vi.fn()}
    />,
  );
  await screen.findByRole('link', { name: /第一週課前閱讀/ });
  fireEvent.click(screen.getByRole('button', { name: '繼續載入較早教材' }));
  await waitFor(() => expect(finishOlder).toBeTypeOf('function'));
  fireEvent.click(screen.getByRole('button', { name: '更新章節內容' }));
  await screen.findByRole('link', { name: /第一週課前閱讀/ });
  await act(async () => finishOlder({ materials: [olderMaterial], nextCursor: 'stale-next' }));
  expect(screen.queryByRole('link', { name: /更早的課前閱讀/ })).toBeNull();
});

it('keeps full progress unknown while earlier materials have not loaded', async () => {
  state.request.mockImplementation(async (path: string) => {
    if (path.endsWith('/materials/page')) return { materials: [material], nextCursor: 'older' };
    if (path.endsWith('/quizzes')) return { quizzes: [] };
    throw new Error('unexpected');
  });
  render(<CourseLearningPath workspace={workspace} assignments={[]} units={[unit]} unitsError="" reloadUnits={vi.fn()} onUnitCreated={vi.fn()} />);
  expect(await screen.findByText(/進度未知：清單未齊/)).toBeTruthy();
  expect(screen.queryByText('已繳交或作答')).toBeNull();
  expect(screen.getByText(/來源：nuni 課程/).textContent).toContain('本次讀取');
  expect(screen.getByRole('link', { name: /第一週課前閱讀/ }).getAttribute('href')).toBe(`#material-${material.id}`);
});
