import { getSupabaseClient } from '../services/supabaseClient';
import { isLmsV2Enabled } from '../services/lmsV2FeatureFlag';
import {
  loadLmsQuizWorkspace, beginLmsQuizAttempt, storeLmsQuizAnswer, finishLmsQuizAttempt,
} from '../services/lmsV2QuizDelivery';

jest.mock('../services/supabaseClient', () => ({ getSupabaseClient: jest.fn() }));
jest.mock('../services/lmsV2FeatureFlag', () => ({ isLmsV2Enabled: jest.fn(() => true) }));

const userId = '11111111-1111-4111-8111-111111111111';
const courseId = '22222222-2222-4222-8222-222222222222';
const quizId = '33333333-3333-4333-8333-333333333333';
const attemptId = '44444444-4444-4444-8444-444444444444';
const questionId = '55555555-5555-4555-8555-555555555555';
const otherId = '66666666-6666-4666-8666-666666666666';

function fixture() {
  const quiz = {
    id: quizId, course_id: courseId, title: '資料庫小考', max_attempts: 2,
    time_limit_seconds: 900, enforce_time_limit: true, pool_pick_count: null,
  };
  const current = {
    id: attemptId, quiz_id: quizId, student_id: userId,
    attempt_no: 1, started_at: '2026-10-26T11:00:00Z',
    submitted_at: null as string | null, score: null as number | null,
    drawn_question_ids: null as string[] | null,
  };
  const question = {
    id: questionId, quiz_id: quizId, question_type: 'single',
    prompt: '選出正確答案', choices: [{ id: 'a', label: '甲' }, { id: 'b', label: '乙' }],
    points: 5,
  };
  const state = {
    attempts: [] as typeof current[],
    questions: [question],
    answers: [] as Array<{ question_id: string; answer: unknown }>,
    quizError: null as Error | null,
    rpcError: null as Error | null,
    refuseReceipt: false,
    writes: [] as Array<{ table: string; payload: any; options?: unknown }>,
    calls: [] as string[],
  };
  const sb = {
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }),
    },
    rpc: jest.fn(async (name: string, args: Record<string, string>) => {
      if (state.rpcError) return { data: null, error: state.rpcError };
      if (name === 'start_quiz_attempt') {
        state.attempts = [{ ...current }];
        return { data: attemptId, error: null };
      }
      if (name === 'submit_quiz_attempt') {
        state.attempts = state.attempts.map((a) =>
          a.id === args.p_attempt_id
            ? { ...a, score: 0, submitted_at: '2026-10-26T11:15:00Z' }
            : a);
        return { data: 0, error: null };
      }
      return { data: null, error: new Error('Unknown RPC') };
    }),
    from: jest.fn((table: string) => {
      state.calls.push(table);
      const filters: Record<string, unknown> = {};
      let writing: { payload: any; options?: unknown } | null = null;
      let clearing = false;
      const q: any = {};
      q.select = jest.fn().mockReturnValue(q);
      q.eq = jest.fn((column: string, value: unknown) => {
        filters[column] = value;
        return q;
      });
      q.order = jest.fn().mockReturnValue(q);
      q.limit = jest.fn(async (limit: number) => {
        // The query builder is then-able in production; make the terminal list awaitable here.
        if (table === 'quiz_attempts') return { data: state.attempts.slice(0, limit), error: null };
        if (table === 'quiz_questions') return { data: state.questions.slice(0, limit), error: null };
        if (table === 'quiz_answers') return { data: state.answers.slice(0, limit), error: null };
        return { data: [], error: null };
      });
      q.upsert = jest.fn((payload: any, options?: unknown) => {
        writing = { payload, options };
        state.writes.push({ table, payload, options });
        return q;
      });
      q.delete = jest.fn(() => { clearing = true; return q; });
      q.maybeSingle = jest.fn(async () => {
        if (table === 'quizzes') return {
          data: state.quizError ? null : quiz, error: state.quizError,
        };
        if (table === 'quiz_attempts') {
          const found = state.attempts.find((a) =>
            (!filters.id || filters.id === a.id) &&
            (!filters.quiz_id || filters.quiz_id === a.quiz_id) &&
            (!filters.student_id || filters.student_id === a.student_id));
          return { data: state.refuseReceipt ? null : found ?? null, error: null };
        }
        if (table === 'quiz_questions') {
          return { data: state.questions.find((a) => a.id === filters.id) ?? null, error: null };
        }
        if (table === 'quiz_answers') {
          const match = state.answers.find((a) => a.question_id === filters.question_id);
          return { data: match ?? null, error: null };
        }
        return { data: null, error: null };
      });
      q.single = jest.fn(async () => {
        if (table === 'quiz_answers' && writing) {
          if (state.refuseReceipt) return { data: null, error: null };
          return { data: {
            attempt_id: writing.payload.attempt_id,
            question_id: writing.payload.question_id,
            answer: writing.payload.answer,
          }, error: null };
        }
        return { data: null, error: null };
      });
      q.then = (resolve: (result: unknown) => void) => {
        if (clearing) {
          state.answers = state.answers.filter((a) => a.question_id !== filters.question_id);
          return Promise.resolve({ data: [], error: null }).then(resolve);
        }
        return Promise.resolve({ data: [], error: null }).then(resolve);
      };
      return q;
    }),
  };
  jest.mocked(getSupabaseClient).mockReturnValue(sb as any);
  return { state, sb, current };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(isLmsV2Enabled).mockReturnValue(true);
});

test('opening a quiz reads metadata without creating an attempt or exposing questions', async () => {
  const { sb, state } = fixture();
  const workspace = await loadLmsQuizWorkspace(courseId, quizId);
  expect(workspace.attempt).toBeNull();
  expect(workspace.questions).toEqual([]);
  expect(sb.rpc).not.toHaveBeenCalled();
  expect(state.calls).not.toContain('quiz_questions');
});

test('the start button uses RPC and resumes an existing attempt without consuming another', async () => {
  const { sb, state } = fixture();
  const started = await beginLmsQuizAttempt({ courseId, quizId });
  expect(started.success).toBe(true);
  expect(sb.rpc).toHaveBeenCalledWith('start_quiz_attempt', { p_quiz_id: quizId });
  const reopened = await beginLmsQuizAttempt({ courseId, quizId });
  expect(reopened.success).toBe(true);
  expect(state.attempts).toHaveLength(1);
  expect(sb.rpc).toHaveBeenCalledTimes(1);
});

test('loads only drawn questions and converts the persisted JSON answer back to an input', async () => {
  const { state, current } = fixture();
  state.attempts = [{ ...current, drawn_question_ids: [questionId] }];
  state.questions.push({
    ...state.questions[0], id: otherId, prompt: '未抽中的題目',
  });
  state.answers = [{ question_id: questionId, answer: { optionIds: ['a'] } }];
  const workspace = await loadLmsQuizWorkspace(courseId, quizId);
  expect(workspace.questions.map((q) => q.id)).toEqual([questionId]);
  expect(workspace.answers).toEqual({ [questionId]: 'a' });
});

test('answer storage matches actual SQL columns and requires a matching receipt', async () => {
  const { state, current } = fixture();
  state.attempts = [{ ...current }];
  const saved = await storeLmsQuizAnswer({ attemptId, questionId, answer: 'a' });
  expect(saved.success).toBe(true);
  expect(state.writes).toEqual([{
    table: 'quiz_answers',
    payload: { attempt_id: attemptId, question_id: questionId, answer: { optionIds: ['a'] } },
    options: { onConflict: 'attempt_id,question_id' },
  }]);
  state.refuseReceipt = true;
  expect((await storeLmsQuizAnswer({ attemptId, questionId, answer: 'a' })).success).toBe(false);
});

test('finishing a quiz calls server scoring and verifies the zero-point receipt', async () => {
  const { state, current, sb } = fixture();
  state.attempts = [{ ...current }];
  const result = await finishLmsQuizAttempt({ attemptId });
  expect(result.success).toBe(true);
  expect(sb.rpc).toHaveBeenCalledWith('submit_quiz_attempt', { p_attempt_id: attemptId });
  expect(result.summary).toContain('伺服器已確認');
  const again = await finishLmsQuizAttempt({ attemptId });
  expect(again.success).toBe(true);
  expect(sb.rpc).toHaveBeenCalledTimes(1);
});

test('server failure and incomplete receipt never create a fake successful attempt', async () => {
  const { state, current } = fixture();
  state.rpcError = new Error('Connection lost');
  expect((await beginLmsQuizAttempt({ courseId, quizId })).success).toBe(false);
  state.rpcError = null;
  state.attempts = [{ ...current }];
  state.refuseReceipt = true;
  expect((await finishLmsQuizAttempt({ attemptId })).success).toBe(false);
});
