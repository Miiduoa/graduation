'use strict';

const { runTool, byName, toolRequiresConfirmation } = require('./registry');
const { MAX_ARRAY_ITEMS } = require('../inputLimits');

describe('registry runTool input bounds', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('keeps confirmation metadata intact', () => {
    expect(toolRequiresConfirmation('submitQuizAttempt')).toBe(true);
    expect(toolRequiresConfirmation('proposeOrder')).toBeFalsy();
  });

  test('does not call schema.parse or execute for oversized quiz answers', async () => {
    const tool = byName.get('submitQuizAttempt');
    const parseSpy = jest.spyOn(tool.inputSchema, 'parse');
    const executeSpy = jest.spyOn(tool, 'execute');

    const answers = Array.from({ length: MAX_ARRAY_ITEMS + 1 }, (_, index) => ({
      questionId: `q${index}`,
      value: 'nope',
    }));

    await expect(
      runTool(
        'submitQuizAttempt',
        { uid: 'u1', schoolId: 'pu' },
        { quizId: 'quiz', courseSpaceId: 'course', answers },
      ),
    ).rejects.toMatchObject({ code: 'resource-exhausted' });

    expect(parseSpy).not.toHaveBeenCalled();
    expect(executeSpy).not.toHaveBeenCalled();
  });

  test('does not call execute for cyclic or accessor payloads', async () => {
    const tool = byName.get('proposeOrder');
    const executeSpy = jest.spyOn(tool, 'execute');

    const cyclic = {
      cafeteriaId: 'cafe',
      items: [{ menuItemId: 'rice', quantity: 1 }],
    };
    cyclic.self = cyclic;

    await expect(runTool('proposeOrder', { uid: 'u1', schoolId: 'pu' }, cyclic)).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    expect(executeSpy).not.toHaveBeenCalled();

    const withGetter = {
      cafeteriaId: 'cafe',
      get items() {
        return [{ menuItemId: 'rice', quantity: 1 }];
      },
    };
    await expect(runTool('proposeOrder', { uid: 'u1', schoolId: 'pu' }, withGetter)).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    expect(executeSpy).not.toHaveBeenCalled();
  });

  test('allows normal quiz answers through preflight into execute', async () => {
    const tool = byName.get('submitQuizAttempt');
    const executeSpy = jest.spyOn(tool, 'execute').mockResolvedValue({ success: true, summary: 'ok' });

    const input = {
      quizId: 'quiz',
      courseSpaceId: 'course',
      answers: [{ questionId: 'q1', value: 'a' }],
    };
    const out = await runTool('submitQuizAttempt', { uid: 'u1', schoolId: 'pu' }, input);
    expect(out).toEqual({ success: true, summary: 'ok' });
    expect(executeSpy).toHaveBeenCalledWith({ uid: 'u1', schoolId: 'pu' }, input);
  });

  test('allows internal optional undefined fields', async () => {
    const tool = byName.get('getAssignments');
    const executeSpy = jest
      .spyOn(tool, 'execute')
      .mockResolvedValue({ success: true, assignments: [] });

    await expect(
      runTool('getAssignments', { uid: 'u1', schoolId: 'pu' }, { preferredGroupId: undefined }),
    ).resolves.toMatchObject({ success: true });
    expect(executeSpy).toHaveBeenCalled();
  });
});
