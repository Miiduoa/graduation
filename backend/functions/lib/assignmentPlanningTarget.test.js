'use strict';

const { resolveAssignmentPlanningTarget: resolve } = require('./assignmentPlanningTarget');
const english = Object.freeze({ id: 'report', groupId: 'g-english', groupName: '英文', title: '英文報告' });
const math = Object.freeze({ id: 'homework', groupId: 'g-math', groupName: '數學', title: '數學作業' });
const assignments = Object.freeze([math, english]);
const clarify = { target: null, reason: 'clarify' };

test.each(['幫我拆解作業', '安排我的作業', '讀書計畫', '幫我規劃讀書計畫', '請幫我分解待繳作業', '幫我把這週作業拆成讀書計畫', '幫我把作業拆成讀書計畫'])('%s is explicitly generic and preserves source order', (message) => {
  expect(resolve(message, assignments)).toEqual({ target: math, reason: 'generic' });
  expect(resolve(message, [english, math]).target).toBe(english);
});

test.each([
  '英文報告', '「英文報告」', '幫我拆解英文報告', '請幫我分解英文報告。',
  '幫我把英文報告拆成待辦', '幫我把「英文報告」分解成步驟',
  '幫我把作業「英文報告」拆成讀書計畫', '幫我把英文報告作業拆成讀書計畫',
  '麻煩你幫我安排「英文報告」', '規劃『英文報告』', '拆解“英文報告”',
])('%s selects the entire title instead of the first assignment', (message) => {
  expect(resolve(message, assignments)).toEqual({ target: english, reason: 'exact' });
  expect(resolve(message, assignments).target).toBe(english);
});

test.each(['英文', '英文報告二', '英文報告草稿', '我的英文報告', '期末英文報告', '英文報告的附件'])('does not turn the explicit partial or unknown title %s into a known title', (name) => {
  expect(resolve(`幫我拆解${name}`, [english])).toEqual(clarify);
  expect(resolve(`幫我把「${name}」拆成待辦`, [english])).toEqual(clarify);
});

test('prefix and suffix collisions select only a complete known title', () => {
  const short = { ...english, title: '期末報告' };
  const numbered = { ...english, id: 'report2', title: '期末報告二' };
  const prefixed = { ...english, id: 'my-report', title: '我的期末報告' };
  expect(resolve('幫我拆解期末報告二', [short])).toEqual(clarify);
  expect(resolve('幫我拆解期末報告二', [short, numbered, prefixed]).target).toBe(numbered);
  expect(resolve('幫我拆解我的期末報告', [short, numbered, prefixed]).target).toBe(prefixed);
  expect(resolve('幫我拆解期末報告', [short, numbered, prefixed]).target).toBe(short);
});

test.each(['幫我拆解未知報告', '拆解「未知報告」', '幫我拆解那份作業', '請幫忙想想英文報告怎麼做', '幫我拆解作業，英文報告晚點', '幫我拆解英文報告再提醒我', '幫我把英文報告拆成待辦後寄給老師'])('%s must clarify instead of falling back', (message) => {
  expect(resolve(message, assignments)).toEqual(clarify);
});

test('a quoted generic word is an explicit title, never a generic fallback', () => {
  expect(resolve('幫我拆解「作業」', assignments)).toEqual(clarify);
  const named = { ...english, title: '作業' };
  expect(resolve('幫我拆解「作業」', [math, named])).toEqual({ target: named, reason: 'exact' });
});

const englishMidterm = Object.freeze({ ...english, title: '期中報告' });
const mathMidterm = Object.freeze({ ...math, title: '期中報告' });
test('an unqualified title shared by different courses needs clarification', () => {
  expect(resolve('拆解「期中報告」', [englishMidterm, mathMidterm])).toEqual(clarify);
});

test.each(['拆解「英文」的「期中報告」', '幫我拆解英文的期中報告', '幫我把英文的期中報告拆成待辦', '幫我把英文的作業「期中報告」拆成讀書計畫', '拆解英文 期中報告', '拆解g-english的期中報告'])('%s uses a complete course name or source group ID to disambiguate', (message) => {
  expect(resolve(message, [mathMidterm, englishMidterm])).toEqual({ target: englishMidterm, reason: 'exact' });
});

test.each(['拆解「英」的「期中報告」', '拆解「英文二」的「期中報告」', '拆解「歷史」的「期中報告」', '拆解g-unknown的期中報告'])('%s never discards an unknown course qualifier', (message) => {
  expect(resolve(message, [englishMidterm])).toEqual(clarify);
});

test('same IDs in different groups remain separate candidates', () => {
  const sameId = { ...mathMidterm, id: englishMidterm.id };
  expect(resolve('拆解期中報告', [englishMidterm, sameId])).toEqual(clarify);
  expect(resolve('拆解數學的期中報告', [englishMidterm, sameId]).target).toBe(sameId);
});

test('same-course duplicate titles and duplicate course names still need clarification', () => {
  expect(resolve('拆解英文的期中報告', [englishMidterm, { ...englishMidterm, id: 'other' }])).toEqual(clarify);
  expect(resolve('拆解英文的期中報告', [englishMidterm, { ...englishMidterm, groupId: 'g-other' }])).toEqual(clarify);
});

test('a full title and a course-qualified interpretation cannot silently override each other', () => {
  const fullTitle = { ...math, title: '英文的期中報告' };
  expect(resolve('拆解英文的期中報告', [fullTitle, englishMidterm])).toEqual(clarify);
  expect(resolve('拆解「英文的期中報告」', [fullTitle, englishMidterm]).target).toBe(fullTitle);
});

test('assignment noun syntax cannot silently override a complete title or shorten an unknown title', () => {
  const fullTitle = { ...math, title: '英文報告作業' };
  expect(resolve('幫我把英文報告作業拆成讀書計畫', [english, fullTitle])).toEqual(clarify);
  expect(resolve('幫我把作業「英文報告二」拆成讀書計畫', [english])).toEqual(clarify);
  expect(resolve('幫我把英文報告作業二拆成讀書計畫', [english])).toEqual(clarify);
  expect(resolve('幫我把未知課程的作業「英文報告」拆成讀書計畫', [english])).toEqual(clarify);
});

test.each(['拆解英文報告和數學作業', '拆解「英文報告」與「數學作業」', '拆解「英文報告」「數學作業」', '拆解英文報告、數學作業', '英文報告或數學作業', '幫我一起拆解作業'])('%s does not select one of several requested targets', (message) => {
  expect(resolve(message, assignments)).toEqual(clarify);
});

test.each(['不要拆解英文報告', '不拆解英文報告', '別安排英文報告', '不是英文報告，是數學作業', '拆解英文報告但不要安排', '除了英文報告', '取消英文報告的計畫', '幫我把英文報告改成數學作業', 'do not plan 英文報告'])('%s rejects negation or replacement without a target', (message) => {
  expect(resolve(message, assignments)).toEqual(clarify);
});

test.each(['不等式作業', '別人的作品', '戰爭與和平'])('control words inside the complete quoted title %s remain part of its name', (title) => {
  const named = { ...english, title, groupName: '不動產管理' };
  expect(resolve(`幫我拆解「${title}」`, [math, named])).toEqual({ target: named, reason: 'exact' });
  expect(resolve(`拆解「不動產管理」的「${title}」`, [named]).target).toBe(named);
  expect(resolve(`不要拆解「${title}」`, [named])).toEqual(clarify);
});

test('normalizes NFKC, ASCII case and whitespace without fuzzy matching', () => {
  const hw = { ...english, title: 'ＨＷ１   Report', groupName: 'English Course' };
  expect(resolve('  請 幫我 拆解  「hw1 report」！ ', [math, hw])).toEqual({ target: hw, reason: 'exact' });
  expect(resolve('拆解「english   COURSE」的「HW1 REPORT」', [hw]).target).toBe(hw);
  expect(resolve('拆解HW1Report', [hw])).toEqual(clarify);
  expect(resolve('拆解HW1 Repor', [hw])).toEqual(clarify);
  expect(resolve('拆解HW1 Report', [hw, { ...hw, id: 'collision', title: 'hw1 report' }])).toEqual(clarify);
});

test.each(['拆解「英文報告', '拆解英文報告」', '拆解「英文報告」的', '', '   ', null, undefined])('malformed or empty message %s cannot pick an assignment', (message) => {
  expect(resolve(message, assignments)).toEqual(clarify);
});

test.each([[], undefined, null])('empty source %j returns empty', (source) => {
  expect(resolve('幫我拆解英文報告', source)).toEqual({ target: null, reason: 'empty' });
});

test('does not mutate source rows or change their order', () => {
  resolve('拆解英文報告', assignments);
  resolve('幫我拆解作業', assignments);
  expect(assignments).toEqual([math, english]);
  expect(resolve('幫我拆解作業', [{ id: 'incomplete' }, english])).toEqual(clarify);
});

test.each([['為什麼', '為什麼?'], ['Report', 'Report!'], ['報告', '報告。']])('terminal punctuation cannot shorten the explicit title %s into a different assignment', (plainTitle, punctuatedTitle) => {
  const plain = { ...english, title: plainTitle };
  const punctuated = { ...math, title: punctuatedTitle };
  expect(resolve(`幫我拆解${punctuatedTitle}`, [plain, punctuated])).toEqual(clarify);
  expect(resolve(`幫我拆解${punctuatedTitle}`, [punctuated])).toEqual({ target: punctuated, reason: 'exact' });
  expect(resolve(`幫我拆解「${punctuatedTitle}」`, [plain, punctuated])).toEqual({ target: punctuated, reason: 'exact' });
});

test.each(['作業!', '我的作業?'])('generic punctuation cannot hide a complete named assignment %s', (title) => {
  const named = { ...english, title };
  expect(resolve(`幫我拆解${title}`, [math, named])).toEqual(clarify);
  expect(resolve(`幫我拆解「${title}」`, [math, named])).toEqual({ target: named, reason: 'exact' });
});

test('a punctuated study-plan title and a generic study-plan request must not select different assignments', () => {
  const named = { ...english, title: '讀書計畫!' };
  expect(resolve('讀書計畫!', [math, named])).toEqual(clarify);
  expect(resolve('「讀書計畫!」', [math, named])).toEqual({ target: named, reason: 'exact' });
});

test('terminal sentence punctuation still supports a uniquely resolved or generic request', () => {
  expect(resolve('幫我拆解英文報告!', assignments)).toEqual({ target: english, reason: 'exact' });
  expect(resolve('幫我拆解作業!', assignments)).toEqual({ target: math, reason: 'generic' });
});

test('each punctuation boundary remains a possible complete title', () => {
  const plain = { ...english, title: 'Report' };
  const question = { ...math, title: 'Report?' };
  expect(resolve('幫我拆解Report?!', [plain, question])).toEqual(clarify);
  expect(resolve('幫我拆解Report?!', [question])).toEqual({ target: question, reason: 'exact' });
});

test('raw and generic interpretations may agree on exactly the same source row', () => {
  const named = { ...english, title: '作業!' };
  expect(resolve('幫我拆解作業!', [named, math])).toEqual({ target: named, reason: 'exact' });
});
