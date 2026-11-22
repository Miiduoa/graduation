import { render, within } from '@testing-library/react';
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

  it('renders every merge-base table comparison with its original values and scale', () => {
    const makeTable = (header: string, firstLabel: string, [first, second]: string[]) =>
      tableText(header, first, second).replace('| 甲 |', () => `| ${firstLabel} |`);
    const tables = [
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
        for (const [index, table] of baseline.entries()) {
          const valueRows = sourceValueRows(table);
          const percentRows = sourcePercentRows(table);
          const sourceTable = liveTables[index].closest('[role="region"]');
          for (const [rows, suffix, max] of [
            [valueRows, '原文數值比較', valueRows && Math.max(...valueRows.map((row) => row.amount))],
            [percentRows, '原文百分比', 100],
          ] as const) {
            if (!rows) continue;
            const list = Array.from(sourceTable?.querySelectorAll('ul[aria-label]') ?? [])
              .find((element) => element.getAttribute('aria-label') === `${table.headers[1]} ${suffix}`);
            expect(Array.from(list?.querySelectorAll('meter') ?? [], (meter) => [meter.value, meter.max]),
              JSON.stringify(table)).toEqual(rows.map((row) => [row.amount, max]));
          }
        }
      } finally {
        view.unmount();
      }
    }
  });

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
  const samples = [...marks, ' \t', ...Array.from({ length: 28 }, () =>
    pick(marks) + pick(['', '甲', 'က္က', '禰', ' ']) + pick(marks))];
  const callbacks = { onChange: vi.fn(), onAction: vi.fn(), onExit: vi.fn(),
    onReadSource: vi.fn(), onDownload: vi.fn() };

  for (const [index, draft] of samples.entries()) {
    const attempt = draft;
    const answerVisible = !!attempt.trim() && index % 2 === 0;
    const quote = '禰';
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

    const extended = JSON.parse(saved);
    extended.version = 2;
    extended.progress.version = 3;
    extended.progress.passages['0:0'].modes.understand.lessons[0].answerReviewAllowed = false;
    const previousPrBackup = checkpoint.parseStudyPracticeCheckpoint(JSON.stringify(extended), input.scope);
    expect(previousPrBackup).toEqual(baseline);
    expect(practice.buildStudyPracticeDeck([[passage]], input.passages, 'understand')).toEqual(baselineDeck);
    expect(practice.hasVisibleStudyAttempt(attempt)).toBe(baselinePractice.hasVisibleStudyAttempt(attempt));
    expect(practice.getStudyPracticeSummary(restored.round)).toEqual(baselinePractice.getStudyPracticeSummary(baseline.round));
    expectBaselineTxt(practice.buildCourseStudyPracticeNotes('國文', source.title, restored.round),
      baselinePractice.buildCourseStudyPracticeNotes('國文', source.title, baseline.round), draft);

    const reading = { passage, memory, mode: 'understand' as const, onChange: callbacks.onChange };
    const examples = [
      { before: <BaselinePassage {...reading} />, after: <CourseStudyPassage {...reading} /> },
      { before: <BaselinePractice {...callbacks} round={baseline.round} />,
        after: <CourseStudyPractice {...callbacks} round={restored.round} /> },
    ];
    const reveal = /^(收起|對照)參考回答$/;
    for (const { before, after } of examples) {
      const view = render(<div><section data-testid="base">{before}</section><section data-testid="pr">{after}</section></div>);
      try {
        const read = (id: string) => within(view.getByTestId(id)).getByRole('button', { name: reveal });
        if (before.type === BaselinePassage) {
          const locate = (id: string) => within(view.getByTestId(id)).getByRole('button', { name: '定位原文引句' });
          expect(locate('pr').hasAttribute('disabled')).toBe(locate('base').hasAttribute('disabled'));
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
