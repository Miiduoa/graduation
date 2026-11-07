'use strict';

const mockDocuments = new Map();

function mockRef(path) {
  const query = {
    where: () => query,
    orderBy: () => query,
    limit: () => query,
    get: async () => ({ docs: [], empty: true, size: 0 }),
  };
  return {
    collection: (name) => mockRef(`${path}/${name}`),
    doc: (id) => mockRef(`${path}/${id}`),
    where: () => query,
    orderBy: () => query,
    limit: () => query,
    get: async () => {
      const data = mockDocuments.get(path);
      if (data instanceof Error) throw data;
      return { exists: data !== undefined, data: () => data, docs: [], empty: true, size: 0 };
    },
    set: async () => {},
  };
}

jest.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ collection: (name) => mockRef(name) }),
  FieldValue: { serverTimestamp: () => 'server-timestamp' },
}));

jest.mock('../assistantAgent', () => ({
  ...jest.requireActual('../assistantAgent'),
  answerWithServerWebSearch: async () => null,
  callAssistantModelWithTools: async () => ({ provider: 'none', content: '', errors: [] }),
  callAssistantModel: async () => ({ content: '{}' }),
}));

const { executeCampusAssistantCore } = require('./executeCampusAssistantCore');

beforeEach(() => {
  mockDocuments.clear();
  mockDocuments.set('users/alice', { schoolId: 'pu', role: 'student', displayName: 'Alice' });
  mockDocuments.set('schools/pu/members/alice', { status: 'active', role: 'student' });
});

async function runReserveSeat() {
  return executeCampusAssistantCore({
    request: {
      auth: { uid: 'alice', token: { name: 'Alice', role: 'student' } },
      data: {
        messages: [{ role: 'user', content: '明天早上九點圖書館三樓隨便一席' }],
        context: { schoolId: 'pu' },
      },
    },
    runId: 'write-perm-core',
    startedAt: Date.now(),
    routingIntent: 'reserve_seat',
    prefetched: {},
  });
}

describe('executeCampusAssistantCore write permission gate', () => {
  test('unset permissions block seat reservation at planning stage with settings link', async () => {
    const result = await runReserveSeat();
    expect(result.debug.route).toBe('write_permission_denied');
    expect(result.content).toMatch(/預約座位/);
    expect(result.content).toMatch(/settings\?section=assistant/);
    expect(result.actions.some((action) => action.action === 'open_url')).toBe(true);
  });

  test('closed permission blocks seat reservation', async () => {
    mockDocuments.set('users/alice/settings/assistantPermissions', { reserveSeat: false });
    const result = await runReserveSeat();
    expect(result.debug.route).toBe('write_permission_denied');
    expect(result.debug.writePermissionDenied).toBe('reserveSeat');
  });

  test('firestore read failure fails closed at planning stage', async () => {
    mockDocuments.set('users/alice/settings/assistantPermissions', new Error('unavailable'));
    const result = await runReserveSeat();
    expect(result.debug.route).toBe('write_permission_denied');
  });

  test('closed personal todo permission omits split/reminder actions', async () => {
    mockDocuments.set('users/alice/settings/assistantPermissions', {
      createPersonalTodoReminder: false,
    });
    const result = await executeCampusAssistantCore({
      request: {
        auth: { uid: 'alice', token: { name: 'Alice', role: 'student' } },
        data: {
          messages: [{ role: 'user', content: '幫我把作業拆成待辦' }],
          context: { schoolId: 'pu' },
        },
      },
      runId: 'write-perm-todo',
      startedAt: Date.now(),
      routingIntent: 'assignment_planning',
      prefetched: {
        scope: { uid: 'alice', schoolId: 'pu' },
        assignments: [
          {
            id: 'a1',
            title: '報告',
            groupId: 'g1',
            groupName: '資料庫',
            dueAt: new Date('2030-01-02T00:00:00Z'),
          },
        ],
      },
    });
    expect(result.actions || []).toEqual([]);
    expect(result.content).toMatch(/建立個人待辦與提醒/);
  });

  test('報修確認只存備忘，不宣稱已送到學校或產生單號', async () => {
    mockDocuments.set('users/alice/settings/assistantPermissions', {
      createDormRepairRequest: true,
    });
    const result = await executeCampusAssistantCore({
      request: {
        auth: { uid: 'alice', token: { name: 'Alice', role: 'student' } },
        data: {
          messages: [{ role: 'user', content: 'A棟 301 冷氣不冷幫我報修' }],
          context: { schoolId: 'pu' },
        },
      },
      runId: 'repair-honest-copy',
      startedAt: Date.now(),
      routingIntent: 'submit_repair_request',
      prefetched: { scope: { uid: 'alice', schoolId: 'pu' } },
    });
    expect(result.content).toContain('報修備忘');
    expect(result.content).toContain('請依學校規定管道送出');
    expect(JSON.stringify(result.actions || [])).toContain('確認存成報修備忘');
    expect(JSON.stringify(result)).not.toMatch(/工單|已提交報修|已為你提交/);
  });
});
