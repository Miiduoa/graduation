import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

// Exercise the real HTTP/PostgREST boundary used by supabase-js. This intentionally
// uses no SDK mocks and no hosted project credentials. It does not exercise Auth,
// Storage uploads, external push delivery, or the unfinished LMS UI write tools.
const base = new URL(`${(process.env.CAMPUS_TEST_API_URL || '').replace(/\/$/, '')}/`);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'API tests require a loopback URL');
assert.equal(base.protocol, 'http:', 'API tests require the disposable local HTTP server');
assert.equal(base.username + base.password, '', 'Credentials in the API URL are not allowed');
const secret = process.env.CAMPUS_TEST_JWT_SECRET;
assert.ok(secret && secret.length >= 32, 'CAMPUS_TEST_JWT_SECRET must be the local test JWT secret');

const uuid = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ids = {
  admin: uuid('00000000', 1), teacher: uuid('00000000', 2), a: uuid('00000000', 3),
  b: uuid('00000000', 4), outsider: uuid('00000000', 5),
  courseA: uuid('10000000', 1), courseB: uuid('10000000', 2),
  assignmentA: uuid('20000000', 1), assignmentB: uuid('20000000', 2),
  assignmentNew: uuid('20000000', 3),
  submissionA: uuid('30000000', 1), submissionB: uuid('30000000', 2),
  submissionOutside: uuid('30000000', 3), submissionLate: uuid('30000000', 4),
  quizGradeItem: uuid('50000000', 3),
  scoreA: uuid('60000000', 1), scoreB: uuid('60000000', 2),
  quizA: uuid('72000000', 1), quizB: uuid('72000000', 2), questionA: uuid('73000000', 1),
  questionA2: uuid('73000000', 3), attemptSeedA: uuid('74000000', 1),
  noticeA: uuid('80000000', 1), noticeB: uuid('80000000', 2),
  exportJob: uuid('90000000', 1), reportJob: uuid('91000000', 1),
  liveA: uuid('b0000000', 1), surveyA: uuid('c0000000', 1), webhook: uuid('d1000000', 1),
  rubricA: uuid('e0000000', 1), rubricB: uuid('e0000000', 2), rubricPeer: uuid('e0000000', 3),
  rubricOtherAssignment: uuid('e0000000', 4), criterionA: uuid('e1000000', 1), criterionPeer: uuid('e1000000', 2),
  pairA: uuid('f1000000', 1), pairB: uuid('f1000000', 2), pairOutside: uuid('f1000000', 3), pairExpired: uuid('f1000000', 4),
};
function token(identity) {
  const now = Math.floor(Date.now() / 1000);
  const claims = { role: identity === 'service' ? 'service_role' : identity === 'anon' ? 'anon' : 'authenticated', iat: now, exp: now + 3600 };
  if (ids[identity]) Object.assign(claims, { sub: ids[identity], aud: 'authenticated' });
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}`;
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
}
async function request(identity, path, { method = 'GET', body, prefer } = {}) {
  const headers = { Authorization: `Bearer ${token(identity)}`, Accept: 'application/json' };
  if (process.env.CAMPUS_TEST_ANON_KEY) headers.apikey = process.env.CAMPUS_TEST_ANON_KEY;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  const response = await fetch(new URL(path, base), {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000), redirect: 'error',
  });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  return { status: response.status, data, headers: response.headers };
}
function succeeds(result, statuses = [200, 201, 204]) {
  assert.ok(statuses.includes(result.status), `HTTP ${result.status}: ${JSON.stringify(result.data)}`);
  return result.data;
}
function denied(result) {
  assert.ok([401, 403].includes(result.status), `Expected permission denial, got HTTP ${result.status}: ${JSON.stringify(result.data)}`);
  assert.equal(result.data?.code, '42501');
}
function rpcDenied(result) {
  // PostgREST versions can hide non-executable functions from the schema cache.
  assert.ok([401, 403, 404].includes(result.status), `Expected RPC denial, got HTTP ${result.status}: ${JSON.stringify(result.data)}`);
  assert.ok(['42501', 'PGRST202'].includes(result.data?.code), JSON.stringify(result.data));
}
const rpc = (identity, name, body = {}) => request(identity, `rpc/${name}`, { method: 'POST', body });
const values = (rows, column) => [...new Set(rows.map((row) => row[column]))].sort();

test('anonymous readers see only the explicit public catalogue projection', async (t) => {
  const catalogue = succeeds(await request('anon', 'public_course_catalog?select=*'));
  assert.deepEqual(values(catalogue, 'id'), [ids.courseA]);
  assert.equal(catalogue[0].title, 'Permissions course A');
  for (const key of ['owner_id', 'enrollment_code', 'created_at']) assert.equal(key in catalogue[0], false);
  for (const table of ['courses', 'profiles', 'course_members', 'submissions', 'grade_scores', 'notifications', 'push_tokens', 'course_grade_rollups']) {
    await t.test(`${table} remains inaccessible`, async () => denied(await request('anon', `${table}?select=*&limit=1`)));
  }
  const anonymousStart = await rpc('anon', 'start_quiz_attempt', { p_quiz_id: ids.quizA });
  assert.ok([400, 401, 403, 404].includes(anonymousStart.status));
  assert.ok(['P0001', '42501', 'PGRST202'].includes(anonymousStart.data?.code));
});

test('authenticated course queries and embedded relationships keep course isolation', async () => {
  const rows = succeeds(await request('a', 'course_members?select=course_id,user_id,role,profiles(display_name),courses(title)&order=user_id'));
  assert.deepEqual(values(rows, 'course_id'), [ids.courseA]);
  assert.deepEqual(values(rows, 'user_id'), [ids.teacher, ids.a, ids.b].sort());
  assert.ok(rows.every((row) => row.profiles?.display_name && row.courses?.title === 'Permissions course A'));
  assert.deepEqual(values(succeeds(await request('a', 'courses?select=id,title')), 'id'), [ids.courseA]);
  assert.deepEqual(values(succeeds(await request('outsider', 'courses?select=id,title')), 'id'), [ids.courseB]);
  assert.deepEqual(succeeds(await request('a', `courses?id=eq.${ids.courseB}&select=*`)), []);
  const head = await request('a', 'courses?select=id', { method: 'HEAD', prefer: 'count=exact' });
  succeeds(head, [200]);
  assert.match(head.headers.get('content-range') || '', /\/1$/);
});

test('same-course students cannot read each other\'s submissions, grades, tokens, or notifications', async () => {
  for (const identity of ['a', 'b']) {
    for (const [table, owner] of [['submissions', 'student_id'], ['grade_scores', 'student_id'], ['push_tokens', 'user_id'], ['notifications', 'user_id']]) {
      const rows = succeeds(await request(identity, `${table}?select=*`));
      assert.ok(rows.length > 0, `${identity}: expected seeded ${table}`);
      assert.deepEqual(values(rows, owner), [ids[identity]], `${identity}: ${table}`);
    }
  }
  assert.deepEqual(succeeds(await request('a', `submissions?id=eq.${ids.submissionB}&select=*`)), []);
});

test('upsert with returned representation works for the owner and rejects forged ownership', async () => {
  const body = { assignment_id: ids.assignmentA, student_id: ids.a, body_text: 'Updated through PostgREST upsert' };
  const own = succeeds(await request('a', 'submissions?on_conflict=assignment_id,student_id&select=id,student_id,body_text', {
    method: 'POST', body, prefer: 'resolution=merge-duplicates,return=representation',
  }));
  assert.equal(own[0].id, ids.submissionA);
  assert.equal(own[0].body_text, body.body_text);
  denied(await request('a', 'submissions?on_conflict=assignment_id,student_id', {
    method: 'POST', body: { ...body, student_id: ids.b }, prefer: 'resolution=merge-duplicates,return=representation',
  }));
  denied(await request('a', `submissions?id=eq.${ids.submissionA}`, {
    method: 'PATCH', body: { student_id: ids.outsider }, prefer: 'return=representation',
  }));
  assert.equal(succeeds(await request('b', `submissions?id=eq.${ids.submissionB}&select=body_text`))[0].body_text, 'Private submission B');
});

test('teachers retain course authoring and grading, while students and other-course teachers cannot write', async () => {
  const body = { course_id: ids.courseA, title: 'Temporary authoring test', created_by: ids.teacher };
  denied(await request('a', 'assignments', { method: 'POST', body: { ...body, created_by: ids.a } }));
  const created = succeeds(await request('teacher', 'assignments?select=id', { method: 'POST', body, prefer: 'return=representation' }));
  assert.ok(created[0].id);
  succeeds(await request('teacher', `assignments?id=eq.${created[0].id}`, { method: 'DELETE' }));
  const grades = succeeds(await request('teacher', 'grade_scores?select=student_id,score'));
  assert.deepEqual(values(grades, 'student_id'), [ids.a, ids.b].sort());
  assert.equal(succeeds(await request('teacher', `grade_scores?id=eq.${ids.scoreA}`, {
    method: 'PATCH', body: { score: 82 }, prefer: 'return=representation',
  }))[0].score, 82);
  assert.deepEqual(succeeds(await request('teacher', `assignments?id=eq.${ids.assignmentB}`, {
    method: 'PATCH', body: { title: 'Forbidden edit' }, prefer: 'return=representation',
  })), []);
  assert.equal(succeeds(await rpc('teacher', 'course_member_has_capability', { p_course_id: ids.courseA, p_capability_slug: 'assignments.grade' })), true);
  assert.equal(succeeds(await rpc('a', 'course_member_has_capability', { p_course_id: ids.courseA, p_capability_slug: 'assignments.grade' })), false);
});

test('students can submit and edit content without creating grades or moving graded rows', async () => {
  const gradingFields = { grade: 999, feedback: 'Forged grader feedback', graded_at: new Date().toISOString(), graded_by: ids.a };
  for (const [field, value] of Object.entries(gradingFields)) {
    denied(await request('a', `submissions?id=eq.${ids.submissionA}`, {
      method: 'PATCH', body: { [field]: value }, prefer: 'return=representation',
    }));
    denied(await request('a', 'submissions', {
      method: 'POST', body: { assignment_id: ids.assignmentNew, student_id: ids.a, body_text: 'Forged first submission', [field]: value },
    }));
  }
  const first = succeeds(await request('a', 'submissions?select=id,grade,student_id', {
    method: 'POST', body: { assignment_id: ids.assignmentNew, student_id: ids.a, body_text: 'Ordinary first submission' },
    prefer: 'return=representation',
  }));
  assert.equal(first[0].grade, null);
  assert.equal(first[0].student_id, ids.a);
  // Content-only upserts are exercised above. PATCH may echo an unchanged grade.
  const unchanged = succeeds(await request('a', `submissions?id=eq.${ids.submissionA}&select=grade,body_text`, {
    method: 'PATCH', body: { grade: 82, body_text: 'Content edit preserves authorized grade' }, prefer: 'return=representation',
  }))[0];
  assert.equal(unchanged.grade, 82);
  const graded = succeeds(await request('teacher', `submissions?id=eq.${ids.submissionA}&select=grade,feedback,graded_by`, {
    method: 'PATCH', body: { grade: 84, feedback: 'Teacher feedback', graded_by: ids.teacher, graded_at: new Date().toISOString() },
    prefer: 'return=representation',
  }))[0];
  assert.equal(graded.grade, 84);
  assert.equal(graded.graded_by, ids.teacher);
  for (const identity of ['a', 'teacher']) {
    for (const changedIdentity of [{ assignment_id: ids.assignmentNew }, { student_id: ids.b }]) {
      denied(await request(identity, `submissions?id=eq.${ids.submissionA}`, { method: 'PATCH', body: changedIdentity }));
    }
  }
  succeeds(await request('teacher', `submissions?id=eq.${ids.submissionA}`, {
    method: 'PATCH', body: { grade: 82, feedback: null, graded_at: null, graded_by: null },
  }));
  assert.equal(succeeds(await request('b', `submissions?id=eq.${ids.submissionB}&select=grade`))[0].grade, 65);
});

test('peer reviews require the assigned pending reviewer and reject replay without extra rows', async () => {
  const input = { p_pair_id: ids.pairA, p_scores: { clarity: 3 }, p_comment: 'Assigned review' };
  for (const identity of ['b', 'outsider', 'teacher']) denied(await rpc(identity, 'submit_peer_review', input));
  denied(await rpc('a', 'submit_peer_review', { ...input, p_pair_id: ids.pairB }));
  denied(await rpc('a', 'submit_peer_review', { ...input, p_pair_id: ids.pairExpired }));
  assert.deepEqual(succeeds(await request('teacher', 'peer_review_responses?select=id')), []);
  const responseId = succeeds(await rpc('a', 'submit_peer_review', input));
  assert.match(responseId, /^[0-9a-f-]{36}$/);
  denied(await rpc('a', 'submit_peer_review', input));
  const rows = succeeds(await request('teacher', `peer_review_responses?pair_id=eq.${ids.pairA}&select=id,comment`));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, responseId);
  assert.equal(rows[0].comment, input.p_comment);
  assert.equal(succeeds(await request('a', `peer_review_pairs?id=eq.${ids.pairA}&select=status`))[0].status, 'submitted');
  assert.equal(succeeds(await request('b', `peer_review_pairs?id=eq.${ids.pairB}&select=status`))[0].status, 'pending');
  assert.deepEqual(succeeds(await request('outsider', `peer_review_responses?id=eq.${responseId}&select=*`)), []);
});

test('rubric scoring requires grader capability and matching course, target kind, and binding', async () => {
  const input = { p_rubric_id: ids.rubricA, p_target_kind: 'submission', p_target_id: ids.submissionA,
    p_scores: { [ids.criterionA]: 3 }, p_comment: 'Authorized rubric score' };
  for (const identity of ['a', 'b', 'outsider']) denied(await rpc(identity, 'submit_rubric_score', input));
  for (const identity of ['teacher', 'admin']) {
    denied(await rpc(identity, 'submit_rubric_score', { ...input, p_target_id: ids.submissionOutside }));
    denied(await rpc(identity, 'submit_rubric_score', { ...input, p_rubric_id: ids.rubricOtherAssignment }));
    denied(await rpc(identity, 'submit_rubric_score', { ...input, p_target_kind: 'peer_review_pair', p_target_id: ids.pairA }));
  }
  denied(await rpc('teacher', 'submit_rubric_score', { ...input, p_rubric_id: ids.rubricB, p_target_id: ids.submissionOutside }));
  for (const identity of ['a', 'teacher']) denied(await request(identity, 'rubric_scores', {
    method: 'POST', body: { rubric_id: ids.rubricA, target_kind: 'submission', target_id: ids.submissionA,
      scorer_id: ids[identity], total_points: 999 },
  }));
  assert.deepEqual(succeeds(await request('admin', 'rubric_scores?select=id')), []);
  assert.equal(succeeds(await rpc('teacher', 'submit_rubric_score', input)), 6);
  assert.equal(succeeds(await rpc('teacher', 'submit_rubric_score', { ...input, p_scores: { [ids.criterionA]: 999 } })), 8);
  const rows = succeeds(await request('teacher', `rubric_scores?rubric_id=eq.${ids.rubricA}&select=id,total_points,scorer_id`));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].total_points, 8);
  assert.equal(rows[0].scorer_id, ids.teacher);
  denied(await request('teacher', `rubric_scores?id=eq.${rows[0].id}`, { method: 'PATCH', body: { total_points: 999 } }));
  assert.deepEqual(succeeds(await request('a', `rubric_scores?id=eq.${rows[0].id}&select=*`)), []);
  const peer = { p_rubric_id: ids.rubricPeer, p_target_kind: 'peer_review_pair', p_target_id: ids.pairA,
    p_scores: { [ids.criterionPeer]: 2 }, p_comment: 'Authorized peer rubric' };
  denied(await rpc('teacher', 'submit_rubric_score', { ...peer, p_target_id: ids.pairOutside }));
  assert.equal(succeeds(await rpc('teacher', 'submit_rubric_score', peer)), 2);
});

test('late-penalty calculation preserves results without leaking another student or course grade', async () => {
  for (const [identity, submission] of [['a', ids.submissionB], ['b', ids.submissionA],
    ['outsider', ids.submissionA], ['teacher', ids.submissionOutside]]) {
    denied(await rpc(identity, 'apply_late_penalty', { p_submission_id: submission }));
  }
  for (const identity of ['a', 'teacher']) assert.equal(succeeds(await rpc(identity, 'apply_late_penalty', {
    p_submission_id: ids.submissionLate,
  })), 64);
  assert.equal(succeeds(await rpc('a', 'apply_late_penalty', { p_submission_id: ids.submissionA })), 82);
  assert.equal(succeeds(await request('a', `submissions?id=eq.${ids.submissionLate}&select=grade`))[0].grade, 80);
});

test('ordinary profile edits succeed but self-promotion and peer modification are blocked', async () => {
  assert.equal(succeeds(await request('a', `profiles?id=eq.${ids.a}&select=display_name`, {
    method: 'PATCH', body: { display_name: 'Student A updated' }, prefer: 'return=representation',
  }))[0].display_name, 'Student A updated');
  for (const role of ['teacher', 'admin']) denied(await request('a', `profiles?id=eq.${ids.a}`, {
    method: 'PATCH', body: { role }, prefer: 'return=representation',
  }));
  assert.deepEqual(succeeds(await request('a', `profiles?id=eq.${ids.b}`, {
    method: 'PATCH', body: { display_name: 'Forbidden peer edit' }, prefer: 'return=representation',
  })), []);
  assert.equal(succeeds(await request('a', `profiles?id=eq.${ids.a}&select=role`))[0].role, 'student');
});

test('audit records and server-maintained logs cannot be forged by authenticated users', async () => {
  for (const identity of ['a', 'teacher', 'admin']) denied(await request(identity, 'audit_logs', {
    method: 'POST', body: { actor_id: ids[identity], action: 'forged', entity_type: 'test', payload: {} },
  }));
  denied(await request('a', 'notification_push_logs', {
    method: 'POST', body: { notification_id: ids.noticeA, status: 'success' },
  }));
  assert.deepEqual(succeeds(await request('a', 'audit_logs?select=id')), []);
  assert.ok(succeeds(await request('admin', 'audit_logs?select=id')).length > 0, 'grade fixtures generated audit rows');
});

test('RPC-only tables reject direct client writes even when a row policy exists', async (t) => {
  const keys = {
    survey_responses: 'id', peer_review_responses: 'id', rubric_scores: 'id',
    xapi_statements: 'id', learning_time_entries: 'id', announcement_reads: 'announcement_id', ai_consent_log: 'id',
  };
  for (const [table, key] of Object.entries(keys)) {
    await t.test(table, async () => {
      denied(await request('a', table, { method: 'POST', body: {} }));
      // Supply a real key filter so Supabase safeupdate lets the ACL check run.
      // This absent fixture key also avoids deleting data if a grant regresses.
      denied(await request('a', `${table}?${key}=eq.00000000-0000-0000-0000-000000000000`, { method: 'DELETE' }));
    });
  }
});

test('survey and learning-time RPCs remain usable without direct INSERT privileges', async () => {
  const responseId = succeeds(await rpc('a', 'submit_survey_response', { p_survey_id: ids.surveyA, p_answers: { experience: 'clear' } }));
  assert.match(responseId, /^[0-9a-f-]{36}$/);
  assert.equal(succeeds(await request('a', `survey_responses?id=eq.${responseId}&select=respondent_id`))[0].respondent_id, ids.a);
  assert.deepEqual(succeeds(await request('b', `survey_responses?id=eq.${responseId}&select=id`)), []);
  const outside = await rpc('outsider', 'submit_survey_response', { p_survey_id: ids.surveyA, p_answers: {} });
  assert.equal(outside.status, 400);
  assert.equal(outside.data?.code, 'P0001');
  const entryId = succeeds(await rpc('a', 'record_learning_time', {
    p_course_id: ids.courseA, p_activity_kind: 'misc', p_ref_id: null, p_duration_seconds: 60,
  }));
  assert.equal(succeeds(await request('a', `learning_time_entries?id=eq.${entryId}&select=user_id,duration_seconds`))[0].duration_seconds, 60);
  assert.deepEqual(succeeds(await request('b', `learning_time_entries?id=eq.${entryId}&select=id`)), []);
});

test('attendance uses its time-window RPC, preserving the intentional direct-insert restriction', async () => {
  denied(await request('a', 'live_attendance', { method: 'POST', body: { session_id: ids.liveA, user_id: ids.a, status: 'present' } }));
  assert.equal(succeeds(await rpc('a', 'record_live_attendance', { p_session_id: ids.liveA })), 'present');
  const outsider = await rpc('outsider', 'record_live_attendance', { p_session_id: ids.liveA });
  assert.equal(outsider.status, 400);
  assert.equal(outsider.data?.code, 'P0001');
  assert.equal(succeeds(await request('teacher', `live_attendance?session_id=eq.${ids.liveA}&user_id=eq.${ids.b}`, {
    method: 'PATCH', body: { status: 'late' }, prefer: 'return=representation',
  }))[0].status, 'late');
});

test('quiz attempts use start/submit RPCs, while answer upserts and teacher-only solutions retain their contracts', async () => {
  denied(await request('a', 'quiz_attempts', {
    method: 'POST', body: { quiz_id: ids.quizA, student_id: ids.a, score: 999, attempt_no: 2 },
  }));
  const attemptId = succeeds(await rpc('a', 'start_quiz_attempt', { p_quiz_id: ids.quizA }));
  assert.match(attemptId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(succeeds(await request('a', 'quiz_question_solutions?select=*')), []);
  assert.equal(succeeds(await request('teacher', `quiz_question_solutions?question_id=eq.${ids.questionA}&select=correct_answer`))[0].correct_answer, 'A');
  const answer = { attempt_id: attemptId, question_id: ids.questionA, answer: 'A' };
  denied(await request('a', 'quiz_answers', { method: 'POST', body: { ...answer, manual_score: 999 } }));
  const answers = succeeds(await request('a', 'quiz_answers?on_conflict=attempt_id,question_id&select=attempt_id,answer', {
    method: 'POST', body: answer, prefer: 'resolution=merge-duplicates,return=representation',
  }));
  assert.equal(answers[0].attempt_id, attemptId);
  const ownAnswer = `quiz_answers?attempt_id=eq.${attemptId}&question_id=eq.${ids.questionA}`;
  denied(await request('a', ownAnswer, { method: 'PATCH', body: { manual_score: 999 } }));
  denied(await request('a', ownAnswer, { method: 'PATCH', body: { question_id: ids.questionA2 } }));
  denied(await request('a', ownAnswer, { method: 'PATCH', body: { attempt_id: ids.attemptSeedA } }));
  const studentManualGrade = await rpc('a', 'set_quiz_manual_score', { p_attempt_id: attemptId, p_question_id: ids.questionA, p_score: 999 });
  assert.equal(studentManualGrade.status, 400);
  assert.equal(studentManualGrade.data?.code, 'P0001');
  succeeds(await rpc('teacher', 'set_quiz_manual_score', { p_attempt_id: attemptId, p_question_id: ids.questionA, p_score: 3 }));
  assert.equal(succeeds(await request('a', `${ownAnswer}&select=manual_score`, {
    method: 'PATCH', body: { answer: 'A', manual_score: 3 }, prefer: 'return=representation',
  }))[0].manual_score, 3);
  // The ordinary answer upsert must not erase a manual score it did not supply.
  assert.equal(succeeds(await request('a', 'quiz_answers?on_conflict=attempt_id,question_id&select=manual_score', {
    method: 'POST', body: answer, prefer: 'resolution=merge-duplicates,return=representation',
  }))[0].manual_score, 3);
  denied(await request('b', 'quiz_answers?on_conflict=attempt_id,question_id', {
    method: 'POST', body: { ...answer, answer: 'B' }, prefer: 'resolution=merge-duplicates',
  }));
  denied(await request('a', `quiz_attempts?id=eq.${attemptId}`, { method: 'PATCH', body: { score: 999 } }));
  assert.equal(succeeds(await rpc('a', 'submit_quiz_attempt', { p_attempt_id: attemptId })), 10);
  assert.equal(succeeds(await request('a', `quiz_attempts?id=eq.${attemptId}&select=score`))[0].score, 10);
  assert.deepEqual(succeeds(await request('b', `quiz_attempts?id=eq.${attemptId}&select=*`)), []);
});

test('quiz gradebook writes use the owned-attempt RPC and reject client-supplied scores', async () => {
  const path = `grade_scores?grade_item_id=eq.${ids.quizGradeItem}&student_id=eq.${ids.a}`;
  assert.deepEqual(succeeds(await request('a', `${path}&select=id`)), []);
  denied(await request('a', 'grade_scores', {
    method: 'POST', body: { grade_item_id: ids.quizGradeItem, student_id: ids.a, score: 999 },
  }));
  // A role claim without sub must not bypass a SQL NULL identity comparison.
  for (const identity of ['b', 'outsider', 'missing-sub']) {
    const result = await rpc(identity, 'sync_quiz_gradebook_from_attempt', { p_attempt_id: ids.attemptSeedA });
    assert.equal(result.status, 400);
    assert.equal(result.data?.code, 'P0001');
  }
  assert.deepEqual(succeeds(await request('a', `${path}&select=id`)), []);
  succeeds(await rpc('a', 'sync_quiz_gradebook_from_attempt', { p_attempt_id: ids.attemptSeedA }));
  const stored = succeeds(await request('a', `${path}&select=id,score`));
  assert.equal(stored.length, 1);
  assert.equal(stored[0].score, 10);
  assert.deepEqual(succeeds(await request('a', `${path}&select=id,score`, {
    method: 'PATCH', body: { score: 999 }, prefer: 'return=representation',
  })), []);
  denied(await request('a', 'grade_scores?on_conflict=grade_item_id,student_id', {
    method: 'POST', body: { grade_item_id: ids.quizGradeItem, student_id: ids.a, score: 999 },
    prefer: 'resolution=merge-duplicates,return=representation',
  }));
  assert.equal(succeeds(await request('a', `${path}&select=score`))[0].score, 10);
  assert.equal(succeeds(await request('teacher', `${path}&select=score`, {
    method: 'PATCH', body: { score: 11 }, prefer: 'return=representation',
  }))[0].score, 11);
  succeeds(await request('teacher', path, { method: 'PATCH', body: { score: 10 } }));
});

test('grade and student-report views enforce both account and course isolation', async (t) => {
  for (const view of ['course_grade_rollups', 'reporting_grade_course_item_scores', 'reporting_student_dashboard', 'reporting_at_risk_students']) {
    await t.test(view, async () => {
      for (const identity of ['a', 'b', 'outsider']) {
        const rows = succeeds(await request(identity, `${view}?select=*`));
        assert.ok(rows.length > 0, `${identity}: expected own ${view} row`);
        assert.deepEqual(values(rows, 'student_id'), [ids[identity]], `${identity}: ${view} exposes another student's row`);
        assert.deepEqual(values(rows, 'course_id'), [identity === 'outsider' ? ids.courseB : ids.courseA]);
      }
      const teacherRows = succeeds(await request('teacher', `${view}?select=*`));
      assert.deepEqual(values(teacherRows, 'student_id'), [ids.a, ids.b].sort());
      assert.deepEqual(values(teacherRows, 'course_id'), [ids.courseA]);
    });
  }
  for (const view of ['reporting_quiz_overview', 'reporting_live_attendance_overview']) {
    assert.deepEqual(values(succeeds(await request('a', `${view}?select=*`)), 'course_id'), [ids.courseA]);
    assert.deepEqual(values(succeeds(await request('outsider', `${view}?select=*`)), 'course_id'), [ids.courseB]);
  }
  assert.deepEqual(values(succeeds(await rpc('a', 'my_dashboard')), 'student_id'), [ids.a]);
});

test('service worker reads have explicit grants without access to unrelated private tables', async () => {
  const reads = {
    profiles: 'id,role', courses: 'id,title,description', course_units: 'id,title,sort_order',
    course_materials: 'id,title,external_url,storage_path,mime_type', assignments: 'id,title,description,due_at,max_points',
    quizzes: 'id,title', notifications: 'id,user_id,title,body,push_dispatch_attempts', push_tokens: 'user_id,token',
  };
  for (const [table, columns] of Object.entries(reads)) {
    assert.ok(succeeds(await request('service', `${table}?select=${columns}`)).length > 0, table);
  }
  for (const table of ['submissions', 'grade_scores', 'course_export_packages', 'report_export_jobs', 'webhook_deliveries', 'notification_push_logs']) {
    denied(await request('service', `${table}?select=*`));
  }
});

test('trusted service profile maintenance remains available after client self-promotion is denied', async () => {
  succeeds(await request('service', `profiles?id=eq.${ids.a}`, { method: 'PATCH', body: { role: 'teacher' } }));
  assert.equal(succeeds(await request('service', `profiles?id=eq.${ids.a}&select=role`))[0].role, 'teacher');
  succeeds(await request('service', `profiles?id=eq.${ids.a}`, { method: 'PATCH', body: { role: 'student' } }));
  assert.equal(succeeds(await request('a', `profiles?id=eq.${ids.a}&select=role`))[0].role, 'student');
});

test('notification dispatch can read tokens, mark the row, and append a server-only push log', async () => {
  const timestamp = new Date().toISOString();
  const updated = succeeds(await request('service', `notifications?id=eq.${ids.noticeA}&select=id,push_dispatched_at`, {
    method: 'PATCH', body: { push_dispatched_at: timestamp }, prefer: 'return=representation',
  }));
  assert.equal(updated[0].id, ids.noticeA);
  assert.ok(updated[0].push_dispatched_at);
  // The worker only inserts; returning a representation would also require SELECT.
  succeeds(await request('service', 'notification_push_logs', {
    method: 'POST', body: { notification_id: ids.noticeA, status: 'success', http_status: 200 }, prefer: 'return=minimal',
  }), [201]);
  const logs = succeeds(await request('admin', `notification_push_logs?notification_id=eq.${ids.noticeA}&select=status,http_status`));
  assert.equal(logs[0].status, 'success');
  assert.deepEqual(succeeds(await request('a', 'notification_push_logs?select=id')), []);
  assert.deepEqual(succeeds(await request('a', `notifications?id=eq.${ids.noticeB}`, {
    method: 'PATCH', body: { read_at: timestamp }, prefer: 'return=representation',
  })), []);
});

const workerCalls = [
  ['course_export_jobs_claim_next', {}],
  ['course_export_jobs_complete', { p_id: ids.exportJob, p_status: 'ready', p_storage_path: 'synthetic/export.json', p_manifest: {}, p_error: null }],
  ['report_export_jobs_claim_next', {}],
  ['report_export_jobs_complete', { p_id: ids.reportJob, p_status: 'ready', p_storage_path: 'synthetic/report.csv', p_row_count: 2, p_error: null }],
  ['webhook_deliveries_claim_next', {}],
  ['webhook_deliveries_mark', { p_id: ids.webhook, p_status: 200, p_error: null, p_delivered: true, p_abandon: false }],
  ['enqueue_webhook_event', { p_event_type: 'permissions_test', p_payload: { synthetic: true } }],
];

test('worker RPCs reject anonymous and all browser roles, including platform admins', async (t) => {
  for (const [name, body] of workerCalls) {
    await t.test(name, async () => {
      for (const identity of ['anon', 'a', 'teacher', 'admin']) rpcDenied(await rpc(identity, name, body));
    });
  }
});

test('service export RPCs claim and complete jobs without table-level read or update grants', async () => {
  const claimed = succeeds(await rpc('service', 'course_export_jobs_claim_next'));
  const courseJob = Array.isArray(claimed) ? claimed[0] : claimed;
  assert.equal(courseJob.id, ids.exportJob);
  assert.equal(courseJob.status, 'running');
  succeeds(await rpc('service', ...workerCalls[1]));
  assert.equal(succeeds(await request('teacher', `course_export_packages?id=eq.${ids.exportJob}&select=status`))[0].status, 'ready');
  const reportClaimed = succeeds(await rpc('service', 'report_export_jobs_claim_next'));
  const reportJob = Array.isArray(reportClaimed) ? reportClaimed[0] : reportClaimed;
  assert.equal(reportJob.id, ids.reportJob);
  assert.equal(reportJob.status, 'running');
  succeeds(await rpc('service', ...workerCalls[3]));
  assert.equal(succeeds(await request('teacher', `report_export_jobs?id=eq.${ids.reportJob}&select=status,row_count`))[0].row_count, 2);
  denied(await request('teacher', `course_export_packages?id=eq.${ids.exportJob}`, { method: 'PATCH', body: { status: 'ready' } }));
});

test('service webhook RPCs can claim, acknowledge, and enqueue without direct outbox grants', async () => {
  const claimed = succeeds(await rpc('service', 'webhook_deliveries_claim_next'));
  const delivery = Array.isArray(claimed) ? claimed[0] : claimed;
  assert.equal(delivery.id, ids.webhook);
  succeeds(await rpc('service', ...workerCalls[5]));
  const row = succeeds(await request('admin', `webhook_deliveries?id=eq.${ids.webhook}&select=last_status,delivered_at`))[0];
  assert.equal(row.last_status, 200);
  assert.ok(row.delivered_at);
  assert.equal(succeeds(await rpc('service', ...workerCalls[6])), 1);
});
