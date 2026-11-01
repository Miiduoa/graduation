import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ClassroomSessions } from './ClassroomSessions';

const workspaceId = 'cw_11111111-1111-4111-8111-111111111111';
const otherWorkspaceId = 'cw_22222222-2222-4222-8222-222222222222';
const sessionId = 'cws_11111111-1111-4111-8111-111111111111';
const otherSessionId = 'cws_22222222-2222-4222-8222-222222222222';
const studentId = 'pa_33333333-3333-4333-8333-333333333333';
const context = 'a'.repeat(43);
const base = `/api/nuni/class-workspaces/${workspaceId}/classroom-sessions`;
const otherBase = `/api/nuni/class-workspaces/${otherWorkspaceId}/classroom-sessions`;
const session = (extra: Record<string, unknown> = {}) => ({
  id: sessionId,
  title: '第一堂私有課堂',
  state: 'open',
  checkInCount: 1,
  checkedInByMe: false,
  shortCode: 'ABCD12',
  makeupRequestState: null,
  ...extra,
});
const roster = (name = '原帳號的學生') => ({
  sessionId,
  present: [],
  late: [],
  absent: [{ platformAccountId: studentId, displayName: name, makeupRequestState: 'pending' }],
});
function ok(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const fetcher = vi.fn();
beforeEach(() => {
  fetcher.mockReset().mockImplementation(async (path: string) => {
    if (path === base) return ok({ sessions: [session()] });
    if (path === otherBase)
      return ok({ sessions: [session({ id: otherSessionId, title: '新的課堂' })] });
    if (path.endsWith('/roster')) return ok(roster());
    throw new Error(`Unexpected endpoint ${path}`);
  });
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => vi.unstubAllGlobals());

it('shows the teacher short code without offering makeup on an open classroom', async () => {
  render(<ClassroomSessions workspaceId={workspaceId} context={context} isTeacher units={[]} />);
  expect(await screen.findByText('ABCD12')).toBeTruthy();
  await screen.findByText('原帳號的學生');
  expect(screen.queryByRole('button', { name: '接受補簽' })).toBeNull();
});

it('does not expose the teacher short code or offer repeat check-in to an already checked-in student', async () => {
  fetcher.mockResolvedValue(ok({ sessions: [session({ checkedInByMe: true })] }));
  render(
    <ClassroomSessions workspaceId={workspaceId} context={context} isTeacher={false} units={[]} />,
  );
  await screen.findByText('第一堂私有課堂');
  expect(screen.queryByText('ABCD12')).toBeNull();
  expect(screen.queryByRole('button', { name: '簽到' })).toBeNull();
  expect(screen.queryByRole('button', { name: '請老師補簽' })).toBeNull();
});

it('allows a missed closed classroom to request makeup using a JSON POST bound to the account context', async () => {
  let requested = false;
  fetcher.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === base)
      return ok({
        sessions: [session({ state: 'closed', makeupRequestState: requested ? 'pending' : null })],
      });
    if (path === `${base}/${sessionId}/makeup-requests` && init?.method === 'POST') {
      requested = true;
      return ok(session({ state: 'closed', makeupRequestState: 'pending' }));
    }
    throw new Error(`Unexpected endpoint ${path}`);
  });
  render(
    <ClassroomSessions workspaceId={workspaceId} context={context} isTeacher={false} units={[]} />,
  );
  fireEvent.click(await screen.findByRole('button', { name: '請老師補簽' }));
  await waitFor(() => expect(requested).toBe(true));
  const posted = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(posted[0]).toBe(`${base}/${sessionId}/makeup-requests`);
  expect(posted[1].method).toBe('POST');
  expect(posted[1].body).toBe('{}');
  expect(posted[1].headers).toEqual({
    'Content-Type': 'application/json',
    'X-Campus-Session': context,
  });
  await waitFor(() => expect(screen.queryByRole('button', { name: '請老師補簽' })).toBeNull());
});

it('retains the closed roster and sends the teacher decision to that closed session', async () => {
  fetcher.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === base) return ok({ sessions: [session({ state: 'closed' })] });
    if (path === `${base}/${sessionId}/roster`) return ok(roster());
    if (path === `${base}/${sessionId}/makeup` && init?.method === 'POST') return ok(roster());
    throw new Error(`Unexpected endpoint ${path}`);
  });
  render(<ClassroomSessions workspaceId={workspaceId} context={context} isTeacher units={[]} />);
  fireEvent.click(await screen.findByRole('button', { name: '接受補簽' }));
  await waitFor(() =>
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true),
  );
  const posted = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(posted[0]).toBe(`${base}/${sessionId}/makeup`);
  expect(posted[1].method).toBe('POST');
  expect(JSON.parse(posted[1].body)).toEqual({ platformAccountId: studentId, decision: 'accept' });
});

it('ignores a late list from the previous workspace', async () => {
  const previous = deferred<Response>();
  fetcher.mockImplementation(async (path: string) => {
    if (path === base) return previous.promise;
    if (path === otherBase)
      return ok({ sessions: [session({ id: otherSessionId, title: '新的課堂' })] });
    if (path.endsWith('/roster')) return ok(roster('新課堂的學生'));
    throw new Error(`Unexpected endpoint ${path}`);
  });
  const view = render(
    <ClassroomSessions workspaceId={workspaceId} context={context} isTeacher units={[]} />,
  );
  view.rerender(
    <ClassroomSessions workspaceId={otherWorkspaceId} context={context} isTeacher units={[]} />,
  );
  await screen.findByText('新的課堂');
  await act(async () => previous.resolve(ok({ sessions: [session()] })));
  expect(screen.queryByText('第一堂私有課堂')).toBeNull();
  expect(screen.getByText('新的課堂')).toBeTruthy();
});

it.each([
  [403, 'FORBIDDEN'],
  [404, 'NOT_FOUND'],
  [409, 'SESSION_CHANGED'],
] as const)(
  'clears private roster and controls when a new roster read is denied with %s %s',
  async (status, code) => {
    let rosterReads = 0;
    fetcher.mockImplementation(async (path: string) => {
      if (path === base) return ok({ sessions: [session()] });
      if (path.endsWith('/roster'))
        return ++rosterReads === 1 ? ok(roster()) : ok({ error: code }, status);
      throw new Error(`Unexpected endpoint ${path}`);
    });
    render(<ClassroomSessions workspaceId={workspaceId} context={context} isTeacher units={[]} />);
    await screen.findByText('原帳號的學生');
    fireEvent.click(screen.getByRole('button', { name: '更新簽到' }));
    await waitFor(() => expect(rosterReads).toBe(2));
    await waitFor(() => expect(screen.queryByText('原帳號的學生')).toBeNull());
    expect(screen.queryByRole('button', { name: '開始課堂' })).toBeNull();
    expect(screen.queryByRole('button', { name: '結束課堂' })).toBeNull();
  },
);

it.each(['success', 'failure'] as const)(
  'does not apply a previous workspace mutation %s or start follow-up reads',
  async (outcome) => {
    const mutation = deferred<Response>();
    fetcher.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === 'POST') return mutation.promise;
      if (path === base) return ok({ sessions: [session()] });
      if (path === otherBase)
        return ok({ sessions: [session({ id: otherSessionId, title: '新的課堂' })] });
      if (path.endsWith('/roster')) return ok(roster());
      throw new Error(`Unexpected endpoint ${path}`);
    });
    const view = render(
      <ClassroomSessions workspaceId={workspaceId} context={context} isTeacher units={[]} />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '結束課堂' }));
    view.rerender(
      <ClassroomSessions workspaceId={otherWorkspaceId} context={context} isTeacher units={[]} />,
    );
    await screen.findByText('新的課堂');
    await act(async () => mutation.resolve(ok({}, outcome === 'success' ? 200 : 503)));
    expect(fetcher.mock.calls.filter(([path]) => path === base)).toHaveLength(1);
    expect(screen.getByText('新的課堂')).toBeTruthy();
    expect(screen.queryByText('課堂沒有結束成功，請稍後再試。')).toBeNull();
  },
);

it('discards a rejected effect replay after Strict Mode has loaded the current classroom', async () => {
  const first = deferred<Response>();
  let reads = 0;
  fetcher.mockImplementation(async (path: string) => {
    if (path === base) return ++reads === 1 ? first.promise : ok({ sessions: [session()] });
    if (path.endsWith('/roster')) return ok(roster());
    throw new Error(`Unexpected endpoint ${path}`);
  });
  render(
    <StrictMode>
      <ClassroomSessions workspaceId={workspaceId} context={context} isTeacher units={[]} />
    </StrictMode>,
  );
  await screen.findByText('原帳號的學生');
  await act(async () => first.resolve(ok({ error: 'FORBIDDEN' }, 403)));
  expect(screen.getByText('第一堂私有課堂')).toBeTruthy();
  expect(screen.getByText('原帳號的學生')).toBeTruthy();
});

// These retain the new Campus One transport checks while using real closed-session
// and roster projection contracts instead of a nonexistent GET makeup-requests.
it('checks in without a code using JSON and the current account context', async () => {
  fetcher.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === base && init?.method === 'GET') return ok({ sessions: [session()] });
    if (path === `${base}/${sessionId}/check-in` && init?.method === 'POST') return ok({});
    throw new Error(`Unexpected endpoint ${path}`);
  });
  render(
    <ClassroomSessions workspaceId={workspaceId} context={context} isTeacher={false} units={[]} />,
  );
  fireEvent.click(await screen.findByRole('button', { name: '簽到' }));
  await waitFor(() =>
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true),
  );
  const posted = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(posted[0]).toBe(`${base}/${sessionId}/check-in`);
  expect(posted[1].method).toBe('POST');
  expect(posted[1].body).toBe('{}');
  expect(posted[1].headers).toEqual({
    'Content-Type': 'application/json',
    'X-Campus-Session': context,
  });
});

it('only offers closed-session makeup decisions for pending requests in the roster', async () => {
  fetcher.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === base) return ok({ sessions: [session({ state: 'closed' })] });
    if (path.endsWith('/roster'))
      return ok({
        ...roster(),
        absent: [
          {
            platformAccountId: 'pa_44444444-4444-4444-8444-444444444444',
            displayName: '尚未申請的缺席生',
            makeupRequestState: null,
          },
          ...roster().absent,
        ],
      });
    if (path === `${base}/${sessionId}/makeup` && init?.method === 'POST') return ok(roster());
    throw new Error(`Unexpected endpoint ${path}`);
  });
  render(<ClassroomSessions workspaceId={workspaceId} context={context} isTeacher units={[]} />);
  expect(await screen.findByRole('button', { name: '接受補簽' })).toBeTruthy();
  expect(screen.getAllByRole('button', { name: '接受補簽' })).toHaveLength(1);
  expect(fetcher.mock.calls.some(([path]) => String(path).endsWith('/makeup-requests'))).toBe(
    false,
  );
  fireEvent.click(screen.getByRole('button', { name: '接受補簽' }));
  await waitFor(() =>
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true),
  );
  const posted = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(posted[0]).toBe(`${base}/${sessionId}/makeup`);
  expect(posted[1].method).toBe('POST');
  expect(JSON.parse(posted[1].body)).toEqual({ platformAccountId: studentId, decision: 'accept' });
});

it('ends an open session using an empty JSON object and retains its closed roster', async () => {
  let closed = false;
  fetcher.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === base) return ok({ sessions: [session({ state: closed ? 'closed' : 'open' })] });
    if (path.endsWith('/roster')) return ok(roster());
    if (path === `${base}/${sessionId}/end` && init?.method === 'POST') {
      closed = true;
      return ok({});
    }
    throw new Error(`Unexpected endpoint ${path}`);
  });
  render(<ClassroomSessions workspaceId={workspaceId} context={context} isTeacher units={[]} />);
  fireEvent.click(await screen.findByRole('button', { name: '結束課堂' }));
  expect(await screen.findByRole('button', { name: '接受補簽' })).toBeTruthy();
  const posted = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(posted[0]).toBe(`${base}/${sessionId}/end`);
  expect(posted[1].method).toBe('POST');
  expect(posted[1].body).toBe('{}');
  expect(posted[1].headers).toEqual({
    'Content-Type': 'application/json',
    'X-Campus-Session': context,
  });
});

it('sends a current 401 back to account login without using legacy transport', async () => {
  const replace = vi.fn();
  vi.stubGlobal('location', { ...window.location, replace });
  fetcher.mockImplementation(async () => ok({ error: 'SIGN_IN_REQUIRED' }, 401));
  render(
    <ClassroomSessions workspaceId={workspaceId} context={context} isTeacher={false} units={[]} />,
  );
  await waitFor(() =>
    expect(replace).toHaveBeenCalledWith(
      `/auth/account?returnUrl=${encodeURIComponent(`/classroom/course/${workspaceId}`)}`,
    ),
  );
  expect(fetcher.mock.calls[0][0]).toBe(base);
  expect(fetcher.mock.calls.some(([path]) => String(path).startsWith('/auth/platform/'))).toBe(
    false,
  );
});

it.each([true, false])('keeps archived attendance read-only for teacher=%s', async (isTeacher) => {
  fetcher.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/roster')) return ok({ present: [], absent: [], late: [] });
    return ok({
      sessions: [{ id: 'session-1', title: '封存課堂', state: 'open', checkedInByMe: false }],
    });
  });
  render(
    <ClassroomSessions
      workspaceId={workspaceId}
      context={context}
      isTeacher={isTeacher}
      readOnly
      units={[]}
    />,
  );
  await screen.findByText('封存課堂');
  expect(screen.queryByRole('button', { name: '開始課堂' })).toBeNull();
  expect(screen.queryByRole('button', { name: '結束課堂' })).toBeNull();
  expect(screen.queryByRole('button', { name: '簽到' })).toBeNull();
  expect(screen.queryByRole('button', { name: '請老師補簽' })).toBeNull();
  expect(screen.queryByText('你已簽到。這不會寫進正式出席系統。')).toBeNull();
});

it.each([400, 503])(
  'keeps check-in retryable without a success message after HTTP %s',
  async (status) => {
    let rejected = true;
    fetcher.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === base) return ok({ sessions: [session({ checkedInByMe: !rejected })] });
      if (path.endsWith('/check-in') && init?.method === 'POST') {
        return rejected ? ok({ error: 'CHECK_IN_FAILED' }, status) : ok({});
      }
      throw new Error(`Unexpected endpoint ${path}`);
    });
    render(
      <ClassroomSessions
        workspaceId={workspaceId}
        context={context}
        isTeacher={false}
        units={[]}
      />,
    );
    const codeInput = await screen.findByLabelText('簽到碼（若老師有提供）');
    fireEvent.change(codeInput, { target: { value: 'ABCD12' } });
    fireEvent.click(screen.getByRole('button', { name: '簽到' }));
    expect((await screen.findByRole('alert')).textContent).toContain('簽到沒有成功');
    expect(screen.queryByText('你已簽到。這不會寫進正式出席系統。')).toBeNull();
    expect((codeInput as HTMLInputElement).value).toBe('ABCD12');
    await waitFor(() =>
      expect((screen.getByRole('button', { name: '簽到' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    rejected = false;
    fireEvent.click(screen.getByRole('button', { name: '簽到' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '簽到' })).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getAllByText('你已簽到。這不會寫進正式出席系統。').length).toBeGreaterThan(0);
  },
);
