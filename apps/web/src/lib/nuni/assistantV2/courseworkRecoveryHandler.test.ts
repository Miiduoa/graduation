// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { handleNuni } from '../api';
import { sealCookie, SESSION_COOKIE, sessionContext } from '../server';
import { createAdapter } from './adapter';
import { confirm, eventRecord, issueRoute, signCard } from './actions';
import { prepareCourseworkStudyRequest } from './courseworkStudyRequest';
import { prepareCourseworkRecoveryRequest } from './courseworkRecovery';
import { studyGuardForTask } from './courseworkStudy';
import { fixtureAdapter, FIXTURE_NOW as now, FIXTURE_SECRET as secret } from './fixtures';
import { canonical, eventArgs, V2Error, type Card, type Ledger } from './contracts';

const modelCall = vi.hoisted(() => vi.fn());
vi.mock('./adapter', async original => ({ ...(await original<typeof import('./adapter')>()), createAdapter: vi.fn() }));
vi.mock('./groq', async original => ({ ...(await original<typeof import('./groq')>()), createProviderModel: () => modelCall }));
const issuedSession = { sessionHandle: 'ps_' + 'i'.repeat(43), expiresAt: now + 7200000 };
const session = { sessionHandle: 'ps_' + 'r'.repeat(43), expiresAt: now + 7200000 };
const target = { workspaceId: 'course-a', taskId: 'task-urgent', kind: 'assignment' as const };
let sequence = 900;
let account: string;
let f: ReturnType<typeof fixtureAdapter>;
let current: number;
const oldBinding = () => ({ account, session: sessionContext(issuedSession), schoolId: 'fixture-school', conversationId: 'original-study' });
const binding = () => ({ ...oldBinding(), session: sessionContext(session), conversationId: 'recovery-study' });
function request(action: string, input: object, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost:3000/api/nuni/assistant/${action}`, { method: 'POST',
    headers: { cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, session)}`,
      'X-Campus-Session': sessionContext(session), Origin: 'http://localhost:3000', 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(input) });
}
const send = (action: string, input: object, headers?: Record<string, string>) => handleNuni(request(action, input, headers), ['assistant', action]);
async function original() {
  const result = await prepareCourseworkStudyRequest({ target, binding: oldBinding(), adapter: f.adapter, secret,
    now, writes: true, signal: new AbortController().signal });
  const card = result.cards[0];
  await confirm(oldBinding(), { token: card.token, args: card.args }, secret, now, f.adapter, true, () => now);
  current = now + 40 * 60000;
  return { issuedContext: oldBinding().session, conversationId: oldBinding().conversationId, token: card.token, args: eventArgs(card.args) };
}
type Proof = Awaited<ReturnType<typeof original>>;
const planInput = (recovery: Proof) => ({ schoolId: binding().schoolId, conversationId: binding().conversationId,
  routeToken: issueRoute(binding(), secret), task: target, recovery });
const act = (card: Card) => ({ schoolId: binding().schoolId, conversationId: binding().conversationId, token: card.token, args: card.args });
async function preview(proof: Proof) {
  const response = await send('plan', planInput(proof));
  expect(response.status).toBe(200);
  return response.json();
}
async function alterLedger(update: (ledger: Ledger) => void) {
  const ledger = await f.adapter.ledger();
  update(ledger);
  await f.adapter.write({ schoolId: ledger.schoolId, expectedRevision: ledger.revision, records: ledger.records, mutationId: 'external-change-' + sequence++ });
}
beforeEach(() => {
  current = now;
  vi.spyOn(Date, 'now').mockImplementation(() => current);
  for (const [name, value] of Object.entries({ CAMPUS_BACKEND: 'nuni', CAMPUS_ASSISTANT_ENABLED: 'true',
    CAMPUS_ASSISTANT_V2_ENABLED: 'true', CAMPUS_ASSISTANT_V2_WRITES_ENABLED: 'true', BFF_SESSION_SECRET: secret,
    WEB_PUBLIC_ORIGIN: 'http://localhost:3000', GROQ_API_KEY: '', FLY_MACHINE_ID: '' })) vi.stubEnv(name, value);
  vi.spyOn(console, 'info').mockImplementation(() => {});
  modelCall.mockReset().mockRejectedValue(new Error('Recovery must not call a model'));
  account = 'pa_00000000-0000-4000-8000-' + String(++sequence).padStart(12, '0');
  f = fixtureAdapter();
  vi.mocked(createAdapter).mockReturnValue({ adapter: f.adapter,
    principal: async () => ({ platformAccountId: account, isPlatformOperator: false }), apiCalls: () => 0 });
});
afterEach(() => { expect(modelCall).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it('recovers elapsed through fresh session preview and verified receipt, preserving original records', async () => {
  const proof = await original();
  const before = f.snapshot();
  const bootstrap = await send('plan', { schoolId: binding().schoolId, conversationId: 'new-recovery', task: target, recovery: proof });
  expect(bootstrap.status).toBe(200);
  expect(await bootstrap.json()).toMatchObject({ bootstrap: true });
  const result = await preview(proof);
  expect(result).toMatchObject({ modelCalls: 0, stopReason: '' });
  expect(result.cards).toHaveLength(1);
  expect(f.snapshot()).toEqual(before);
  const saved = await send('confirm', act(result.cards[0]));
  expect(saved.status).toBe(200);
  expect(await saved.json()).toMatchObject({ status: 'verified', storage: 'synced' });
  expect(f.snapshot().records).toEqual([...before.records, expect.objectContaining({ id: result.cards[0].mutationId })]);
  const replay = await send('confirm', act(result.cards[0]));
  expect(await replay.json()).toMatchObject({ status: 'verified', replay: true });
  expect(f.snapshot().records).toHaveLength(before.records.length + 1);
  expect(await preview(proof)).toMatchObject({ cards: [], stopReason: 'COURSEWORK_RECOVERY_EXISTS' });
});

it.each(['submitted', 'closed', 'changed', 'missing source', 'read failed', 'missing original', 'future original', 'edited original', 'other arrangement'] as const)(
  'refuses %s without a recovery card or service write', async mode => {
    const proof = await original();
    if (mode === 'future original') current = now;
    if (mode === 'missing original') await alterLedger(ledger => { ledger.records = ledger.records.filter(row => row.title !== proof.args.title); });
    if (mode === 'edited original') await alterLedger(ledger => { ledger.records.find(row => row.title === proof.args.title)!.title = 'edited'; });
    if (mode === 'other arrangement') await alterLedger(ledger => { const row = ledger.records.find(row => row.title === proof.args.title)!;
      ledger.records.push({ ...row, id: 'other-plan', startTime: '12:00', endTime: '12:30' }); });
    const work = f.adapter.work;
    if (['submitted', 'closed', 'changed', 'missing source'].includes(mode)) f.adapter.work = async id => {
      const tasks = await work(id);
      return mode === 'missing source' ? [] : tasks.map(task => task.id === target.taskId ? { ...task,
        ...(mode === 'submitted' ? { submitted: true } : mode === 'closed' ? { state: 'closed' } : { title: 'changed source' }) } : task);
    };
    if (mode === 'read failed') f.adapter.ledger = async () => { throw new V2Error(503, 'SOURCE_UNAVAILABLE'); };
    const writes = f.writes.length;
    const result = await preview(proof);
    expect(result.cards).toEqual([]);
    expect(result.stopReason).not.toBe('');
    expect(f.writes).toHaveLength(writes);
  });

it('does not trust event_missing when the source fingerprint changed', async () => {
  const proof = await original();
  await alterLedger(ledger => { ledger.records = ledger.records.filter(row => row.title !== proof.args.title); });
  const work = f.adapter.work;
  f.adapter.work = async id => (await work(id)).map(row => ({ ...row, dueAt: '2026-11-06T23:59:00+08:00' }));
  expect(await preview(proof)).toMatchObject({ cards: [], stopReason: 'COURSEWORK_CHANGED' });
});

it.each(['account', 'school', 'conversation', 'issued context', 'arguments', 'selected task'] as const)(
  'rejects mismatched %s before fresh private-source reads', async mode => {
    const proof = await original();
    if (mode === 'account') account = 'another-account';
    const input = planInput(proof);
    if (mode === 'school') { input.schoolId = 'other-school'; input.routeToken = issueRoute({ ...binding(), schoolId: input.schoolId }, secret); }
    if (mode === 'conversation') proof.conversationId = 'other-conversation';
    if (mode === 'issued context') proof.issuedContext = 'z'.repeat(43);
    if (mode === 'arguments') proof.args = { ...proof.args, title: 'changed' };
    if (mode === 'selected task') input.task = { ...target, taskId: 'task-next' };
    const work = vi.spyOn(f.adapter, 'work');
    const response = await send('plan', input);
    const result = await response.json();
    expect(result.cards || []).toEqual([]);
    expect(response.status === 409 || Boolean(result.stopReason)).toBe(true);
    expect(work).not.toHaveBeenCalled();
  });

it('requires current session headers and createPersonalEvent permission', async () => {
  const proof = await original();
  expect((await send('plan', planInput(proof), { 'X-Campus-Session': proof.issuedContext })).status).toBe(409);
  f.adapter.permissions = async () => ({ createPersonalEvent: false, prepareFoodOrder: true });
  expect(await preview(proof)).toMatchObject({ cards: [], stopReason: 'ASSISTANT_PERMISSION_DENIED' });
});

it('uses one stable recovery identity across new previews and cancels without a write', async () => {
  const proof = await original();
  const first = (await preview(proof)).cards[0];
  const second = (await preview(proof)).cards[0];
  expect(first.mutationId).toBe(second.mutationId);
  expect((await send('confirm', act(first))).status).toBe(409);
  const count = f.writes.length;
  expect((await send('cancel', act(second))).status).toBe(200);
  expect((await send('confirm', act(second))).status).toBe(409);
  expect(f.writes).toHaveLength(count);
  const third = (await preview(proof)).cards[0];
  expect(third.mutationId).toBe(second.mutationId);
  expect((await send('confirm', act(third))).status).toBe(200);
  expect(f.writes).toHaveLength(count + 1);
});

it.each(['source changed', 'permission removed', 'calendar changed', 'original missing', 'read failed'] as const)('rechecks %s at confirmation', async mode => {
  const proof = await original();
  const card = (await preview(proof)).cards[0];
  if (mode === 'source changed') { const work = f.adapter.work; f.adapter.work = async id => (await work(id)).map(row => ({ ...row, submitted: true })); }
  if (mode === 'permission removed') f.adapter.permissions = async () => ({ createPersonalEvent: false, prepareFoodOrder: true });
  if (mode === 'calendar changed') await alterLedger(ledger => { ledger.records.find(row => row.title === proof.args.title)!.title = 'changed'; });
  if (mode === 'original missing') {
    const snapshot = f.snapshot();
    snapshot.records = snapshot.records.filter(row => row.title !== proof.args.title);
    // Even an inconsistent transport preserving the revision cannot bypass the original-row guard.
    f.adapter.ledger = async () => snapshot;
  }
  if (mode === 'read failed') f.adapter.work = async () => { throw new V2Error(503, 'SOURCE_UNAVAILABLE'); };
  const before = f.snapshot();
  expect((await send('confirm', act(card))).status).toBeGreaterThanOrEqual(400);
  expect(f.snapshot()).toEqual(before);
});

it('does not promote a legacy generic study policy into gap recovery authority', async () => {
  const proof = await original();
  const task = (await f.adapter.work(target.workspaceId))[0];
  const card = signCard(oldBinding(), 'propose_personal_event', proof.args, f.snapshot().revision,
    secret, now, undefined, undefined, studyGuardForTask(task, 'study'));
  await alterLedger(ledger => { ledger.records.push(eventRecord(eventArgs(card.args), binding().schoolId, card.mutationId, now)); });
  expect(await preview({ ...proof, token: card.token, args: eventArgs(card.args) })).toMatchObject({ cards: [], stopReason: 'COURSEWORK_RECOVERY_UNAVAILABLE' });
});

it('rejects a never-confirmed old preview instead of treating absence as completion', async () => {
  const result = await prepareCourseworkStudyRequest({ target, binding: oldBinding(), adapter: f.adapter, secret,
    now, writes: true, signal: new AbortController().signal });
  current = now + 40 * 60000;
  const card = result.cards[0];
  expect(await preview({ issuedContext: oldBinding().session, conversationId: oldBinding().conversationId,
    token: card.token, args: eventArgs(card.args) })).toMatchObject({ cards: [], stopReason: 'COURSEWORK_RECOVERY_UNAVAILABLE' });
  expect(f.writes).toHaveLength(0);
});

it('keeps an uncertain committed child to its exact receipt and never issues another child', async () => {
  const proof = await original();
  const card = (await preview(proof)).cards[0];
  const write = f.adapter.write;
  f.adapter.write = async input => { await write(input); throw new V2Error(504, 'DEADLINE_EXCEEDED'); };
  expect((await send('confirm', act(card))).status).toBe(504);
  expect(f.writes).toHaveLength(2);
  const checked = await send('reconcile', act(card));
  expect(checked.status).toBe(200);
  expect(await checked.json()).toMatchObject({ status: 'verified' });
  expect(await preview(proof)).toMatchObject({ cards: [], stopReason: 'COURSEWORK_RECOVERY_EXISTS' });
  expect(f.writes).toHaveLength(2);
});

it('honors cancellation during preparation and expiry before confirmation', async () => {
  const proof = await original();
  const controller = new AbortController();
  const read = f.adapter.work;
  f.adapter.work = async id => { controller.abort(); return read(id); };
  await expect(prepareCourseworkRecoveryRequest({ target, recovery: proof,
    binding: binding(), adapter: f.adapter, secret, now: current, writes: true, signal: controller.signal })).rejects.toThrow();
  f.adapter.work = read;
  const card = (await preview(proof)).cards[0];
  current += 6 * 60000;
  expect((await send('confirm', act(card))).status).toBe(409);
  expect(f.writes).toHaveLength(1);
});

it.each(['conversation', 'session'] as const)('derives the same child across a new %s and uses CAS for competing confirmations', async mode => {
  const proof = await original();
  const first = (await preview(proof)).cards[0];
  const secondSession = { ...session, sessionHandle: 'ps_' + 's'.repeat(43) };
  const headers = mode === 'session' ? {
    cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, secondSession)}`,
    'X-Campus-Session': sessionContext(secondSession),
  } : undefined;
  const secondBinding = { ...binding(), conversationId: 'second-tab',
    ...(mode === 'session' ? { session: sessionContext(secondSession) } : {}) };
  current += 1000;
  const response = await send('plan', { ...planInput(proof), conversationId: secondBinding.conversationId,
    routeToken: issueRoute(secondBinding, secret) }, headers);
  expect(response.status).toBe(200);
  const second = (await response.json()).cards[0];
  expect(second.mutationId).toBe(first.mutationId);
  expect((await send('confirm', { schoolId: binding().schoolId, conversationId: proof.conversationId,
    token: proof.token, args: proof.args }, headers)).status).toBe(409);
  const results = await Promise.all([
    send('confirm', act(first)),
    send('confirm', { ...act(second), conversationId: secondBinding.conversationId }, headers),
  ]);
  expect(results.map(result => result.status).sort()).toEqual([200, 409]);
  expect(f.writes).toHaveLength(2);
  expect(f.snapshot().records.filter(row => row.id === first.mutationId)).toHaveLength(1);
});

it('keeps one child when a timed-out write commits after a new-session confirmation', async () => {
  const proof = await original();
  const first = (await preview(proof)).cards[0];
  const write = f.adapter.write;
  // Model the real sync transport's same-ID request-hash check before its CAS.
  // The generic fixture otherwise treats every same-ID payload as an exact retry.
  const transportWrite: typeof write = async input => {
    const replay = f.writes.find(row => row.mutationId === input.mutationId);
    if (replay && canonical({ schoolId: replay.schoolId, expectedRevision: replay.expectedRevision, records: replay.records }) !==
        canonical({ schoolId: input.schoolId, expectedRevision: input.expectedRevision, records: input.records }))
      throw new V2Error(409, 'PERSONAL_IMPORT_MUTATION_CONFLICT');
    return write(input);
  };
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let delayed: Promise<unknown> | undefined;
  f.adapter.write = async input => {
    // Return before committing anything. The upstream operation remains in flight.
    delayed = gate.then(() => transportWrite(input)).catch(error => error);
    throw new V2Error(504, 'DEADLINE_EXCEEDED');
  };
  const timedOut = await send('confirm', act(first));
  expect(timedOut.status).toBe(504);
  expect(f.writes).toHaveLength(1);
  expect(f.snapshot().records.some(row => row.id === first.mutationId)).toBe(false);
  f.adapter.write = transportWrite;
  current += 1000;
  const replacementSession = { ...session, sessionHandle: 'ps_' + 'n'.repeat(43) };
  const headers = { cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, replacementSession)}`,
    'X-Campus-Session': sessionContext(replacementSession) };
  const replacement = { ...binding(), session: sessionContext(replacementSession), conversationId: 'replacement-login' };
  const planned = await send('plan', { ...planInput(proof), conversationId: replacement.conversationId,
    routeToken: issueRoute(replacement, secret) }, headers);
  expect(planned.status).toBe(200);
  const second = (await planned.json()).cards[0];
  expect(second.mutationId).toBe(first.mutationId);
  const confirmed = await send('confirm', { ...act(second), conversationId: replacement.conversationId }, headers);
  expect(confirmed.status).toBe(200);
  expect(await confirmed.json()).toMatchObject({ status: 'verified', mutationId: second.mutationId });
  const committed = f.snapshot();
  release();
  expect(await delayed).toMatchObject({ status: 409, code: 'PERSONAL_IMPORT_MUTATION_CONFLICT' });
  expect(f.snapshot()).toEqual(committed);
  expect(f.writes).toHaveLength(2);
  expect(f.snapshot().records.filter(row => row.id === first.mutationId)).toHaveLength(1);
});

it('keeps maximum-length proofs and repeated recovery below the browser 2048-character token limit', async () => {
  vi.stubEnv('FLY_MACHINE_ID', 'm'.repeat(100));
  const task = { ...(await f.adapter.work(target.workspaceId))[0], id: 't'.repeat(100), courseId: 'c'.repeat(100), title: '課'.repeat(1000) };
  const longTarget = { workspaceId: task.courseId, taskId: task.id, kind: 'assignment' as const };
  f.adapter.work = async () => [task];
  f.adapter.courses = async () => ({ courses: [{ id: task.courseId, title: '合成長名稱課程' }], partial: false });
  const initial = signCard(oldBinding(), 'propose_personal_event', { title: '準備作業：' + '課'.repeat(115),
    date: '2026-11-04', allDay: false, startTime: '10:35', endTime: '11:05' }, f.snapshot().revision, secret, now,
    undefined, undefined, studyGuardForTask(task, 'coursework-gap'));
  expect(initial.token.length).toBeLessThanOrEqual(2048);
  await confirm(oldBinding(), { token: initial.token, args: initial.args }, secret, now, f.adapter, true, () => now);
  current = now + 40 * 60000;
  const originalProof = { issuedContext: oldBinding().session, conversationId: oldBinding().conversationId, token: initial.token, args: eventArgs(initial.args) };
  const first = await prepareCourseworkRecoveryRequest({ target: longTarget, recovery: originalProof, adapter: f.adapter,
    binding: binding(), secret, now: current, writes: true, signal: new AbortController().signal });
  expect(first.cards).toHaveLength(1);
  expect(first.cards[0].token.length).toBeLessThanOrEqual(2048);
  await confirm(binding(), { token: first.cards[0].token, args: first.cards[0].args }, secret, current, f.adapter, true, () => current);
  current += 45 * 60000;
  const childProof = { issuedContext: binding().session, conversationId: binding().conversationId,
    token: first.cards[0].token, args: eventArgs(first.cards[0].args) };
  const second = await prepareCourseworkRecoveryRequest({ target: longTarget, recovery: childProof, adapter: f.adapter,
    binding: binding(), secret, now: current, writes: true, signal: new AbortController().signal });
  expect(second.cards).toHaveLength(1);
  expect(second.cards[0].token.length).toBeLessThanOrEqual(2048);
  expect(second.cards[0].token.length).toBe(first.cards[0].token.length);
  expect(second.cards[0].mutationId).not.toBe(first.cards[0].mutationId);
  expect(await prepareCourseworkRecoveryRequest({ target: longTarget, recovery: originalProof, adapter: f.adapter,
    binding: binding(), secret, now: current, writes: true, signal: new AbortController().signal })).toMatchObject({ cards: [], stopReason: 'COURSEWORK_RECOVERY_EXISTS' });
});

it('does not let generic revision discard the signed original-event guard', async () => {
  const proof = await original();
  const card = (await preview(proof)).cards[0];
  await send('cancel', act(card));
  const revised = await send('revise', { schoolId: binding().schoolId, conversationId: binding().conversationId,
    routeToken: issueRoute(binding(), secret), originalCards: [{ token: card.token, args: card.args }],
    change: { mutationId: card.mutationId, date: card.args.date, startTime: '12:00', endTime: '12:30' } });
  expect(revised.status).toBe(409);
  expect(await revised.json()).toMatchObject({ error: 'INVALID_PLAN_REVISION' });
  expect(f.writes).toHaveLength(1);
});
