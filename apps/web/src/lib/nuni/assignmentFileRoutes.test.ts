// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { handleNuni } from './api';
import { resetAssignmentFileStores } from './assignmentFileService';
import { SESSION_COOKIE, sealCookie, sessionContext } from './server';

const id = 'cw_11111111-1111-4111-8111-111111111111';
const assignmentId = 'cwa_22222222-2222-4222-8222-222222222222';
const accountId = 'pa_55555555-5555-4555-8555-555555555555';
const timestamp = '2026-10-21T13:00:00.000Z';
const principal = { authenticated: true, platformAccountId: accountId, isPlatformOperator: false };
const workspace = { id, title: '資料庫', state: 'active', memberRole: 'student' };
const assignment = {
  id: assignmentId,
  workspaceId: id,
  title: '設計資料表',
  instructions: '說明主鍵。',
  state: 'open',
  createdAt: timestamp,
  closedAt: null,
  dueAt: '2026-10-21T12:00:00.000Z',
  unitId: null,
  unitTitle: null,
  submissionCount: 0,
  mySubmission: null,
};
const session = { sessionHandle: `ps_${'a'.repeat(43)}`, expiresAt: Date.now() + 3600_000 };
const fetcher = vi.fn();
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

function invoke(
  suffix: string,
  options: {
    method?: string;
    input?: unknown;
    body?: Uint8Array;
    contentType?: string;
    query?: string;
    cookie?: boolean;
    origin?: boolean;
    platform?: boolean;
  } = {},
) {
  const path = ['class-workspaces', id, ...suffix.split('/')];
  const method = options.method ?? (options.input || options.body ? 'POST' : 'GET');
  return handleNuni(
    new NextRequest(`https://nuni.tw/api/nuni/${path.join('/')}${options.query ?? ''}`, {
      method,
      headers: {
        ...(options.cookie === false
          ? {}
          : { Cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, session)}` }),
        ...(options.platform ? { Authorization: `Platform ${session.sessionHandle}` } : {}),
        'X-Campus-Session': sessionContext(session),
        ...(options.input
          ? { Origin: 'https://nuni.tw', 'Content-Type': 'application/json' }
          : {}),
        ...(options.body
          ? {
              ...(options.origin === false ? {} : { Origin: 'https://nuni.tw' }),
              'Content-Type': options.contentType ?? 'image/jpeg',
            }
          : {}),
      },
      ...(options.input ? { body: JSON.stringify(options.input) } : {}),
      ...(options.body ? { body: Buffer.from(options.body) } : {}),
    }),
    path,
  );
}

beforeEach(() => {
  vi.stubEnv('NUNI_CLASSROOM_ENABLED', 'true');
  vi.stubEnv('WEB_PUBLIC_ORIGIN', 'https://nuni.tw');
  vi.stubEnv('BFF_SESSION_SECRET', 'test-session-secret-longer-than-32-characters');
  vi.stubEnv('NUNI_API_BASE_URL', 'https://api.nuni.tw');
  vi.stubEnv('ASSIGNMENT_FILE_SUBMIT_ENABLED', '');
  vi.stubGlobal('fetch', fetcher.mockReset());
  resetAssignmentFileStores();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetAssignmentFileStores();
});

describe('assignment file BFF flag and contracts', () => {
  it('hides file routes while the flag is off', async () => {
    expect(
      (
        await invoke(`assignments/${assignmentId}/files/intents`, {
          input: {
            originalName: 'shot.jpg',
            contentType: 'image/jpeg',
            byteSize: 8,
            idempotencyKey: 'intent-disabled',
          },
        })
      ).status,
    ).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps flag-off PUT, signed query and Platform classroom session identical to main', async () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    const guessed = `assignments/${assignmentId}/files/cwf_99999999-9999-4999-8999-999999999999/content`;
    expect(
      (await invoke(guessed, { method: 'PUT', body: jpeg, contentType: 'image/jpeg' })).status,
    ).toBe(405);
    expect(
      (await invoke(guessed, { method: 'GET', query: '?exp=1&sig=nope', cookie: false })).status,
    ).toBe(400);
    expect(
      (
        await invoke(guessed, {
          method: 'GET',
          query: '?exp=1&sig=nope&download=1',
          cookie: false,
        })
      ).status,
    ).toBe(400);
    expect((await invoke('assignments', { cookie: false, platform: true })).status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('accepts a late photo, keeps the receipt after reload, and does not fake success', async () => {
    vi.stubEnv('ASSIGNMENT_FILE_SUBMIT_ENABLED', 'true');
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    let mine: unknown = null;
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith('/sessions/current')) return response(principal);
      if (target.endsWith(`/class-workspaces/${id}`) && (!init?.method || init.method === 'GET'))
        return response(workspace);
      if (target.endsWith(`/assignments`) && (!init?.method || init.method === 'GET'))
        return response({
          assignments: [mine ? { ...assignment, submissionCount: 1, mySubmission: mine } : assignment],
        });
      if (target.endsWith(`/assignments/${assignmentId}/submit`)) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { body: string };
        mine = {
          assignmentId,
          platformAccountId: accountId,
          displayName: '同學',
          body: body.body,
          state: 'submitted',
          submittedAt: '2026-10-21T13:00:00.000Z',
          teacherFeedback: null,
          reviewedAt: null,
        };
        return response({
          ...assignment,
          submissionCount: 1,
          mySubmission: mine,
        });
      }
      return response({ error: { code: 'NOT_FOUND' } }, 404);
    });
    const intent = await invoke(`assignments/${assignmentId}/files/intents`, {
      input: {
        originalName: 'shot.jpg',
        contentType: 'image/jpeg',
        byteSize: jpeg.byteLength,
        idempotencyKey: 'intent-late-ok',
      },
    });
    expect(intent.status).toBe(201);
    const created = (await intent.json()) as { id: string; uploadPath: string };
    const uploaded = await invoke(
      created.uploadPath.replace(`class-workspaces/${id}/`, ''),
      { method: 'PUT', body: jpeg, contentType: 'image/jpeg' },
    );
    expect(uploaded.status).toBe(200);
    expect(
      (
        await invoke(created.uploadPath.replace(`class-workspaces/${id}/`, ''), {
          method: 'GET',
          query: '?exp=1&sig=nope',
          cookie: false,
        })
      ).status,
    ).toBe(403);
    const submitted = await invoke(`assignments/${assignmentId}/submit-files`, {
      input: { fileIds: [created.id], idempotencyKey: 'submit-late-ok' },
    });
    expect(submitted.status).toBe(200);
    const receipt = (await submitted.json()) as {
      mySubmission: { late: boolean; files: { originalName: string }[] };
    };
    expect(receipt.mySubmission.late).toBe(true);
    expect(receipt.mySubmission.files[0].originalName).toBe('shot.jpg');
    const replay = await invoke(`assignments/${assignmentId}/submit-files`, {
      input: { fileIds: [created.id], idempotencyKey: 'submit-late-ok' },
    });
    expect(await replay.json()).toEqual(receipt);
    const listed = await invoke('assignments');
    const page = (await listed.json()) as {
      assignments: { mySubmission: { files: { originalName: string; downloadSig: string }[] } }[];
    };
    expect(page.assignments[0].mySubmission.files[0].originalName).toBe('shot.jpg');
    expect(page.assignments[0].mySubmission.files[0].downloadSig.length).toBeGreaterThan(10);
    const viaApp = await invoke('assignments', { cookie: false, platform: true });
    expect(viaApp.status).toBe(200);
    expect(
      ((await viaApp.json()) as typeof page).assignments[0].mySubmission.files[0].originalName,
    ).toBe('shot.jpg');
  });

  it('rejects disallowed types and oversize intents on the server', async () => {
    vi.stubEnv('ASSIGNMENT_FILE_SUBMIT_ENABLED', 'true');
    fetcher.mockImplementation(async (url: string) => {
      const target = String(url);
      if (target.endsWith('/sessions/current')) return response(principal);
      if (target.endsWith(`/class-workspaces/${id}`)) return response(workspace);
      if (target.endsWith('/assignments')) return response({ assignments: [assignment] });
      return response({ error: { code: 'NOT_FOUND' } }, 404);
    });
    expect(
      (
        await invoke(`assignments/${assignmentId}/files/intents`, {
          input: {
            originalName: 'payload.exe',
            contentType: 'application/octet-stream',
            byteSize: 64,
            idempotencyKey: 'intent-bad-type',
          },
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await invoke(`assignments/${assignmentId}/files/intents`, {
          input: {
            originalName: 'huge.jpg',
            contentType: 'image/jpeg',
            byteSize: 11 * 1024 * 1024,
            idempotencyKey: 'intent-too-large',
          },
        })
      ).status,
    ).toBe(422);
  });

  it('creates a batch of intents, serves inline content, and attaches download=1', async () => {
    vi.stubEnv('ASSIGNMENT_FILE_SUBMIT_ENABLED', 'true');
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    let mine: unknown = null;
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith('/sessions/current')) return response(principal);
      if (target.endsWith(`/class-workspaces/${id}`) && (!init?.method || init.method === 'GET'))
        return response(workspace);
      if (target.endsWith(`/assignments`) && (!init?.method || init.method === 'GET'))
        return response({
          assignments: [mine ? { ...assignment, submissionCount: 1, mySubmission: mine } : assignment],
        });
      if (target.endsWith(`/assignments/${assignmentId}/submit`)) {
        mine = {
          assignmentId,
          platformAccountId: accountId,
          displayName: '同學',
          body: '（附檔繳交）',
          state: 'submitted',
          submittedAt: '2026-10-21T13:00:00.000Z',
          teacherFeedback: null,
          reviewedAt: null,
        };
        return response({ ...assignment, submissionCount: 1, mySubmission: mine });
      }
      return response({ error: { code: 'NOT_FOUND' } }, 404);
    });
    const created = await invoke(`assignments/${assignmentId}/files/intents`, {
      input: {
        idempotencyKey: 'batch-intents-ok',
        files: [
          {
            originalName: 'shot.jpg',
            contentType: 'image/jpeg',
            byteSize: jpeg.byteLength,
            idempotencyKey: 'batch-file-aaaa',
          },
        ],
      },
    });
    expect(created.status).toBe(201);
    const payload = (await created.json()) as {
      intents: { id: string; uploadPath: string }[];
    };
    expect(payload.intents).toHaveLength(1);
    const uploaded = await invoke(payload.intents[0]!.uploadPath.replace(`class-workspaces/${id}/`, ''), {
      method: 'PUT',
      body: jpeg,
      contentType: 'image/jpeg',
    });
    expect(uploaded.status).toBe(200);
    const submitted = await invoke(`assignments/${assignmentId}/submit-files`, {
      input: { fileIds: [payload.intents[0]!.id], idempotencyKey: 'batch-submit-ok' },
    });
    expect(submitted.status).toBe(200);
    const listed = await invoke('assignments');
    const page = (await listed.json()) as {
      assignments: {
        mySubmission: { files: { downloadPath: string; downloadExp: string; downloadSig: string }[] };
      }[];
    };
    const file = page.assignments[0]!.mySubmission.files[0]!;
    const suffix = file.downloadPath.replace(`class-workspaces/${id}/`, '');
    const inline = await invoke(suffix, {
      method: 'GET',
      query: `?exp=${file.downloadExp}&sig=${file.downloadSig}`,
      cookie: false,
    });
    expect(inline.status).toBe(200);
    expect(inline.headers.get('Content-Disposition')).toMatch(/^inline;/);
    const download = await invoke(suffix, {
      method: 'GET',
      query: `?exp=${file.downloadExp}&sig=${file.downloadSig}&download=1`,
      cookie: false,
    });
    expect(download.status).toBe(200);
    expect(download.headers.get('Content-Disposition')).toMatch(/^attachment;/);
    expect(
      (
        await invoke(suffix, {
          method: 'GET',
          query: `?exp=${file.downloadExp}&sig=${file.downloadSig}&download=yes`,
          cookie: false,
        })
      ).status,
    ).toBe(400);
  });

  it('rejects a closed assignment and a guessed unsigned file URL', async () => {
    vi.stubEnv('ASSIGNMENT_FILE_SUBMIT_ENABLED', 'true');
    fetcher.mockImplementation(async (url: string) => {
      const target = String(url);
      if (target.endsWith('/sessions/current')) return response(principal);
      if (target.endsWith(`/class-workspaces/${id}`)) return response(workspace);
      if (target.endsWith('/assignments'))
        return response({
          assignments: [{ ...assignment, state: 'closed', closedAt: timestamp }],
        });
      return response({ error: { code: 'NOT_FOUND' } }, 404);
    });
    expect(
      (
        await invoke(`assignments/${assignmentId}/files/intents`, {
          input: {
            originalName: 'shot.jpg',
            contentType: 'image/jpeg',
            byteSize: 8,
            idempotencyKey: 'intent-closed',
          },
        })
      ).status,
    ).toBe(409);
    const guessed = await invoke(
      `assignments/${assignmentId}/files/cwf_99999999-9999-4999-8999-999999999999/content`,
      { method: 'GET', query: '?exp=1&sig=nope', cookie: false },
    );
    expect(guessed.status).toBe(404);
  });
});

it.each(['student', 'co-teacher', 'outsider'])('checks withdrawal permissions for %s', async (role) => {
  vi.stubEnv('ASSIGNMENT_FILE_SUBMIT_ENABLED', 'true');
  const mine = {
    assignmentId, platformAccountId: accountId, displayName: '同學', body: '繳交內容',
    state: 'submitted', submittedAt: timestamp, teacherFeedback: null, reviewedAt: null,
  };
  fetcher.mockImplementation(async (url: string) => {
    const target = String(url);
    if (target.endsWith('/sessions/current')) return response(principal);
    if (target.endsWith(`/class-workspaces/${id}`)) return role === 'outsider'
      ? response({ error: { code: 'CLASS_WORKSPACE_FORBIDDEN' } }, 403)
      : response({ ...workspace, memberRole: role });
    if (target.endsWith('/assignments')) return response({ assignments: [{ ...assignment, dueAt: '2099-10-31T12:00:00Z', mySubmission: mine, submissionCount: 1 }] });
    return response({ error: { code: 'NOT_FOUND' } }, 404);
  });
  const result = await invoke(`assignments/${assignmentId}/withdraw-submission`, {
    input: { submittedAt: timestamp, idempotencyKey: 'withdraw-route-key' }, cookie: false, platform: true,
  });
  expect(result.status).toBe(role === 'student' ? 200 : 403);
  if (role === 'student') {
    expect((await result.json()).mySubmission).toBeNull();
    const listed = await invoke('assignments', { cookie: false, platform: true });
    const page = await listed.json();
    expect(page.assignments[0].mySubmission).toBeNull();
    expect(page.assignments[0].submissionCount).toBe(0);
  }
});

it('requires authentication before accepting a withdrawal', async () => {
  vi.stubEnv('ASSIGNMENT_FILE_SUBMIT_ENABLED', 'true');
  const result = await invoke(`assignments/${assignmentId}/withdraw-submission`, {
    input: { submittedAt: timestamp, idempotencyKey: 'withdraw-anonymous-key' }, cookie: false,
  });
  expect(result.status).toBe(401);
  expect(fetcher).not.toHaveBeenCalled();
});
