import {
  quizOptions, quizAnswerInput, quizAnswerPayload,
} from '../services/lmsV2QuizModels';

test('uses stable IDs for teacher-authored options and rejects malformed choices', () => {
  expect(quizOptions([{ id: 'a', label: '選項甲' }, { id: 'b', text: '選項乙' }])).toEqual([
    { id: 'a', label: '選項甲' }, { id: 'b', label: '選項乙' },
  ]);
  expect(quizOptions({ options: [{ id: 'a', label: '甲' }, { id: 'a', label: '重複' }] }))
    .toEqual([{ id: 'a', label: '甲' }]);
  expect(quizOptions([{ text: '缺少 ID' }])).toEqual([]);
});

test('encodes five question types to the existing server scoring JSON contract', () => {
  const choices = [{ id: 'a', label: '甲' }, { id: 'b', label: '乙' }];
  expect(quizAnswerPayload('single', 'a', choices)).toEqual({ optionIds: ['a'] });
  expect(quizAnswerPayload('multiple', ['b', 'a', 'b'], choices))
    .toEqual({ optionIds: ['a', 'b'] });
  expect(quizAnswerPayload('boolean', false)).toEqual({ value: false });
  expect(quizAnswerPayload('short', '  HELLO  ')).toEqual({ text: 'HELLO' });
  expect(quizAnswerPayload('essay', '申論內容')).toEqual({ text: '申論內容' });
  expect(quizAnswerPayload('essay', '  ')).toBeNull();
  expect(quizAnswerPayload('single', null, choices)).toBeNull();
  expect(quizAnswerPayload('multiple', [], choices)).toBeNull();
});

test('rejects foreign options and unsuitable input instead of silently misgrading', () => {
  const choices = [{ id: 'one', label: '合法選項' }];
  expect(() => quizAnswerPayload('single', 'other', choices)).toThrow();
  expect(() => quizAnswerPayload('single', 'one', [])).toThrow();
  expect(() => quizAnswerPayload('boolean', 'true')).toThrow();
  expect(() => quizAnswerPayload('essay', 'x'.repeat(8001))).toThrow();
  expect(() => quizAnswerPayload('unknown', 'word')).toThrow();
});

test('restores server answers including boolean false and empty multiple answers', () => {
  expect(quizAnswerInput('single', { optionIds: ['a'] })).toBe('a');
  expect(quizAnswerInput('multiple', { optionIds: [] })).toEqual([]);
  expect(quizAnswerInput('boolean', { value: false })).toBe(false);
  expect(quizAnswerInput('short', { text: '答題內容' })).toBe('答題內容');
  expect(quizAnswerInput('essay', { text: '申論' })).toBe('申論');
  expect(quizAnswerInput('essay', null)).toBeNull();
});
