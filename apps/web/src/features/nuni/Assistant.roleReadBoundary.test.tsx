import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Assistant } from './Assistant';
import { browserRequest } from './Session';
import { answerAssistantLocally } from '@/lib/assistantLocalActions';
import { answerAssistantPersonalQuestion } from '@/lib/assistantPersonalReads';
import { personalImportsStorageKey } from '@/lib/personalImports';
import type { PersonalImportRecord } from '@campus/shared/src/imports/types';

vi.mock('./Session', () => ({
  browserRequest: vi.fn(),
  useNuniSession: () => ({ loading: false, error: '', pendingLogout: false,
    session: { context: 'a'.repeat(43), platformAccountId: 'alice' } }),
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/useCampusBrowseContext', () => ({
  useCampusBrowseContext: () => ({ status: 'ready', schoolId: 'pu' }),
}));
vi.mock('@/components/SiteShell', () => ({ SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('@/lib/assistantLocalActions', async original => {
  const value = await original<typeof import('@/lib/assistantLocalActions')>();
  return { ...value, answerAssistantLocally: vi.fn(value.answerAssistantLocally) };
});
vi.mock('@/lib/assistantPersonalReads', async original => {
  const value = await original<typeof import('@/lib/assistantPersonalReads')>();
  return { ...value, answerAssistantPersonalQuestion: vi.fn(value.answerAssistantPersonalQuestion) };
});

const profiles = ['teacher', 'merchant', 'club', 'school', 'platform'] as const;
const destination = { teacher: 'classroom', merchant: 'merchant', club: 'clubs', school: 'classroom/account', platform: 'admin' };
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const scope = { owner: 'platform:alice', schoolId: 'pu' };
const grade = { id: 'grade-a', kind: 'grades', title: '學生匯入成績來源', schoolId: 'pu',
  academicYear: '115', semester: '1', credits: 3, grade: '87', batchId: 'saved',
  importedAt: '2026-11-10T01:00:00Z', source: { type: 'paste', line: 1, rawText: '來源原文' } };
function saveRecords() {
  const date = new Date(Date.now() + 28_800_000).toISOString().slice(0, 10);
  const dayOfWeek = new Date(date + 'T12:00:00+08:00').getUTCDay() || 7;
  const timetable = { ...grade, id: 'own-class', kind: 'timetable', title: '本人保存的課表來源',
    dayOfWeek, startTime: '09:10', endTime: '10:00', location: '自己的教室 203' };
  const event = { ...grade, id: 'own-event', kind: 'events', title: '本人保存的個人行程',
    date, allDay: false, startTime: '18:00', endTime: '19:00' };
  localStorage.setItem(personalImportsStorageKey(scope), JSON.stringify({ version: 1, records: [grade, timetable, event] }));
  localStorage.setItem(personalImportsStorageKey({ ...scope, owner: 'platform:bob' }),
    JSON.stringify({ version: 1, records: [{ ...timetable, title: '另一個帳號的課表' }] }));
}
async function open(profile: string) {
  await act(async () => { render(<Assistant />); });
  const selector = await screen.findByLabelText('目前要處理') as HTMLSelectElement;
  fireEvent.change(selector, { target: { value: profile } });
  expect(selector.value).toBe(profile);
}
function send(question: string) {
  fireEvent.change(screen.getByLabelText('問題'), { target: { value: question } });
  const button = screen.getByRole('button', { name: '送出' }) as HTMLButtonElement;
  expect(button.disabled).toBe(false);
  fireEvent.click(button);
}
function noRemoteRead() {
  expect(browserRequest).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith('/api/nuni/assistant/capability', expect.any(Object));
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
}
beforeEach(() => {
  // PU timetable rows accept weekdays only. A moving CI clock must not make
  // the shared personal-import fixture invalid when the runner reaches Saturday.
  // Mock Date only; keep network deadlines and React timers real.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-18T10:30:00+08:00'));
  localStorage.clear(); sessionStorage.clear();
  vi.mocked(browserRequest).mockReset().mockRejectedValue(new Error('Unexpected private source'));
  vi.mocked(answerAssistantLocally).mockClear();
  vi.mocked(answerAssistantPersonalQuestion).mockClear();
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async () => json({ enabled: true, ready: false, version: 2 })));
  saveRecords();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it.each(profiles)('%s can submit and answer its own timetable without model consent', async profile => {
  await open(profile);
  send('查我的課表');
  const answer = await screen.findByText(/本人保存的課表來源/);
  expect(answer.textContent).toContain('自己的教室 203');
  expect(answer.textContent).not.toMatch(/學生匯入成績來源|另一個帳號的課表/);
  expect(answerAssistantLocally).not.toHaveBeenCalled();
  expect(answerAssistantPersonalQuestion).toHaveBeenCalledExactlyOnceWith('查我的課表', scope,
    expect.objectContaining({ context: 'a'.repeat(43), fallbackOnMissing: false }));
  noRemoteRead();
});

it.each(profiles.flatMap(profile => ['查我的待辦', '查我要繳的', '查我的\n成績', '查我的\t學分紀錄',
  '查詢 TronClass 課程', '下載 TronClass 教材', '幫我準備 TronClass 作業']
  .map(question => [profile, question] as const)))(
  '%s routes %j to work guidance before any local or student reader', async (profile, question) => {
    await open(profile);
    send(question);
    await screen.findByText(/也可以給我明確日期、起訖時間與名稱/);
    const links = screen.getAllByRole('link').map(link => link.getAttribute('href'));
    expect(links).toContain('/' + destination[profile] + '?schoolId=pu');
    expect(screen.queryByText(/學生匯入成績來源/)).toBeNull();
    expect(answerAssistantLocally).not.toHaveBeenCalled();
    expect(answerAssistantPersonalQuestion).not.toHaveBeenCalled();
    noRemoteRead();
  },
);

it('a complete personal timetable query is not redirected by broad teacher keywords', async () => {
  await open('teacher');
  send('今天有什麼課程');
  await screen.findByText(/本人保存的課表來源/);
  expect(answerAssistantLocally).toHaveBeenCalledOnce();
  expect(answerAssistantPersonalQuestion).not.toHaveBeenCalled();
  expect(screen.queryByText(/也可以給我明確日期、起訖時間與名稱/)).toBeNull();
  noRemoteRead();
});

it.each(['今天有什麼課程', '下一堂課在哪裡', '查我的課表',
      '下一堂課在哪裡呢', '今天有什麼課程嗎'])(
  'teacher falls back from a missing device timetable to the cloud answer: %s', async question => {
    localStorage.clear();
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/capability')) return json({ enabled: true, ready: true, version: 2 });
      expect(url).toBe('/api/nuni/assistant/ask');
      const input = JSON.parse(String(init?.body));
      expect(input).toMatchObject({ question, taskProfile: 'teacher' });
      // Actual Runner/ledger retrieval is covered by roleContext.integration.test.ts.
      return json({ version: 2, answer: '已同步課表：13:00–15:00 資料結構；資訊202',
        steps: [{ name: 'get_schedule', status: 'ok', summary: '已讀取課表' }], cards: [], modelCalls: 0 });
    });
    vi.stubGlobal('fetch', fetcher);
    await open('teacher');
    fireEvent.click(screen.getByRole('checkbox'));
    send(question);
    const answer = await screen.findByText(/資訊202/);
    expect(answer.textContent).toContain('資料結構');
    expect(answer.textContent).toContain('13:00');
    expect(screen.queryByText(/也可以給我明確日期、起訖時間與名稱/)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
  },
);

it('keeps the nonstudent personal calendar on its existing scoped reader', async () => {
  await open('merchant');
  send('查我的行程');
  await screen.findByText(/本人保存的個人行程/);
  expect(answerAssistantPersonalQuestion).toHaveBeenCalledExactlyOnceWith('查我的行程', scope,
    expect.objectContaining({ fallbackOnMissing: false }));
  expect(answerAssistantLocally).not.toHaveBeenCalled();
  noRemoteRead();
});

it('preserves the student local academic read, including supported whitespace', async () => {
  await open('student');
  send('查我的\n成績');
  const answer = await screen.findByText(/學生匯入成績來源/);
  expect(answer.textContent).toContain('成績：87');
  expect(answerAssistantLocally).toHaveBeenCalledOnce();
  expect(answerAssistantPersonalQuestion).not.toHaveBeenCalled();
  noRemoteRead();
});

it('preserves the student coursework reader and reports its actual source failure', async () => {
  await open('student');
  send('查我的待辦');
  await screen.findByText(/這次無法讀取課程與作業資料/);
  expect(answerAssistantPersonalQuestion).toHaveBeenCalledOnce();
  expect(browserRequest).toHaveBeenCalledOnce();
  expect(answerAssistantLocally).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('keeps unrelated model questions disabled without consent instead of swallowing a submit', async () => {
  await open('teacher');
  fireEvent.change(screen.getByLabelText('問題'), { target: { value: '請說一個笑話' } });
  const button = screen.getByRole('button', { name: '送出' }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(answerAssistantLocally).not.toHaveBeenCalled();
  expect(answerAssistantPersonalQuestion).not.toHaveBeenCalled();
  noRemoteRead();
});

it('answers the signed-in platform account timetable and calendar conflict from this device without remote reads', async () => {
  // beforeEach has frozen Date at Wednesday 2026-11-18 10:30 in Taipei.
  const base = { schoolId: 'pu', academicYear: '115', semester: '1', batchId: 'conflict-batch',
    importedAt: '2026-11-10T01:00:00.000Z', source: { type: 'paste' as const, line: 1, rawText: '不得外送的匯入原文' } };
  const eventId = '行程/#' + 'a'.repeat(296);
  const records: PersonalImportRecord[] = [
    { ...base, id: 'conflict-class', kind: 'timetable', title: '資料庫管理', dayOfWeek: 3,
      startTime: '14:10', endTime: '16:00', location: '私人教室 B203' },
    { ...base, id: eventId, kind: 'events', title: '專題小組討論', academicYear: '', semester: '',
      date: '2026-11-18', allDay: false, startTime: '15:00', endTime: '16:30' },
    { ...base, id: 'quiet-event', kind: 'events', title: '晚間聚餐', academicYear: '', semester: '',
      date: '2026-11-18', allDay: false, startTime: '18:00', endTime: '19:00' },
  ];
  localStorage.setItem(personalImportsStorageKey(scope), JSON.stringify({ version: 1, records }));
  localStorage.setItem(personalImportsStorageKey({ ...scope, owner: 'platform:bob' }), JSON.stringify({ version: 1, records: [
    { ...records[0], id: 'bob-class', title: '另一個帳號的課' },
    { ...records[1], id: 'bob-event', title: '另一個帳號的行程' }] }));
  localStorage.setItem(personalImportsStorageKey({ ...scope, schoolId: 'ntpu' }), JSON.stringify({ version: 1, records: [
    { ...records[0], id: 'ntpu-class', schoolId: 'ntpu', title: '其他學校的課' },
    { ...records[1], id: 'ntpu-event', schoolId: 'ntpu', title: '其他學校的行程' }] }));

  await open('student');
  send('今天的行程跟上課有撞期嗎？');
  await screen.findAllByText(/專題小組討論/);
  const text = document.body.textContent ?? '';
  expect(text).toContain('資料庫管理');
  expect(text).toMatch(/15:00[^\d]{1,6}16:00/);
  const href = screen.getByRole('link', { name: /查看行程.*專題小組討論/ }).getAttribute('href');
  expect(href).toBe('/calendar?' + new URLSearchParams({ schoolId: 'pu', eventId }));
  expect(document.querySelector('a[href*="eventId=quiet-event"]')).toBeNull();
  for (const hidden of ['晚間聚餐', '另一個帳號', '其他學校', '不得外送的匯入原文'])
    expect(text).not.toContain(hidden);
  noRemoteRead();
});
