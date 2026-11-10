import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { assertLoopback, createTestToken, sql } from './harness.mjs';

// Only run-supabase.mjs provides this URL after creating its disposable stack.
const base = assertLoopback(`${process.env.CAMPUS_TEST_STORAGE_URL || ''}/`, ['http:']);
assert.equal(base.port, '54321');
assert.equal(base.pathname, '/storage/v1/');
assert.equal(base.username + base.password, '');
const databaseUrl = process.env.CAMPUS_TEST_DATABASE_URL;
const database = assertLoopback(databaseUrl, ['postgres:', 'postgresql:']);
assert.equal(database.port, '54322');
assert.equal(database.pathname, '/postgres');
assert.equal(decodeURIComponent(database.username), 'postgres');
const secret = process.env.CAMPUS_TEST_JWT_SECRET;
const anonKey = process.env.CAMPUS_TEST_ANON_KEY;
assert.ok(secret && secret.length >= 32);
assert.ok(anonKey, 'The disposable local gateway API key is required');

const users = {
  teacher: '00000000-0000-4000-8000-000000000002',
  student: '00000000-0000-4000-8000-000000000003',
  peer: '00000000-0000-4000-8000-000000000004',
};
const course = '10000000-0000-4000-8000-000000000001';
const assignment = '20000000-0000-4000-8000-000000000001';
// Reuse these exact JWTs across membership revocation and restoration.
const tokens = Object.fromEntries(Object.entries(users).map(([name, id]) =>
  [name, createTestToken(secret, 'authenticated', id)]));
tokens.service = createTestToken(secret, 'service_role');

async function request(identity, path, { method = 'GET', body, json, headers = {} } = {}) {
  const url = assertLoopback(new URL(path, base).toString(), ['http:']);
  assert.equal(url.origin, base.origin);
  assert.ok(url.pathname.startsWith(base.pathname));
  assert.ok(tokens[identity]);
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${tokens[identity]}`, apikey: anonKey,
      'Content-Type': json === undefined ? 'text/plain' : 'application/json',
      ...headers,
    },
    body: json === undefined ? body : JSON.stringify(json),
    signal: AbortSignal.timeout(15_000), redirect: 'error', cache: 'no-store',
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: response.status, data, text };
}

function succeeds(result) {
  assert.ok([200, 201].includes(result.status), `Storage HTTP ${result.status}, ${result.data?.error || 'unexpected response'}`);
  return result;
}

function denied(result, { hidden = false } = {}) {
  // Older Storage releases return HTTP 400 with the actual status in the body.
  const allowed = hidden ? [401, 403, 404] : [401, 403];
  assert.ok([400, ...allowed].includes(result.status), `Expected denial, got Storage HTTP ${result.status}`);
  const status = Number(result.data?.statusCode ?? result.status);
  assert.ok(allowed.includes(status), `Unexpected Storage denial status ${status}`);
}

test('submission attachments stay immutable through the real Storage HTTP API', { timeout: 90_000 }, async (t) => {
  const prefix = `${course}/${assignment}/${users.student}/storage-${randomUUID()}`;
  const first = `${prefix}-first.txt`;
  const next = `${prefix}-next.txt`;
  const signed = `${prefix}-signed.txt`;
  const revoked = `${prefix}-revoked.txt`;
  const wrongAssignment = `${course}/20000000-0000-4000-8000-000000000002/${users.student}/storage-${randomUUID()}.txt`;
  const peerPath = `${course}/${assignment}/${users.peer}/storage-${randomUUID()}.txt`;
  const content = 'Synthetic submission attachment version one\n';
  const object = (name) => `object/submissions/${name}`;
  const download = (identity, name = first) => request(identity, `object/authenticated/submissions/${name}`);

  t.after(async () => {
    succeeds(await request('service', 'object/submissions', {
      method: 'DELETE', json: { prefixes: [first, next, signed, revoked, wrongAssignment, peerPath] },
    }));
  });

  succeeds(await request('student', object(first), { method: 'POST', body: content }));

  await t.test('current student and teacher download the original bytes', async () => {
    for (const identity of ['student', 'teacher']) {
      assert.equal(succeeds(await download(identity)).text, content);
    }
    denied(await download('peer'), { hidden: true });
  });

  await t.test('a new filename accepts a new version', async () => {
    succeeds(await request('student', object(next), { method: 'POST', body: 'Synthetic version two' }));
    assert.equal(succeeds(await download('student', next)).text, 'Synthetic version two');
  });

  await t.test('UPDATE cannot replace an existing attachment', async () => {
    denied(await request('student', object(first), { method: 'PUT', body: 'Replacement' }), { hidden: true });
    assert.equal(succeeds(await download('student')).text, content);
  });

  await t.test('upsert cannot replace an existing attachment', async () => {
    denied(await request('student', object(first), {
      method: 'POST', body: 'Replacement', headers: { 'x-upsert': 'true' },
    }));
    assert.equal(succeeds(await download('student')).text, content);
  });

  await t.test('student and teacher cannot delete the original bytes', async () => {
    for (const identity of ['student', 'teacher']) {
      const removed = await request(identity, 'object/submissions', { method: 'DELETE', json: { prefixes: [first] } });
      if (removed.status === 200) assert.deepEqual(removed.data, []);
      else denied(removed, { hidden: true });
      assert.equal(succeeds(await download('student')).text, content);
    }
  });

  await t.test('signed upsert upload tokens cannot be minted before an object exists', async () => {
    denied(await request('student', `object/upload/sign/submissions/${signed}`, {
      method: 'POST', json: {}, headers: { 'x-upsert': 'true' },
    }));
  });

  await t.test('signed download URLs cannot be minted', async () => {
    denied(await request('student', `object/sign/submissions/${first}`, {
      method: 'POST', json: { expiresIn: 60 },
    }), { hidden: true });
  });

  await t.test('bulk signing cannot issue a download URL', async () => {
    const result = await request('student', 'object/sign/submissions', {
      method: 'POST', json: { expiresIn: 60, paths: [first] },
    });
    if (result.status === 200) {
      assert.equal(result.data.length, 1);
      assert.equal(result.data[0].signedURL, null);
      assert.ok(result.data[0].error);
    } else denied(result, { hidden: true });
  });

  await t.test('uploads reject another assignment or student path', async () => {
    for (const path of [wrongAssignment, peerPath]) {
      denied(await request('student', object(path), { method: 'POST', body: content }));
    }
  });

  await t.test('the same JWTs lose access immediately after enrollment revocation', async () => {
    const filter = `course_id = '${course}' and user_id in ('${users.student}', '${users.teacher}')`;
    const snapshot = JSON.parse(sql(databaseUrl, { text: `
      select json_build_object('members', json_agg(m order by user_id), 'audit_boundary', clock_timestamp())
      from public.course_members m where ${filter};
    ` }));
    assert.equal(snapshot.members.length, 2);
    try {
      assert.equal(sql(databaseUrl, { text: `
        with removed as (delete from public.course_members where ${filter} returning 1)
        select count(*) from removed;
      ` }).trim(), '2');
      for (const identity of ['student', 'teacher']) denied(await download(identity), { hidden: true });
      denied(await request('student', object(revoked), { method: 'POST', body: content }));
    } finally {
      const members = JSON.stringify(snapshot.members).replaceAll("'", "''");
      const boundary = snapshot.audit_boundary.replaceAll("'", "''");
      sql(databaseUrl, { text: `
        begin;
        insert into public.course_members
          select * from json_populate_recordset(null::public.course_members, '${members}')
          where true
          on conflict (course_id, user_id) do update set role=excluded.role, joined_at=excluded.joined_at;
        delete from public.enrollment_history where ${filter} and event_at >= '${boundary}'::timestamptz;
        commit;
      ` });
    }
    for (const identity of ['student', 'teacher']) {
      assert.equal(succeeds(await download(identity)).text, content);
    }
  });
});
