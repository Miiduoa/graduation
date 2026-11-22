import { fireEvent, render, within } from '@testing-library/react';
import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import { parseTutorExplanation, splitStudySection, studySourceFromText } from '@/lib/studyTutor';
import { buildCourseStudyNotes } from './courseStudyNotes';
import { parseCourseStudyProgress, serializeCourseStudyProgress } from './courseStudyProgress';
import { appendStudyLesson, canReviewStudyAnswer, emptyStudyPassage } from './courseStudySession';
import { locateStudyEvidence } from './studyEvidence';
import { StudySourceTables } from './StudySourceTables';
import { extractStudySourceTables } from './studySourceTables';
import { extractStudySourceTables as extractBaselineTables } from './__fixtures__/courseStudyMergeBase/studySourceTables';
import { sourcePercentRows, sourceValueRows } from './__fixtures__/courseStudyMergeBase/chartRows';
import { parseTutorExplanation as parseBaselineExplanation } from './__fixtures__/courseStudyMergeBase/studyTutor';

import { CourseStudyPanel } from './CourseStudyPanel';
import { CourseStudyPassage } from './CourseStudyPassage';
import { CourseStudyPractice } from './CourseStudyPractice';
import { courseStudyBackupFilenameStem } from './courseStudyBackupFilename';
import * as practice from './courseStudyPractice';
import * as checkpoint from './courseStudyPracticeCheckpoint';
import { CourseStudyPanel as BaselinePanel } from './__fixtures__/courseStudyMergeBase/CourseStudyPanel';
import { CourseStudyPassage as BaselinePassage } from './__fixtures__/courseStudyMergeBase/CourseStudyPassage';
import { CourseStudyPractice as BaselinePractice } from './__fixtures__/courseStudyMergeBase/CourseStudyPractice';
import { StudySourceTables as BaselineTables } from './__fixtures__/courseStudyMergeBase/StudySourceTables';
import { buildCourseStudyNotes as baselineNotes } from './__fixtures__/courseStudyMergeBase/courseStudyNotes';
import { courseStudyBackupFilenameStem as baselineFilename } from './__fixtures__/courseStudyMergeBase/courseStudyBackupFilename';
import * as baselinePractice from './__fixtures__/courseStudyMergeBase/courseStudyPractice';
import * as baselineCheckpoint from './__fixtures__/courseStudyMergeBase/courseStudyPracticeCheckpoint';
import * as baselineProgress from './__fixtures__/courseStudyMergeBase/courseStudyProgress';
import * as baselineSession from './__fixtures__/courseStudyMergeBase/courseStudySession';
import { locateStudyEvidence as baselineEvidence } from './__fixtures__/courseStudyMergeBase/studyEvidence';

// Baseline outputs from 2232ee5c9e4340fc6fba8ca56c2916f976fa4bbb.
const percentageMeters = [[25, 100], [75, 100]];
const tableText = (header: string, first: string, second: string) =>
  ['| 組別 | ' + header + ' |', '| --- | --- |', '| 甲 | ' + first + ' |', '| 乙 | ' + second + ' |'].join('\n');

it.each([
  ['visibility:hidden', 'visibility:var(--state)', '', 0],
  ['visibility:hidden', 'visibility:var(--state)', '.elsewhere { --state:visible }', 0],
  ['visibility:collapse', 'visibility:var(--state, var(--other))', '.elsewhere { --state:visible }', 0],
  ['visibility:hidden', '--state:bogus;visibility:var(--state)', '', 0],
  ['visibility:hidden', '--state:var(--state);visibility:var(--state)', '', 0],
  ['visibility:visible', 'visibility:var(--state)', '.elsewhere { --state:hidden }', 1],
  ['display:none', 'display:var(--state)', '.elsewhere { --state:block }', 0],
  ['content-visibility:hidden', 'content-visibility:var(--state)', '', 0],
  ['opacity:0', 'opacity:var(--state)', '', 0],
  ['', 'display:var(--state);display:block', '.elsewhere { --state:none }', 1],
  ['', 'display:var(--state, block)', '', 1],
  ['', 'display:none;display:var(--state)', '', 1],
  ['', 'content-visibility:hidden;content-visibility:var(--state)', '', 1],
  ['', 'opacity:0;opacity:var(--state)', '', 1],
  ['', 'visibility:var(--state, hidden)', '', 1],
  ['', '--state:collapse;visibility:var(--state)', '', 1],
  ['', 'display:none; --mode:banana; display:var(--mode)', '', 1],
  ['', 'display:none;display:banana', '', 0],
  ['', 'display:none;display:banana block', '', 1],
  ['', 'display:none!important;display:var(--state)', '', 0],
  ['', 'display:none!important;display:var(--state)!important', '', 1],
  ['', 'visibility:hidden;visibility:var(--state)', '', 1],
  ['', 'opacity:1e-99999', '', 1],
])('compares hidden-table extraction for parent %s, child %s, stylesheet %s', (parent, child, css, baseline) => {
  const source = [`<div style="${parent}">`, `<section style="${child}">`, tableText('完成率', '25%', '75%'),
    '</section>', '</div>', css && `<style>${css}</style>`].join('\n');
  const count = extractStudySourceTables(source).length;
  expect(count).toBe(baseline);
});

it.each([
  { header: '各百分等級的出席率', values: ['25%', '75%'], baseline: percentageMeters },
  { header: 'Percentage by Temperature', values: ['25%', '75%'], baseline: percentageMeters },
  { header: 'Completion Rate per pH', values: ['25%', '75%'], baseline: percentageMeters },
  { header: 'Percentage by Revenue Growth', values: ['25%', '75%'], baseline: [] },
  { header: 'Coverage by Student ID (%)', values: ['25%', '75%'], baseline: percentageMeters },
  { header: '完成率 按氣溫', values: ['25%', '75%'], baseline: percentageMeters },
  { header: '百分比依溫度', values: ['25%', '75%'], baseline: percentageMeters },
  { header: '按分貝分組統計通過率', values: ['25%', '75%'], baseline: percentageMeters },
  { header: '依溫度正確率', values: ['25%', '75%'], baseline: percentageMeters },
  { header: '風險等級百分比', values: ['25%', '75%'], baseline: percentageMeters },
  { header: 'Count by Week', values: ['25', '75'], baseline: [[25, 75], [75, 75]] },
  { header: 'Temperature by Room', values: ['25', '75'], baseline: [] },
  { header: 'Percentage by which revenue will increase', values: ['50%', '100%'], baseline: [] },
  { header: 'Return Percentage by Region', values: ['25%', '75%'], baseline: [] },
  { header: 'Percentage by Temperature', values: ['25%', '101%'], baseline: [] },
  { header: '金額', values: ['123456.01', '123456.02'], baseline: [[123456.01, 123456.02], [123456.02, 123456.02]] },
  { header: '金額', values: ['1,200.1', '1,200.10'], baseline: [] },
  { header: '金額', values: ['90,000,000,000,000.02', '90,000,000,000,000.03'], baseline: [] },
  { header: '金額', values: ['90,000,000,000,000.01', '90,000,000,000,000.02'], baseline: [] },
  { header: '金額', values: ['90,000,000,000,000.1', '90,000,000,000,000.09'], baseline: [] },
  { header: '金額', values: ['9,007,199,254,740,992', '9,007,199,254,740,994'], baseline: [] },
])('compares chart scales and exact source cells for $header and $values', ({ header, values, baseline }) => {
  const { container } = render(<StudySourceTables text={tableText(header, values[0], values[1])} />);
  expect(Array.from(container.querySelectorAll('td'), (cell) => cell.textContent)).toEqual(values);
  expect(Array.from(container.querySelectorAll('meter'), (meter) => [meter.value, meter.max]))
    .toEqual(baseline);
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
  { quote: 'က္', text: '校對က္က標點', baseline: true },
  { quote: 'e', text: '校對e\u0301標點', baseline: true },
  { quote: '\u200b', text: '校對\u200b標點', baseline: true },
  { quote: '\u2800', text: '校對\u2800標點', baseline: true },
  { quote: ' ', text: '校對 標點', baseline: false },
  { quote: '。', text: '校對，標點', baseline: false },
  // An unpaired direction override within readable text still matches the source verbatim.
  { quote: '甲\u202e乙', text: '校對甲\u202e乙標點', baseline: true },
])('compares generated citation parsing and evidence location for $quote', ({ quote, text, baseline }) => {
  const passage = { id: 'lesson:1', label: '原文', text };
  const response = { ...reply, sourceQuote: quote };
  expect(!!locateStudyEvidence(text, quote)).toBe(baseline);
  const parse = () => parseTutorExplanation(JSON.stringify(response), passage);
  if (baseline) expect(parse().sourceQuote).toBe(quote);
  else expect(parse).toThrow();
});

// Each suite starts with its own fixed seed. Failure messages include the exact input.
function seededPicker() {
  let state = 719;
  return <T,>(options: readonly T[]): T => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return options[Math.floor((state / 2 ** 32) * options.length)];
  };
}

const marks = ['', '\ufff9', '\ufffa', '\ufffb', '\u{e0100}', '禰\u{e0100}', 'က္က', '\u061c', '\u200e', '\u200f', '\u202a', '\u202e', '\u2066', '\u2069',
  '\u200b', '\u200c', '\u200d', '\u2060', '\ufeff', '\u034f', '\u0301', '\u2800'];
const headers = ['完成率', '出席率', 'Completion Rate', '版本更新次數', '版本', '版本總數',
  '編號', '識別碼', '學生識別碼總數', '題號', 'Version Count', 'Verification Code',
  '一次性驗證碼 (%)', 'ISBN', 'SKU', '貨號', '郵政編碼', '文件識別碼', '時間', '溫度', 'Percentage by Temperature', 'Percentage by which revenue will increase', 'Rate by Region'];
const chartVocabulary = [
  'Student Identifier by Attendance Rate', '百分位排名（%）', '百分位排名（％）',
  'Identifier', 'Student ID', 'Number', 'Course Code', 'Rank', 'Percentile',
  '排名', '百分位', '編號', 'Count by Student ID', 'Count per Course Code', 'Count each rank',
  'Percent Increase', '增幅 (%)', '依編號分組統計出席率', '按地區計算完成率',
  'Attendance Rate', 'Return Rate', '正答率', '速度', 'Transfer Rate',
];
const chartHeaders = chartVocabulary.flatMap((header) => [
  header,
  header + ' (%)',
  header.replace(/[!-~]/gu, (character) => String.fromCharCode(character.charCodeAt(0) + 0xfee0)),
]);
const chartValuePairs = [
  ['101', '202'], ['１０１', '２０２'], ['25%', '75%'], ['25％', '75％'],
  ['２５%', '７５%'], ['２５％', '７５％'], ['1,200', '2,300'], ['１，２００', '２，３００'],
];
const valuePairs = [['25%', '75%'], ['2', '4'], ['２５％', '７５％'], ['1,200', '2,300']];

describe('merge-base differential', () => {
  it('extracts at least the same number of tables across HTML and Markdown boundaries', () => {
    const table = tableText('完成率', '25%', '75%');
    const tags = ['pre', 'code', 'script', 'style', 'div', 'details', 'template', 'svg', 'math',
      'select', 'button', 'center', 'strong', 'lesson-answer'];
    const ticks = ['', '`', '``'];
    const examples = tags.flatMap((tag) => ticks.map((tick) =>
      [`<${tag}>`, table, `${tick}</${tag}>${tick}`, '', table].join('\n')));
    examples.push(...tags.map((tag) =>
      [`<${tag}>`, `<${tag}>`, table, `</${tag}>`, table, `</${tag}>`, '', table].join('\n')));
    const pick = seededPicker();
    for (let i = 0; i < 150; i++) {
      const parent = pick(tags);
      const child = pick(tags);
      const tick = pick(ticks);
      const separator = pick(['\n', '\r\n', '\r']);
      const body = [`<${child}>`, table, `</${child}>`].join('\n');
      examples.push([
        pick([`<${parent} hidden>`, `<${parent}>`, `<${parent} style="display:none">`]),
        pick([body, `<!--\n${body}\n-->`, `${tick}${body}${tick}`]),
        `${tick}</${parent}>${tick}`, '', table, '', table,
      ].join('\n').replaceAll('\n', separator));
    }
    for (const source of examples) {
      expect(extractStudySourceTables(source).length, JSON.stringify(source))
        .toBeGreaterThanOrEqual(extractBaselineTables(source).length);
    }
  });

  it('matches merge-base chart eligibility and scale for every header, number format and column position', () => {
    const makeTable = (header: string, firstLabel: string, [first, second]: string[]) =>
      tableText(header, first, second).replace('| 甲 |', () => `| ${firstLabel} |`);
    const tables = [
      ...chartHeaders.flatMap((header) => chartValuePairs.flatMap(([first, second]) => [
        tableText(header, first, second),
        tableText('完成率', first, second).replace('| 組別 |', () => `| ${header} |`),
      ])),
      ...marks.map((mark) => makeTable('完成率', mark + '甲', valuePairs[0])),
      ...headers.flatMap((header) => valuePairs.map((pair) => makeTable(header, '甲', pair))),
      ...headers.flatMap((header) => marks.flatMap((mark) => [
        makeTable(header + mark, '甲', valuePairs[0]),
        makeTable(header, mark || '甲', valuePairs[0]),
      ])),
    ];
    const pick = seededPicker();
    for (let i = 0; i < 150; i++) {
      const header = pick(headers);
      tables.push(makeTable(pick([pick(marks) + header, header + pick(marks)]),
        pick(marks) + pick(['甲', 'e\u0301', 'က္က', '👩‍💻', '乙', '']), pick(valuePairs)));
    }

    for (let i = 0; i < tables.length; i += 3) {
      const source = tables.slice(i, i + 3).join('\n\n');
      const baseline = extractBaselineTables(source);
      const view = render(<StudySourceTables text={source} />);
      try {
        const liveTables = view.container.querySelectorAll('table');
        expect(liveTables).toHaveLength(baseline.length);
        for (const [index, table] of baseline.entries()) {
          const valueRows = sourceValueRows(table);
          const percentRows = sourcePercentRows(table);
          const sourceTable = liveTables[index].closest('[role="region"]');
          expect(sourceTable?.querySelectorAll('meter')).toHaveLength(
            (valueRows?.length ?? 0) + (percentRows?.length ?? 0),
          );
          for (const [rows, suffix, max] of [
            [valueRows, '原文數值比較', valueRows && Math.max(...valueRows.map((row) => row.amount))],
            [percentRows, '原文百分比', 100],
          ] as const) {
            const list = Array.from(sourceTable?.querySelectorAll('ul[aria-label]') ?? [])
              .find((element) => element.getAttribute('aria-label') === `${table.headers[1]} ${suffix}`);
            expect(Array.from(list?.querySelectorAll('meter') ?? [], (meter) => [meter.value, meter.max]),
              JSON.stringify(table)).toEqual(rows?.map((row) => [row.amount, max]) ?? []);
          }
        }
      } finally {
        view.unmount();
      }
    }
  }, 120_000);

  it('accepts every explanation and step with a merge-base quotation', () => {
    const graphemes = ['禰\u{e0100}', 'cafe\u0301', 'က္က', 'ကေ', 'ကါ', 'का', 'কি', '👩‍💻', '🇹🇼', '1️⃣'];
    const quotes = [
      ...graphemes.flatMap((source) => Array.from({ length: source.length }, (_, i) =>
        ({ source, quote: source.slice(0, i + 1) }))),
      ...marks.flatMap((mark) => [mark, '甲' + mark + '乙'].map((quote) => ({ source: quote, quote }))),
      { source: '原文', quote: '沒有命中' },
    ];
    const pick = seededPicker();
    for (let i = 0; i < 150; i++) {
      const source = pick(graphemes) + pick(marks) + pick(graphemes);
      const start = pick(Array.from({ length: source.length }, (_, index) => index));
      const end = pick(Array.from({ length: source.length - start }, (_, index) => start + index + 1));
      quotes.push({ source, quote: source.slice(start, end) });
    }
    for (const { source, quote } of quotes) {
      const passage = { id: 'lesson:1', label: '原文', text: `甲${source}乙。共同引句` };
      const exact = baselineEvidence(passage.text, quote);
      expect(locateStudyEvidence(passage.text, quote), JSON.stringify({ source, quote })).toEqual(exact);
      const step = { title: '步驟', explanation: '說明', sourceQuote: '共同引句' };
      for (const response of [
        { ...reply, sourceQuote: quote },
        { ...reply, sourceQuote: '共同引句', steps: [{ ...step, sourceQuote: quote }, step] },
      ]) {
        const raw = JSON.stringify(response);
        let baseline;
        try {
          baseline = parseBaselineExplanation(raw, passage);
        } catch {
          continue;
        }
        expect(() => parseTutorExplanation(raw, passage), JSON.stringify({ source, response })).not.toThrow();
        expect(parseTutorExplanation(raw, passage)).toEqual(baseline);
      }
    }
  });
});


function expectBaselineTxt(actual: string, baseline: string, input: string) {
  // Provenance labels can be clarified, while all original field values remain.
  const normalized = actual
    .replaceAll('本步 AI 引句（無法在本段逐字定位）：', '本步引用原文：')
    .replaceAll('AI 引句（無法在本段逐字定位）：', baseline.includes('原文引句：') ? '原文引句：' : '引用原文：')
    .replaceAll('AI 公式（無法在本段逐字定位）：', '原文公式：');
  expect(normalized, JSON.stringify(input)).toBe(baseline);
}

it('preserves merge-base reading and practice fields, checkpoints and reveal controls', () => {
  const pick = seededPicker();
  const samples = [...marks, '\u0903', '\u20dd', '\ufe0f', ' \t', ...Array.from({ length: 28 }, () =>
    pick(marks) + pick(['', '甲', 'က္က', '禰', ' ']) + pick(marks))];
  const callbacks = { onChange: vi.fn(), onAction: vi.fn(), onExit: vi.fn(),
    onReadSource: vi.fn(), onDownload: vi.fn() };

  for (const draft of samples) {
    const attempt = draft;
    const answerVisible = !!attempt.trim();
    const quote = draft.trim() ? draft : '禰';
    const source = studySourceFromText({ id: 'lesson', title: '教材' + draft,
      text: `禰\u{e0100}是姓氏。原文${draft}。` });
    const response = { ...reply, sourceQuote: quote, question: draft || reply.question,
      answer: draft || reply.answer };
    // Trim-empty generated fields are rejected by the baseline parser, so use
    // valid model fields there while still exercising the raw student input.
    if (!response.question.trim() || !response.answer.trim()) Object.assign(response, reply, { sourceQuote: quote });
    const memory = baselineSession.appendStudyLesson(baselineSession.emptyStudyPassage(), 'understand',
      { question: draft, response });
    memory.needsReview = true;
    const lesson = memory.modes.understand.lessons[0];
    Object.assign(lesson, { attempt, answerVisible });
    const input = { ...context, source, passages: { '0:0': memory } };
    const raw = baselineProgress.serializeCourseStudyProgress(input);
    for (const version of [1, 2]) {
      const legacy = JSON.stringify({ ...JSON.parse(raw), version });
      const baseline = baselineProgress.parseCourseStudyProgress(legacy, input.scope);
      const restored = parseCourseStudyProgress(legacy, input.scope);
      expect(restored, JSON.stringify(draft)).toEqual(baseline);
      expect(JSON.parse(serializeCourseStudyProgress(restored))).toEqual(JSON.parse(raw));
      expectBaselineTxt(buildCourseStudyNotes('國文', source, restored.passages),
        baselineNotes('國文', source, baseline.passages), draft);
    }
    const [passage] = splitStudySection(source.sections[0]);
    const baselineDeck = baselinePractice.buildStudyPracticeDeck([[passage]], input.passages, 'understand');
    const round = baselinePractice.startStudyPracticeRound(1, 'understand', baselineDeck.cards);
    if (!round) throw new Error('Missing baseline practice round');
    round.responses[round.cards[0].id] = { attempt, answerVisible, hintVisible: true, outcome: null };
    const saved = baselineCheckpoint.serializeStudyPracticeCheckpoint({ progress: input, round });
    const baseline = baselineCheckpoint.parseStudyPracticeCheckpoint(saved, input.scope);
    const restored = checkpoint.parseStudyPracticeCheckpoint(saved, input.scope);
    expect(restored).toEqual(baseline);
    expect(JSON.parse(checkpoint.serializeStudyPracticeCheckpoint(restored))).toEqual(JSON.parse(saved));

    expect(practice.buildStudyPracticeDeck([[passage]], input.passages, 'understand')).toEqual(baselineDeck);
    expect(practice.hasVisibleStudyAttempt(attempt)).toBe(baselinePractice.hasVisibleStudyAttempt(attempt));
    expect(practice.getStudyPracticeSummary(restored.round)).toEqual(baselinePractice.getStudyPracticeSummary(baseline.round));
    expectBaselineTxt(practice.buildCourseStudyPracticeNotes('國文', source.title, restored.round),
      baselinePractice.buildCourseStudyPracticeNotes('國文', source.title, baseline.round), draft);

    // A valid attempt exposes the saved answer even when the answer text itself
    // would not qualify as a practice attempt.
    const withRevealedAnswer = (round: practice.StudyPracticeRound) => {
      const id = round.cards[0].id;
      return { ...round, responses: { ...round.responses,
        [id]: { ...round.responses[id], attempt: '已試答', answerVisible: true } } };
    };
    const reading = { passage, mode: 'understand' as const, onChange: callbacks.onChange };
    const examples = [
      { before: <BaselinePassage {...reading} memory={baseline.progress.passages['0:0']} />,
        after: <CourseStudyPassage {...reading} timingLog={[]} onTiming={vi.fn()} memory={restored.progress.passages['0:0']} /> },
      { before: <BaselinePractice {...callbacks} round={baseline.round} />,
        after: <CourseStudyPractice {...callbacks} round={restored.round} /> },
      { before: <BaselinePractice {...callbacks} round={withRevealedAnswer(baseline.round)} />,
        after: <CourseStudyPractice {...callbacks} round={withRevealedAnswer(restored.round)} /> },
    ];
    const reveal = /^(收起|對照)參考回答$/;
    for (const { before, after } of examples) {
      const view = render(<div><section data-testid="base">{before}</section><section data-testid="pr">{after}</section></div>);
      try {
        // Compare raw DOM text so variation selectors and controls are checked as stored.
        const text = (id: string, selector: string) =>
          Array.from(view.getByTestId(id).querySelectorAll(selector), (node) => node.textContent);
        for (const field of [response.question, response.answer]) {
          const matches = (id: string) => text(id, 'p').filter((value) => value === field);
          expect(matches('pr'), JSON.stringify(field)).toEqual(matches('base'));
        }
        expect(text('pr', 'blockquote')).toEqual(text('base', 'blockquote'));
        const attempts = (id: string) => Array.from(view.getByTestId(id)
          .querySelectorAll('textarea'), (node) => node.value);
        expect(attempts('pr')).toEqual(attempts('base'));
        const read = (id: string) => within(view.getByTestId(id)).getByRole('button', { name: reveal });
        if (before.type === BaselinePassage) {
          const locate = (id: string) => within(view.getByTestId(id)).getByRole('button', { name: '定位原文引句' });
          expect(locate('pr').hasAttribute('disabled')).toBe(locate('base').hasAttribute('disabled'));
          if (!locate('base').hasAttribute('disabled')) {
            fireEvent.click(locate('base'));
            fireEvent.click(locate('pr'));
            expect(text('base', 'blockquote mark')).toEqual([quote]);
            expect(text('pr', 'blockquote mark')).toEqual(text('base', 'blockquote mark'));
          }
        }
        expect(read('pr').getAttribute('aria-expanded'), JSON.stringify(draft)).toBe(read('base').getAttribute('aria-expanded'));
        expect(read('pr').hasAttribute('disabled'), JSON.stringify(draft)).toBe(read('base').hasAttribute('disabled'));
      } finally { view.unmount(); }
    }
    expect(courseStudyBackupFilenameStem(source.title)).toBe(baselineFilename(source.title));
  }
}, 120_000);

it('compares rendering and panel export controls with the baseline components', () => {
  const source = tableText('Percentage by Temperature', '50%', '100%');
  const meters = (container: HTMLElement) => Array.from(container.querySelectorAll('meter'), (m) => [m.value, m.max]);
  const baseline = render(<BaselineTables text={source} />);
  const live = render(<StudySourceTables text={source} />);
  expect(meters(live.container)).toEqual(meters(baseline.container));
  baseline.unmount();
  live.unmount();

  const props = { scope: context.scope, courseTitle: '國文', onClose: vi.fn(),
    material: { id: 'lesson', title: '原文', body: source } };
  const original = render(<BaselinePanel {...props} />);
  const current = render(<CourseStudyPanel {...props} />);
  const buttons = (container: HTMLElement) => within(container).getAllByRole('button')
    .map((button) => [button.textContent, button.hasAttribute('disabled')]);
  expect(buttons(current.container)).toEqual(expect.arrayContaining(buttons(original.container)));
}, 120_000);


describe.each([1, 2, 3])('reading v%i import compatibility', (readingVersion) => {
  it.each(['', ' \t\n', '\u200b', '\ufff9', '可見試答'])('matches the merge-base for attempt %j', (attempt) => {
    const memory = baselineSession.appendStudyLesson(baselineSession.emptyStudyPassage(), 'understand',
      { question: '', response: { ...reply, sourceQuote: '原文' } });
    memory.needsReview = true;
    const progress = { ...context, passages: { '0:0': memory } };
    const [passage] = splitStudySection(progress.source.sections[0]);
    const deck = baselinePractice.buildStudyPracticeDeck([[passage]], progress.passages, 'understand');
    const round = baselinePractice.startStudyPracticeRound(0, 'understand', deck.cards);
    if (!round) throw new Error('Missing baseline practice round');
    const checkpointEnvelope = JSON.parse(baselineCheckpoint.serializeStudyPracticeCheckpoint({ progress, round }));
    const reading = checkpointEnvelope.progress;
    const lesson = reading.passages['0:0'].modes.understand.lessons[0];
    reading.version = readingVersion;

    for (const answerVisible of [false, true]) {
      for (const answerReviewAllowed of [undefined, false, true]) {
        Object.assign(lesson, { attempt, answerVisible });
        round.responses[round.cards[0].id] = { attempt, answerVisible, hintVisible: true, outcome: null };
        if (answerReviewAllowed === undefined) delete lesson.answerReviewAllowed;
        else lesson.answerReviewAllowed = answerReviewAllowed;
        const raw = JSON.stringify(reading);
        let baseReading;
        try {
          baseReading = baselineProgress.parseCourseStudyProgress(raw, progress.scope);
        } catch {
          expect(() => parseCourseStudyProgress(raw, progress.scope)).toThrow();
        }
        if (baseReading) {
          const restored = parseCourseStudyProgress(raw, progress.scope);
          expect(restored).toEqual(baseReading);
          expect(canReviewStudyAnswer(restored.passages['0:0'].modes.understand.lessons[0])).toBe(!!attempt.trim());
          const exported = serializeCourseStudyProgress(restored);
          expect(exported).toBe(baselineProgress.serializeCourseStudyProgress(baseReading));
          expect(parseCourseStudyProgress(exported, progress.scope)).toEqual(baseReading);
        }

        for (const version of [1, 2]) {
          for (const responseRestriction of [undefined, false, true]) {
            const response = { ...round.responses[round.cards[0].id], answerReviewAllowed: responseRestriction };
            const saved = JSON.stringify({ ...checkpointEnvelope, version, practice: {
              ...checkpointEnvelope.practice, responses: { [round.cards[0].id]: response },
            } });
            let baseCheckpoint;
            try {
              baseCheckpoint = baselineCheckpoint.parseStudyPracticeCheckpoint(saved, progress.scope);
            } catch {
              expect(() => checkpoint.parseStudyPracticeCheckpoint(saved, progress.scope)).toThrow();
              continue;
            }
            const restored = checkpoint.parseStudyPracticeCheckpoint(saved, progress.scope);
            expect(restored).toEqual(baseCheckpoint);
            expect(practice.hasVisibleStudyAttempt(restored.round.responses[round.cards[0].id].attempt))
              .toBe(baselinePractice.hasVisibleStudyAttempt(attempt));
            const exported = checkpoint.serializeStudyPracticeCheckpoint(restored);
            expect(exported).toBe(baselineCheckpoint.serializeStudyPracticeCheckpoint(baseCheckpoint));
            expect(checkpoint.parseStudyPracticeCheckpoint(exported, progress.scope)).toEqual(baseCheckpoint);
          }
        }
      }
    }
  });
});


it('keeps the second passage chart and excerpt announcement free of added line numbers', () => {
  const firstPassage = '文'.repeat(1580) + '\n'.repeat(20);
  const body = firstPassage + tableText('學分', '2', '3');
  const material = { id: 'two-passages', title: '表格教材', body };
  const view = render(<CourseStudyPanel scope={context.scope} courseTitle="國文" material={material} onClose={vi.fn()} />);
  fireEvent.click(view.getByRole('button', { name: '下一段' }));
  expect(view.getByRole('table', { name: '原文第 1 行起的表格' })).toBeTruthy();
  fireEvent.click(view.getByText('展開第 2 欄「學分」的原文數值比較'));
  const jump = view.getByRole('button', { name: '甲 · 回表格核對' });
  fireEvent.click(jump);
  expect(document.activeElement?.textContent).toBe('甲2');
  fireEvent.click(view.getByRole('button', { name: '返回圖表' }));
  expect(document.activeElement).toBe(jump);

  fireEvent.click(view.getByText('選取第 1 張表格的原文（可複製）'));
  fireEvent.change(view.getByRole('combobox', { name: '第 1 張表格的原文選取範圍' }), { target: { value: '0' } });
  fireEvent.click(view.getByRole('checkbox', { name: '連同原文欄名與分隔列' }));
  const excerpt = view.getByRole('textbox', { name: '原文表格 1 的可選取文字' }) as HTMLTextAreaElement;
  expect(excerpt.value).toBe('| 組別 | 學分 |\n| --- | --- |\n| 甲 | 2 |');
  const announcement = excerpt.closest('details')?.querySelector('[aria-live="polite"][aria-atomic="true"]');
  expect(announcement?.textContent).toBe('目前選取第 1 列：包含欄名、分隔列與所選資料列；不包含其他資料列。');
});

describe.each(['\n', '\r\n'])('table excerpts with %j line endings', (newline) => {
  const flags = [false, true];
  const cases = flags.flatMap((multi) => flags.flatMap((blank) =>
    flags.map((atStart) => ({ multi, blank, atStart }))));
  it.each(cases)('keeps verbatim excerpt exports for $multi/$blank/$atStart', async ({ multi, blank, atStart }) => {
    const rowLabels = multi ? ['甲', '乙'] : ['甲'];
    const paragraphs = rowLabels.map((label) => {
      const rows = ['| 組別 | 學分 |', '| --- | --- |', `| ${label} | 2 |`];
      const gap = blank ? [''] : [];
      const otherLines = [...rows, ...gap, ''];
      const prose = '文'.repeat(multi ? 1600 - otherLines.join(newline).length - newline.length : 10);
      return atStart ? [...rows, ...gap, prose] : [prose, ...gap, ...rows];
    });
    const lines = paragraphs.flat();
    const material = { id: 'table-material', title: '表格教材', body: lines.join(newline) };
    const options = { scope: context.scope, courseTitle: '國文', material, onClose: vi.fn() };
    const view = render(<main><section aria-label="基準"><BaselinePanel {...options} /></section>
      <section aria-label="變更"><CourseStudyPanel {...options} /></section></main>);
    const baseline = within(view.getByRole('region', { name: '基準' }));
    const current = within(view.getByRole('region', { name: '變更' }));
    const name = '摘錄開頭加上教材原文行號（註記非原文）';
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const create = vi.fn<(blob: NodeBlob) => string>(() => 'blob:table-excerpt');
    const anchor = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const createDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    const revokeDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    vi.stubGlobal('Blob', NodeBlob);
    try {
      for (const [index, label] of rowLabels.entries()) {
        for (const panel of [baseline, current]) {
          fireEvent.click(panel.getByText('選取第 1 張表格的原文（可複製）'));
          fireEvent.change(panel.getByRole('combobox', { name: '第 1 張表格的原文選取範圍' }),
            { target: { value: '0' } });
        }
        expect(baseline.queryByRole('checkbox', { name })).toBeNull();
        expect(current.queryByRole('checkbox', { name })).toBeNull();
        fireEvent.click(baseline.getByRole('button', { name: '複製第 1 張表格第 1 列原文' }));
        const original = `| ${label} | 2 |`;
        expect(writeText).toHaveBeenLastCalledWith(original);
        fireEvent.click(baseline.getByRole('button', { name: '下載第 1 張表格第 1 列原文 TXT' }));
        expect(await create.mock.lastCall?.[0].text()).toBe(original);
        fireEvent.click(current.getByRole('button', { name: '複製第 1 張表格第 1 列原文' }));
        expect(writeText).toHaveBeenLastCalledWith(original);
        fireEvent.click(current.getByRole('button', { name: '下載第 1 張表格第 1 列原文 TXT' }));
        expect(await create.mock.lastCall?.[0].text()).toBe(original);
        if (index < rowLabels.length - 1) {
          for (const panel of [baseline, current]) fireEvent.click(panel.getByRole('button', { name: '下一段' }));
        }
      }
    } finally {
      view.unmount();
      anchor.mockRestore();
      vi.unstubAllGlobals();
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
      else Reflect.deleteProperty(navigator, 'clipboard');
      if (createDescriptor) Object.defineProperty(URL, 'createObjectURL', createDescriptor);
      else Reflect.deleteProperty(URL, 'createObjectURL');
      if (revokeDescriptor) Object.defineProperty(URL, 'revokeObjectURL', revokeDescriptor);
      else Reflect.deleteProperty(URL, 'revokeObjectURL');
    }
  });
});
