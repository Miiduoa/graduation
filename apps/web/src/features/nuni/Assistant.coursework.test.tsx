import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { Assistant } from './Assistant';
import { answerAssistantPersonalQuestion } from '@/lib/assistantPersonalReads';

const state = vi.hoisted(() => ({ accountId: 'alice', context: 'a'.repeat(43), schoolId: 'pu' }));
vi.mock('./Session', () => ({
  useNuniSession: () => ({
    loading: false,
    error: '',
    pendingLogout: false,
    session: { context: state.context, platformAccountId: state.accountId },
  }),
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/useCampusBrowseContext', () => ({
  useCampusBrowseContext: () => ({ status: 'ready', schoolId: state.schoolId }),
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/lib/assistantPersonalReads', async (original) => ({
  ...(await original<typeof import('@/lib/assistantPersonalReads')>()),
  answerAssistantPersonalQuestion: vi.fn(),
}));

const target = {
  workspaceId: 'cw_one',
  taskId: 'cwa_one',
  kind: 'assignment' as const,
  title: '期末資料模型',
  courseTitle: '資料庫管理',
  dueAt: '2099-11-13T10:00:00Z',
};
const json = (value: object) =>
  new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
  });
let requests: Record<string, unknown>[];
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  sessionStorage.clear();
  state.accountId = 'alice';
  state.context = 'a'.repeat(43);
  state.schoolId = 'pu';
  requests = [];
  vi.mocked(answerAssistantPersonalQuestion)
    .mockReset()
    .mockResolvedValue({
      kind: 'personal',
      content: '資料庫管理：期末資料模型尚未繳交。',
      serviceIds: ['classroom'],
      courseworkTargets: [target],
    });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('capability')) return json({ enabled: true, ready: false, version: 2 });
      requests.push(JSON.parse(String(init?.body)));
      return json({
        answer: '已核對作業與課間空堂，請確認準備時間。',
        dataRead: true,
        steps: [{ name: 'get_course_work', status: 'ok', summary: '已讀取' }],
        cards: [],
      });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function readTasks() {
  const question = await screen.findByLabelText('問題');
  fireEvent.change(question, { target: { value: '我有哪些未交作業？' } });
  fireEvent.click(screen.getByText('送出'));
  await screen.findByRole('button', { name: '替資料庫管理的期末資料模型安排30分鐘' });
  return question;
}

it('continues a verified task without a provider, model consent, or erasing the current draft', async () => {
  render(<Assistant />);
  const question = await readTasks();
  fireEvent.change(question, { target: { value: '下一個還沒送出的問題' } });
  fireEvent.click(screen.getByRole('button', { name: '替資料庫管理的期末資料模型安排30分鐘' }));
  await screen.findByText('已核對作業與課間空堂，請確認準備時間。');
  expect((question as HTMLTextAreaElement).value).toBe('下一個還沒送出的問題');
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    schoolId: 'pu',
    consent: false,
    history: [],
    studyTarget: { workspaceId: 'cw_one', taskId: 'cwa_one', kind: 'assignment' },
  });
  expect(JSON.stringify(requests[0])).not.toContain('2099-11-13');
});

it('understands the slide follow-up and preserves its Taiwan date', async () => {
  render(<Assistant />);
  const question = await readTasks();
  fireEvent.change(question, { target: { value: '幫這份作業，今天找 30 分鐘空堂。' } });
  fireEvent.click(screen.getByText('送出'));
  await screen.findByText('已核對作業與課間空堂，請確認準備時間。');
  expect(requests).toHaveLength(1);
  const today = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  expect(requests[0].studyTarget).toEqual({
    workspaceId: 'cw_one',
    taskId: 'cwa_one',
    kind: 'assignment',
    date: today,
  });
  const groups = screen.getAllByRole('group', { name: '安排作業準備時間' });
  fireEvent.click(
    within(groups.at(-1)!).getByRole('button', { name: '替資料庫管理的期末資料模型安排30分鐘' }),
  );
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[1].studyTarget).toEqual(requests[0].studyTarget);
});

it('asks for an exact selection when same-named tasks are in different courses', async () => {
  vi.mocked(answerAssistantPersonalQuestion).mockResolvedValue({
    kind: 'personal',
    content: '找到兩份待交作業。',
    serviceIds: ['classroom'],
    courseworkTargets: [
      target,
      { ...target, workspaceId: 'cw_two', taskId: 'cwa_two', courseTitle: '資訊安全' },
    ],
  });
  render(<Assistant />);
  const question = await readTasks();
  fireEvent.change(question, { target: { value: '幫這份作業明天找半小時' } });
  fireEvent.click(screen.getByText('送出'));
  await screen.findByText(
    '要替哪一份安排？請選下方作業或測驗，我會重新核對來源與時段，再列出確認內容。',
  );
  expect(requests).toHaveLength(0);
  const groups = screen.getAllByRole('group', { name: '安排作業準備時間' });
  fireEvent.click(
    within(groups.at(-1)!).getByRole('button', { name: '替資訊安全的期末資料模型安排30分鐘' }),
  );
  await screen.findByText('已核對作業與課間空堂，請確認準備時間。');
  const tomorrow = new Date(Date.now() + 32 * 60 * 60 * 1000).toISOString().slice(0, 10);
  expect(requests[0].studyTarget).toEqual({
    workspaceId: 'cw_two',
    taskId: 'cwa_two',
    kind: 'assignment',
    date: tomorrow,
  });
});

it('does not carry a private task through an unrelated reply or a new account', async () => {
  const view = render(<Assistant />);
  const question = await readTasks();
  fireEvent.change(question, { target: { value: '開啟圖書館' } });
  fireEvent.click(screen.getByText('送出'));
  fireEvent.change(question, { target: { value: '幫這份作業找半小時' } });
  fireEvent.click(screen.getByText('送出'));
  await screen.findByText(
    '請先查詢未交作業，或從剛才的作業清單選擇一份，再幫你找 30 分鐘的準備空堂。',
  );
  expect(requests).toHaveLength(0);
  state.accountId = 'bob';
  state.context = 'b'.repeat(43);
  view.rerender(<Assistant />);
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: '替資料庫管理的期末資料模型安排30分鐘' }),
    ).toBeNull(),
  );
  const newQuestion = await screen.findByLabelText('問題');
  fireEvent.change(newQuestion, { target: { value: '幫這份作業找半小時' } });
  fireEvent.click(screen.getByText('送出'));
  await screen.findByText(
    '請先查詢未交作業，或從剛才的作業清單選擇一份，再幫你找 30 分鐘的準備空堂。',
  );
  expect(requests).toHaveLength(0);
});
