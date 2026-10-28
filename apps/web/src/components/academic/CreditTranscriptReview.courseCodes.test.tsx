import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CreditTranscriptReview } from './CreditTranscriptReview';
import { normalizeGradeRecords } from '@/lib/academicRecords';
import { creditPlanStorageKey } from '@/lib/creditPlanner';
import type { AcademicSnapshot } from '@/lib/academicClient';

vi.mock('@/components/AuthGuard', () => ({ useAuth: () => ({ user: { uid: 'fixture' }, loading: false, error: null }) }));
vi.mock('@/lib/firebase', () => ({ getAuth: () => ({ currentUser: { uid: 'fixture' } }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));

function sample(): AcademicSnapshot<'grades'> {
  const row = { semester: '1151', credits: 3, score: 80, courseType: '必修' };
  return { ownerUid: 'fixture', schoolId: 'pu', fetchedAt: new Date().toISOString(), records: normalizeGradeRecords({
    success: true, allSemesters: ['1151', '1142'], summary: {},
    grades: [
      { ...row, courseCode: 'IM101', courseName: '資料庫' },
      { ...row, courseCode: 'IM101', courseName: '資料庫系統', semester: '1142' },
      { ...row, courseCode: 'IM202', courseName: '統計學' },
    ],
  }) };
}
const key = creditPlanStorageKey('fixture', 'pu');
beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('carries source codes through normalization and excludes renamed duplicates from bulk selection', () => {
  render(<CreditTranscriptReview snapshot={sample()} />);
  fireEvent.click(screen.getByRole('button', { name: '60 分' }));
  expect(screen.getAllByText('課號 IM101')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: '選取建議課程' }));
  expect((screen.getByRole('checkbox', { name: '選取資料庫 1151' }) as HTMLInputElement).checked).toBe(false);
  expect((screen.getByRole('checkbox', { name: '選取資料庫系統 1142' }) as HTMLInputElement).checked).toBe(false);
  expect((screen.getByRole('checkbox', { name: '選取統計學 1151' }) as HTMLInputElement).checked).toBe(true);
  expect(localStorage.getItem(key)).toBeNull();
});

it('prevents double selection of renamed records while retaining explicit confirmation', () => {
  render(<CreditTranscriptReview snapshot={sample()} />);
  fireEvent.click(screen.getByRole('button', { name: '60 分' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '選取資料庫 1151' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '選取資料庫系統 1142' }));
  expect(screen.getByRole('alert').textContent).toContain('已有選取項目');
  expect((screen.getByRole('checkbox', { name: '選取資料庫系統 1142' }) as HTMLInputElement).checked).toBe(false);
  expect(localStorage.getItem(key)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '預覽套用差異' }));
  expect(localStorage.getItem(key)).toBeNull();
  fireEvent.click(screen.getByRole('checkbox', { name: /我已核對來源/ }));
  fireEvent.click(screen.getByRole('button', { name: '確認套用到個人規劃' }));
  expect(JSON.parse(localStorage.getItem(key)!).recognized).toBe('3');
  expect(screen.getByRole('heading', { name: '已帶入 3 學分' })).toBeTruthy();
});

it('finds source course codes with fullwidth input without selecting or modifying grades', () => {
  const snapshot = sample(); const before = JSON.stringify(snapshot);
  render(<CreditTranscriptReview snapshot={snapshot} />);
  fireEvent.click(screen.getByRole('button', { name: '60 分' }));
  fireEvent.change(screen.getByLabelText('搜尋課程或學期'), { target: { value: 'ｉｍ１０１' } });
  expect(screen.getAllByText('課號 IM101')).toHaveLength(2);
  expect(screen.queryByRole('checkbox', { name: '選取統計學 1151' })).toBeNull();
  expect(screen.getAllByRole('checkbox').every(node => !(node as HTMLInputElement).checked)).toBe(true);
  expect(JSON.stringify(snapshot)).toBe(before);
  expect(localStorage.getItem(key)).toBeNull();
});
