'use strict';

const { transactionStore } = require('../../testSupport/transactionStore');

let mockStore;
jest.mock('firebase-functions/v2/https', () => ({
  ...jest.requireActual('firebase-functions/v2/https'),
  onCall: (_, handler) => handler,
}));
jest.mock('firebase-admin/firestore', () => ({
  ...jest.requireActual('firebase-admin/firestore'),
  getFirestore: () => mockStore.db,
}));

mockStore = transactionStore([
  ['users/alice', { schoolId: 'pu', role: 'student' }],
  ['schools/pu/members/alice', { status: 'active', role: 'student' }],
]);

const executeAgentWrite = require('./executeAgentWrite');
const { byName } = require('../tools/registry');

const RUN_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function seedProposal(toolName = 'reserveSeat') {
  mockStore.docs.set(`users/alice/agentRuns/${RUN_ID}`, {
    uid: 'alice',
    schoolId: 'pu',
    proposals: [
      {
        toolName,
        input: { seatId: 'A-1', date: '2030-01-02', startTime: '09:00', endTime: '11:00' },
      },
    ],
  });
}

describe('executeAgentWrite assistant write permissions', () => {
  beforeEach(() => {
    // executeAgentWrite 模組載入時固定 db 參考，只能清同一份 store 的文件。
    mockStore.docs.clear();
    mockStore.docs.set('users/alice', { schoolId: 'pu', role: 'student' });
    mockStore.docs.set('schools/pu/members/alice', { status: 'active', role: 'student' });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('unset permissions block write even with a valid proposal', async () => {
    seedProposal('reserveSeat');
    const tool = byName.get('reserveSeat');
    const executeSpy = jest.spyOn(tool, 'execute');

    await expect(
      executeAgentWrite({
        auth: { uid: 'alice' },
        data: {
          toolName: 'reserveSeat',
          agentRunId: RUN_ID,
          input: { seatId: 'A-1', date: '2030-01-02', startTime: '09:00', endTime: '11:00' },
          context: { schoolId: 'pu' },
        },
      }),
    ).rejects.toMatchObject({
      code: 'permission-denied',
      message: expect.stringContaining('預約座位'),
    });
    expect(executeSpy).not.toHaveBeenCalled();
  });

  test('explicitly closed permission blocks write', async () => {
    mockStore.docs.set('users/alice/settings/assistantPermissions', {
      reserveSeat: false,
      borrowBook: true,
    });
    seedProposal('reserveSeat');
    const executeSpy = jest.spyOn(byName.get('reserveSeat'), 'execute');

    await expect(
      executeAgentWrite({
        auth: { uid: 'alice' },
        data: {
          toolName: 'reserveSeat',
          agentRunId: RUN_ID,
          input: { seatId: 'A-1', date: '2030-01-02', startTime: '09:00', endTime: '11:00' },
          context: { schoolId: 'pu' },
        },
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(executeSpy).not.toHaveBeenCalled();
  });

  test('enabled permission still requires confirmation proposal (cannot bypass)', async () => {
    mockStore.docs.set('users/alice/settings/assistantPermissions', { reserveSeat: true });
    const executeSpy = jest.spyOn(byName.get('reserveSeat'), 'execute');

    await expect(
      executeAgentWrite({
        auth: { uid: 'alice' },
        data: {
          toolName: 'reserveSeat',
          // missing/invalid agentRunId → still blocked by confirmation gate
          input: { seatId: 'A-1', date: '2030-01-02', startTime: '09:00', endTime: '11:00' },
          context: { schoolId: 'pu' },
        },
      }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(executeSpy).not.toHaveBeenCalled();
  });

  test('direct executeAgentWrite with closed permission is blocked without proposal match', async () => {
    mockStore.docs.set('users/alice/settings/assistantPermissions', { cancelOrder: false });
    const executeSpy = jest.spyOn(byName.get('cancelOrder'), 'execute');

    await expect(
      executeAgentWrite({
        auth: { uid: 'alice' },
        data: {
          toolName: 'cancelOrder',
          agentRunId: RUN_ID,
          input: { orderId: 'ord-1' },
          context: { schoolId: 'pu' },
        },
      }),
    ).rejects.toMatchObject({
      code: 'permission-denied',
      message: expect.stringContaining('取消餐廳訂單'),
    });
    expect(executeSpy).not.toHaveBeenCalled();
  });
});
