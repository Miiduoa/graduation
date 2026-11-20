const { createSubmitProductFeedback } = require('./productFeedback');
const { transactionStore } = require('./testSupport/transactionStore');

describe('authenticated product feedback', () => {
  let store;
  const input = {
    requestId: 'feedback-request-0001',
    schoolId: 'pu',
    kind: 'general',
    feedbackType: 'bug',
    title: '畫面無法載入',
    description: '切換學校後，公告畫面沒有更新。',
    rating: 3,
    contactEmail: 'student@example.test',
  };
  const submit = (change = {}, uid = 'alice') =>
    createSubmitProductFeedback({ db: store.db })({ auth: { uid }, data: { ...input, ...change } });
  const feedback = () => [...store.docs].filter(([path]) => path.startsWith('feedback/'));
  beforeEach(() => {
    store = transactionStore([
      ['schools/pu/members/alice', { status: 'active' }],
      ['schools/pu/members/bob', { status: 'active' }],
    ]);
  });

  test('requires authentication and explicitly active membership', async () => {
    await expect(
      createSubmitProductFeedback({ db: store.db })({ data: input }),
    ).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    for (const membership of [{ status: 'inactive' }, {}]) {
      store.docs.set('schools/pu/members/alice', membership);
      await expect(submit()).rejects.toMatchObject({ code: 'permission-denied' });
    }
    await expect(submit({ schoolId: 'another-school' })).rejects.toMatchObject({
      code: 'permission-denied',
    });
    expect(feedback()).toHaveLength(0);
  });

  test('stores only the authenticated actor and canonical bounded content', async () => {
    const result = await submit({ title: '  畫面無法載入  ' });
    expect(result).toMatchObject({ ok: true, reused: false });
    expect(store.docs.get(`feedback/${result.feedbackId}`)).toMatchObject({
      kind: 'general',
      type: 'bug',
      title: input.title,
      description: input.description,
      submittedBy: 'alice',
      schoolId: 'pu',
      status: 'new',
      rating: 3,
    });
    expect(feedback()).toHaveLength(1);
  });

  test('retries from a fresh handler reuse the receipt and preserve review status', async () => {
    const first = await submit();
    const stored = store.docs.get(`feedback/${first.feedbackId}`);
    stored.status = 'reviewed';
    const retry = await submit();
    expect(retry).toEqual({ ...first, reused: true });
    expect(feedback()).toHaveLength(1);
    expect(store.docs.get(`feedback/${first.feedbackId}`)).toBe(stored);
    expect(stored.status).toBe('reviewed');
  });

  test('a changed payload cannot reuse a request ID', async () => {
    const first = await submit();
    await expect(submit({ title: '另一個問題' })).rejects.toMatchObject({ code: 'already-exists' });
    expect(store.docs.get(`feedback/${first.feedbackId}`).title).toBe(input.title);
    expect(feedback()).toHaveLength(1);
  });

  test('the same request ID remains separate across accounts', async () => {
    const alice = await submit();
    const bob = await submit({}, 'bob');
    expect(alice.feedbackId).not.toBe(bob.feedbackId);
    expect(feedback()).toHaveLength(2);
    expect(store.docs.get(`feedback/${bob.feedbackId}`).submittedBy).toBe('bob');
  });

  test('membership revocation prevents even a receipt retry', async () => {
    await submit();
    store.docs.set('schools/pu/members/alice', { status: 'inactive' });
    await expect(submit()).rejects.toMatchObject({ code: 'permission-denied' });
    expect(feedback()).toHaveLength(1);
  });

  test('a failed commit is not reported as received and retry can finish once', async () => {
    store.failNextCommit();
    await expect(submit()).rejects.toThrow('commit unavailable');
    expect(feedback()).toHaveLength(0);
    expect(await submit()).toMatchObject({ ok: true, reused: false });
    expect(feedback()).toHaveLength(1);
  });

  test.each([
    { submittedBy: 'bob' },
    { status: 'reviewed' },
    { requestId: '../invalid' },
    { schoolId: 'school/path' },
    { kind: 'nps' },
    { feedbackType: 'unknown' },
    { title: '' },
    { title: 'x'.repeat(161) },
    { description: 'x'.repeat(8001) },
    { rating: -1 },
    { rating: 6 },
    { rating: 1.5 },
    { rating: '3' },
    { contactEmail: 'not-an-email' },
  ])('rejects invalid or forged input: %j', async (change) => {
    await expect(submit(change)).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(feedback()).toHaveLength(0);
  });
});
