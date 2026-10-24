import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { NuniError, type NuniMaterial } from '@campus/shared/src/nuni';
import { CourseMaterialSearch } from './CourseMaterialSearch';

const state = vi.hoisted(() => ({ context: 'session-a', request: vi.fn() }));
vi.mock('./Session', () => ({
  browserRequest: state.request,
  useNuniSession: () => ({
    session: {
      context: state.context,
      platformAccountId: 'pa_11111111-1111-4111-8111-111111111111',
    },
    pendingLogout: false,
    refresh: vi.fn(),
  }),
}));

const workspaceId = 'cw_11111111-1111-4111-8111-111111111111';
const material: NuniMaterial = {
  id: 'cwm_11111111-1111-4111-8111-111111111111',
  workspaceId,
  title: '關聯與主鍵',
  body: '第三正規化 https://example.test/week3.pdf',
  unitId: 'cwu_11111111-1111-4111-8111-111111111111',
  unitTitle: '第 03 週｜資料模型',
  createdByPlatformAccountId: 'pa_11111111-1111-4111-8111-111111111111',
  createdAt: '2026-10-20T08:00:00.000Z',
};
const olderMaterial: NuniMaterial = {
  ...material,
  id: 'cwm_22222222-2222-4222-8222-222222222222',
  title: '較早的主鍵講義',
  createdAt: '2026-09-01T08:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  state.context = 'session-a';
  state.request.mockImplementation(async (path: string) => {
    if (path === 'class-workspaces') {
      return {
        workspaces: [
          { id: workspaceId, title: '資料庫系統', state: 'active', memberRole: 'student' },
        ],
      };
    }
    if (path === `class-workspaces/${workspaceId}/materials/page`) {
      return { materials: [material], nextCursor: null };
    }
    throw new Error(`Unexpected ${path}`);
  });
});

it('does not read courses until the student types a query', async () => {
  render(<CourseMaterialSearch />);
  expect(screen.getByRole('heading', { name: '找教材' })).toBeTruthy();
  expect(state.request).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('搜尋教材'), { target: { value: '主鍵' } });
  const link = await screen.findByRole('link', { name: /關聯與主鍵/ });
  expect(link.getAttribute('href')).toBe(
    `/classroom/course/${workspaceId}#material-${material.id}`,
  );
  expect(link.textContent).toContain('資料庫系統');
  expect(link.textContent).toContain('第 03 週｜資料模型');
});

it('keeps a typed query working after a one-character typo', async () => {
  render(<CourseMaterialSearch />);
  fireEvent.change(screen.getByLabelText('搜尋教材'), { target: { value: '關連' } });
  expect(await screen.findByRole('link', { name: /關聯與主鍵/ })).toBeTruthy();
});

it('says so when nothing matches and does not invent a hit', async () => {
  render(<CourseMaterialSearch />);
  fireEvent.change(screen.getByLabelText('搜尋教材'), { target: { value: '沒有這份講義' } });
  expect(await screen.findByText(/找不到符合「沒有這份講義」的教材/)).toBeTruthy();
  expect(screen.queryByRole('link', { name: /關聯與主鍵/ })).toBeNull();
});

it('shows an offline error without pretending the catalogue loaded', async () => {
  state.request.mockRejectedValue(new TypeError('Failed to fetch'));
  render(<CourseMaterialSearch />);
  fireEvent.change(screen.getByLabelText('搜尋教材'), { target: { value: '主鍵' } });
  expect((await screen.findByRole('alert')).textContent).toMatch(/目前無法連線/);
  expect(screen.queryByRole('link')).toBeNull();
});

it('retries a first-page catalogue failure with 重新讀取教材 without editing the query', async () => {
  state.request
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockImplementation(async (path: string) => {
      if (path === 'class-workspaces') {
        return {
          workspaces: [
            { id: workspaceId, title: '資料庫系統', state: 'active', memberRole: 'student' },
          ],
        };
      }
      if (path === `class-workspaces/${workspaceId}/materials/page`) {
        return { materials: [material], nextCursor: null };
      }
      throw new Error(path);
    });
  render(<CourseMaterialSearch />);
  fireEvent.change(screen.getByLabelText('搜尋教材'), { target: { value: '主鍵' } });
  expect(await screen.findByRole('alert')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '重新讀取教材' }));
  expect(await screen.findByRole('link', { name: /關聯與主鍵/ })).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('skips a course without permission and still searches the rest', async () => {
  const other = 'cw_22222222-2222-4222-8222-222222222222';
  state.request.mockImplementation(async (path: string) => {
    if (path === 'class-workspaces') {
      return {
        workspaces: [
          { id: workspaceId, title: '資料庫系統', state: 'active', memberRole: 'student' },
          { id: other, title: '被撤權的課', state: 'active', memberRole: 'student' },
        ],
      };
    }
    if (path.endsWith(`${other}/materials/page`)) throw new NuniError(403, 'REQUEST_FAILED');
    if (path.endsWith('/materials/page')) return { materials: [material], nextCursor: null };
    throw new Error(path);
  });
  render(<CourseMaterialSearch />);
  fireEvent.change(screen.getByLabelText('搜尋教材'), { target: { value: '主鍵' } });
  await screen.findByRole('link', { name: /關聯與主鍵/ });
  expect(screen.getByText(/有 1 門課目前沒有權限/)).toBeTruthy();
});

it('reuses today-page materials and does not fetch those courses again', async () => {
  render(
    <CourseMaterialSearch
      seed={{
        items: [
          {
            id: material.id,
            workspaceId,
            courseTitle: '資料庫系統',
            title: material.title,
            body: material.body,
            unitTitle: material.unitTitle,
            createdAt: material.createdAt,
          },
        ],
        courseIds: [workspaceId],
        truncated: false,
      }}
    />,
  );
  fireEvent.change(screen.getByLabelText('搜尋教材'), { target: { value: '主鍵' } });
  expect(await screen.findByRole('link', { name: /關聯與主鍵/ })).toBeTruthy();
  expect(state.request.mock.calls.map(([path]) => path)).toEqual(['class-workspaces']);
});

it('continues later pages so older materials become searchable and link to the cabinet', async () => {
  state.request.mockImplementation(async (path: string, _context?: string, _input?: unknown, _method?: unknown, query?: { cursor?: string }) => {
    if (path === 'class-workspaces') {
      return {
        workspaces: [
          { id: workspaceId, title: '資料庫系統', state: 'active', memberRole: 'student' },
        ],
      };
    }
    if (path === `class-workspaces/${workspaceId}/materials/page`) {
      if (!query?.cursor) return { materials: [material], nextCursor: 'older-page' };
      if (query.cursor === 'older-page') return { materials: [olderMaterial], nextCursor: null };
    }
    throw new Error(`Unexpected ${path}`);
  });
  render(<CourseMaterialSearch />);
  fireEvent.change(screen.getByLabelText('搜尋教材'), { target: { value: '主鍵' } });
  expect(await screen.findByRole('link', { name: /關聯與主鍵/ })).toBeTruthy();
  expect(screen.queryByRole('link', { name: /較早的主鍵講義/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '繼續載入較早教材' }));
  const older = await screen.findByRole('link', { name: /較早的主鍵講義/ });
  expect(older.getAttribute('href')).toBe(
    `/classroom/course/${workspaceId}#material-${olderMaterial.id}`,
  );
  expect(screen.queryByRole('button', { name: /較早教材/ })).toBeNull();
});

it('keeps confirmed hits and retries after a later-page failure', async () => {
  let olderAttempts = 0;
  state.request.mockImplementation(async (path: string, _context?: string, _input?: unknown, _method?: unknown, query?: { cursor?: string }) => {
    if (path === 'class-workspaces') {
      return {
        workspaces: [
          { id: workspaceId, title: '資料庫系統', state: 'active', memberRole: 'student' },
        ],
      };
    }
    if (path === `class-workspaces/${workspaceId}/materials/page`) {
      if (!query?.cursor) return { materials: [material], nextCursor: 'older-page' };
      olderAttempts += 1;
      if (olderAttempts === 1) throw new TypeError('Failed to fetch');
      return { materials: [olderMaterial], nextCursor: null };
    }
    throw new Error(path);
  });
  render(<CourseMaterialSearch />);
  fireEvent.change(screen.getByLabelText('搜尋教材'), { target: { value: '主鍵' } });
  await screen.findByRole('link', { name: /關聯與主鍵/ });
  fireEvent.click(await screen.findByRole('button', { name: '繼續載入較早教材' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByRole('link', { name: /關聯與主鍵/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '重試載入較早教材' }));
  expect(await screen.findByRole('link', { name: /較早的主鍵講義/ })).toBeTruthy();
});

it('restarts search after an invalid cursor instead of retrying the broken continuation', async () => {
  let firstPages = 0;
  state.request.mockImplementation(async (path: string, _context?: string, _input?: unknown, _method?: unknown, query?: { cursor?: string }) => {
    if (path === 'class-workspaces') {
      return {
        workspaces: [
          { id: workspaceId, title: '資料庫系統', state: 'active', memberRole: 'student' },
        ],
      };
    }
    if (path === `class-workspaces/${workspaceId}/materials/page`) {
      if (!query?.cursor) {
        firstPages += 1;
        if (firstPages === 1) return { materials: [material], nextCursor: 'older-page' };
        return { materials: [material, olderMaterial], nextCursor: null };
      }
      throw new NuniError(422, 'CLASS_WORKSPACE_MATERIAL_CURSOR_INVALID');
    }
    throw new Error(path);
  });
  render(<CourseMaterialSearch />);
  fireEvent.change(screen.getByLabelText('搜尋教材'), { target: { value: '主鍵' } });
  await screen.findByRole('link', { name: /關聯與主鍵/ });
  fireEvent.click(screen.getByRole('button', { name: '繼續載入較早教材' }));
  expect((await screen.findByRole('alert')).textContent).toMatch(/請重新讀取教材/);
  expect(screen.queryByRole('button', { name: '重試載入較早教材' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新讀取教材' }));
  expect(await screen.findByRole('link', { name: /較早的主鍵講義/ })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /較早教材|重新讀取/ })).toBeNull();
});

it('restarts search after an A→B→A cursor cycle without faking a complete catalogue', async () => {
  const calls: Array<string | undefined> = [];
  state.request.mockImplementation(async (path: string, _context?: string, _input?: unknown, _method?: unknown, query?: { cursor?: string }) => {
    if (path === 'class-workspaces') {
      return {
        workspaces: [
          { id: workspaceId, title: '資料庫系統', state: 'active', memberRole: 'student' },
        ],
      };
    }
    if (path === `class-workspaces/${workspaceId}/materials/page`) {
      calls.push(query?.cursor);
      if (!query?.cursor) {
        if (calls.filter((cursor) => cursor === undefined).length === 1) {
          return { materials: [material], nextCursor: 'cursor-a' };
        }
        return { materials: [material, olderMaterial], nextCursor: null };
      }
      if (query.cursor === 'cursor-a') {
        return {
          materials: [{ ...olderMaterial, id: 'cwm_33333333-3333-4333-8333-333333333333', title: '中間頁主鍵' }],
          nextCursor: 'cursor-b',
        };
      }
      if (query.cursor === 'cursor-b') {
        return {
          materials: [
            {
              ...olderMaterial,
              id: 'cwm_44444444-4444-4444-8444-444444444444',
              title: '循環頁主鍵',
            },
          ],
          nextCursor: 'cursor-a',
        };
      }
    }
    throw new Error(path);
  });
  render(<CourseMaterialSearch />);
  fireEvent.change(screen.getByLabelText('搜尋教材'), { target: { value: '主鍵' } });
  await screen.findByRole('link', { name: /關聯與主鍵/ });
  fireEvent.click(screen.getByRole('button', { name: '繼續載入較早教材' }));
  await screen.findByRole('link', { name: /中間頁主鍵/ });
  fireEvent.click(screen.getByRole('button', { name: '繼續載入較早教材' }));
  expect((await screen.findByRole('alert')).textContent).toMatch(/重複游標/);
  expect(screen.queryByRole('button', { name: '繼續載入較早教材' })).toBeNull();
  expect(calls).toEqual([undefined, 'cursor-a', 'cursor-b']);
  fireEvent.click(screen.getByRole('button', { name: '重新讀取教材' }));
  expect(await screen.findByRole('link', { name: /較早的主鍵講義/ })).toBeTruthy();
  expect(calls).toEqual([undefined, 'cursor-a', 'cursor-b', undefined]);
});

it('does not keep a pending catalogue after the account changes', async () => {
  let finish!: (value: unknown) => void;
  state.request.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<CourseMaterialSearch />);
  fireEvent.change(screen.getByLabelText('搜尋教材'), { target: { value: '主鍵' } });
  await waitFor(() => expect(state.request).toHaveBeenCalled());
  state.context = 'session-b';
  view.rerender(<CourseMaterialSearch />);
  finish({
    workspaces: [{ id: workspaceId, title: '資料庫系統', state: 'active', memberRole: 'student' }],
  });
  expect(screen.queryByRole('link', { name: /關聯與主鍵/ })).toBeNull();
});

it('suppresses a late continue page after the account switches', async () => {
  let finishOlder!: (value: unknown) => void;
  state.request.mockImplementation(async (path: string, _context?: string, _input?: unknown, _method?: unknown, query?: { cursor?: string }) => {
    if (path === 'class-workspaces') {
      return {
        workspaces: [
          { id: workspaceId, title: '資料庫系統', state: 'active', memberRole: 'student' },
        ],
      };
    }
    if (path === `class-workspaces/${workspaceId}/materials/page`) {
      if (!query?.cursor) return { materials: [material], nextCursor: 'older-page' };
      return new Promise((resolve) => {
        finishOlder = resolve;
      });
    }
    throw new Error(path);
  });
  const view = render(<CourseMaterialSearch />);
  fireEvent.change(screen.getByLabelText('搜尋教材'), { target: { value: '主鍵' } });
  await screen.findByRole('link', { name: /關聯與主鍵/ });
  fireEvent.click(screen.getByRole('button', { name: '繼續載入較早教材' }));
  await waitFor(() => expect(finishOlder).toBeTypeOf('function'));
  state.context = 'session-b';
  view.rerender(<CourseMaterialSearch />);
  await act(async () => finishOlder({ materials: [olderMaterial], nextCursor: null }));
  expect(screen.queryByRole('link', { name: /較早的主鍵講義/ })).toBeNull();
  expect(screen.queryByRole('link', { name: /關聯與主鍵/ })).toBeNull();
});
