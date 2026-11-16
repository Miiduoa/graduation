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
const submissionPath = '/api/course/activities/202/submissions';
const readbackPath = '/api/activities/202/students/17/submission_list';
const uploadPath = '/private-storage/private-upload-token?signature=private-signature';
const json = (value) => ({ mimeType: 'application/json', text: JSON.stringify(value) });
const entry = (path, method = 'GET', response = {}, request, status = 200) => ({
  request: { url: `${origin}${path}`, method, ...(request === undefined ? {} : { postData: json(request) }) },
  response: { status, content: json(response) },
});
const har = (entries) => ({ log: { version: '1.2', entries } });
const finalBody = (overrides = {}) => ({
  comment: 'private-homework-text', uploads: [401], is_draft: false, mode: 'normal',
  slides: [], other_resources: [], uploads_in_rich_text: [], ...overrides,
});
const receipt = (overrides = {}) => ({
  id: 303, created_by: { id: 17 }, course_id: 101, activity_id: 202, group_id: null,
  is_draft: false, is_redo: false, submit_by_instructor: false, marked_submitted: false,
  is_latest_version: true, created_at: '2026-01-02T03:04:05Z', comment: 'private-homework-text',
  uploads: [{ id: 401, name: 'private-assignment.pdf', size: 18 }], ...overrides,
});
const responseOf = (capture, index) => JSON.parse(capture.log.entries[index].response.content.text);
const cloneEntry = (value) => JSON.parse(JSON.stringify(value));
const setResponse = (capture, index, value) => { capture.log.entries[index].response.content = json(value); };
const setRequest = (capture, index, value) => { capture.log.entries[index].request.postData = json(value); };
const chainOf = (capture) => analyzeHar(capture).homeworkEvidence.chains[0];

function trace() {
  const upload = entry('/api/uploads', 'POST', {
    id: 401, upload_url: `${origin}${uploadPath}`, storage_type: 'S3', transcoder: 'WRPC',
  }, { name: 'private-assignment.pdf', size: 18, parent_type: 'activity', parent_id: 202 });
  const binary = entry(uploadPath, 'PUT');
  binary.request.bodySize = 18;
  binary.request.postData = { mimeType: 'application/pdf', text: 'private-file-bytes' };
  return har([
    entry('/api/profile', 'GET', { id: 17, name: 'private-student-name' }),
    entry('/api/activities/202', 'GET', { id: 202, course_id: 101, type: 'homework', submit_by_group: false }),
    entry(readbackPath, 'GET', { list: [] }),
    upload,
    binary,
    entry('/internal-api/upload/callback/401', 'POST', {}, { file_key: 401 }),
    entry(submissionPath, 'POST', { submission: { id: 303 }, student: { id: 17 } }, finalBody()),
    entry(readbackPath, 'GET', { list: [receipt()] }),
  ]);
}

test('official metadata, exact same-origin PUT, callback, final and own history correlate only as offline observations', (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('network is forbidden'); });
  const report = analyzeHar(trace());
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(report.formatVersion, 2);
  assert.equal(report.contractVerified, false);
  assert.equal(report.evidenceLevel, 'untrusted_offline_trace_only');
  assert.deepEqual(report.homeworkEvidence.missingTracePhases, []);
  const chain = report.homeworkEvidence.chains[0];
  assert.deepEqual(chain.missingEvidence, []);
  for (const flag of ['uploadReferencesLinked', 'binaryPutAndPayloadObserved', 'requiredCallbacksObserved',
    'sameReceiptAndOwner', 'explicitStudentSubmittedState', 'latestVersionMatches',
    'sourceCreatedAtCaptured', 'newSubmissionOrDraftTransition']) assert.equal(chain.observed[flag], true, flag);
  assert.equal(chain.readbackState, 'submitted');
  assert.deepEqual(chain.linkedUploadEntries, [4]);
  assert.deepEqual(chain.linkedBinaryUploadEntries, [5]);
  assert.deepEqual(chain.linkedCallbackEntries, [6]);
  assert.equal(chain.linkedReadbackEntry, 8);
  assert.equal(report.entries[4].endpoint, '{sameOriginUploadUrl}');
  assert.equal(report.entries[4].requestBody.state, 'binary_body_omitted');
  assert.equal('submissionTimestamp' in chain.observed, false);
  assert.ok(report.manualReviewRequired.includes('actual_binary_upload_completion'));
  const output = JSON.stringify(report);
  for (const secret of ['private-upload-token', 'private-signature', 'private-assignment.pdf', 'private-file-bytes',
    'private-student-name', 'private-homework-text']) assert.equal(output.includes(secret), false, secret);
});

test('every arbitrary value and field name is omitted, including credentials, unknown keys and callback values', () => {
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
  const report = analyzeHar(har([sample, entry('/internal-api/upload/callback/938273', 'POST', {}, { file_key: secret })]));
  const output = JSON.stringify(report);
  for (const value of [secret, 'access_token', 'Cookie', 'Set-Cookie', '938273']) assert.equal(output.includes(value), false);
  assert.deepEqual(report.entries[0].responseBody.schema.properties.name, { type: 'string' });
  assert.equal(report.entries[0].responseBody.schema['x-omitted-field-count'], 1);
  assert.equal(report.entries[0].responseBody.schema.properties.data['x-omitted-field-count'], 1);
});

test('only fixed origin and allowlisted path templates are included without exposing numeric path IDs', () => {
  const urls = [
    'https://attacker.invalid/api/profile', 'http://tronclass.pu.edu.tw/api/profile',
    'https://user:password@tronclass.pu.edu.tw/api/profile', 'https://tronclass.pu.edu.tw:444/api/profile',
    `${origin}/api/courses/private-student/homework-activities`, `${origin}/api/private-token`,
    `${origin}/api/courses/101/../profile`, `${origin}/api/%70rofile`,
  ];
  const excluded = urls.map((url) => ({ ...entry('/api/profile'), request: { url, method: 'GET' } }));
  const report = analyzeHar(har([
    ...excluded, entry('/api/activities/184391/students/931887/submission_list?secret=private-query'),
    entry('/api/uploads/private-download-key/blob'),
  ]));
  assert.deepEqual(report.entryCounts, { total: 10, included: 2, ignored: 8 });
  const output = JSON.stringify(report);
  for (const secret of ['184391', '931887', 'private-query', 'private-download-key', 'password', 'attacker.invalid']) {
    assert.equal(output.includes(secret), false);
  }
  assert.equal(report.entries[0].endpoint, '/api/activities/{activityId}/students/{studentId}/submission_list');
});

test('legacy guessed paths and single or group readback remain visible but cannot establish the official chain', () => {
  const report = analyzeHar(har([
    entry('/api/courses/101/homework-activities/202/submissions', 'POST', { id: 303 }, { content: 'private-text' }),
    entry('/api/courses/101/homework-activities/202/student-submissions', 'GET', { submissions: [receipt()] }),
    entry('/api/activities/202/groups/99/submission_list', 'GET', { list: [receipt()] }),
    entry('/api/course/activities/202/students/17/submission', 'GET', receipt()),
  ]));
  assert.equal(report.entries.length, 4);
  assert.equal(report.homeworkEvidence.finalCandidates, 0);
  assert.deepEqual(report.homeworkEvidence.chains, []);
  assert.deepEqual(report.homeworkEvidence.unsupportedTraceKinds, [
    'legacy_submission_paths', 'group_submission_history', 'single_submission_as_complete_history',
  ]);
  assert.ok(report.homeworkEvidence.missingTracePhases.includes('final_trace_missing'));
});

test('HTTP 200 and an explicit final request without identity and own readback do not establish submission', () => {
  const report = analyzeHar(har([entry(submissionPath, 'POST', {}, finalBody())]));
  const chain = report.homeworkEvidence.chains[0];
  assert.equal(chain.observed.finalHttp2xx, true);
  assert.equal(chain.observed.sameReceiptAndOwner, false);
  for (const missing of ['profile_identity_missing', 'final_submission_id_missing', 'same_activity_readback_missing',
    'explicit_student_submitted_state_missing']) assert.ok(chain.missingEvidence.includes(missing));
  assert.equal(report.contractVerified, false);
});

test('draft and unknown is_draft requests are counted separately from final POST and PUT', () => {
  const report = analyzeHar(har([
    entry(submissionPath, 'POST', {}, finalBody({ is_draft: true })),
    entry(submissionPath, 'PUT', {}, finalBody({ is_draft: true, submission_id: 303 })),
    entry(submissionPath, 'POST', {}, { comment: 'private-text' }),
    entry(submissionPath, 'POST', {}, finalBody({ is_draft: 'false' })),
  ]));
  assert.deepEqual(report.entries.map((item) => item.submissionIntent), ['draft', 'draft', 'unknown', 'unknown']);
  assert.equal(report.homeworkEvidence.finalCandidates, 0);
  assert.equal(report.homeworkEvidence.draftCandidates, 2);
  assert.equal(report.homeworkEvidence.unknownSubmissionCandidates, 2);
  assert.deepEqual(report.homeworkEvidence.chains, []);
});

test('history distinguishes draft, returned, teacher markers and unknown without truthiness defaults', () => {
  const cases = [
    [{ is_draft: true }, 'draft'], [{ is_redo: true }, 'returned'],
    [{ is_draft: true, is_redo: true }, 'unknown'],
    [{ submit_by_instructor: true, marked_submitted: true, created_by: { id: 99 } }, 'teacher-marked'],
    [{ submit_by_instructor: true, marked_submitted: false }, 'unknown'],
    [{ is_draft: undefined }, 'unknown'], [{ is_redo: undefined }, 'unknown'],
    [{ submit_by_instructor: undefined }, 'unknown'], [{ is_latest_version: 'true' }, 'unknown'],
  ];
  for (const [change, state] of cases) {
    const capture = trace();
    setResponse(capture, 7, { list: [receipt(change)] });
    const report = analyzeHar(capture);
    const chain = report.homeworkEvidence.chains[0];
    assert.equal(chain.readbackState, state);
    assert.equal(chain.observed.explicitStudentSubmittedState, false);
    assert.ok(chain.missingEvidence.includes('explicit_student_submitted_state_missing'));
    assert.equal(report.entries[7].history.stateCounts[state], 1);
  }
});

test('PUT can correlate an observed own draft transition but cannot invent or replace its target', () => {
  const capture = trace();
  capture.log.entries[6].request.method = 'PUT';
  setRequest(capture, 6, finalBody({ submission_id: 303 }));
  setResponse(capture, 2, { list: [receipt({ is_draft: true })] });
  assert.deepEqual(chainOf(capture).missingEvidence, []);
  assert.equal(chainOf(capture).observed.putDraftTargetMatchesResponse, true);
  setResponse(capture, 2, { list: [receipt()] });
  assert.ok(chainOf(capture).missingEvidence.includes('new_submission_or_draft_transition_unproven'));
  for (const target of [undefined, '303', 304]) {
    setRequest(capture, 6, finalBody({ submission_id: target }));
    assert.ok(chainOf(capture).missingEvidence.includes('put_draft_target_missing_or_conflicting'));
  }
});

test('a prior submitted row is not the latest version when the school marks another version returned', () => {
  const capture = trace();
  setResponse(capture, 7, { list: [receipt({ is_latest_version: false }), receipt({ id: 304, is_redo: true })] });
  const report = analyzeHar(capture);
  assert.equal(report.entries[7].history.latestState, 'returned');
  assert.equal(report.homeworkEvidence.chains[0].observed.latestVersionMatches, false);
  assert.ok(report.homeworkEvidence.chains[0].missingEvidence.includes('latest_version_match_missing'));
  setResponse(capture, 7, { list: [receipt(), receipt({ id: 304 })] });
  assert.equal(chainOf(capture).observed.readbackShapeAndPaginationConsistent, false);
  assert.equal(chainOf(capture).linkedReadbackEntry, null);
});

test('identity, course, activity and group conflicts cannot be combined into an own receipt', () => {
  const changes = [
    (capture) => setResponse(capture, 7, { list: [receipt({ created_by: { id: 99 } })] }),
    (capture) => setResponse(capture, 7, { list: [receipt({ student_id: 99 })] }),
    (capture) => setResponse(capture, 7, { list: [receipt({ course_id: 999 })] }),
    (capture) => setResponse(capture, 7, { list: [receipt({ activity_id: 999 })] }),
    (capture) => setResponse(capture, 7, { list: [receipt({ group_id: 99 })] }),
    (capture) => { capture.log.entries[7].request.url = `${origin}/api/activities/202/students/99/submission_list`; },
    (capture) => { capture.log.entries.splice(7, 0, entry('/api/profile', 'GET', { id: 99 })); },
    (capture) => { capture.log.entries.splice(7, 0, entry('/api/profile', 'GET', {}, undefined, 401)); },
    (capture) => setResponse(capture, 0, {}),
  ];
  for (const change of changes) {
    const capture = trace(); change(capture);
    assert.equal(chainOf(capture).observed.sameReceiptAndOwner, false);
    assert.ok(chainOf(capture).missingEvidence.includes('same_receipt_and_owner_link_missing'));
  }
  const group = trace();
  setResponse(group, 1, { id: 202, course_id: 101, type: 'homework', submit_by_group: true });
  assert.ok(chainOf(group).missingEvidence.includes('individual_activity_missing_or_unsupported'));
  const different = trace();
  setResponse(different, 6, { submission: { id: 303 }, student: { id: 99 } });
  assert.ok(chainOf(different).missingEvidence.includes('final_response_student_conflict'));
});

test('an own top-level student cannot hide a conflicting owner in the final response submission', () => {
  for (const conflict of [
    { created_by: { id: 99 } }, { student_id: 99 }, { user_id: 99 },
    { student: { id: 99 } }, { user: { id: 99 } }, { created_by: null },
  ]) {
    const capture = trace();
    setResponse(capture, 6, { submission: { id: 303, ...conflict }, student: { id: 17 } });
    const chain = chainOf(capture);
    assert.equal(chain.observed.finalResponseStudentConsistent, false);
    assert.equal(chain.observed.sameReceiptAndOwner, false);
    assert.ok(chain.missingEvidence.includes('final_response_student_conflict'));
  }
  const envelope = trace();
  setResponse(envelope, 6, { submission: { id: 303 }, student: { id: 17 }, user_id: 99 });
  assert.ok(chainOf(envelope).missingEvidence.includes('final_response_student_conflict'));
});

test('every baseline row must belong to the observed personal scope before it can establish a new ID', () => {
  for (const conflict of [
    { created_by: { id: 99 } }, { student_id: 99 }, { course_id: 909 }, { activity_id: 808 },
    { course: { id: 909 } }, { activity: { id: 808 } }, { group_id: 99 }, { created_by: undefined },
    { created_by: { id: 99 }, submit_by_instructor: true, marked_submitted: true, student_id: 99 },
  ]) {
    const capture = trace();
    setResponse(capture, 2, { list: [receipt({ id: 999, ...conflict })] });
    const chain = chainOf(capture);
    assert.equal(chain.observed.prefinalHistoryObserved, false);
    assert.equal(chain.observed.newSubmissionOrDraftTransition, false);
    assert.ok(chain.missingEvidence.includes('prefinal_history_missing_or_incomplete'));
  }
  const teacher = trace();
  setResponse(teacher, 2, { list: [receipt({ id: 999, created_by: { id: 99 },
    submit_by_instructor: true, marked_submitted: true })] });
  assert.equal(chainOf(teacher).observed.prefinalHistoryObserved, true);
  assert.deepEqual(chainOf(teacher).missingEvidence, []);
});

test('facts from different receipts or duplicate IDs are never assembled into one success', () => {
  const capture = trace();
  setResponse(capture, 7, { list: [
    receipt({ created_by: { id: 99 }, is_latest_version: false }),
    receipt({ id: 304, is_latest_version: false }),
    receipt({ is_draft: true, uploads: [{ id: 402 }] }),
  ] });
  const chain = chainOf(capture);
  assert.equal(chain.observed.sameReceiptAndOwner, false);
  assert.equal(chain.observed.explicitStudentSubmittedState, false);
  assert.equal(chain.observed.attachmentReferencesInReadback, false);
});

test('metadata creation alone never supplies binary transfer or required callback evidence', () => {
  const capture = trace();
  capture.log.entries.splice(4, 2);
  const chain = chainOf(capture);
  assert.equal(chain.observed.uploadReferencesLinked, true);
  assert.equal(chain.observed.binaryPutAndPayloadObserved, false);
  assert.equal(chain.observed.requiredCallbacksObserved, false);
  assert.ok(chain.missingEvidence.includes('binary_put_observation_missing'));
  assert.ok(chain.missingEvidence.includes('upload_callback_observation_missing'));
});

test('binary association requires a preceding exact URL including its query and cannot expand external hosts', () => {
  for (const badUrl of [
    'https://storage.example.invalid/private-file?signature=private-secret',
    'https://tronclass.pu.edu.tw.attacker.invalid/private-file',
    'https://user:password@tronclass.pu.edu.tw/private-file',
    `${origin}/private/%2e%2e/storage`, `${origin}/private/../storage`,
    'http://tronclass.pu.edu.tw/private-file',
  ]) {
    const capture = trace();
    setResponse(capture, 3, { ...responseOf(capture, 3), upload_url: badUrl });
    capture.log.entries[4].request.url = badUrl;
    const report = analyzeHar(capture);
    assert.equal(report.homeworkEvidence.binaryPutCandidates, 0, badUrl);
    assert.equal(report.homeworkEvidence.chains[0].observed.binaryPutAndPayloadObserved, false);
    assert.equal(JSON.stringify(report).includes(badUrl), false);
  }
  const query = trace();
  query.log.entries[4].request.url += '-different';
  assert.equal(analyzeHar(query).homeworkEvidence.binaryPutCandidates, 0);
  const reordered = trace();
  [reordered.log.entries[3], reordered.log.entries[4]] = [reordered.log.entries[4], reordered.log.entries[3]];
  assert.equal(analyzeHar(reordered).homeworkEvidence.binaryPutCandidates, 0);
  const external = trace();
  setResponse(external, 3, { ...responseOf(external, 3), upload_url: 'https://storage.example.invalid/private-secret' });
  assert.ok(chainOf(external).missingEvidence.includes('cross_origin_upload_url_unsupported'));
});

test('duplicate metadata IDs or a shared URL cannot silently select a binary transfer', () => {
  const duplicate = trace();
  duplicate.log.entries.splice(4, 0, cloneEntry(duplicate.log.entries[3]));
  assert.ok(chainOf(duplicate).missingEvidence.includes('upload_metadata_reference_ambiguous'));
  const shared = trace();
  const other = cloneEntry(shared.log.entries[3]);
  other.response.content = json({ ...responseOf(shared, 3), id: 402 });
  shared.log.entries.splice(4, 0, other);
  assert.equal(chainOf(shared).observed.binaryPutAndPayloadObserved, false);
});

test('failed or unrecorded payload stages and intervening account switches cannot complete upload observations', () => {
  const changes = [
    (capture) => { capture.log.entries[3].response.status = 500; },
    (capture) => { capture.log.entries[4].response.status = 500; },
    (capture) => { capture.log.entries[4].request.bodySize = 1; },
    (capture) => { delete capture.log.entries[4].request.bodySize; },
    (capture) => { delete capture.log.entries[4].request.postData; },
    (capture) => { capture.log.entries.splice(4, 0,
      entry('/api/profile', 'GET', { id: 99 }), entry('/api/profile', 'GET', { id: 17 })); },
  ];
  for (const change of changes) {
    const capture = trace(); change(capture);
    assert.equal(chainOf(capture).observed.binaryPutAndPayloadObserved, false);
    assert.ok(chainOf(capture).missingEvidence.length > 0);
  }
});

test('explicit upload parent scope cannot point to another activity or silently enable unknown parent types', () => {
  for (const change of [
    { parent_type: 'activity', parent_id: 999 }, { parent_type: 'activity', parent_id: '202' },
    { parent_type: 'activity', parent_id: undefined }, { parent_type: 'unknown-parent', parent_id: 202 },
  ]) {
    const capture = trace();
    setRequest(capture, 3, { name: 'private-assignment.pdf', size: 18, ...change });
    const chain = chainOf(capture);
    assert.equal(chain.observed.uploadReferencesLinked, false);
    assert.equal(chain.uploads[0].observed.parentScopeConsistent, false);
    assert.ok(chain.missingEvidence.some((code) => code.startsWith('upload_parent_')));
  }
  const responseConflict = trace();
  setResponse(responseConflict, 3, { ...responseOf(responseConflict, 3), parent_type: 'activity', parent_id: 999 });
  assert.ok(chainOf(responseConflict).missingEvidence.includes('upload_parent_activity_mismatch'));
  const personalRoot = trace();
  setRequest(personalRoot, 3, { name: 'private-assignment.pdf', size: 18, parent_type: null, parent_id: 0 });
  assert.deepEqual(chainOf(personalRoot).missingEvidence, []);
});

test('unlisted same-origin 401 responses interrupt identity without exposing or allowing their paths', () => {
  for (const position of [4, 7]) {
    const capture = trace();
    capture.log.entries.splice(position, 0, entry('/api/private-person%40example.invalid/notifications', 'GET',
      { 'private-secret-field': 'private-body' }, undefined, 401));
    const report = analyzeHar(capture);
    const chain = report.homeworkEvidence.chains[0];
    assert.equal(report.entryCounts.ignored, 1);
    assert.equal(report.homeworkEvidence.unlistedSessionInterruptions, 1);
    assert.equal(chain.observed.sameReceiptAndOwner, false);
    assert.ok(chain.missingEvidence.includes('readback_identity_context_missing'));
    if (position === 4) {
      assert.equal(chain.observed.profileIdentityBeforeFinal, false);
      assert.ok(chain.missingEvidence.includes('profile_identity_missing'));
    }
    const output = JSON.stringify(report);
    for (const secret of ['private-person', 'notifications', 'private-secret-field', 'private-body']) {
      assert.equal(output.includes(secret), false);
    }
  }
});

test('foreign 401 responses do not change school identity and a fresh profile restores it for later observations', () => {
  const foreign = trace();
  const denied = entry('/api/private-notifications', 'GET', {}, undefined, 401);
  denied.request.url = 'https://unrelated.example.invalid/api/private-notifications';
  foreign.log.entries.splice(4, 0, denied);
  assert.equal(analyzeHar(foreign).homeworkEvidence.unlistedSessionInterruptions, 0);
  assert.deepEqual(chainOf(foreign).missingEvidence, []);
  const refreshed = trace();
  refreshed.log.entries.splice(1, 0, entry('/api/private-notifications', 'GET', {}, undefined, 401),
    entry('/api/profile', 'GET', { id: 17 }));
  assert.equal(analyzeHar(refreshed).homeworkEvidence.unlistedSessionInterruptions, 1);
  assert.deepEqual(chainOf(refreshed).missingEvidence, []);
});

test('callback must follow the linked binary, use the same numeric file_key and return 2xx', () => {
  const changes = [
    (capture) => setRequest(capture, 5, { file_key: '401' }),
    (capture) => setRequest(capture, 5, { file_key: 402 }),
    (capture) => { capture.log.entries[5].request.url = `${origin}/internal-api/upload/callback/402`; },
    (capture) => { capture.log.entries[5].response.status = 500; },
    (capture) => { [capture.log.entries[4], capture.log.entries[5]] = [capture.log.entries[5], capture.log.entries[4]]; },
  ];
  for (const change of changes) {
    const capture = trace(); change(capture);
    assert.equal(chainOf(capture).observed.requiredCallbacksObserved, false);
    assert.ok(chainOf(capture).missingEvidence.includes('upload_callback_observation_missing'));
  }
});

test('same-origin local multipart PUT is separate from metadata and does not require an S3 callback', () => {
  const capture = trace();
  setResponse(capture, 3, { ...responseOf(capture, 3), storage_type: 'LOCAL', transcoder: 'LOCAL' });
  capture.log.entries[4].request.postData = { mimeType: 'multipart/form-data; boundary=private-boundary',
    params: [{ name: 'file', fileName: 'private-assignment.pdf', value: 'private-file-bytes' }] };
  capture.log.entries.splice(5, 1);
  assert.deepEqual(chainOf(capture).missingEvidence, []);
  assert.deepEqual(chainOf(capture).linkedCallbackEntries, []);
  assert.ok(analyzeHar(capture).homeworkEvidence.missingTracePhases.includes('upload_callback_trace_missing'));
  capture.log.entries[4].request.postData.params.push({ name: 'file', fileName: 'private-extra.pdf' });
  assert.ok(chainOf(capture).missingEvidence.includes('binary_payload_metadata_missing'));
});

test('QINIU or missing storage information is explicitly unsupported even if PUT and callback exist', () => {
  for (const fields of [{ storage_type: 'QINIU' }, { storage_type: undefined }, { transcoder: undefined }]) {
    const capture = trace(); setResponse(capture, 3, { ...responseOf(capture, 3), ...fields });
    assert.ok(chainOf(capture).missingEvidence.includes('upload_storage_flow_unsupported'));
  }
});

test('all numeric attachment IDs and exact comment must agree, including extra and missing files', () => {
  const text = trace();
  setResponse(text, 7, { list: [receipt({ comment: 'private-old-text' })] });
  assert.equal(chainOf(text).observed.attachmentReferencesInReadback, true);
  assert.ok(chainOf(text).missingEvidence.includes('content_readback_link_missing'));
  for (const uploads of [[{ id: 402 }], [], [{ id: 401 }, { id: 402 }], [{ id: '401' }], [{ id: 401 }, { id: 401 }]]) {
    const capture = trace(); setResponse(capture, 7, { list: [receipt({ uploads })] });
    assert.equal(chainOf(capture).observed.attachmentReferencesInReadback, false);
  }
  for (const uploads of [['401'], [{ id: 401 }], [401, 401], undefined]) {
    const capture = trace(); setRequest(capture, 6, finalBody({ uploads }));
    assert.ok(chainOf(capture).missingEvidence.includes('final_upload_ids_missing_or_invalid'));
  }
});

test('a pre-final baseline is needed and a reused existing submission ID is not treated as a new POST', () => {
  const capture = trace();
  setResponse(capture, 2, { list: [receipt()] });
  assert.ok(chainOf(capture).missingEvidence.includes('new_submission_or_draft_transition_unproven'));
  capture.log.entries.splice(2, 1);
  assert.ok(chainOf(capture).missingEvidence.includes('prefinal_history_missing_or_incomplete'));
  const reversed = trace();
  [reversed.log.entries[6], reversed.log.entries[7]] = [reversed.log.entries[7], reversed.log.entries[6]];
  assert.equal(chainOf(reversed).observed.sameActivityReadbackAfterFinal, false);
  assert.equal(chainOf(reversed).linkedReadbackEntry, null);
});

test('later failure or returned history is not replaced by an earlier success and the next write ends an attempt', () => {
  const capture = trace();
  capture.log.entries.push(entry(readbackPath, 'GET', { list: [receipt({ is_redo: true })] }));
  assert.equal(chainOf(capture).readbackState, 'returned');
  capture.log.entries.push(entry(readbackPath, 'GET', {}, undefined, 403));
  assert.equal(chainOf(capture).observed.readbackHttp2xx, false);
  assert.equal(chainOf(capture).linkedReadbackEntry, null);
  const next = trace();
  next.log.entries.splice(7, 0, cloneEntry(next.log.entries[6]));
  assert.equal(analyzeHar(next).homeworkEvidence.chains[0].observed.sameActivityReadbackAfterFinal, false);
});

test('text-only final compares comment without exposing it or claiming attachment upload coverage', () => {
  const capture = trace();
  setRequest(capture, 6, finalBody({ uploads: [] }));
  setResponse(capture, 7, { list: [receipt({ uploads: [] })] });
  capture.log.entries.splice(3, 3);
  const report = analyzeHar(capture);
  assert.deepEqual(report.homeworkEvidence.chains[0].missingEvidence, []);
  assert.equal(report.homeworkEvidence.chains[0].observed.exactContentInReadback, true);
  assert.equal(report.homeworkEvidence.chains[0].observed.binaryPutAndPayloadObserved, false);
  assert.deepEqual(report.homeworkEvidence.missingTracePhases,
    ['upload_metadata_trace_missing', 'upload_binary_trace_missing', 'upload_callback_trace_missing']);
  assert.equal(JSON.stringify(report).includes('private-homework-text'), false);
});

test('nonstandard resources, malformed history and incomplete pagination retain explicit gaps', () => {
  for (const change of [{ mode: 'multiple' }, { slides: [12] }, { other_resources: [{ source: 'LARK' }] },
    { uploads_in_rich_text: [401] }, { slides: undefined }]) {
    const capture = trace(); setRequest(capture, 6, finalBody(change));
    assert.ok(chainOf(capture).missingEvidence.includes('nonstandard_resources_or_mode_unsupported'));
  }
  for (const body of [{ submissions: [receipt()] }, { list: [receipt()], total: 2 },
    { list: [receipt()], has_next: true }, { list: [receipt()], pagination: {} },
    { list: [receipt()], next_page: 2 }]) {
    const capture = trace(); setResponse(capture, 7, body);
    assert.ok(chainOf(capture).missingEvidence.includes('readback_shape_or_pagination_incomplete'));
  }
});

test('history, attachment and readback analysis limits never become silent complete evidence', () => {
  const rows = trace();
  setResponse(rows, 7, { list: Array.from({ length: LIMITS.receiptSamples + 1 }, (_, index) =>
    receipt({ id: 303 + index, is_latest_version: index === 0 })) });
  assert.ok(chainOf(rows).missingEvidence.includes('receipt_analysis_limit'));
  const files = trace();
  setRequest(files, 6, finalBody({ uploads: Array.from({ length: LIMITS.receiptSamples + 1 }, (_, index) => 401 + index) }));
  assert.ok(chainOf(files).missingEvidence.includes('attachment_analysis_limit'));
  const reads = trace();
  reads.log.entries.push(...Array.from({ length: LIMITS.evidenceReadbacks }, () => cloneEntry(reads.log.entries[7])));
  assert.ok(chainOf(reads).missingEvidence.includes('readback_analysis_limit'));
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
  const finals = Array.from({ length: LIMITS.evidenceFinals + 1 }, () => entry(submissionPath, 'POST', {}, finalBody()));
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
