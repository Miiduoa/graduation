import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AssistantThread } from './AssistantThread';

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const base = {
  schoolId: 'pu',
  ready: true,
  fallback: false,
  consent: false,
  onConsent: vi.fn(),
  question: '',
  onQuestion: vi.fn(),
  turns: [],
  states: {},
  pending: false,
  error: '',
  onAsk: vi.fn(),
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
};

it('shows empty state, suggestion chips and a labelled composer', () => {
  render(<AssistantThread {...base} />);
  expect(screen.getByRole('heading', { name: '今天想問什麼？' })).toBeTruthy();
  fireEvent.click(screen.getByText('這禮拜有什麼要交的'));
  expect(base.onQuestion).toHaveBeenCalledWith('這禮拜有什麼要交的');
  expect(screen.getByLabelText('問題')).toBeTruthy();
  expect((screen.getByText('送出') as HTMLButtonElement).disabled).toBe(true);
});

it('shows a typing status instead of a blank wait', () => {
  render(<AssistantThread {...base} pending consent onConsent={vi.fn()} />);
  expect(screen.getByRole('status').textContent).toMatch(/正在整理回覆/);
});

it('surfaces a friendly error region', () => {
  render(<AssistantThread {...base} error="查詢未完成，請稍後再試。" />);
  expect(screen.getByRole('alert').textContent).toBe('查詢未完成，請稍後再試。');
});
