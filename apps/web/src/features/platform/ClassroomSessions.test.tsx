import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ClassroomSessions } from './ClassroomSessions';

const workspaceId = 'cw_11111111-1111-4111-8111-111111111111';
const sessionId = 'cws_11111111-1111-4111-8111-111111111111';
const studentId = 'pa_44444444-4444-4444-8444-444444444444';
const context = 'a'.repeat(43);

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const fetcher = vi.fn();

beforeEach(() => {
  fetcher.mockReset();
  vi.stubGlobal('fetch', fetcher);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function posted(path: string) {
  return fetcher.mock.calls.find(
    ([url, options]) => String(url) === `/api/nuni/${path}` && options?.method === 'POST',
  );
}

it('starts a session, checks in without a code, requests makeup, and ends with empty JSON', async () => {
  fetcher.mockImplementation(async (url: string, options?: { method?: string }) => {
    const path = String(url);
    if (path.endsWith('/classroom-sessions') && (!options?.method || options.method === 'GET')) {
      return json({
        sessions: [{ id: sessionId, title: '本堂課', state: 'open', checkInCount: 1 }],
      });
    }
    if (path.endsWith('/roster')) {
      return json({
        present: [{ platformAccountId: studentId, displayName: '同學甲' }],
        absent: [],
        late: [],
      });
    }
    if (path.endsWith('/makeup-requests') && (!options?.method || options.method === 'GET')) {
      return json({ requests: [] });
    }
    return json({});
  });
  render(
    <ClassroomSessions
      workspaceId={workspaceId}
      isTeacher={false}
      units={[]}
      context={context}
    />,
  );
  expect(await screen.findByText(/進行中/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '簽到' }));
  await waitFor(() => expect(posted(`class-workspaces/${workspaceId}/classroom-sessions/${sessionId}/check-in`)).toBeTruthy());
  const checkIn = posted(`class-workspaces/${workspaceId}/classroom-sessions/${sessionId}/check-in`)!;
  expect(checkIn[1].method).toBe('POST');
  expect(checkIn[1].body).toBe('{}');
  expect(checkIn[1].headers['Content-Type']).toBe('application/json');
  fireEvent.click(screen.getByRole('button', { name: '請老師補簽' }));
  await waitFor(() =>
    expect(posted(`class-workspaces/${workspaceId}/classroom-sessions/${sessionId}/makeup-requests`)).toBeTruthy(),
  );
  const makeup = posted(
    `class-workspaces/${workspaceId}/classroom-sessions/${sessionId}/makeup-requests`,
  )!;
  expect(makeup[1].method).toBe('POST');
  expect(makeup[1].body).toBe('{}');
});

it('loads pending makeup requests before accept or reject, not every absentee', async () => {
  fetcher.mockImplementation(async (url: string, options?: { method?: string }) => {
    const path = String(url);
    if (path.endsWith('/classroom-sessions') && (!options?.method || options.method === 'GET')) {
      return json({ sessions: [{ id: sessionId, title: '本堂課', state: 'open' }] });
    }
    if (path.endsWith('/roster')) {
      return json({
        present: [],
        absent: [
          { platformAccountId: 'pa_55555555-5555-4555-8555-555555555555', displayName: '缺席生' },
          { platformAccountId: studentId, displayName: '待補簽' },
        ],
        late: [],
      });
    }
    if (path.endsWith('/makeup-requests') && (!options?.method || options.method === 'GET')) {
      return json({ requests: [{ platformAccountId: studentId, displayName: '待補簽' }] });
    }
    return json({});
  });
  render(
    <ClassroomSessions workspaceId={workspaceId} isTeacher units={[]} context={context} />,
  );
  expect(await screen.findByRole('button', { name: '接受補簽' })).toBeTruthy();
  expect(screen.getAllByRole('button', { name: '接受補簽' })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '接受補簽' }));
  await waitFor(() =>
    expect(posted(`class-workspaces/${workspaceId}/classroom-sessions/${sessionId}/makeup`)).toBeTruthy(),
  );
  const makeup = posted(`class-workspaces/${workspaceId}/classroom-sessions/${sessionId}/makeup`)!;
  expect(makeup[1].method).toBe('POST');
  expect(JSON.parse(makeup[1].body)).toEqual({
    platformAccountId: studentId,
    decision: 'accept',
  });
});

it('ends an open session with an empty JSON body', async () => {
  fetcher.mockImplementation(async (url: string, options?: { method?: string }) => {
    const path = String(url);
    if (path.endsWith('/classroom-sessions') && (!options?.method || options.method === 'GET')) {
      return json({ sessions: [{ id: sessionId, title: '本堂課', state: 'open' }] });
    }
    if (path.endsWith('/roster')) return json({ present: [], absent: [], late: [] });
    if (path.endsWith('/makeup-requests')) return json({ requests: [] });
    return json({});
  });
  render(
    <ClassroomSessions workspaceId={workspaceId} isTeacher units={[]} context={context} />,
  );
  fireEvent.click(await screen.findByRole('button', { name: '結束課堂' }));
  await waitFor(() =>
    expect(posted(`class-workspaces/${workspaceId}/classroom-sessions/${sessionId}/end`)).toBeTruthy(),
  );
  const ended = posted(`class-workspaces/${workspaceId}/classroom-sessions/${sessionId}/end`)!;
  expect(ended[1].method).toBe('POST');
  expect(ended[1].body).toBe('{}');
  expect(ended[1].headers['Content-Type']).toBe('application/json');
});

it('sends a 401 classroom-session read back to account login', async () => {
  const replace = vi.fn();
  vi.stubGlobal('location', { ...window.location, replace });
  fetcher.mockResolvedValue(json({ error: 'SIGN_IN_REQUIRED' }, 401));
  render(
    <ClassroomSessions workspaceId={workspaceId} isTeacher={false} units={[]} context={context} />,
  );
  await waitFor(() =>
    expect(replace).toHaveBeenCalledWith(
      `/auth/account?returnUrl=${encodeURIComponent(`/auth/platform/class-workspace/${workspaceId}`)}`,
    ),
  );
  expect(String(fetcher.mock.calls[0][0])).toBe(
    `/api/nuni/class-workspaces/${workspaceId}/classroom-sessions`,
  );
  expect(fetcher.mock.calls.some(([url]) => String(url).startsWith('/auth/platform/'))).toBe(false);
});
