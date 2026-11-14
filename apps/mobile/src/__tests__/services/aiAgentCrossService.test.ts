jest.mock('../../firebase', () => ({
  getFirebaseApp: jest.fn(() => ({})),
  hasUsableFirebaseConfig: jest.fn(() => false),
}));
jest.mock('../../services/aiAgentTools', () => ({
  executeTool: jest.fn(),
  getToolDeclarations: () => [
    'query_courses', 'query_assignments', 'query_bus', 'query_menus', 'query_orders',
    'query_library', 'query_events', 'register_event', 'reserve_library_seat',
    'borrow_book', 'submit_assignment', 'query_loans', 'renew_book', 'request_leave',
  ].map((name) => ({ name, description: name, parameters: { type: 'object', properties: {} } })),
}));
jest.mock('../../services/aiToolRegistry', () => ({
  executeToolStandard: jest.fn(), getToolSpec: jest.fn(),
}));
jest.mock('../../services/aiDynamicTraining', () => ({
  detectCapabilityGap: jest.fn(() => null), recordAgentProcessTraining: jest.fn(),
}));

import { executeTool } from '../../services/aiAgentTools';
import {
  analyzeIntents, autonomousQuery, buildLocalAgentPrompt, exploreAndLearn, getLearnedSkills,
  resetAdaptiveLearnedPatternsForTests,
} from '../../services/aiLocalAgent';

const ctx = { userId: 'cross-service-user', schoolId: 'pu', role: 'student' as const, isOnline: true };
const call = jest.mocked(executeTool);

beforeEach(() => {
  resetAdaptiveLearnedPatternsForTests();
  jest.clearAllMocks();
  call.mockImplementation(async (tool) => ({ success: true, summary: tool + '實際結果', data: [] }));
});

async function rememberOneRead(question: string, tool: string, args: Record<string, string>) {
  await exploreAndLearn(question, ctx, async () =>
    `[STEP:1] [TOOL:${tool}] [ARGS:${JSON.stringify(args)}] [REASON:fixture]`);
  for (const skill of getLearnedSkills().values()) skill.successCount = 2;
  call.mockClear();
}

describe('mobile agent cross-service execution', () => {
  it('keeps every requested service when an older single-tool skill matches the whole request', async () => {
    const question = '查我的課表、未交作業、公車與訂單';
    await rememberOneRead(question, 'query_courses', { filter: 'all' });
    const result = await autonomousQuery(question, ctx);
    const tools = result.results.map((entry) => entry.tool);
    expect(tools).toEqual(expect.arrayContaining([
      'query_courses', 'query_assignments', 'query_bus', 'query_orders',
    ]));
    expect(result.executedActions).toEqual([]);
    for (const tool of ['query_courses', 'query_assignments', 'query_bus', 'query_orders']) {
      expect(result.contextText).toContain(tool + '實際結果');
      expect(call.mock.calls.filter(([name]) => name === tool)).toHaveLength(1);
    }
    expect(call.mock.calls.every(([, , scope]) => scope.userId === ctx.userId && scope.schoolId === ctx.schoolId)).toBe(true);
  });

  it('reports a failed independent source while retaining the other real results without exposing its error', async () => {
    call.mockImplementation(async (tool) => {
      if (tool === 'query_assignments') throw new Error('PRIVATE_UPSTREAM_DETAIL');
      return { success: true, summary: tool + '實際結果', data: [] };
    });
    const result = await autonomousQuery('查我的課表、未交作業與公車', ctx);
    expect(result.contextText).toContain('query_courses實際結果');
    expect(result.contextText).toContain('query_bus實際結果');
    expect(result.contextText).toContain('查詢作業尚未完成');
    expect(result.contextText).toContain('不能視為沒有資料');
    expect(JSON.stringify(result)).not.toContain('PRIVATE_UPSTREAM_DETAIL');
  });

  it('does not reuse library loan results to resolve a seat reservation', async () => {
    const question = '查我的借書資料，接著幫我預約座位，另外查公車';
    expect(analyzeIntents(question).find((intent) => intent.tool === 'query_library')?.args.action).toBe('loans');
    call.mockImplementation(async (tool, args) => {
      if (tool === 'query_library') return { success: true,
        summary: args.action === 'seats' ? '座位資料' : '借閱資料',
        data: args.action === 'seats' ? { seats: [{ id: 'seat-verified', available: true }] }
          : [{ id: 'book-must-not-be-seat' }] };
      return { success: true, summary: '準備完成，仍須確認', isWrite: false, data: [] };
    });
    const result = await autonomousQuery(question, ctx);
    expect(call.mock.calls.filter(([tool]) => tool === 'query_library').map(([, args]) => args.action))
      .toEqual(['loans', 'seats']);
    expect(call).toHaveBeenCalledWith('reserve_library_seat',
      expect.objectContaining({ seatId: 'seat-verified' }), expect.objectContaining(ctx));
    expect(result.results.some((entry) => entry.tool === 'query_bus')).toBe(true);
    expect(call.mock.calls.some(([, args]) => args.seatId === 'book-must-not-be-seat')).toBe(false);
  });

  it('stops a dependent action on a failed lookup, without retrying it or dropping unrelated reads', async () => {
    const question = '查公車，接著幫我預約圖書館座位';
    call.mockImplementation(async (tool) => tool === 'query_library'
      ? { success: false, summary: 'PRIVATE_SCOPE_FAILURE', error: 'PRIVATE_SCOPE_FAILURE' }
      : { success: true, summary: '公車資料已取得', data: [] });
    const result = await autonomousQuery(question, ctx);
    expect(call.mock.calls.filter(([tool]) => tool === 'query_library')).toHaveLength(1);
    expect(call.mock.calls.some(([tool]) => tool === 'reserve_library_seat')).toBe(false);
    expect(result.failedActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ tool: 'reserve_library_seat', missingInfo: expect.stringContaining('必要資料尚未取得') }),
    ]));
    expect(result.contextText).toContain('公車資料已取得');
    expect(result.contextText).not.toContain('PRIVATE_SCOPE_FAILURE');
  });

  it('reuses an exact prerequisite once, then resolves the selected target from that result', async () => {
    call.mockImplementation(async (tool) => tool === 'query_loans'
      ? { success: true, summary: '已讀取借閱', data: [{ id: 'loan-a', title: '資料庫' }] }
      : { success: true, summary: '待確認', isWrite: false });
    const result = await autonomousQuery('查我的借閱，接著幫我續借資料庫', ctx);
    expect(call.mock.calls.filter(([tool]) => tool === 'query_loans')).toHaveLength(1);
    expect(call).toHaveBeenCalledWith('renew_book', { loanId: 'loan-a' }, expect.objectContaining(ctx));
    expect(result.executedActions[0].result.isWrite).toBe(false);
    expect(result.contextText).toContain('操作尚未完成');
    expect(result.contextText).not.toContain('✅');
    const prompt = buildLocalAgentPrompt(result, ctx);
    expect(prompt).toContain('待確認 續借');
    expect(prompt).not.toContain('請在回答中確認這些操作已完成');
  });

  it.each(['returned', 'thrown'] as const)('blocks an action with no argument resolver when its required read fails (%s)', async (failure) => {
    const question = '明天我要請病假，另外查公車';
    const leave = analyzeIntents(question).find((intent) => intent.tool === 'request_leave');
    expect(leave?.prereqRead).toEqual({ tool: 'query_courses', args: {} });
    expect(leave?.resolveFromRead).toBeUndefined();
    call.mockImplementation(async (tool) => {
      if (tool === 'query_courses') {
        if (failure === 'thrown') throw new Error('PRIVATE_COURSE_FAILURE');
        return { success: false, summary: 'PRIVATE_COURSE_FAILURE', error: 'unavailable' };
      }
      return { success: true, summary: '公車資料已取得', data: [] };
    });
    const result = await autonomousQuery(question, ctx);
    expect(call.mock.calls.filter(([tool]) => tool === 'query_courses')).toHaveLength(1);
    expect(call.mock.calls.some(([tool]) => tool === 'request_leave')).toBe(false);
    expect(result.failedActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ tool: 'request_leave', missingInfo: expect.stringContaining('必要資料尚未取得') }),
    ]));
    expect(result.contextText).toContain('公車資料已取得');
    expect(result.contextText).not.toContain('PRIVATE_COURSE_FAILURE');
    expect(result.executedActions).toEqual([]);
  });

  it('verifies a required source before preparing an action that needs no argument resolver', async () => {
    call.mockImplementation(async (tool) => ({ success: true, summary: tool + '實際結果',
      ...(tool === 'request_leave' ? { isWrite: false } : { data: [] }) }));
    const result = await autonomousQuery('明天我要請病假，另外查公車', ctx);
    const called = call.mock.calls.map(([tool]) => tool);
    expect(called.filter((tool) => tool === 'query_courses')).toHaveLength(1);
    expect(called.indexOf('query_courses')).toBeLessThan(called.indexOf('request_leave'));
    expect(call).toHaveBeenCalledWith('request_leave', expect.objectContaining({ leaveType: 'sick' }), expect.objectContaining(ctx));
    expect(result.results.map((entry) => entry.tool)).toEqual(expect.arrayContaining(['query_courses', 'query_bus']));
    expect(result.contextText).toContain('操作尚未完成');
    expect(result.contextText).not.toContain('✅');
  });

  it('records a remembered single read as a read, never as a completed write', async () => {
    const question = '我的課表';
    await rememberOneRead(question, 'query_courses', { filter: 'all' });
    const result = await autonomousQuery(question, ctx);
    expect(result.results).toEqual([
      expect.objectContaining({ tool: 'query_courses', result: expect.objectContaining({ success: true }) }),
    ]);
    expect(result.executedActions).toEqual([]);
    expect(result.intents.every((intent) => !intent.isWrite)).toBe(true);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('does not reuse a learned multi-step or write action when only a read was requested', async () => {
    const question = '我的課表';
    await rememberOneRead(question, 'query_courses', { filter: 'all' });
    for (const skill of getLearnedSkills().values()) {
      skill.steps = [{ tool: 'query_courses', args: { filter: 'all' } },
        { tool: 'submit_assignment', args: { assignmentId: 'unrequested' } }];
    }
    const result = await autonomousQuery(question, ctx);
    expect(call.mock.calls.map(([tool]) => tool)).toEqual(['query_courses']);
    expect(result.executedActions).toEqual([]);
  });
});
