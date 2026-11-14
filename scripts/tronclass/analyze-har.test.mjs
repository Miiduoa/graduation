import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, truncate, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { analyzeHar, analyzeHarFile, HarInputError, LIMITS } from './analyze-har.mjs';

const origin = 'https://tronclass.pu.edu.tw';
const submissionPath = '/api/courses/101/homework-activities/202/submissions';
const readbackPath = '/api/courses/101/homework-activities/202/student-submissions';
const json = (value) => ({ mimeType: 'application/json', text: JSON.stringify(value) });
const entry = (path, method = 'GET', response = {}, request, status = 200) => ({
  request: { url: `${origin}${path}`, method, ...(request === undefined ? {} : { postData: json(request) }) },
  response: { status, content: json(response) },
});
const har = (entries) => ({ log: { version: '1.2', entries } });

function trace() {
  const upload = entry('/api/uploads', 'POST', { key: 'private-upload-token' });
  upload.request.postData = {
    mimeType: 'multipart/form-data; boundary=private-boundary',
    params: [{ name: 'file', fileName: 'private-assignment.pdf', value: 'private-file-bytes' }],
  };
  return har([
    entry('/api/profile', 'GET', { id: 17, name: 'private-student-name' }),
    upload,
    entry(submissionPath, 'POST', { id: 303 }, { content: 'private-homework-text', attachments: [{ key: 'private-upload-token' }] }),
    entry(readbackPath, 'GET', { submissions: [{
      id: 303, student_id: 17, course_id: 101, activity_id: 202, status: 'submitted',
      submitted_at: '2026-01-02T03:04:05Z', content: 'private-homework-text',
      attachments: [{ key: 'private-upload-token' }],
    }] }),
  ]);
}

test('an offline correlated trace is observational and can never verify a school contract', (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('network is forbidden'); });
  const report = analyzeHar(trace());
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(report.contractVerified, false);
  assert.equal(report.evidenceLevel, 'untrusted_offline_trace_only');
  assert.deepEqual(report.homeworkEvidence.missingTracePhases, []);
  const chain = report.homeworkEvidence.chains[0];
  assert.deepEqual(chain.missingEvidence, []);
  assert.equal(chain.observed.uploadReferencesLinked, true);
  assert.equal(chain.observed.uploadFilePartMetadata, true);
  assert.equal(chain.observed.sameReceiptAndOwner, true);
  assert.equal(chain.observed.explicitSubmittedState, true);
  assert.deepEqual(chain.linkedUploadEntries, [2]);
  assert.equal(chain.linkedReadbackEntry, 4);
  assert.ok(report.manualReviewRequired.includes('actual_binary_upload_completion'));
  const output = JSON.stringify(report);
  for (const secret of ['private-upload-token', 'private-assignment.pdf', 'private-file-bytes', 'private-student-name', 'private-homework-text', 'private-boundary']) {
    assert.equal(output.includes(secret), false);
  }
});

test('every arbitrary value and field name is omitted, including credentials and nested keys', () => {
  const secret = 'secret-person@example.invalid';
  const sample = entry(`/api/profile?access_token=${secret}`, 'GET', {
    id: 17, name: secret, content: secret, [secret]: { id: secret },
    data: { [secret]: secret, attachments: [{ filename: secret, key: secret }] },
  }, { content: secret, answers: { [secret]: secret } });
  sample.request.headers = [{ name: secret, value: secret }, { name: 'Cookie', value: secret }];
  sample.request.cookies = [{ name: secret, value: secret }];
  sample.response.statusText = secret;
  sample.response.headers = [{ name: 'Set-Cookie', value: secret }];
  sample.pageref = secret;
  const report = analyzeHar(har([sample]));
  const output = JSON.stringify(report);
  assert.equal(output.includes(secret), false);
  assert.equal(output.includes('access_token'), false);
  assert.equal(output.includes('Cookie'), false);
  assert.equal(output.includes('Set-Cookie'), false);
  assert.deepEqual(report.entries[0].responseBody.schema.properties.name, { type: 'string' });
  assert.equal(report.entries[0].responseBody.schema['x-omitted-field-count'], 1);
  assert.equal(report.entries[0].responseBody.schema.properties.data['x-omitted-field-count'], 1);
});

test('only fixed origin and allowlisted path templates are included', () => {
  const urls = [
    'https://attacker.invalid/api/profile',
    'http://tronclass.pu.edu.tw/api/profile',
    'https://user:password@tronclass.pu.edu.tw/api/profile',
    'https://tronclass.pu.edu.tw:444/api/profile',
    `${origin}/api/courses/private-student/homework-activities`,
    `${origin}/api/private-token`,
    `${origin}/api/courses/101/../profile`,
    `${origin}/api/%70rofile`,
  ];
  const excluded = urls.map((url) => ({ ...entry('/api/profile'), request: { url, method: 'GET' } }));
  const report = analyzeHar(har([
    ...excluded,
    entry('/api/courses/184391/homework-activities/298411?student_id=931887'),
    entry('/api/uploads/private-download-key/blob'),
  ]));
  assert.deepEqual(report.entryCounts, { total: 10, included: 2, ignored: 8 });
  const output = JSON.stringify(report);
  for (const secret of ['184391', '298411', '931887', 'private-download-key', 'password', 'attacker.invalid']) {
    assert.equal(output.includes(secret), false);
  }
  assert.equal(report.entries[0].endpoint, '/api/courses/{courseId}/homework-activities/{activityId}');
});

test('HTTP 200 without final receipt identity and readback never establishes submission', () => {
  const report = analyzeHar(har([entry(submissionPath, 'POST', {}, { content: 'assignment' })]));
  const chain = report.homeworkEvidence.chains[0];
  assert.equal(chain.observed.finalHttp2xx, true);
  assert.equal(chain.observed.sameReceiptAndOwner, false);
  for (const missing of ['profile_identity_missing', 'final_submission_id_missing', 'same_activity_readback_missing', 'explicit_submitted_state_missing']) {
    assert.ok(chain.missingEvidence.includes(missing));
  }
  assert.equal(report.contractVerified, false);
});

test('a draft, missing status, another student, activity conflict or account switch fails correlation', () => {
  const changes = [
    (capture) => { capture.log.entries[3].response.content = json({ submissions: [{ id: 303, student_id: 17, status: 'draft' }] }); },
    (capture) => { capture.log.entries[3].response.content = json({ submissions: [{ id: 303, student_id: 17 }] }); },
    (capture) => { capture.log.entries[3].response.content = json({ submissions: [{ id: 303, student_id: 99, status: 'submitted' }] }); },
    (capture) => { capture.log.entries[3].response.content = json({ submissions: [{ id: 303, student_id: 17, course_id: 999, status: 'submitted' }] }); },
    (capture) => { capture.log.entries[3].request.url = `${origin}/api/courses/999/homework-activities/202/student-submissions`; },
    (capture) => { capture.log.entries.splice(3, 0, entry('/api/profile', 'GET', { id: 99 })); },
    (capture) => { capture.log.entries[0].response.content = json({}); },
  ];
  for (const change of changes) {
    const capture = trace();
    change(capture);
    const report = analyzeHar(capture);
    assert.equal(report.contractVerified, false);
    assert.ok(report.homeworkEvidence.chains[0].missingEvidence.length > 0);
  }
});

test('upload, final and readback references must match on the same receipt', () => {
  const capture = trace();
  capture.log.entries[1].response.content = json({ key: 'different-upload' });
  capture.log.entries[3].response.content = json({ submissions: [
    { id: 303, student_id: 99, status: 'submitted', attachments: [{ key: 'private-upload-token' }] },
    { id: 304, student_id: 17, status: 'submitted', attachments: [{ key: 'private-upload-token' }] },
    { id: 303, student_id: 17, status: 'draft', attachments: [{ key: 'different-upload' }] },
  ] });
  const chain = analyzeHar(capture).homeworkEvidence.chains[0];
  assert.equal(chain.observed.uploadReferencesLinked, false);
  assert.equal(chain.observed.explicitSubmittedState, false);
  assert.equal(chain.observed.attachmentReferencesInReadback, false);
  assert.ok(chain.missingEvidence.includes('upload_to_final_reference_link_missing'));
  assert.ok(chain.missingEvidence.includes('attachment_readback_link_missing'));
});

test('readback before final is not reused as a new submission receipt', () => {
  const capture = trace();
  [capture.log.entries[2], capture.log.entries[3]] = [capture.log.entries[3], capture.log.entries[2]];
  const chain = analyzeHar(capture).homeworkEvidence.chains[0];
  assert.equal(chain.observed.sameActivityReadbackAfterFinal, false);
  assert.equal(chain.linkedReadbackEntry, null);
});

test('matching files cannot hide mismatched text in a mixed content submission', () => {
  const capture = trace();
  const response = JSON.parse(capture.log.entries[3].response.content.text);
  response.submissions[0].content = 'old-different-content';
  capture.log.entries[3].response.content = json(response);
  const chain = analyzeHar(capture).homeworkEvidence.chains[0];
  assert.equal(chain.observed.attachmentReferencesInReadback, true);
  assert.equal(chain.observed.exactContentInReadback, false);
  assert.ok(chain.missingEvidence.includes('content_readback_link_missing'));
});

test('text-only readback compares content internally without exposing it or claiming upload coverage', () => {
  const report = analyzeHar(har([
    entry('/api/profile', 'GET', { id: 17 }),
    entry(submissionPath, 'POST', { id: 303 }, { content: 'private-answer' }),
    entry(readbackPath, 'GET', { submissions: [{ id: 303, student_id: 17, status: 'submitted', submitted_at: '2026-01-02T03:04:05Z', content: 'private-answer' }] }),
  ]));
  assert.equal(report.homeworkEvidence.chains[0].observed.exactContentInReadback, true);
  assert.deepEqual(report.homeworkEvidence.missingTracePhases, ['upload_trace_missing']);
  assert.equal(JSON.stringify(report).includes('private-answer'), false);
  assert.equal(report.contractVerified, false);
});

test('encoded, invalid, oversized and non-JSON bodies are safely omitted', () => {
  const bodies = [
    { ...json({ secret: 'encoded-secret' }), encoding: 'base64' },
    { mimeType: 'application/json', text: '{invalid-secret' },
    { mimeType: 'application/json', text: JSON.stringify('size-secret'.repeat(LIMITS.jsonBodyBytes)) },
    { mimeType: 'text/html', text: '<h1>login-secret</h1>' },
  ];
  const report = analyzeHar(har(bodies.map((body) => ({ ...entry('/api/profile'), response: { status: 200, content: body } }))));
  assert.deepEqual(report.entries.map((item) => item.responseBody.state), [
    'encoded_body_omitted', 'invalid_json_omitted', 'body_size_limit', 'non_json_body_omitted',
  ]);
  for (const secret of ['encoded-secret', 'invalid-secret', 'size-secret', 'login-secret']) {
    assert.equal(JSON.stringify(report).includes(secret), false);
  }
});

test('schema traversal and evidence matching are bounded and explicitly truncated', () => {
  let deep = { content: 'private-deep-value' };
  for (let depth = 0; depth < 1000; depth++) deep = { data: deep };
  const report = analyzeHar(har([entry('/api/profile', 'GET', deep)]));
  assert.ok(JSON.stringify(report).includes('x-truncated'));
  assert.equal(JSON.stringify(report).includes('private-deep-value'), false);
  const finals = Array.from({ length: LIMITS.evidenceFinals + 1 }, () => entry(submissionPath, 'POST'));
  const bounded = analyzeHar(har(finals));
  assert.equal(bounded.homeworkEvidence.chainAnalysisTruncated, true);
  assert.equal(bounded.homeworkEvidence.chains.length, LIMITS.evidenceFinals);
});

test('file and entry limits, invalid input and errors do not expose paths or file contents', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'tronclass-har-test-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const goodPath = join(folder, 'private-student.har');
  await writeFile(goodPath, JSON.stringify(trace()));
  assert.equal((await analyzeHarFile(goodPath)).contractVerified, false);
  await assert.rejects(analyzeHarFile('https://private-token.invalid/data.har'), { code: 'local_file_required' });
  const badPath = join(folder, 'private-password.har');
  await writeFile(badPath, '{private-password');
  await assert.rejects(analyzeHarFile(badPath), { code: 'invalid_har_json' });
  assert.throws(() => analyzeHar({ log: {} }), { code: 'invalid_har' });
  assert.throws(() => analyzeHar(har(new Array(LIMITS.entries + 1))), { code: 'entry_limit_exceeded' });
  const largePath = join(folder, 'large.har');
  await writeFile(largePath, '');
  await truncate(largePath, LIMITS.fileBytes + 1);
  await assert.rejects(analyzeHarFile(largePath), { code: 'file_size_limit_exceeded' });
  const directoryPath = join(folder, 'directory');
  await mkdir(directoryPath);
  await assert.rejects(analyzeHarFile(directoryPath), { code: 'regular_file_required' });
  const linkPath = join(folder, 'link.har');
  await symlink(goodPath, linkPath);
  await assert.rejects(analyzeHarFile(linkPath), { code: 'local_file_read_failed' });
  await assert.rejects(analyzeHarFile(join(folder, 'missing-private-name.har')), (error) => {
    assert.ok(error instanceof HarInputError);
    assert.equal(error.message, 'local_file_read_failed');
    return true;
  });
  const cli = fileURLToPath(new URL('./analyze-har.mjs', import.meta.url));
  const failed = spawnSync(process.execPath, ['--no-warnings', cli, badPath], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } });
  assert.equal(failed.status, 1);
  assert.equal(failed.stdout, '');
  assert.deepEqual(JSON.parse(failed.stderr), { error: 'invalid_har_json' });
  assert.equal(failed.stderr.includes(badPath), false);
  const passed = spawnSync(process.execPath, ['--no-warnings', cli, goodPath], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } });
  assert.equal(passed.status, 0);
  assert.equal(JSON.parse(passed.stdout).contractVerified, false);
  assert.equal(passed.stdout.includes('private-'), false);
});
