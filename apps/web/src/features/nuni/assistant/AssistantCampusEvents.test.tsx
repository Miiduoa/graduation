import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AssistantCampusEvents } from './AssistantCampusEvents';
import { AssistantThread } from './AssistantThread';
import type { AssistantCampusEventTarget } from '@/lib/assistantCampusEvent';

const target = (id: string, title: string): AssistantCampusEventTarget => ({
  schoolId: 'pu', source: 'school-club-events', id, title,
  startsAt: '2030-11-16T06:00:00.000Z', endsAt: '2030-11-16T08:00:00.000Z',
  checkedAt: '2030-11-15T06:00:00.000Z', location: '活動中心',
  href: `/events/${id}?schoolId=pu&source=school-club-events`,
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('requires an explicit selection and shows source, Taipei time and the confirmation boundary', () => {
  const first = target('photo', '攝影講座'), second = target('music', '音樂工作坊');
  const onSelect = vi.fn();
  render(<AssistantCampusEvents targets={[first, second]} schoolId="pu" pending={false} onSelect={onSelect} />);
  expect(onSelect).not.toHaveBeenCalled();
  expect(screen.getByText(/確認後才加入個人行事曆/)).toBeTruthy();
  expect(screen.getAllByText(/2030\/11\/16 下午2:00.*2030\/11\/16 下午4:00/)).toHaveLength(2);
  expect(screen.getAllByRole('link', { name: '查看活動來源' })[1].getAttribute('href')).toBe(second.href);
  fireEvent.click(screen.getByRole('button', { name: '將音樂工作坊加入個人行事曆' }));
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(second);
});

it('keeps incomplete events readable without offering an invented duration', () => {
  const missingEnd = target('photo', '攝影講座');
  delete missingEnd.endsAt;
  const onSelect = vi.fn();
  render(<AssistantCampusEvents targets={[missingEnd]} schoolId="pu" pending={false} onSelect={onSelect} />);
  const button = screen.getByRole('button', { name: '將攝影講座加入個人行事曆' });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/不會猜測活動長度/)).toBeTruthy();
  fireEvent.click(button);
  expect(onSelect).not.toHaveBeenCalled();
  expect(screen.getByRole('link', { name: '查看活動來源' })).toBeTruthy();
});

it.each(['pending', 'blocked'] as const)('keeps source links available while %s prevents preparing another card', reason => {
  const onSelect = vi.fn();
  render(<AssistantCampusEvents targets={[target('photo', '攝影講座')]} schoolId="pu"
    pending={reason === 'pending'} blockedReason={reason === 'blocked' ? '請先確認或取消原本的項目。原卡保留。' : ''} onSelect={onSelect} />);
  const button = screen.getByRole('button', { name: '將攝影講座加入個人行事曆' });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(button);
  expect(onSelect).not.toHaveBeenCalled();
  expect(screen.getByRole('link', { name: '查看活動來源' })).toBeTruthy();
});

it('expires a source eligibility at its start without requiring a rerender from the parent', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2030-11-16T05:59:59.000Z'));
  const onSelect = vi.fn();
  render(<AssistantCampusEvents targets={[target('photo', '攝影講座')]} schoolId="pu" pending={false} onSelect={onSelect} />);
  const button = screen.getByRole('button', { name: '將攝影講座加入個人行事曆' });
  expect((button as HTMLButtonElement).disabled).toBe(false);
  act(() => { vi.advanceTimersByTime(1002); });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/這個活動已開始/)).toBeTruthy();
  fireEvent.click(button);
  expect(onSelect).not.toHaveBeenCalled();
});

it('rejects an entire foreign-school or malformed group before rendering links', () => {
  render(<AssistantCampusEvents targets={[target('photo', '攝影講座')]} schoolId="nthu" pending={false} onSelect={vi.fn()} />);
  expect(screen.queryByRole('link')).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
});

it('keeps source-bound preview cards out of generic revision controls', () => {
  Element.prototype.scrollIntoView = vi.fn();
  const revision = vi.fn(() => <button>不該出現的通用改期</button>), select = vi.fn();
  render(<AssistantThread schoolId="pu" ready={false} fallback={false} consent={false} onConsent={vi.fn()}
    question="" onQuestion={vi.fn()} states={{}} pending={false} asking={false} onStopAsk={vi.fn()}
    error="" recoverableQuestion="" onRecoverQuestion={vi.fn()} onAsk={vi.fn()} onConfirm={vi.fn()} onCancel={vi.fn()}
    renderPlanRevision={revision} onEventTarget={select}
    turns={[{ question: '選擇攝影講座', reply: { answer: '來源已核對，等待確認。', steps: [], cards: [],
      dataRead: true, campusEventPreview: true, eventTargets: [target('photo', '攝影講座')] } }]} />);
  const source = screen.getByRole('region', { name: '活動來源行程' });
  expect(within(source).getByText(/只保存標題與時間，地點僅供來源參考/)).toBeTruthy();
  expect(within(source).getByRole('link', { name: '重新查看活動來源' })).toBeTruthy();
  expect(within(source).queryByRole('button')).toBeNull();
  expect(revision).not.toHaveBeenCalled();
  expect(select).not.toHaveBeenCalled();
});
