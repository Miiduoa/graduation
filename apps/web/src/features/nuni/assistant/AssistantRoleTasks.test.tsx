import { fireEvent, render, screen } from '@testing-library/react';
import { useState, type ComponentProps } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AssistantThread } from './AssistantThread';
import { AssistantRoleTasks } from './AssistantRoleTasks';
import type { V2Card } from './types';

type Props = ComponentProps<typeof AssistantThread>;
const noop = () => {};
const base: Props = {
  schoolId: 'pu', ready: true, fallback: false, consent: true,
  onConsent: noop, question: '', onQuestion: noop, turns: [], states: {},
  pending: false, asking: false, onStopAsk: noop, error: '',
  recoverableQuestion: '', onRecoverQuestion: noop, onAsk: noop, onConfirm: noop, onCancel: noop,
};

function Harness({ initial = '', ...props }: Partial<Props> & { initial?: string }) {
  const [question, setQuestion] = useState(initial);
  return <AssistantThread {...base} {...props} question={question} onQuestion={setQuestion} />;
}
const context = () => screen.getByLabelText('目前處理的工作') as HTMLSelectElement;
const field = () => screen.getByLabelText('問題') as HTMLTextAreaElement;
const chooseContext = (value: string) => fireEvent.change(context(), { target: { value } });

beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });

it('shows teaching examples for an explicit teaching entry without student homework chips', () => {
  render(<Harness initial="查我的授課概況" />);
  expect(context().value).toBe('teacher');
  expect(field().placeholder).toContain('授課概況');
  expect(screen.queryByRole('button', { name: '幫我排今晚寫作業' })).toBeNull();
  expect(screen.getByRole('button', { name: '查我的授課概況，查近期活動' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '開啟授課課程' }).getAttribute('href')).toBe('/classroom?schoolId=pu');
});

it('keeps both drafts while switching roles and filling an example, without submitting a task', () => {
  const onAsk = vi.fn(), onConfirm = vi.fn(), onCancel = vi.fn();
  render(<Harness initial={' 原本的問題\n補充內容 '} onAsk={onAsk} onConfirm={onConfirm} onCancel={onCancel} />);
  const originalField = field();
  chooseContext('merchant');
  expect(field()).toBe(originalField);
  expect(field().value).toBe(' 原本的問題\n補充內容 ');
  expect(field().placeholder).toContain('門市營運概況');
  fireEvent.click(screen.getByRole('button', { name: '查我的門市營運概況，查近期活動' }));
  expect(field().value).toBe('查我的門市營運概況，查近期活動');
  expect(document.activeElement).toBe(field());
  fireEvent.click(screen.getByRole('button', { name: '切換保留草稿' }));
  expect(field().value).toBe(' 原本的問題\n補充內容 ');
  expect(context().value).toBe('merchant');
  expect(onAsk).not.toHaveBeenCalled();
  expect(onConfirm).not.toHaveBeenCalled();
  expect(onCancel).not.toHaveBeenCalled();
});

it('uses an already-loaded teacher preference and preserves a later manual choice', () => {
  const view = render(<Harness inline />);
  const originalField = field();
  view.rerender(<Harness inline preferredWorkContext="teacher" />);
  expect(context().value).toBe('teacher');
  expect(screen.queryByRole('button', { name: '下一堂課在哪裡？' })).toBeNull();
  expect(screen.getByRole('button', { name: '查我的授課概況' })).toBeTruthy();
  chooseContext('merchant');
  view.rerender(<Harness inline preferredWorkContext="student" />);
  expect(context().value).toBe('merchant');
  expect(field()).toBe(originalField);
  expect(screen.getByRole('button', { name: '查我的門市營運概況' })).toBeTruthy();
});

it('keeps an uncertain operation and its recovery action when work context changes', () => {
  const card: V2Card = { tool: 'propose_personal_event', token: 'signed-previous-operation',
    mutationId: 'original-event', schoolId: 'pu', destination: '個人行事曆',
    args: { title: '先前的讀書安排', date: '2026-11-18', allDay: false, startTime: '15:00', endTime: '16:00' } };
  const onAsk = vi.fn(), onConfirm = vi.fn(), onCancel = vi.fn(), onReconcile = vi.fn();
  const view = render(<Harness onAsk={onAsk} onConfirm={onConfirm} onCancel={onCancel} onReconcile={onReconcile}
    turns={[{ question: '先前問題', reply: { answer: '已準備行程', steps: [], cards: [card] } }]}
    states={{ [card.mutationId]: { status: 'unknown', message: '需要核對先前操作結果' } }} />);
  const originalTurn = view.container.querySelector('article');
  const originalRecovery = screen.getByRole('button', { name: '重新核對結果' });
  chooseContext('teacher');
  expect(view.container.querySelector('article')).toBe(originalTurn);
  expect(screen.getByRole('button', { name: '重新核對結果' })).toBe(originalRecovery);
  expect(screen.getByText('需要核對先前操作結果')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '幫我排今晚寫作業' })).toBeNull();
  expect(onAsk).not.toHaveBeenCalled();
  expect(onConfirm).not.toHaveBeenCalled();
  expect(onCancel).not.toHaveBeenCalled();
  expect(onReconcile).not.toHaveBeenCalled();
});

it('keeps manager operations in the original workspace with the current school', () => {
  const onContext = vi.fn();
  const view = render(<AssistantRoleTasks context="operator" schoolId="nthu" onContext={onContext} />);
  expect(screen.getByText(/管理操作請到管理工作區/)).toBeTruthy();
  expect(screen.getByRole('link', { name: '開啟平台管理' }).getAttribute('href')).toBe('/admin?schoolId=nthu');
  view.rerender(<AssistantRoleTasks context="staff" schoolId="pu" onContext={onContext} />);
  expect(screen.getByRole('link', { name: '開啟請假核閱' }).getAttribute('href')).toBe('/leave/review?schoolId=pu');
  expect(screen.getByRole('link', { name: '開啟課務申訴審核' }).getAttribute('href')).toBe('/teacher?schoolId=pu');
  expect(onContext).not.toHaveBeenCalled();
});

it('drops the work preference with the authenticated conversation instead of persisting it across accounts', () => {
  const view = render(<Harness key="account-one:pu" />);
  chooseContext('merchant');
  view.rerender(<Harness key="account-two:nthu" schoolId="nthu" />);
  expect(context().value).toBe('student');
  expect(field().value).toBe('');
});
