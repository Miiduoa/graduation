import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { Assistant } from './Assistant';
import { browserRequest } from './Session';
import type { V2Card } from './assistant/types';

const state = vi.hoisted(() => ({
  context: 'a'.repeat(43), account: 'alice', school: 'pu', query: '', operator: false,
}));
vi.mock('./Session', () => ({
  browserRequest: vi.fn(),
  useNuniSession: () => ({ loading: false, error: '', pendingLogout: false,
    session: { context: state.context, platformAccountId: state.account, isPlatformOperator: state.operator } }),
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(state.query) }));
vi.mock('@/lib/useCampusBrowseContext', () => ({
  useCampusBrowseContext: () => ({ status: 'ready', schoolId: state.school }),
}));
vi.mock('@/components/SiteShell', () => ({ SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
});
const card = (): V2Card => ({
  tool: 'propose_personal_event', token: 'test-role-event-token', mutationId: 'role-event-1',
  schoolId: 'pu', destination: '個人行事曆',
  args: { title: '門市盤點時間', date: '2030-11-04', allDay: false, startTime: '19:00', endTime: '20:00' },
});
function cancellation(value: V2Card) {
  return { version: 1, operation: 'calendar.create', status: 'revoked', schoolId: value.schoolId,
    mutationId: value.mutationId, storage: 'synced', revision: 0,
    checkedAt: '2026-11-18T08:00:00.000Z', authorizationValid: false, retryable: false, alreadyRevoked: false };
}
function selector() { return screen.getByLabelText('目前要處理') as HTMLSelectElement; }
function selectProfile(value: string) { fireEvent.change(selector(), { target: { value } }); }
async function mountAssistant() {
  let view!: ReturnType<typeof render>;
  // Capability resolution mounts a new conversation. Flush its lifetime effect
  // before changing context; finding the selector alone only observes the DOM.
  await act(async () => { view = render(<Assistant />); });
  await screen.findByLabelText('目前要處理');
  return view;
}
async function send(question: string) {
  fireEvent.change(await screen.findByLabelText('問題'), { target: { value: question } });
  const button = screen.getByRole('button', { name: '送出' }) as HTMLButtonElement;
  expect(button.disabled).toBe(false);
  fireEvent.click(button);
}
beforeEach(() => {
  vi.mocked(browserRequest).mockReset().mockRejectedValue(new Error('Unexpected private reader'));
  localStorage.clear();
  sessionStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  let lock = Promise.resolve<unknown>(undefined);
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: (_key: string, action: () => unknown) => {
      const next = lock.then(action);
      lock = next.then(() => undefined, () => undefined);
      return next;
    },
  } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  state.context = 'a'.repeat(43); state.account = 'alice'; state.school = 'pu'; state.query = ''; state.operator = false;
});

describe('Assistant role task interaction', () => {
  it.each([
    ['teacher', '查學生待繳作業', '課程與作業', '/classroom?schoolId=pu'],
    ['merchant', '查門市訂單與營收', '店家工作區', '/merchant?schoolId=pu'],
    ['platform', '我想管理平台帳號', '平台管理', '/admin?schoolId=pu'],
  ])('%s guidance works offline from the model without consent or private data reads', async (profile, question, label, href) => {
    const fetcher = vi.fn(async () => json({ enabled: true, ready: false, planning: true, version: 2 }));
    vi.stubGlobal('fetch', fetcher);
    await mountAssistant();
    selectProfile(profile);
    expect(selector().value).toBe(profile);
    await send(question);
    const destination = await screen.findByRole('link', { name: new RegExp(`^開啟${label}`) });
    expect(destination.getAttribute('href')).toBe(href);
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('/api/nuni/assistant/capability', expect.any(Object));
    expect(browserRequest).not.toHaveBeenCalled();
  });

  it.each([
    ['school', '打開校園公告', '校園公告', '/announcements?schoolId=pu'],
    ['club', '打開校園活動', '校園活動', '/events?schoolId=pu'],
  ])('%s public navigation retains the requested destination without a private reader', async (profile, question, label, href) => {
    const fetcher = vi.fn(async () => json({ enabled: true, ready: false, planning: true, version: 2 }));
    vi.stubGlobal('fetch', fetcher);
    await mountAssistant();
    selectProfile(profile);
    expect(selector().value).toBe(profile);
    await send(question);
    expect((await screen.findByRole('link', { name: new RegExp(`^開啟${label}`) })).getAttribute('href')).toBe(href);
    expect(screen.queryByRole('link', { name: /^開啟校籍與任職/ })).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(browserRequest).not.toHaveBeenCalled();
  });

  it('profile suggestions only fill the composer and switching contexts preserves unsent text', async () => {
    const fetcher = vi.fn(async () => json({ enabled: true, ready: false, version: 2 }));
    vi.stubGlobal('fetch', fetcher);
    await mountAssistant();
    const question = await screen.findByLabelText('問題') as HTMLTextAreaElement;
    fireEvent.change(question, { target: { value: '還沒送出的私人草稿' } });
    selectProfile('merchant');
    expect(question.value).toBe('還沒送出的私人草稿');
    selectProfile('teacher');
    expect(question.value).toBe('還沒送出的私人草稿');
    fireEvent.change(question, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '幫我新增行程明天15:00到16:00備課' }));
    expect(question.value).toBe('幫我新增行程明天15:00到16:00備課');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(browserRequest).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '確認' })).toBeNull();
  });

  it('locks selection while requesting and holding a signed proposal, and unlocks only after cancellation', async () => {
    const value = card();
    let resolveAsk!: (response: Response) => void;
    const calls: { action: string; body?: Record<string, unknown> }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const action = url.split('/').at(-1)!;
      calls.push({ action, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (action === 'capability') return json({ enabled: true, ready: true, version: 2 });
      if (action === 'cancel') return json(cancellation(value));
      return new Promise<Response>(resolve => { resolveAsk = resolve; });
    }));
    await mountAssistant();
    await screen.findByLabelText('問題');
    selectProfile('merchant');
    fireEvent.click(screen.getByRole('checkbox'));
    await send('幫我新增行程2030-11-04 19:00到20:00門市盤點時間');
    await waitFor(() => expect(selector().disabled).toBe(true));
    selectProfile('teacher');
    expect(selector().value).toBe('merchant');
    await act(async () => resolveAsk(json({ answer: '請核對這筆個人行程', steps: [], cards: [value] })));
    await screen.findByRole('button', { name: '確認' });
    expect(selector().disabled).toBe(true);
    selectProfile('platform');
    expect(selector().value).toBe('merchant');
    expect(calls.filter(item => item.action === 'ask')).toHaveLength(1);
    expect(calls.find(item => item.action === 'ask')?.body?.taskProfile).toBe('merchant');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(selector().disabled).toBe(false));
    const canceled = calls.find(item => item.action === 'cancel')!.body!;
    expect(canceled).toMatchObject({ token: value.token, args: value.args });
    expect(calls.some(item => item.action === 'confirm')).toBe(false);
    selectProfile('teacher');
    expect(selector().value).toBe('teacher');
  });

  it('keeps unknown execution locked and never resends the signed operation on a role change', async () => {
    const value = card();
    const actions: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const action = url.split('/').at(-1)!;
      actions.push(action);
      if (action === 'capability') return json({ enabled: true, ready: true, version: 2 });
      if (action === 'confirm' || action === 'reconcile') return json({ error: 'UPSTREAM_UNAVAILABLE' }, 503);
      return json({ answer: '請核對行程', steps: [], cards: [value] });
    }));
    await mountAssistant();
    await screen.findByLabelText('問題');
    selectProfile('merchant');
    fireEvent.click(screen.getByRole('checkbox'));
    await send('幫我新增行程2030-11-04 19:00到20:00門市盤點時間');
    fireEvent.click(await screen.findByRole('button', { name: '確認' }));
    await waitFor(() => expect(actions).toContain('reconcile'));
    await waitFor(() => expect(screen.queryByText('正在確認並儲存…')).toBeNull());
    expect(selector().disabled).toBe(true);
    selectProfile('teacher');
    expect(selector().value).toBe('merchant');
    expect(actions.filter(action => action === 'confirm')).toHaveLength(1);
    expect(actions.filter(action => action === 'ask')).toHaveLength(1);
    expect(screen.queryByText('已核對並加入個人行事曆')).toBeNull();
  });

  it('keeps model history inside the selected task context while preserving earlier turns on screen', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('capability')) return json({ enabled: true, ready: true, version: 2 });
      bodies.push(JSON.parse(String(init?.body)));
      return json({ answer: `一般回答-${bodies.length}`, steps: [], cards: [] });
    }));
    await mountAssistant();
    await screen.findByLabelText('問題');
    fireEvent.click(screen.getByRole('checkbox'));
    await send('請用一句話解釋風的形成 STUDENT_HISTORY');
    await screen.findByText('一般回答-1');
    selectProfile('teacher');
    await send('請用一句話解釋雲的形成 TEACHER_HISTORY');
    await screen.findByText('一般回答-2');
    expect(bodies[1]).toMatchObject({ taskProfile: 'teacher', history: [] });
    await send('請再補一個自然現象 TEACHER_FOLLOWUP');
    await screen.findByText('一般回答-3');
    expect(JSON.stringify(bodies[2].history)).toContain('TEACHER_HISTORY');
    expect(JSON.stringify(bodies[2].history)).not.toContain('STUDENT_HISTORY');
    selectProfile('student');
    await send('請解釋降雨 STUDENT_FOLLOWUP');
    await screen.findByText('一般回答-4');
    expect(JSON.stringify(bodies[3].history)).toContain('STUDENT_HISTORY');
    expect(JSON.stringify(bodies[3].history)).not.toMatch(/TEACHER_HISTORY|TEACHER_FOLLOWUP/);
    expect(screen.getByText('一般回答-1')).toBeTruthy();
    expect(screen.getByText('一般回答-2')).toBeTruthy();
  });

  it('hides previous student study actions and never carries their targets into a teacher follow-up', async () => {
    const workspaceId = 'cw_11111111-1111-4111-8111-111111111111';
    const taskId = 'cwa_11111111-1111-4111-8111-111111111111';
    vi.mocked(browserRequest).mockImplementation(async path => {
      if (path === 'class-workspaces') return { workspaces: [{ id: workspaceId, title: '課班', state: 'active', memberRole: 'student' }] };
      if (path === 'course-access/workspace-course') return {
        status: 'reviewed', workspaceId, memberRole: 'student', membershipActive: true,
        course: { id: 'ccd_11111111-1111-4111-8111-111111111111', workspaceId, version: 1,
          verification: 'administrator-reviewed', schoolId: 'pu', academicYear: '115', semester: '1',
          title: '資料庫管理', courseCode: 'CS301', teacher: '王老師', className: '三甲' },
      };
      if (path.endsWith('/assignments')) return { assignments: [{
        id: taskId, workspaceId, title: '期末資料模型', instructions: '不應外送的全文', state: 'open',
        createdAt: '2026-11-10T00:00:00Z', closedAt: null, dueAt: '2099-11-13T10:00:00Z',
        unitId: null, unitTitle: null, submissionCount: 0, mySubmission: null,
      }] };
      if (path.endsWith('/quizzes')) return { quizzes: [] };
      throw new Error('Unexpected read: ' + path);
    });
    const fetcher = vi.fn(async () => json({ enabled: true, ready: false, planning: true, version: 2 }));
    vi.stubGlobal('fetch', fetcher);
    await mountAssistant();
    await send('我有哪些未交作業？');
    await screen.findByRole('button', { name: '替資料庫管理的期末資料模型安排30分鐘' });
    const sourceReads = vi.mocked(browserRequest).mock.calls.length;
    selectProfile('teacher');
    expect(screen.queryByRole('button', { name: '替資料庫管理的期末資料模型安排30分鐘' })).toBeNull();
    await send('幫這份作業明天找半小時');
    await screen.findByText(/授課工作從你有權限的課程開始/);
    expect(browserRequest).toHaveBeenCalledTimes(sourceReads);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: '確認' })).toBeNull();
  });

  it.each(['context', 'account', 'school'] as const)('resets selected context and unsent content when authenticated %s changes', async key => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ enabled: true, ready: false, version: 2 })));
    const view = await mountAssistant();
    const field = await screen.findByLabelText('問題') as HTMLTextAreaElement;
    selectProfile('teacher');
    fireEvent.change(field, { target: { value: '舊來源的未送出內容' } });
    state[key] = key === 'context' ? 'b'.repeat(43) : key === 'account' ? 'bob' : 'nthu';
    view.rerender(<Assistant />);
    await waitFor(() => expect(selector().value).toBe('student'));
    expect((screen.getByLabelText('問題') as HTMLTextAreaElement).value).toBe('');
    expect(browserRequest).not.toHaveBeenCalled();
  });
});
