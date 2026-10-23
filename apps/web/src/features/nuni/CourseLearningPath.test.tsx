import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { NuniAssignment, NuniUnit, NuniWorkspace } from '@campus/shared/src/nuni';
import { CourseLearningPath } from './CourseLearningPath';

const state = vi.hoisted(() => ({ request: vi.fn(), refresh: vi.fn() }));
vi.mock('./Session', () => ({
  browserRequest: (...args: unknown[]) => state.request(...args),
  useNuniSession: () => ({
    session: {
      context: 'a'.repeat(43),
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

beforeEach(() => {
  vi.clearAllMocks();
  state.request.mockImplementation(async (path: string) => {
    if (path.endsWith('/materials')) return { materials: [material] };
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
    if (path.endsWith('/materials')) return { materials: [] };
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
  await screen.findByText(/部分資料尚未取得/);
  expect(screen.queryByText('已繳交或作答')).toBeNull();
  expect(screen.getByRole('link', { name: /關聯式模型練習/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '重試章節清單' }));
  expect(reloadUnits).toHaveBeenCalledOnce();
});
