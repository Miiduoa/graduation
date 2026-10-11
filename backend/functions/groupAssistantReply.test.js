const { createGroupAssistantReplyHandler } = require('./groupAssistantReply');

function fakeDb() {
  const docs = new Map();
  return {
    docs,
    doc(path) {
      return {
        async set(data, opts) {
          docs.set(path, opts?.merge ? { ...(docs.get(path) || {}), ...data } : data);
        },
        async get() {
          return { exists: docs.has(path), data: () => docs.get(path) };
        },
        async create(data) {
          if (docs.has(path)) {
            const err = new Error('already exists');
            err.code = 6;
            throw err;
          }
          docs.set(path, data);
        },
      };
    },
  };
}
const FieldValue = { serverTimestamp: () => 'ts' };
const question = { kind: 'question', authorId: 'alice', schoolId: 'pu', title: '期中考', body: '範圍？' };

test('writes one assistant reply under the assistant, not the student', async () => {
  const db = fakeDb();
  const generate = jest.fn(async () => ({ content: '第一到四章' }));
  const handle = createGroupAssistantReplyHandler({ db, FieldValue, generate, log: () => {} });
  await expect(handle({ groupId: 'g1', postId: 'q1', post: question })).resolves.toEqual({ status: 'done' });
  await expect(handle({ groupId: 'g1', postId: 'q1', post: question })).resolves.toEqual({ status: 'done', duplicate: true });
  const reply = db.docs.get('groups/g1/posts/q1/comments/assistant');
  expect(reply).toMatchObject({ authorId: 'campus-assistant', authorName: '助理回覆', isAI: true, requestedBy: 'alice' });
  expect(reply.body).toContain('第一到四章');
  expect(generate).toHaveBeenCalledWith(expect.objectContaining({ uid: 'alice', groupId: 'g1' }));
  expect(db.docs.get('groups/g1/posts/q1').assistantReply.status).toBe('done');
});

test('skips posts that are not questions', async () => {
  const db = fakeDb();
  const generate = jest.fn();
  const handle = createGroupAssistantReplyHandler({ db, FieldValue, generate });
  await expect(handle({ groupId: 'g1', postId: 'p1', post: { ...question, kind: 'post' } })).resolves.toEqual({ status: 'skipped' });
  expect(generate).not.toHaveBeenCalled();
});

test('when not configured or the assistant has no answer, marks it and writes no reply', async () => {
  for (const deps of [
    { enabled: () => false, generate: jest.fn() },
    { generate: undefined },
    { generate: async () => ({ content: '', error: 'down' }) },
    { generate: async () => { throw new Error('boom'); } },
  ]) {
    const db = fakeDb();
    const handle = createGroupAssistantReplyHandler({ db, FieldValue, log: () => {}, ...deps });
    const result = await handle({ groupId: 'g1', postId: 'q1', post: question });
    expect(result.status).toBe('unavailable');
    expect(db.docs.has('groups/g1/posts/q1/comments/assistant')).toBe(false);
    expect(db.docs.get('groups/g1/posts/q1').assistantReply.status).toBe('unavailable');
  }
});

test('a legacy assistant doc not written by the server gets replaced by the real reply', async () => {
  const db = fakeDb();
  db.docs.set('groups/g1/posts/q1/comments/assistant', { body: '學校說期末考取消', authorId: 'campus-assistant', isAI: true });
  const handle = createGroupAssistantReplyHandler({ db, FieldValue, generate: async () => ({ content: '第一到四章' }), log: () => {} });
  await expect(handle({ groupId: 'g1', postId: 'q1', post: question })).resolves.toEqual({ status: 'done' });
  const reply = db.docs.get('groups/g1/posts/q1/comments/assistant');
  expect(reply.generatedBy).toBe('server');
  expect(reply.body).toContain('第一到四章');
  expect(reply.body).not.toContain('期末考取消');
});
