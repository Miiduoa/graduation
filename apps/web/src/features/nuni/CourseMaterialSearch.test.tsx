import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    if (path === `class-workspaces/${workspaceId}/materials`) return { materials: [material] };
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
    if (path.endsWith(`${other}/materials`)) throw new NuniError(403, 'REQUEST_FAILED');
    if (path.endsWith('/materials')) return { materials: [material] };
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
