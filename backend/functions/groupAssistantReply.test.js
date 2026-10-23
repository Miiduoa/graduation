const { createGroupAssistantReplyHandler, generateWithCampusAssistant } = require('./groupAssistantReply');

const FAILED = '助理暫時沒辦法回答，可以等其他同學回覆';

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
  const generate = jest.fn(async () => ({ fromModel: true, content: '第一到四章' }));
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

function expectFailed(db, result) {
  expect(result.status).toBe('failed');
  const reply = db.docs.get('groups/g1/posts/q1/comments/assistant');
  expect(reply).toMatchObject({ body: FAILED, generatedBy: 'server', authorId: 'campus-assistant' });
  expect(reply.body).not.toMatch(/最值得先關注|最新公告/);
  expect(db.docs.get('groups/g1/posts/q1').assistantReply.status).toBe('failed');
}

test('沒有金鑰：模型那層回 provider none，寫「暫時沒辦法回答」並標成失敗', async () => {
  const db = fakeDb();
  const callModel = jest.fn(async () => ({ provider: 'none', content: '', errors: [] }));
  const handle = createGroupAssistantReplyHandler({
    db, FieldValue, log: () => {},
    generate: (input) => generateWithCampusAssistant(input, { callModel }),
  });
  expectFailed(db, await handle({ groupId: 'g1', postId: 'q1', post: question }));
  expect(callModel).toHaveBeenCalled();
});

test('模型出錯：一樣寫「暫時沒辦法回答」', async () => {
  const db = fakeDb();
  const callModel = jest.fn(async () => {
    throw new Error('upstream 500');
  });
  const handle = createGroupAssistantReplyHandler({
    db, FieldValue, log: () => {},
    generate: (input) => generateWithCampusAssistant(input, { callModel }),
  });
  const result = await handle({ groupId: 'g1', postId: 'q1', post: question });
  expectFailed(db, result);
  expect(result.reason).toBe('model-error');
});

test('模型逾時：一樣寫「暫時沒辦法回答」', async () => {
  const db = fakeDb();
  const handle = createGroupAssistantReplyHandler({
    db, FieldValue, log: () => {}, timeoutMs: 20,
    generate: () => new Promise(() => {}),
  });
  const result = await handle({ groupId: 'g1', postId: 'q1', post: question });
  expectFailed(db, result);
  expect(result.reason).toBe('timeout');
});

test('關掉、沒設定、或回來的內容不是模型產生的（例如一般校園摘要）：都算失敗', async () => {
  for (const deps of [
    { enabled: () => false, generate: jest.fn() },
    { generate: undefined },
    { generate: async () => ({ content: '', error: 'down' }) },
    { generate: async () => ({ content: '測試學生甲，這是你目前最值得先關注的重點：' }) },
  ]) {
    const db = fakeDb();
    const handle = createGroupAssistantReplyHandler({ db, FieldValue, log: () => {}, ...deps });
    expectFailed(db, await handle({ groupId: 'g1', postId: 'q1', post: question }));
  }
});

test('模型真的回答時才寫成助理回覆', async () => {
  const callModel = jest.fn(async () => ({ provider: 'gemini', content: '範圍是第一到四章，請以老師公告為準。' }));
  await expect(generateWithCampusAssistant({ prompt: '範圍？' }, { callModel })).resolves.toMatchObject({
    fromModel: true,
    content: '範圍是第一到四章，請以老師公告為準。',
  });
});

test('a legacy assistant doc not written by the server gets replaced by the real reply', async () => {
  const db = fakeDb();
  db.docs.set('groups/g1/posts/q1/comments/assistant', { body: '學校說期末考取消', authorId: 'campus-assistant', isAI: true });
  const handle = createGroupAssistantReplyHandler({ db, FieldValue, generate: async () => ({ fromModel: true, content: '第一到四章' }), log: () => {} });
  await expect(handle({ groupId: 'g1', postId: 'q1', post: question })).resolves.toEqual({ status: 'done' });
  const reply = db.docs.get('groups/g1/posts/q1/comments/assistant');
  expect(reply.generatedBy).toBe('server');
  expect(reply.body).toContain('第一到四章');
  expect(reply.body).not.toContain('期末考取消');
});
