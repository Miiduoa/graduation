import { render } from '@testing-library/react';
import { expect, it } from 'vitest';
import { parseTutorExplanation, studySourceFromText } from '@/lib/studyTutor';
import { buildCourseStudyNotes } from './courseStudyNotes';
import { parseCourseStudyProgress, serializeCourseStudyProgress } from './courseStudyProgress';
import { appendStudyLesson, canReviewStudyAnswer, emptyStudyPassage } from './courseStudySession';
import { locateStudyEvidence } from './studyEvidence';
import { StudySourceTables } from './StudySourceTables';
import { extractStudySourceTables } from './studySourceTables';

// Baseline outputs from 2232ee5c9e4340fc6fba8ca56c2916f976fa4bbb.
const percentageMeters = [[25, 100], [75, 100]];
const tableText = (header: string, first: string, second: string) =>
  ['| 組別 | ' + header + ' |', '| --- | --- |', '| 甲 | ' + first + ' |', '| 乙 | ' + second + ' |'].join('\n');

it.each([
  ['visibility:hidden', 'visibility:var(--state)', '', 0, 0],
  ['visibility:hidden', 'visibility:var(--state)', '.elsewhere { --state:visible }', 0, 0],
  ['visibility:collapse', 'visibility:var(--state, var(--other))', '.elsewhere { --state:visible }', 0, 0],
  ['visibility:hidden', '--state:bogus;visibility:var(--state)', '', 0, 0],
  ['visibility:hidden', '--state:var(--state);visibility:var(--state)', '', 0, 0],
  ['visibility:visible', 'visibility:var(--state)', '.elsewhere { --state:hidden }', 1, 1],
  ['display:none', 'display:var(--state)', '.elsewhere { --state:block }', 0, 0],
  ['content-visibility:hidden', 'content-visibility:var(--state)', '', 0, 0],
  ['opacity:0', 'opacity:var(--state)', '', 0, 0],
  ['', 'display:var(--state);display:block', '.elsewhere { --state:none }', 1, 1],
  ['', 'display:var(--state, block)', '', 1, 1],
  ['', 'display:none;display:var(--state)', '', 1, 1],
  ['', 'content-visibility:hidden;content-visibility:var(--state)', '', 1, 1],
  ['', 'opacity:0;opacity:var(--state)', '', 1, 1],
  ['', 'visibility:var(--state, hidden)', '', 1, 0],
  ['', '--state:collapse;visibility:var(--state)', '', 1, 0],
])('compares hidden-table extraction for parent %s, child %s, stylesheet %s', (parent, child, css, baseline, expected) => {
  const source = [`<div style="${parent}">`, `<section style="${child}">`, tableText('完成率', '25%', '75%'),
    '</section>', '</div>', css && `<style>${css}</style>`].join('\n');
  const count = extractStudySourceTables(source).length;
  expect(count).toBe(expected);
  expect(count).toBeLessThanOrEqual(baseline);
});

it.each([
  { header: 'Percentage by Temperature', values: ['25%', '75%'], baseline: percentageMeters },
  { header: 'Completion Rate per pH', values: ['25%', '75%'], baseline: percentageMeters },
  { header: 'Percentage by Revenue Growth', values: ['25%', '75%'], baseline: [], change: percentageMeters },
  { header: 'Coverage by Student ID (%)', values: ['25%', '75%'], baseline: percentageMeters },
  { header: '完成率 按氣溫', values: ['25%', '75%'], baseline: percentageMeters },
  { header: '百分比依溫度', values: ['25%', '75%'], baseline: percentageMeters },
  { header: '按分貝分組統計通過率', values: ['25%', '75%'], baseline: percentageMeters },
  { header: '依溫度正確率', values: ['25%', '75%'], baseline: percentageMeters },
  { header: '風險等級百分比', values: ['25%', '75%'], baseline: percentageMeters },
  { header: 'Count by Week', values: ['25', '75'], baseline: [[25, 75], [75, 75]] },
  { header: 'Temperature by Room', values: ['25', '75'], baseline: [] },
  { header: 'Return Percentage by Region', values: ['25%', '75%'], baseline: [] },
  { header: 'Percentage by Temperature', values: ['25%', '101%'], baseline: [] },
  { header: '金額', values: ['123456.01', '123456.02'], baseline: [[123456.01, 123456.02], [123456.02, 123456.02]] },
  { header: '金額', values: ['1,200.1', '1,200.10'], baseline: [], change: [[1200.1, 1200.1], [1200.1, 1200.1]] },
  { header: '金額', values: ['90,000,000,000,000.02', '90,000,000,000,000.03'], baseline: [],
    change: [[90000000000000.02, 90000000000000.03], [90000000000000.03, 90000000000000.03]] },
  { header: '金額', values: ['90,000,000,000,000.01', '90,000,000,000,000.02'], baseline: [] },
  { header: '金額', values: ['90,000,000,000,000.1', '90,000,000,000,000.09'], baseline: [] },
  { header: '金額', values: ['9,007,199,254,740,992', '9,007,199,254,740,994'], baseline: [] },
])('compares chart scales and exact source cells for $header and $values', ({ header, values, baseline, change }) => {
  const { container } = render(<StudySourceTables text={tableText(header, values[0], values[1])} />);
  expect(Array.from(container.querySelectorAll('td'), (cell) => cell.textContent)).toEqual(values);
  expect(Array.from(container.querySelectorAll('meter'), (meter) => [meter.value, meter.max]))
    .toEqual(change ?? baseline);
});

const context = {
  scope: { platformAccountId: 'pa_11111111-1111-4111-8111-111111111111', workspaceId: 'cw_22222222-2222-4222-8222-222222222222' },
  position: { sectionIndex: 0, passageIndex: 0, mode: 'understand' as const },
  source: studySourceFromText({ id: 'lesson', title: '標點', text: '原文說明，。' }),
};
const reply = { title: '句讀', explanation: '逗號與句號的功能不同。', sourceQuote: '，。',
  question: '哪一個符號表示一句話結束？', answer: '句號標示句子結束。' };

it.each([1, 2])('matches v%i backup reveal and TXT behavior', (version) => {
  const cases = [
    { draft: '', review: false }, { draft: ' \t\n', review: false }, { draft: '\ufeff', review: false },
    { draft: '\u200b', review: true }, { draft: '\u0301', review: true }, { draft: '\u2800', review: true },
    { draft: ' \u200e\u2060 ', review: true }, { draft: 'e\u0301', review: true }, { draft: '，。', review: true },
  ];
  for (const { draft, review } of cases) {
    const noteOnly = { ...emptyStudyPassage(), note: draft };
    const raw = JSON.parse(serializeCourseStudyProgress({ ...context, passages: { '0:0': noteOnly } }));
    const restoredNotes = parseCourseStudyProgress(JSON.stringify({ ...raw, version }), context.scope);
    expect(buildCourseStudyNotes('國文', context.source, restoredNotes.passages).includes('我的筆記：\n' + draft))
      .toBe(review);
    for (const answerVisible of review ? [false, true] : [false]) {
      const memory = appendStudyLesson(noteOnly, 'understand', { question: '', response: reply });
      Object.assign(memory.modes.understand.lessons[0], { attempt: draft, answerVisible });
      const backup = JSON.parse(serializeCourseStudyProgress({ ...context, passages: { '0:0': memory } }));
      const restored = parseCourseStudyProgress(JSON.stringify({ ...backup, version }), context.scope);
      const lesson = restored.passages['0:0'].modes.understand.lessons[0];
      expect(canReviewStudyAnswer(lesson)).toBe(review);
      const output = buildCourseStudyNotes('國文', context.source, restored.passages);
      expect(output.includes('我的試答：\n' + draft)).toBe(review);
      expect(output.includes('參考回答（已展開）：')).toBe(answerVisible);
    }
  }
});

it.each([
  { quote: '，。', text: '校對，。標點', baseline: true },
  { quote: '，\u200e。', text: '校對，\u200e。標點', baseline: true },
  { quote: 'က္က', text: '校對က္က標點', baseline: true },
  { quote: 'က္', text: '校對က္က標點', baseline: true, change: false },
  { quote: 'e', text: '校對e\u0301標點', baseline: true, change: false },
  { quote: '\u200b', text: '校對\u200b標點', baseline: true, change: false },
  { quote: '\u2800', text: '校對\u2800標點', baseline: true, change: false },
  { quote: ' ', text: '校對 標點', baseline: false },
  { quote: '。', text: '校對，標點', baseline: false },
  // An unpaired direction override within readable text still matches the source verbatim.
  { quote: '甲\u202e乙', text: '校對甲\u202e乙標點', baseline: true },
])('compares generated citation parsing and evidence location for $quote', ({ quote, text, baseline, change }) => {
  const passage = { id: 'lesson:1', label: '原文', text };
  const response = { ...reply, sourceQuote: quote };
  const accepted = change ?? baseline;
  expect(!!locateStudyEvidence(text, quote)).toBe(accepted);
  const parse = () => parseTutorExplanation(JSON.stringify(response), passage);
  if (accepted) expect(parse().sourceQuote).toBe(quote);
  else expect(parse).toThrow();
});
