// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  createNuniClasses,
  NuniError,
  parseNuniAssignment,
  parseNuniMaterial,
  parseNuniQuiz,
  parseNuniQuizResponse,
  parseNuniSubmission,
  parseNuniUnit,
} from '@campus/shared/src/nuni';

const workspaceId = 'cw_11111111-1111-4111-8111-111111111111';
const otherWorkspace = 'cw_99999999-9999-4999-8999-999999999999';
const accountId = 'pa_22222222-2222-4222-8222-222222222222';
const otherAccount = 'pa_99999999-9999-4999-8999-999999999999';
const assignmentId = 'cwa_33333333-3333-4333-8333-333333333333';
const quizId = 'cwq_44444444-4444-4444-8444-444444444444';
const unitId = 'cwu_55555555-5555-4555-8555-555555555555';
const timestamp = '2026-10-08T01:00:00.000Z';
const key = 'same-attempt-key';
const common = {
  workspaceId,
  title: '課堂討論',
  state: 'open',
  createdAt: timestamp,
  closedAt: null,
  dueAt: null,
  unitId: null,
  unitTitle: null,
};
const unit = { id: unitId, workspaceId, title: '第一章', position: 0, createdAt: timestamp };
const material = {
  id: 'cwm_66666666-6666-4666-8666-666666666666',
  workspaceId,
  title: '閱讀材料',
  body: '閱讀 https://example.edu/lesson',
  unitId,
  unitTitle: '第一章',
  createdByPlatformAccountId: accountId,
  createdAt: timestamp,
};
const submission = {
  assignmentId,
  platformAccountId: accountId,
  displayName: '同學',
  body: '我的觀察',
  state: 'submitted',
  submittedAt: timestamp,
  teacherFeedback: null,
  reviewedAt: null,
};
const answer = {
  quizId,
  platformAccountId: accountId,
  displayName: '同學',
  answer: '理由如下',
  state: 'submitted',
  submittedAt: timestamp,
  teacherFeedback: null,
  reviewedAt: null,
};
const assignment = {
  ...common,
  id: assignmentId,
  instructions: '提出觀察',
  submissionCount: 0,
  mySubmission: null,
};
const quiz = { ...common, id: quizId, prompt: '說明你的理由', responseCount: 0, myResponse: null };
const invalidResponse = { status: 502, code: 'INVALID_RESPONSE' };

describe('Nuni course response contracts', () => {
  it('keeps exact server projections and omits unsupported grade or privilege fields', () => {
    expect(parseNuniUnit(unit)).toEqual(unit);
    expect(parseNuniMaterial({ ...material, accessToken: 'unrelated' })).toEqual(material);
    expect(parseNuniAssignment(assignment)).toEqual(assignment);
    expect(parseNuniSubmission({ ...submission, grade: 100 })).toEqual(submission);
    expect(parseNuniQuiz(quiz)).toEqual(quiz);
    expect(parseNuniQuizResponse({ ...answer, grade: 100 })).toEqual(answer);
  });

  it.each([
    ['material identifier', () => parseNuniMaterial({ ...material, id: quizId })],
    ['unit position', () => parseNuniUnit({ ...unit, position: -1 })],
    ['fractional count', () => parseNuniQuiz({ ...quiz, responseCount: 0.5 })],
    ['string count', () => parseNuniQuiz({ ...quiz, responseCount: '0' })],
    ['missing prompt', () => parseNuniQuiz({ ...quiz, prompt: undefined })],
    ['empty prompt', () => parseNuniQuiz({ ...quiz, prompt: ' ' })],
    ['empty material body', () => parseNuniMaterial({ ...material, body: '' })],
    [
      'empty saved feedback',
      () => parseNuniSubmission({ ...submission, teacherFeedback: '', reviewedAt: timestamp }),
    ],
    ['bad date', () => parseNuniMaterial({ ...material, createdAt: 'yesterday' })],
    ['missing unit name', () => parseNuniMaterial({ ...material, unitTitle: null })],
    ['missing review timestamp', () => parseNuniQuizResponse({ ...answer, reviewedAt: undefined })],
    [
      'feedback without review timestamp',
      () => parseNuniSubmission({ ...submission, teacherFeedback: '請補充' }),
    ],
    ['oversized answer', () => parseNuniQuizResponse({ ...answer, answer: 'x'.repeat(2001) })],
    ['closed without timestamp', () => parseNuniQuiz({ ...quiz, state: 'closed' })],
    [
      'nested wrong quiz',
      () =>
        parseNuniQuiz({
          ...quiz,
          myResponse: { ...answer, quizId: quizId.replace('44444444', '77777777') },
        }),
    ],
    [
      'nested wrong assignment',
      () =>
        parseNuniAssignment({
          ...assignment,
          mySubmission: {
            ...submission,
            assignmentId: assignmentId.replace('33333333', '77777777'),
          },
        }),
    ],
  ])('rejects malformed %s', (_label, run) => expect(run).toThrow(NuniError));

  it('binds every list and creation result to the requested workspace', async () => {
    const badUnit = { ...unit, workspaceId: otherWorkspace };
    const badMaterial = { ...material, workspaceId: otherWorkspace };
    const badQuiz = { ...quiz, workspaceId: otherWorkspace };
    const badAssignment = { ...assignment, workspaceId: otherWorkspace };
    await expect(
      createNuniClasses(async () => ({ units: [badUnit] })).units(workspaceId),
    ).rejects.toMatchObject(invalidResponse);
    await expect(
      createNuniClasses(async () => badUnit).createUnit(workspaceId, {
        title: '一',
        idempotencyKey: key,
      }),
    ).rejects.toMatchObject(invalidResponse);
    await expect(
      createNuniClasses(async () => ({ materials: [badMaterial] })).materials(workspaceId),
    ).rejects.toMatchObject(invalidResponse);
    await expect(
      createNuniClasses(async () => badMaterial, accountId).createMaterial(workspaceId, {
        title: '一',
        body: '二',
        idempotencyKey: key,
      }),
    ).rejects.toMatchObject(invalidResponse);
    await expect(
      createNuniClasses(async () => ({ quizzes: [badQuiz] })).quizzes(workspaceId),
    ).rejects.toMatchObject(invalidResponse);
    await expect(
      createNuniClasses(async () => badQuiz).createQuiz(workspaceId, {
        title: '一',
        prompt: '二',
        dueAt: null,
        idempotencyKey: key,
      }),
    ).rejects.toMatchObject(invalidResponse);
    await expect(
      createNuniClasses(async () => badAssignment).createAssignment(workspaceId, {
        title: '一',
        instructions: '二',
        dueAt: null,
        idempotencyKey: key,
      }),
    ).rejects.toMatchObject(invalidResponse);
    await expect(
      createNuniClasses(async () => ({
        id: otherWorkspace,
        title: '其他課程',
        state: 'active',
        memberRole: 'student',
      })).get(workspaceId),
    ).rejects.toMatchObject(invalidResponse);
  });

  it('does not accept absent envelopes as an empty course', async () => {
    for (const method of ['units', 'materials', 'quizzes'] as const) {
      await expect(createNuniClasses(async () => ({}))[method](workspaceId)).rejects.toMatchObject(
        invalidResponse,
      );
      await expect(
        createNuniClasses(async () => ({ [method]: null }))[method](workspaceId),
      ).rejects.toMatchObject(invalidResponse);
    }
  });

  it('binds private responses to the signed-in account, including list reads', async () => {
    const ownQuiz = { ...quiz, responseCount: 1, myResponse: answer };
    const ownAssignment = { ...assignment, submissionCount: 1, mySubmission: submission };
    await expect(
      createNuniClasses(async () => ownQuiz, otherAccount).submitQuiz(
        workspaceId,
        quizId,
        '答案',
        key,
      ),
    ).rejects.toMatchObject(invalidResponse);
    await expect(
      createNuniClasses(async () => ({ quizzes: [ownQuiz] }), otherAccount).quizzes(workspaceId),
    ).rejects.toMatchObject(invalidResponse);
    await expect(
      createNuniClasses(async () => ownAssignment, otherAccount).submit(
        workspaceId,
        assignmentId,
        '內容',
        key,
      ),
    ).rejects.toMatchObject(invalidResponse);
    await expect(
      createNuniClasses(async () => ({ assignments: [ownAssignment] }), otherAccount).assignments(
        workspaceId,
      ),
    ).rejects.toMatchObject(invalidResponse);
    await expect(
      createNuniClasses(async () => ownQuiz).submitQuiz(workspaceId, quizId, '答案', key),
    ).rejects.toMatchObject(invalidResponse);
    await expect(
      createNuniClasses(async () => material, otherAccount).createMaterial(workspaceId, {
        title: '一',
        body: '二',
        idempotencyKey: key,
      }),
    ).rejects.toMatchObject(invalidResponse);
    await expect(
      createNuniClasses(
        async () => ownQuiz,
        async () => {
          throw new NuniError(401, 'SESSION_EXPIRED');
        },
      ).submitQuiz(workspaceId, quizId, '答案', key),
    ).rejects.toMatchObject({ status: 401, code: 'SESSION_EXPIRED' });
  });

  it('checks submission targets and requires an actual saved response', async () => {
    await expect(
      createNuniClasses(async () => quiz, accountId).submitQuiz(workspaceId, quizId, '答案', key),
    ).rejects.toMatchObject(invalidResponse);
    const differentQuiz = { ...quiz, id: quizId.replace('44444444', '77777777') };
    await expect(
      createNuniClasses(async () => differentQuiz, accountId).submitQuiz(
        workspaceId,
        quizId,
        '答案',
        key,
      ),
    ).rejects.toMatchObject(invalidResponse);
    await expect(
      createNuniClasses(async () => ({
        responses: [{ ...answer, quizId: differentQuiz.id }],
      })).quizResponses(workspaceId, quizId),
    ).rejects.toMatchObject(invalidResponse);
    await expect(
      createNuniClasses(async () => ({
        submissions: [
          { ...submission, assignmentId: assignmentId.replace('33333333', '77777777') },
        ],
      })).submissions(workspaceId, assignmentId),
    ).rejects.toMatchObject(invalidResponse);
  });

  it('binds feedback to the requested student and activity and requires persisted review metadata', async () => {
    const reviewedAnswer = { ...answer, teacherFeedback: '補充例子', reviewedAt: timestamp };
    const reviewedSubmission = {
      ...submission,
      teacherFeedback: '補充例子',
      reviewedAt: timestamp,
    };
    for (const value of [
      answer,
      { ...reviewedAnswer, platformAccountId: otherAccount },
      { ...reviewedAnswer, quizId: quizId.replace('44444444', '77777777') },
    ]) {
      await expect(
        createNuniClasses(async () => value).quizFeedback(
          workspaceId,
          quizId,
          accountId,
          '補充例子',
          key,
        ),
      ).rejects.toMatchObject(invalidResponse);
    }
    for (const value of [
      submission,
      { ...reviewedSubmission, platformAccountId: otherAccount },
      { ...reviewedSubmission, assignmentId: assignmentId.replace('33333333', '77777777') },
    ]) {
      await expect(
        createNuniClasses(async () => value).assignmentFeedback(
          workspaceId,
          assignmentId,
          accountId,
          '補充例子',
          key,
        ),
      ).rejects.toMatchObject(invalidResponse);
    }
  });

  it('preserves idempotency replay semantics when a later edit changed saved contents', async () => {
    const savedAnswer = {
      ...quiz,
      responseCount: 1,
      myResponse: { ...answer, answer: '稍後修改的答案' },
    };
    const transport = vi.fn(async () => savedAnswer);
    expect(
      (
        await createNuniClasses(transport, accountId).submitQuiz(
          workspaceId,
          quizId,
          '較早答案',
          key,
        )
      ).myResponse?.answer,
    ).toBe('稍後修改的答案');
    expect(transport).toHaveBeenCalledWith(
      `class-workspaces/${workspaceId}/quizzes/${quizId}/submit`,
      { answer: '較早答案', idempotencyKey: key },
    );
    const savedFeedback = { ...answer, teacherFeedback: '後來的回饋', reviewedAt: timestamp };
    expect(
      await createNuniClasses(async () => savedFeedback).quizFeedback(
        workspaceId,
        quizId,
        accountId,
        '原本的回饋',
        key,
      ),
    ).toEqual(savedFeedback);
    expect(
      await createNuniClasses(async () => material, accountId).createMaterial(workspaceId, {
        title: '原本標題',
        body: '原本內容',
        idempotencyKey: key,
      }),
    ).toEqual(material);
  });

  it('requires confirmed closed state and preserves close conflicts without automatic replay', async () => {
    await expect(
      createNuniClasses(async () => quiz).closeQuiz(workspaceId, quizId),
    ).rejects.toMatchObject(invalidResponse);
    const closed = { ...quiz, state: 'closed', closedAt: timestamp };
    const transport = vi.fn(async () => closed);
    expect(await createNuniClasses(transport).closeQuiz(workspaceId, quizId)).toEqual(closed);
    expect(transport).toHaveBeenCalledExactlyOnceWith(
      `class-workspaces/${workspaceId}/quizzes/${quizId}/close`,
      {},
    );
    const closedAssignment = { ...assignment, state: 'closed', closedAt: timestamp };
    expect(
      await createNuniClasses(async () => closedAssignment).closeAssignment(
        workspaceId,
        assignmentId,
      ),
    ).toEqual(closedAssignment);
    const conflict = vi.fn(async () => {
      throw new NuniError(409, 'CLASS_WORKSPACE_QUIZ_CLOSED');
    });
    await expect(createNuniClasses(conflict).closeQuiz(workspaceId, quizId)).rejects.toMatchObject({
      status: 409,
      code: 'CLASS_WORKSPACE_QUIZ_CLOSED',
    });
    expect(conflict).toHaveBeenCalledTimes(1);
  });

  it('rejects IDs that could escape the selected resource before transport', async () => {
    const transport = vi.fn();
    const classes = createNuniClasses(transport, accountId);
    await expect(classes.materials('../other')).rejects.toMatchObject(invalidResponse);
    await expect(
      classes.quizFeedback(workspaceId, quizId, '../other', '內容', key),
    ).rejects.toMatchObject(invalidResponse);
    expect(transport).not.toHaveBeenCalled();
  });
});
