// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { handleNuni } from '../api';
import { sealCookie, SESSION_COOKIE, sessionContext } from '../server';
import { readPlatformAssistantPermissions } from '../platformAssistantPermissionStore';
import { eventRecord, issueRoute, signCard } from './actions';
import { studyGuardForTask } from './courseworkStudy';
import { FIXTURE_NOW as issuedAt, FIXTURE_SECRET as secret } from './fixtures';
import type { Ledger } from './contracts';

vi.mock('../platformAssistantPermissionStore', async original => ({
  ...(await original<typeof import('../platformAssistantPermissionStore')>()),
  readPlatformAssistantPermissions: vi.fn(),
}));

const workspaceId = 'cw_11111111-1111-4111-8111-111111111111';
const taskId = 'cwa_11111111-1111-4111-8111-111111111111';
const schoolId = 'fixture-school';
const now = issuedAt + 40 * 60_000;
const session = { sessionHandle: 'ps_' + 'b'.repeat(43), expiresAt: now + 3_600_000 };
const target = { workspaceId, taskId, kind: 'assignment' as const };
const task = { id: taskId, courseId: workspaceId, kind: 'assignment' as const,
  title: '合成資料結構作業', dueAt: '2026-11-05T23:59:00+08:00', state: 'open', submitted: false };
const originalEvent = { title: `準備作業：${task.title}`, date: '2026-11-04', allDay: false,
  startTime: '10:35', endTime: '11:05' };
let accountSequence = 3000;
let account: string;
let ledger: Ledger;
let assignmentUnavailable: boolean;
let writes: number;
let fetcher: ReturnType<typeof vi.fn>;
const binding = () => ({ account, session: sessionContext(session), conversationId: 'adapter-recovery', schoolId });

function request(action: string, input: object) {
  return new NextRequest(`http://localhost:3000/api/nuni/assistant/${action}`, { method: 'POST',
    headers: { cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, session)}`,
      'X-Campus-Session': sessionContext(session), Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
    body: JSON.stringify(input) });
}
function originalProof() {
  const originalBinding = { ...binding(), session: 'o'.repeat(43), conversationId: 'adapter-original' };
  const card = signCard(originalBinding, 'propose_personal_event', originalEvent, 0, secret, issuedAt,
    undefined, undefined, studyGuardForTask(task, 'coursework-gap'));
  ledger.records.push(eventRecord(originalEvent, schoolId, card.mutationId, issuedAt));
  return { issuedContext: originalBinding.session, conversationId: originalBinding.conversationId,
    token: card.token, args: card.args };
}
function plan(proof: ReturnType<typeof originalProof>) {
  return handleNuni(request('plan', { schoolId, conversationId: binding().conversationId,
    routeToken: issueRoute(binding(), secret), task: target, recovery: proof }), ['assistant', 'plan']);
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(now);
  vi.spyOn(console, 'info').mockImplementation(() => {});
  for (const [key, value] of Object.entries({ CAMPUS_BACKEND: 'nuni', CAMPUS_ASSISTANT_ENABLED: 'true',
    CAMPUS_ASSISTANT_V2_ENABLED: 'true', CAMPUS_ASSISTANT_V2_WRITES_ENABLED: 'true', BFF_SESSION_SECRET: secret,
    WEB_PUBLIC_ORIGIN: 'http://localhost:3000', NUNI_API_BASE_URL: 'https://synthetic.invalid', FLY_MACHINE_ID: '' })) vi.stubEnv(key, value);
  account = 'pa_00000000-0000-4000-8000-' + String(++accountSequence).padStart(12, '0');
  vi.mocked(readPlatformAssistantPermissions).mockImplementation(async accountId => ({
    scope: 'platform-account', accountId, revision: 1,
    permissions: { createPersonalEvent: true, prepareFoodOrder: false },
  }));
  const base = { schoolId, academicYear: '115', semester: '1', batchId: 'synthetic-batch',
    importedAt: '2026-11-01T00:00:00Z', source: { type: 'paste' as const, line: 1, rawText: '' } };
  ledger = { schoolId, revision: 1, updatedAt: '2026-11-04T02:00:00Z', records: [
    { ...base, id: 'class-before', kind: 'timetable', title: '合成早課', dayOfWeek: 3, startTime: '09:00', endTime: '10:00' },
    { ...base, id: 'class-after', kind: 'timetable', title: '合成午課', dayOfWeek: 3, startTime: '13:00', endTime: '15:00' },
  ] };
  assignmentUnavailable = false;
  writes = 0;
  fetcher = vi.fn(async (url: string, init: RequestInit) => {
    expect(new URL(url).origin).toBe('https://synthetic.invalid');
    expect(init.headers).toMatchObject({ Authorization: 'Platform ' + session.sessionHandle });
    expect(init.cache).toBe('no-store');
    expect(init.redirect).toBe('error');
    const path = new URL(url).pathname.replace('/v1/auth/platform/', '');
    if (path === 'sessions/current') return Response.json({ authenticated: true, platformAccountId: account, isPlatformOperator: false });
    if (path === 'class-workspaces') return Response.json({ workspaces: [
      { id: workspaceId, title: '合成課程', state: 'active', memberRole: 'student' },
    ] });
    if (path === 'course-access/workspace-course') {
      expect(JSON.parse(String(init.body))).toEqual({ workspaceId, schoolId });
      return Response.json({ workspaceId, memberRole: 'student', membershipActive: true, status: 'reviewed', course: {
        workspaceId, schoolId, id: 'ccd_11111111-1111-4111-8111-111111111111', version: 1,
        verification: 'administrator-reviewed', academicYear: '115', semester: '1', courseCode: 'CS301',
        teacher: '合成老師', className: '合成班級', title: '合成課程',
      } });
    }
    if (path === `class-workspaces/${workspaceId}/assignments`) return assignmentUnavailable
      ? Response.json({ error: 'SOURCE_UNAVAILABLE' }, { status: 503 })
      : Response.json({ assignments: [{ id: taskId, workspaceId, title: task.title, dueAt: task.dueAt,
        state: 'open', createdAt: '2026-11-01T00:00:00Z', closedAt: null, unitId: null, unitTitle: null,
        instructions: '合成作業內容', submissionCount: 0, mySubmission: null }] });
    if (path === `class-workspaces/${workspaceId}/quizzes`) return Response.json({ quizzes: [] });
    if (path === 'personal-imports/read') return Response.json(ledger);
    if (path === 'personal-imports/write') {
      const input = JSON.parse(String(init.body));
      if (input.schoolId !== schoolId || input.expectedRevision !== ledger.revision)
        return Response.json({ error: 'PERSONAL_IMPORT_REVISION_CONFLICT' }, { status: 409 });
      writes++;
      ledger = { ...ledger, records: structuredClone(input.records), revision: ledger.revision + 1 };
      return Response.json(ledger);
    }
    throw new Error('Unexpected synthetic transport path: ' + path);
  });
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('uses the real adapter and parsed source to preview in 8 API calls and confirm in 10, within the unchanged 12-call budget', async () => {
  const proof = originalProof();
  const originalRecords = structuredClone(ledger.records);
  const planned = await plan(proof);
  expect(planned.status).toBe(200);
  const result = await planned.json();
  expect(result).toMatchObject({ stopReason: '', modelCalls: 0, simulation: false });
  expect(result.cards).toHaveLength(1);
  expect(fetcher).toHaveBeenCalledTimes(8);
  expect(writes).toBe(0);
  expect(ledger.records).toEqual(originalRecords);

  fetcher.mockClear();
  const card = result.cards[0];
  const confirmed = await handleNuni(request('confirm', { schoolId, conversationId: binding().conversationId,
    token: card.token, args: card.args }), ['assistant', 'confirm']);
  expect(confirmed.status).toBe(200);
  expect(await confirmed.json()).toMatchObject({ status: 'verified', storage: 'synced', replay: false,
    mutationId: card.mutationId });
  expect(fetcher).toHaveBeenCalledTimes(10);
  expect(writes).toBe(1);
  expect(ledger.records).toEqual([...originalRecords, expect.objectContaining({ id: card.mutationId })]);
});

it.each(['plan', 'confirm'] as const)('fails closed when the real coursework transport is unavailable during %s', async stage => {
  const proof = originalProof();
  const originalLedger = structuredClone(ledger);
  if (stage === 'plan') assignmentUnavailable = true;
  const planned = await plan(proof);
  const result = await planned.json();
  if (stage === 'plan') {
    expect(planned.status).toBe(200);
    expect(result).toMatchObject({ cards: [], stopReason: 'SOURCE_UNAVAILABLE' });
  } else {
    expect(result.cards).toHaveLength(1);
    assignmentUnavailable = true;
    fetcher.mockClear();
    const card = result.cards[0];
    const confirmed = await handleNuni(request('confirm', { schoolId, conversationId: binding().conversationId,
      token: card.token, args: card.args }), ['assistant', 'confirm']);
    expect(confirmed.status).toBe(503);
    expect(await confirmed.json()).toMatchObject({ error: 'SOURCE_UNAVAILABLE' });
  }
  expect(fetcher.mock.calls.length).toBeLessThanOrEqual(12);
  expect(writes).toBe(0);
  expect(ledger).toEqual(originalLedger);
});
