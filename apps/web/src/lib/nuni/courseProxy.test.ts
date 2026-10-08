// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { handleNuni } from './api';
import { SESSION_COOKIE, sealCookie, sessionContext } from './server';

const id = 'cw_11111111-1111-4111-8111-111111111111';
const assignmentId = 'cwa_22222222-2222-4222-8222-222222222222';
const quizId = 'cwq_33333333-3333-4333-8333-333333333333';
const unitId = 'cwu_44444444-4444-4444-8444-444444444444';
const accountId = 'pa_55555555-5555-4555-8555-555555555555';
const otherAccount = 'pa_99999999-9999-4999-8999-999999999999';
const timestamp = '2026-10-08T01:00:00.000Z';
const key = 'stable-request-key';
const principal = { authenticated: true, platformAccountId: accountId, isPlatformOperator: false };
const unit = { id: unitId, workspaceId: id, title: '第一章', position: 1, createdAt: timestamp };
const material = {
  id: 'cwm_66666666-6666-4666-8666-666666666666',
  workspaceId: id,
  title: '教材',
  body: '課前閱讀',
  unitId: null,
  unitTitle: null,
  createdByPlatformAccountId: accountId,
  createdAt: timestamp,
};
const common = {
  workspaceId: id,
  title: '課堂討論',
  state: 'open',
  createdAt: timestamp,
  closedAt: null,
  dueAt: null,
  unitId: null,
  unitTitle: null,
};
const assignment = {
  ...common,
  id: assignmentId,
  instructions: '你的觀察',
  submissionCount: 0,
  mySubmission: null,
};
const quiz = { ...common, id: quizId, prompt: '你的理由', responseCount: 0, myResponse: null };
const submission = {
  assignmentId,
  platformAccountId: accountId,
  displayName: '同學',
  body: '回答',
  state: 'submitted',
  submittedAt: timestamp,
  teacherFeedback: '再補充一個例子',
  reviewedAt: timestamp,
};
const answer = {
  quizId,
  platformAccountId: accountId,
  displayName: '同學',
  answer: '回答',
  state: 'submitted',
  submittedAt: timestamp,
  teacherFeedback: '再補充一個例子',
  reviewedAt: timestamp,
};
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const fetcher = vi.fn();
const session = { sessionHandle: `ps_${'a'.repeat(43)}`, expiresAt: Date.now() + 3600_000 };
function invoke(
  suffix: string,
  input?: unknown,
  options: { origin?: string; context?: string; cookie?: boolean; query?: string } = {},
) {
  const path = ['class-workspaces', id, ...suffix.split('/')];
  return handleNuni(
    new NextRequest(`https://nuni.tw/api/nuni/${path.join('/')}${options.query ?? ''}`, {
      method: input === undefined ? 'GET' : 'POST',
      headers: {
        ...(options.cookie === false
          ? {}
          : { Cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, session)}` }),
        'X-Campus-Session': options.context ?? sessionContext(session),
        ...(input === undefined
          ? {}
          : { Origin: options.origin ?? 'https://nuni.tw', 'Content-Type': 'application/json' }),
      },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    }),
    path,
  );
}
function reply(value: unknown) {
  fetcher.mockImplementation(async (url: string) =>
    response(url.endsWith('/sessions/current') ? principal : value),
  );
}

beforeEach(() => {
  vi.stubEnv('CAMPUS_BACKEND', 'nuni');
  vi.stubEnv('WEB_PUBLIC_ORIGIN', 'https://nuni.tw');
  vi.stubEnv('BFF_SESSION_SECRET', 'test-session-secret-longer-than-32-characters');
  vi.stubEnv('NUNI_API_BASE_URL', 'https://api.nuni.tw');
  vi.stubGlobal('fetch', fetcher.mockReset());
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Nuni course proxy allowlist', () => {
  it.each([
    ['units', { units: [unit] }],
    ['materials', { materials: [material] }],
    ['quizzes', { quizzes: [quiz] }],
    [`quizzes/${quizId}/responses`, { responses: [answer] }],
    [`assignments/${assignmentId}/submissions`, { submissions: [submission] }],
  ])('reads the exact %s endpoint using the sealed session', async (suffix, payload) => {
    reply(payload);
    const result = await invoke(suffix);
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body).toEqual(payload);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe(
      `https://api.nuni.tw/v1/auth/platform/class-workspaces/${id}/${suffix}`,
    );
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      method: 'GET',
      cache: 'no-store',
      redirect: 'error',
    });
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe(
      `Platform ${session.sessionHandle}`,
    );
    expect(result.headers.get('cache-control')).toContain('no-store');
    expect(JSON.stringify(body)).not.toContain(session.sessionHandle);
  });

  it.each([
    [
      'units',
      { title: ' 第一章 ', idempotencyKey: key, memberRole: 'owner-teacher' },
      unit,
      { title: '第一章', idempotencyKey: key },
    ],
    [
      'materials',
      {
        title: ' 教材 ',
        body: ' 課前閱讀 ',
        unitId,
        idempotencyKey: key,
        platformAccountId: otherAccount,
      },
      material,
      { title: '教材', body: '課前閱讀', unitId, idempotencyKey: key },
    ],
    [
      'quizzes',
      {
        title: ' 題目 ',
        prompt: ' 說明理由 ',
        dueAt: timestamp,
        unitId,
        idempotencyKey: key,
        responseCount: 10,
      },
      quiz,
      { title: '題目', prompt: '說明理由', dueAt: timestamp, unitId, idempotencyKey: key },
    ],
  ])(
    'creates %s with only allowlisted input fields and the stable retry key',
    async (suffix, input, receipt, forwarded) => {
      reply(receipt);
      const result = await invoke(suffix, input);
      expect(result.status).toBe(201);
      expect(await result.json()).toEqual(receipt);
      expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual(forwarded);
    },
  );

  it.each([
    [`assignments/${assignmentId}/submissions/${accountId}/feedback`, submission],
    [`quizzes/${quizId}/responses/${accountId}/feedback`, answer],
  ])('forwards feedback to the exact student target on %s', async (suffix, receipt) => {
    reply(receipt);
    const result = await invoke(suffix, {
      feedback: ' 再補充一個例子 ',
      idempotencyKey: key,
      grade: 100,
    });
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual(receipt);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      feedback: '再補充一個例子',
      idempotencyKey: key,
    });
  });

  it.each([
    [`assignments/${assignmentId}/close`, { ...assignment, state: 'closed', closedAt: timestamp }],
    [`quizzes/${quizId}/close`, { ...quiz, state: 'closed', closedAt: timestamp }],
  ])(
    'closes %s with an empty body, without inventing backend idempotency',
    async (suffix, receipt) => {
      reply(receipt);
      const result = await invoke(suffix, {});
      expect(result.status).toBe(200);
      expect(await result.json()).toEqual(receipt);
      expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({});
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it('binds quiz submission to the current server-side principal and filters response metadata', async () => {
    const receipt = { ...quiz, responseCount: 1, myResponse: answer };
    reply({ ...receipt, sessionHandle: session.sessionHandle, grade: 100 });
    const result = await invoke(`quizzes/${quizId}/submit`, {
      answer: ' 回答 ',
      idempotencyKey: key,
      platformAccountId: otherAccount,
    });
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual(receipt);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      answer: '回答',
      idempotencyKey: key,
    });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      `https://api.nuni.tw/v1/auth/platform/class-workspaces/${id}/quizzes/${quizId}/submit`,
      'https://api.nuni.tw/v1/auth/platform/sessions/current',
    ]);
  });

  it('resolves the principal once for multiple private quiz records', async () => {
    const secondId = quizId.replace('33333333', '77777777');
    reply({
      quizzes: [
        { ...quiz, responseCount: 1, myResponse: answer },
        { ...quiz, id: secondId, responseCount: 1, myResponse: { ...answer, quizId: secondId } },
      ],
    });
    expect((await invoke('quizzes')).status).toBe(200);
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/sessions/current'))).toHaveLength(1);
  });
});

describe('Nuni course proxy rejection boundaries', () => {
  it.each([
    ['units', { title: ' ', idempotencyKey: key }],
    ['units', { title: 'x'.repeat(81), idempotencyKey: key }],
    ['materials', { title: '教材', body: '', idempotencyKey: key }],
    ['materials', { title: '教材', body: '內容', unitId: '../other', idempotencyKey: key }],
    ['materials', { title: '教材', body: '內容', unitId: null, idempotencyKey: key }],
    ['quizzes', { title: '题目', prompt: 'x'.repeat(4001), dueAt: null, idempotencyKey: key }],
    [
      'quizzes',
      { title: '题目', prompt: '內容', dueAt: '2026-02-31T10:00:00Z', idempotencyKey: key },
    ],
    [
      'quizzes',
      { title: '题目', prompt: '內容', dueAt: '2026-10-08T10:00:00', idempotencyKey: key },
    ],
    [`quizzes/${quizId}/submit`, { answer: 'x'.repeat(2001), idempotencyKey: key }],
    [`quizzes/${quizId}/submit`, { answer: '答案', idempotencyKey: 'short' }],
    [`quizzes/${quizId}/responses/${accountId}/feedback`, { feedback: '', idempotencyKey: key }],
    [
      `assignments/${assignmentId}/submissions/${accountId}/feedback`,
      { feedback: 'x'.repeat(4001), idempotencyKey: key },
    ],
    [`quizzes/${quizId}/close`, { idempotencyKey: key }],
  ])('rejects invalid %s inputs before sending to Nuni', async (suffix, input) => {
    expect((await invoke(suffix, input)).status).toBe(422);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['quizzes/invalid/responses', undefined],
    [`quizzes/${assignmentId}/close`, {}],
    [`assignments/${quizId}/close`, {}],
    [`quizzes/${quizId}/responses/${accountId}/grade`, { grade: 100, idempotencyKey: key }],
    ['materials/extra', { title: '教材', body: '內容', idempotencyKey: key }],
  ])('does not proxy unapproved path %s', async (suffix, input) => {
    expect((await invoke(suffix, input)).status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('requires a session on reads and trusted origin plus current session context on writes', async () => {
    expect((await invoke('materials', undefined, { cookie: false })).status).toBe(401);
    expect((await invoke('materials', undefined, { context: 'old-account-context' })).status).toBe(
      409,
    );
    expect(
      (await invoke(`quizzes/${quizId}/close`, {}, { origin: 'https://attacker.example' })).status,
    ).toBe(403);
    expect(
      (
        await invoke(
          `assignments/${assignmentId}/submissions/${accountId}/feedback`,
          { feedback: '補充', idempotencyKey: key },
          { context: 'old-account-context' },
        )
      ).status,
    ).toBe(409);
    expect((await invoke('quizzes', undefined, { query: '?platformAccountId=other' })).status).toBe(
      400,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404, 409])(
    'preserves upstream %i errors without inventing an empty list or success',
    async (status) => {
      fetcher.mockResolvedValue(response({ error: 'BACKEND_ERROR' }, status));
      const result = await invoke(`quizzes/${quizId}/close`, {});
      expect(result.status).toBe(status);
      expect(await result.json()).toEqual({ error: 'REQUEST_FAILED' });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    [
      'materials',
      undefined,
      { materials: [{ ...material, workspaceId: id.replace('11111111', '99999999') }] },
    ],
    ['units', undefined, { units: null }],
    [
      'quizzes',
      undefined,
      { quizzes: [{ ...quiz, myResponse: { ...answer, platformAccountId: otherAccount } }] },
    ],
    [
      `quizzes/${quizId}/submit`,
      { answer: '答案', idempotencyKey: key },
      { ...quiz, myResponse: { ...answer, platformAccountId: otherAccount } },
    ],
    [
      `quizzes/${quizId}/responses/${accountId}/feedback`,
      { feedback: '補充', idempotencyKey: key },
      { ...answer, platformAccountId: otherAccount },
    ],
    [
      `assignments/${assignmentId}/submissions/${accountId}/feedback`,
      { feedback: '補充', idempotencyKey: key },
      { ...submission, platformAccountId: otherAccount },
    ],
    [
      'materials',
      { title: '教材', body: '內容', idempotencyKey: key },
      { ...material, createdByPlatformAccountId: otherAccount },
    ],
  ])('rejects malformed or cross-owner %s receipts', async (suffix, input, receipt) => {
    reply(receipt);
    const result = await invoke(suffix, input);
    expect(result.status).toBe(502);
    expect(await result.json()).toEqual({ error: 'INVALID_RESPONSE' });
  });

  it('does not accept a private result when principal verification has expired', async () => {
    fetcher.mockImplementation(async (url: string) =>
      url.endsWith('/sessions/current')
        ? response({ error: 'EXPIRED' }, 401)
        : response({ ...quiz, myResponse: answer }),
    );
    const result = await invoke(`quizzes/${quizId}/submit`, {
      answer: '答案',
      idempotencyKey: key,
    });
    expect(result.status).toBe(401);
    expect(await result.json()).toEqual({ error: 'REQUEST_FAILED' });
  });
});
