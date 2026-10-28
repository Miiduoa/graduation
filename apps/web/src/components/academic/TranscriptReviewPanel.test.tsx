import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { AcademicGrade } from '@/lib/academicRecords';
import { TranscriptReviewPanel, TranscriptReviewHint } from './TranscriptReviewPanel';

const row = (score: number | string, credits = 0.5): AcademicGrade => ({ id: String(score), semester: '1151', courseName: '來源課程', courseNameEn: '', class: '', courseType: '', score, credits });
afterEach(cleanup);

it('shows actionable counts without claiming earned or missing graduation credits', () => {
  const change = vi.fn();
  render(<TranscriptReviewPanel grades={[row('SAT'), row('', 0), row(0, 3)]} active={false} onChange={change} />);
  expect(screen.getByRole('heading', { name: '2 筆成績需要核對' })).toBeTruthy();
  expect(screen.getByText('成績尚未提供 1 筆 · 文字結果需核對 1 筆')).toBeTruthy();
  expect(screen.getByText('這些紀錄共列 0.5 學分；不代表已取得或尚缺學分。')).toBeTruthy();
  const button = screen.getByRole('button', { name: '核對 2 筆成績' });
  expect(button.getAttribute('aria-pressed')).toBe('false');
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(button);
  expect(change).toHaveBeenCalledExactlyOnceWith(true);
});

it('always offers a way out if refreshed data has no remaining review rows', () => {
  const change = vi.fn();
  render(<TranscriptReviewPanel grades={[]} active onChange={change} />);
  const button = screen.getByRole('button', { name: '返回全部明細' });
  expect(button.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(button);
  expect(change).toHaveBeenCalledExactlyOnceWith(false);
});

it('does not label clean but possibly incomplete source data as fully verified', () => {
  render(<TranscriptReviewPanel grades={[row(0), row('Pass')]} active={false} onChange={vi.fn()} />);
  expect(screen.queryByRole('region', { name: '成績待核對' })).toBeNull();
  expect(screen.queryByText(/完整|全部通過/)).toBeNull();
});

it('keeps invalid credits unknown instead of displaying zero', () => {
  render(<TranscriptReviewPanel grades={[row('SAT', NaN)]} active={false} onChange={vi.fn()} />);
  expect(screen.getByText('這些紀錄的學分合計尚無法確認。')).toBeTruthy();
});

it('labels unrecognized text and malformed numbers but not genuine zero', () => {
  const { rerender } = render(<TranscriptReviewHint score="SAT" />);
  expect(screen.getByText('文字結果需核對')).toBeTruthy();
  rerender(<TranscriptReviewHint score={101} />);
  expect(screen.getByText('數值或格式需核對')).toBeTruthy();
  rerender(<TranscriptReviewHint score={0} />);
  expect(screen.queryByText(/需核對|尚未提供/)).toBeNull();
});
