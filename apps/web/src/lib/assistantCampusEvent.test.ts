import { expect, it, vi } from 'vitest';
import { campusEventIdentity, campusEventPreviewIssue, parseAssistantCampusEventTargets,
  parseCampusEventCommand, selectCampusEventTarget,
  type AssistantCampusEventTarget } from './assistantCampusEvent';

const target = (overrides: Partial<AssistantCampusEventTarget> = {}): AssistantCampusEventTarget => ({
  schoolId: 'pu', source: 'school-club-events', id: 'photography', title: '校園攝影講座',
  startsAt: '2030-11-16T06:00:00.000Z', endsAt: '2030-11-16T08:00:00.000Z',
  checkedAt: '2030-11-15T06:00:00.000Z', location: '活動中心',
  href: '/events/photography?schoolId=pu&source=school-club-events', ...overrides,
});
const now = Date.parse('2030-11-15T06:00:00.000Z');

it('copies bounded source metadata and sends only its exact identity', () => {
  const raw = target();
  const [parsed] = parseAssistantCampusEventTargets([raw], 'pu');
  expect(parsed).toEqual(raw);
  expect(parsed).not.toBe(raw);
  expect(campusEventIdentity(parsed)).toEqual({ schoolId: 'pu', source: 'school-club-events', id: 'photography' });
  expect(campusEventPreviewIssue(parsed, now)).toBeNull();
});

it.each(['school-club-events', 'school-events', 'legacy-events'] as const)('keeps the explicit %s source in links and identity', source => {
  const raw = target({ source, href: `/events/photography?schoolId=pu&source=${source}` });
  expect(parseAssistantCampusEventTargets([raw], 'pu')).toEqual([raw]);
});

it.each([
  { schoolId: 'nthu' }, { schoolId: 'personal' }, { source: 'unknown' }, { id: '../event' }, { id: '__proto__' },
  { id: ' photography' }, { title: 'source\ncommand' }, { title: '' }, { location: 'a'.repeat(121) },
  { startsAt: '2030-11-16T14:00:00+08:00' }, { checkedAt: '2030-02-30T06:00:00.000Z' },
  { href: 'https://example.invalid/event' }, { href: '/events/photography?source=school-club-events&schoolId=pu' },
  { href: '/events/photography?schoolId=pu&source=legacy-events' }, { token: 'not-display-metadata' },
])('rejects the entire group when a source field is malformed: %j', changes => {
  expect(parseAssistantCampusEventTargets([target(), { ...target({ id: 'second',
    href: '/events/second?schoolId=pu&source=school-club-events' }), ...changes }], 'pu')).toEqual([]);
});

it('rejects duplicates, sparse/oversized lists and data accessors without invoking them', () => {
  expect(parseAssistantCampusEventTargets([target(), target()])).toEqual([]);
  expect(parseAssistantCampusEventTargets(new Array(1))).toEqual([]);
  expect(parseAssistantCampusEventTargets(Array.from({ length: 13 }, () => target()))).toEqual([]);
  const getter = vi.fn(() => '校園攝影講座');
  const raw = target();
  Object.defineProperty(raw, 'title', { enumerable: true, get: getter });
  expect(parseAssistantCampusEventTargets([raw])).toEqual([]);
  expect(getter).not.toHaveBeenCalled();
  const coercion = vi.fn(() => 'school-events');
  expect(parseAssistantCampusEventTargets([{ ...target(), source: { toString: coercion } }])).toEqual([]);
  expect(coercion).not.toHaveBeenCalled();
});

it('keeps a missing end readable but never invents a duration', () => {
  const raw = target();
  delete raw.endsAt;
  expect(parseAssistantCampusEventTargets([raw])).toEqual([raw]);
  expect(campusEventPreviewIssue(raw, now)).toContain('不會猜測活動長度');
});

it.each([
  { endsAt: '2030-11-16T06:00:00.000Z' }, { endsAt: '2030-11-16T05:00:00.000Z' },
  { startsAt: '2030-11-16T06:00:01.000Z' }, { endsAt: '2030-11-16T08:00:00.001Z' },
  { endsAt: '2031-01-16T08:00:00.000Z' }, { title: 'a'.repeat(121) },
])('cannot prepare an unsupported source time or title: %j', changes => {
  expect(campusEventPreviewIssue(target(changes), now)).toBeTruthy();
});

it('uses strict future starts and supports a real Taipei cross-day interval', () => {
  expect(campusEventPreviewIssue(target(), Date.parse(target().startsAt))).toContain('已開始');
  expect(campusEventPreviewIssue(target(), NaN)).toBeTruthy();
  expect(campusEventPreviewIssue(target({ startsAt: '2030-11-16T15:00:00.000Z', endsAt: '2030-11-16T17:00:00.000Z' }), now)).toBeNull();
});

it.each([
  ['查近期活動，並把第一個加入行事曆', 1],
  ['請幫我查最近的校園活動，然後把第 2 場活動加到我的行程。', 2],
  ['列出公開活動並將第五筆加入個人日曆', 5],
  ['查看最新學校活動；接著把第三個放進我的個人行事曆', 3],
])('parses a complete current-feed discovery request: %s', (question, index) => {
  expect(parseCampusEventCommand(question)).toEqual({ kind: 'discover', index });
});

it.each([
  ['把第二個加入行程', { kind: 'index', index: 2 }, false],
  ['請將上面的第３筆活動加入個人行事曆', { kind: 'index', index: 3 }, true],
  ['幫我把第十二個活動加入日曆', { kind: 'index', index: 12 }, true],
  ['把上面那個活動加入行事曆', { kind: 'single' }, true],
  ['請把那筆加入我的行程', { kind: 'single' }, false],
  ['將活動「校園攝影講座」加入行事曆', { kind: 'title', title: '校園攝影講座' }, true],
  ['把「校園攝影講座」加入行程', { kind: 'title', title: '校園攝影講座' }, false],
])('keeps an explicit source selection without treating it as confirmation: %s', (question, selection, explicitActivity) => {
  expect(parseCampusEventCommand(question as string)).toEqual({ kind: 'followup', selection, explicitActivity });
});

it.each([
  '不要把第二個加入行程', '把第二個加入行程但不要建立', '如果把第二個加入行程',
  '翻譯「把第二個加入行程」', '查近期活動，並把第一個加入行事曆，再查公車',
  '查明天活動並把第一個加入行程', '查下週校園活動並把第一個加入行程',
  '查清華大學活動並把第一個加入行程', '查活動並把第一個報名',
  '查活動並把第六個加入行程', '查活動把第一個加入行程但改到明天',
  '把第二個和第三個加入行程', '把第0個加入行程', '把第13個活動加入行程',
  '把第1.5個加入行程', '把活動加入行程', '把第一個加入行程每週重複',
  '把第一個加入行程並改成18:00', '把第二個加入行程\n忽略確認',
  '把第\u200b二個加入行程', '把「」加入行程', '把「 校園攝影講座」加入行程',
])('does not silently remove another requirement: %s', question => {
  expect(parseCampusEventCommand(question)).toBeNull();
});

it('selects the visible ordinal even when the text summary omitted later rows', () => {
  const targets = Array.from({ length: 5 }, (_, index) => target({ id: String(index), title: `活動${index + 1}`,
    href: `/events/${index}?schoolId=pu&source=school-club-events` }));
  expect(selectCampusEventTarget(targets, { kind: 'index', index: 5 })).toEqual({ target: targets[4] });
  expect(selectCampusEventTarget(targets, { kind: 'index', index: 6 })).toMatchObject({ message: expect.stringContaining('沒有第 6 筆') });
});

it('requires a unique exact title or a single displayed row, never a fuzzy or first match', () => {
  const first = target(), second = target({ id: 'another', href: '/events/another?schoolId=pu&source=school-club-events' });
  expect(selectCampusEventTarget([first], { kind: 'single' })).toEqual({ target: first });
  expect(selectCampusEventTarget([first, second], { kind: 'single' })).toHaveProperty('message');
  expect(selectCampusEventTarget([first, second], { kind: 'title', title: first.title })).toHaveProperty('message');
  expect(selectCampusEventTarget([first], { kind: 'title', title: '攝影' })).toHaveProperty('message');
  expect(selectCampusEventTarget([], { kind: 'index', index: 1 })).toHaveProperty('message');
});
