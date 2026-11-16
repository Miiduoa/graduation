import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import {
  createTronClassCandidateFetch, createTronClassTextSubmissionCandidate,
  type TronClassCandidateAuthorization,
} from './tronClassSubmissionCandidate';

// Synthetic protocol examples. No fixtures contain captured school responses,
// and all HTTP implementations below are in-memory mocks.
const NOW = Date.parse('2026-11-16T12:00:00.000Z');
const input = { courseId: 10, homeworkId: 20, content: '我的 <作業> & 說明\n第二行' };
const acknowledgment = () => ({
  student: { id: 30 },
  submission: { id: 90, course_id: 10, activity_id: 20, created_by: { id: 30 },
    is_draft: false, is_redo: false, submit_by_instructor: false, is_latest_version: true,
    created_at: '2026-11-16T12:00:00Z', submission_correct: { grade: 'private-fixture' } },
});
function authorization(): TronClassCandidateAuthorization {
  return {
    binding: { schoolId: 'pu', userId: 30, account: 'synthetic-account', userName: null,
      revision: 'a'.repeat(32), expiresAt: '2026-11-16T13:00:00.000Z',
      cookies: { session: 'synthetic-session', 'XSRF-TOKEN': 'synthetic%2Dcsrf' } },
    assignment: { courseId: 10, homeworkId: 20, studentId: 30, title: '合成作業', description: '',
      deadline: '2026-11-16T14:00:00.000Z', opensAt: null, permissionKnown: true, individual: true,
      canSubmit: true, isClosed: false, allowLate: false, remainingAttempts: 1,
      allowsText: true, allowsAttachments: false, maxFiles: 0, maxFileBytes: 0, maxTotalBytes: 0, allowedContentTypes: [] },
    mode: 'normal', historyComplete: true, priorSubmissionIds: [], userSubmitCount: 0,
    ordinaryWindowConfirmed: true, prerequisitesConfirmed: true,
  };
}
function setup(value = authorization()) {
  const enabled = vi.fn(() => true);
  const authorize = vi.fn(async () => value);
  const assertCurrent = vi.fn(async () => {});
  const fetch = vi.fn(async () => new Response(JSON.stringify(acknowledgment()), { headers: { 'Content-Type': 'application/json' } }));
  const dependencies = { enabled, authorize, assertCurrent, fetch, now: () => NOW };
  return { ...dependencies, value, candidate: createTronClassTextSubmissionCandidate(dependencies) };
}
afterEach(() => { vi.useRealTimers(); });

describe('controlled text submission candidate', () => {
  it('is disabled by default, remains unverified, and does not even read an account', async () => {
    const s = setup();
    const candidate = createTronClassTextSubmissionCandidate({ ...s, enabled: undefined });
    expect(candidate.contractVerified).toBe(false);
    expect(Object.isFrozen(candidate)).toBe(true);
    await expect(candidate.dispatch('firebase:fixture', input)).rejects.toMatchObject({ code: 'TRONCLASS_CANDIDATE_DISABLED' });
    expect(s.authorize).not.toHaveBeenCalled();
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it('sends one fixed, text-only POST and returns an acknowledgment, never a receipt', async () => {
    const s = setup();
    const result = await s.candidate.dispatch('firebase:fixture', input);
    expect(result).toEqual({ state: 'acknowledged', submissionId: 90, courseId: 10, activityId: 20, studentId: 30 });
    expect(result).not.toHaveProperty('submittedAt');
    expect(result).not.toHaveProperty('receipt');
    expect(s.authorize).toHaveBeenCalledWith('firebase:fixture', { courseId: 10, homeworkId: 20 });
    expect(s.assertCurrent).toHaveBeenCalledTimes(2);
    expect(s.fetch).toHaveBeenCalledTimes(1);
    const [url, request] = s.fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://tronclass.pu.edu.tw/api/course/activities/20/submissions');
    expect(request).toMatchObject({ method: 'POST', redirect: 'manual', cache: 'no-store' });
    const headers = new Headers(request.headers);
    expect(headers.get('Cookie')).toContain('session=synthetic-session');
    expect(headers.get('X-XSRF-TOKEN')).toBe('synthetic-csrf');
    expect(JSON.parse(String(request.body))).toEqual({ comment: '我的 &lt;作業&gt; &amp; 說明<br>第二行',
      uploads: [], slides: [], is_draft: false, mode: 'normal', other_resources: [], uploads_in_rich_text: [] });
    await expect(s.candidate.dispatch('firebase:fixture', input)).rejects.toMatchObject({ code: 'TRONCLASS_CANDIDATE_ALREADY_DISPATCHED' });
    expect(s.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['unknown permission', (a: TronClassCandidateAuthorization) => { a.assignment.permissionKnown = false; }],
    ['different owner', (a: TronClassCandidateAuthorization) => { a.assignment.studentId = 31; }],
    ['different course', (a: TronClassCandidateAuthorization) => { a.assignment.courseId = 11; }],
    ['different activity', (a: TronClassCandidateAuthorization) => { a.assignment.homeworkId = 21; }],
    ['group work', (a: TronClassCandidateAuthorization) => { a.assignment.individual = false; }],
    ['no text', (a: TronClassCandidateAuthorization) => { a.assignment.allowsText = false; }],
    ['closed', (a: TronClassCandidateAuthorization) => { a.assignment.isClosed = true; }],
    ['no attempts', (a: TronClassCandidateAuthorization) => { a.assignment.remainingAttempts = 0; }],
    ['future opening', (a: TronClassCandidateAuthorization) => { a.assignment.opensAt = '2026-11-16T12:30:00Z'; }],
    ['past deadline even with late work allowed', (a: TronClassCandidateAuthorization) => { a.assignment.deadline = '2026-11-16T11:00:00Z'; a.assignment.allowLate = true; }],
    ['partial history', (a: TronClassCandidateAuthorization) => { a.historyComplete = false; }],
    ['prior version', (a: TronClassCandidateAuthorization) => { a.priorSubmissionIds = [80]; }],
    ['conflicting source count', (a: TronClassCandidateAuthorization) => { a.userSubmitCount = 1; }],
    ['unverified ordinary window', (a: TronClassCandidateAuthorization) => { a.ordinaryWindowConfirmed = false; }],
    ['unknown prerequisites', (a: TronClassCandidateAuthorization) => { a.prerequisitesConfirmed = false; }],
  ])('stops %s before any school write', async (_label, alter) => {
    const value = authorization();
    alter(value);
    const s = setup(value);
    await expect(s.candidate.dispatch('firebase:fixture', input)).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_BLOCKED' });
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it('does not ignore attachments or arbitrary transport fields on the input', async () => {
    const s = setup();
    await expect(s.candidate.dispatch('firebase:fixture', { ...input, uploadIds: [40] } as typeof input)).rejects.toMatchObject({ code: 'TRONCLASS_PROTOCOL_INVALID_INPUT' });
    expect(s.authorize).not.toHaveBeenCalled();
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it.each(['missing', 'newline', 'malformed', 'cookie-injection'])('refuses %s CSRF/cookie material without issuing a request', async kind => {
    const value = authorization();
    if (kind === 'missing') delete value.binding.cookies['XSRF-TOKEN'];
    if (kind === 'newline') value.binding.cookies['XSRF-TOKEN'] = 'bad%0Atoken';
    if (kind === 'malformed') value.binding.cookies['XSRF-TOKEN'] = '%xx';
    if (kind === 'cookie-injection') value.binding.cookies.session = 'value; other=account';
    const s = setup(value);
    await expect(s.candidate.dispatch('firebase:fixture', input)).rejects.toBeInstanceOf(NuniError);
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it('rechecks the control switch after authorization and binding checks', async () => {
    const s = setup();
    s.assertCurrent.mockImplementationOnce(async () => { s.enabled.mockReturnValue(false); });
    await expect(s.candidate.dispatch('firebase:fixture', input)).rejects.toMatchObject({ code: 'TRONCLASS_CANDIDATE_DISABLED' });
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it('rechecks the captured deadline after the awaited binding check', async () => {
    const s = setup();
    let instant = NOW;
    s.value.assignment.deadline = new Date(NOW + 1).toISOString();
    s.assertCurrent.mockImplementationOnce(async () => {
      instant = NOW + 2;
      // Another consumer mutating the shared source object cannot extend the
      // deadline of the already checked authorization snapshot.
      s.value.assignment.deadline = new Date(NOW + 60_000).toISOString();
    });
    const candidate = createTronClassTextSubmissionCandidate({ ...s, now: () => instant });
    await expect(candidate.dispatch('firebase:fixture', input)).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_BLOCKED' });
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it('drops a late acknowledgment after the account revision changes', async () => {
    const s = setup();
    s.assertCurrent.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new NuniError(409, 'TRONCLASS_BINDING_CHANGED'));
    await expect(s.candidate.dispatch('firebase:fixture', input)).rejects.toMatchObject({ code: 'TRONCLASS_BINDING_CHANGED' });
    await expect(s.candidate.dispatch('firebase:fixture', input)).rejects.toMatchObject({ code: 'TRONCLASS_CANDIDATE_ALREADY_DISPATCHED' });
    expect(s.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([302, 307, 401, 403, 500, 503])('does not retry or follow an HTTP %s response', async status => {
    const s = setup();
    s.fetch.mockResolvedValueOnce(new Response('private-upstream-fixture', { status, headers: { Location: 'https://untrusted.test/' } }));
    await expect(s.candidate.dispatch('firebase:fixture', input)).rejects.toMatchObject({
      code: status === 401 || status === 403 ? 'TRONCLASS_RECONNECT_REQUIRED' : 'TRONCLASS_CANDIDATE_UNCONFIRMED',
    });
    await expect(s.candidate.dispatch('firebase:fixture', input)).rejects.toMatchObject({ code: 'TRONCLASS_CANDIDATE_ALREADY_DISPATCHED' });
    expect(s.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not leak malformed JSON or network error contents', async () => {
    const s = setup();
    s.fetch.mockResolvedValueOnce(new Response('{"private-school-content":', { headers: { 'content-type': 'application/json' } }));
    await expect(s.candidate.dispatch('firebase:fixture', input)).rejects.toMatchObject({ message: 'TRONCLASS_CANDIDATE_UNCONFIRMED' });
    const other = setup();
    other.fetch.mockRejectedValueOnce(new Error('private-cookie-url-fixture'));
    await expect(other.candidate.dispatch('firebase:fixture', input)).rejects.toMatchObject({ message: 'TRONCLASS_CANDIDATE_UNCONFIRMED' });
    expect(other.fetch).toHaveBeenCalledTimes(1);
  });

  it('bounds the response and leaves an unconfirmed operation non-repeatable', async () => {
    const s = setup();
    s.fetch.mockResolvedValueOnce(new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': String(1024 * 1024 + 1) } }));
    await expect(s.candidate.dispatch('firebase:fixture', input)).rejects.toMatchObject({ code: 'TRONCLASS_CANDIDATE_UNCONFIRMED' });
    expect(s.fetch).toHaveBeenCalledTimes(1);
  });

  it('aborts a stalled write without retrying', async () => {
    vi.useFakeTimers();
    const s = setup();
    s.fetch.mockImplementationOnce(() => new Promise<Response>(() => {}));
    const candidate = createTronClassTextSubmissionCandidate({ ...s, timeoutMs: 20 });
    const rejected = expect(candidate.dispatch('firebase:fixture', input)).rejects.toMatchObject({ code: 'TRONCLASS_CANDIDATE_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(20);
    await rejected;
    const request = (s.fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(request.signal?.aborted).toBe(true);
    await expect(candidate.dispatch('firebase:fixture', input)).rejects.toMatchObject({ code: 'TRONCLASS_CANDIDATE_ALREADY_DISPATCHED' });
    expect(s.fetch).toHaveBeenCalledTimes(1);
  });

  it('cannot dispatch after authorization completes beyond the timeout', async () => {
    vi.useFakeTimers();
    const s = setup();
    let allow!: (value: TronClassCandidateAuthorization) => void;
    s.authorize.mockImplementationOnce(() => new Promise(resolve => { allow = resolve; }));
    const candidate = createTronClassTextSubmissionCandidate({ ...s, timeoutMs: 20 });
    const rejected = expect(candidate.dispatch('firebase:fixture', input)).rejects.toMatchObject({ code: 'TRONCLASS_CANDIDATE_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(20);
    await rejected;
    allow(authorization());
    await vi.runAllTimersAsync();
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it('allows only one of two concurrent attempts to reach the transport', async () => {
    const s = setup();
    const results = await Promise.allSettled([
      s.candidate.dispatch('firebase:fixture', input), s.candidate.dispatch('firebase:fixture', input),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(s.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('fixed candidate HTTP boundary', () => {
  const body = JSON.stringify({ comment: '合成內容', uploads: [], slides: [], is_draft: false,
    mode: 'normal', other_resources: [], uploads_in_rich_text: [] });
  const url = 'https://tronclass.pu.edu.tw/api/course/activities/20/submissions';
  function transport(status = 200, bytes = '{}', headers = { 'content-type': 'application/json' }) {
    const req = Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn(), destroy: vi.fn() });
    const request = vi.fn((_options, callback: (res: IncomingMessage) => void) => {
      req.end.mockImplementation(() => {
        const response = Object.assign(new EventEmitter(), { statusCode: status, headers });
        callback(response as IncomingMessage);
        response.emit('data', Buffer.from(bytes));
        response.emit('end');
      });
      return req as unknown as ClientRequest;
    });
    return { req, request, fetch: createTronClassCandidateFetch(request) };
  }
  it('uses IPv4 and sends the exact JSON bytes once', async () => {
    const s = transport();
    const response = await s.fetch(url, { method: 'POST', redirect: 'manual', body });
    expect(response.status).toBe(200);
    expect(s.request).toHaveBeenCalledTimes(1);
    expect(s.request.mock.calls[0][0]).toMatchObject({ hostname: 'tronclass.pu.edu.tw', family: 4, method: 'POST',
      path: '/api/course/activities/20/submissions', headers: { 'content-length': String(Buffer.byteLength(body)) } });
    expect(s.req.write).toHaveBeenCalledWith(body);
  });
  it.each([
    'https://untrusted.test/api/course/activities/20/submissions',
    'https://tronclass.pu.edu.tw/api/uploads',
    `${url}?other=1`, `${url}#fragment`,
    'https://tronclass.pu.edu.tw:443/api/course/activities/20/submissions',
  ])('never opens an unsupported target %s', async target => {
    const s = transport();
    await expect(s.fetch(target, { method: 'POST', redirect: 'manual', body })).rejects.toMatchObject({ code: 'TRONCLASS_PROTOCOL_INVALID_INPUT' });
    expect(s.request).not.toHaveBeenCalled();
  });
  it('does not accept a binary upload or attachment IDs through this text-only transport', async () => {
    const s = transport();
    await expect(s.fetch(url, { method: 'POST', redirect: 'manual', body: new Uint8Array([1]) })).rejects.toBeInstanceOf(NuniError);
    await expect(s.fetch(url, { method: 'POST', redirect: 'manual', body: JSON.stringify({ ...JSON.parse(body), uploads: [40] }) })).rejects.toBeInstanceOf(NuniError);
    expect(s.request).not.toHaveBeenCalled();
  });
  it('destroys an oversized response at the network boundary', async () => {
    const s = transport(200, 'x'.repeat(1024 * 1024 + 1));
    await expect(s.fetch(url, { method: 'POST', redirect: 'manual', body })).rejects.toMatchObject({ code: 'TRONCLASS_CANDIDATE_UNCONFIRMED' });
    expect(s.request).toHaveBeenCalledTimes(1);
    expect(s.req.destroy).toHaveBeenCalledTimes(1);
  });
  it('does not follow redirects or send the body a second time', async () => {
    const s = transport(302);
    const response = await s.fetch(url, { method: 'POST', redirect: 'manual', body });
    expect(response.status).toBe(302);
    expect(s.request).toHaveBeenCalledTimes(1);
    expect(s.req.write).toHaveBeenCalledTimes(1);
  });
});
