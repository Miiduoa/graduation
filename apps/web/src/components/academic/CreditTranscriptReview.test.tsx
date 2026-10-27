import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreditTranscriptReview } from './CreditTranscriptReview';
import { creditPlanStorageKey, emptyCreditPlan } from '@/lib/creditPlanner';
import type { AcademicSnapshot } from '@/lib/academicClient';

const auth = vi.hoisted(() => ({ uid: 'a' as string | null, actualUid: 'a' as string | null, loading: false }));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => ({ user: auth.uid ? { uid: auth.uid } : null, loading: auth.loading, error: null }) }));
vi.mock('@/lib/firebase', () => ({ getAuth: () => ({ currentUser: auth.actualUid ? { uid: auth.actualUid } : null }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));

const key = creditPlanStorageKey('a', 'pu');
function sample(): AcademicSnapshot<'grades'> {
  return { ownerUid: 'a', schoolId: 'pu', fetchedAt: new Date().toISOString(), records: {
    grades: [{ id: 'g1', semester: '1141', courseName: '資料庫', courseNameEn: '', class: '', courseType: '必修', credits: 3, score: 80 }],
    semesters: ['1141'], allSemesters: ['1141'], summary: {},
  } };
}
function pick() {
  fireEvent.click(screen.getByRole('button', { name: '60 分' }));
  fireEvent.click(screen.getByRole('button', { name: '選取無重複疑義的通過紀錄' }));
}
function preview() { pick(); fireEvent.click(screen.getByRole('button', { name: '預覽套用差異' })); }
function confirm() {
  fireEvent.click(screen.getByRole('checkbox', { name: /我已核對來源/ }));
  fireEvent.click(screen.getByRole('button', { name: '確認套用到個人規劃' }));
}
beforeEach(() => { auth.uid = 'a'; auth.actualUid = 'a'; auth.loading = false; window.localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Web transcript review', () => {
  it('requires an explicit pass mark, row review, preview and final confirmation before writing', () => {
    render(<CreditTranscriptReview snapshot={sample()} />);
    expect(screen.queryByRole('button', { name: '預覽套用差異' })).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
    preview();
    expect(screen.getByText('核對更新前後')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '確認套用到個人規劃' }));
    expect(localStorage.getItem(key)).toBeNull();
    confirm();
    expect(screen.getByRole('heading', { name: '已帶入 3 學分' })).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(key)!).recognized).toBe('3');
    expect(screen.getByRole('link', { name: '查看更新後的學分規劃' }).getAttribute('href')).toBe('/credit-planner?school=pu');
  });
  it('does not read another account, a guest or unresolved authentication', () => {
    auth.uid = 'b'; const read = vi.spyOn(Storage.prototype, 'getItem');
    const view = render(<CreditTranscriptReview snapshot={sample()} />);
    expect(screen.queryByRole('button', { name: '60 分' })).toBeNull(); expect(read).not.toHaveBeenCalled();
    auth.uid = null; view.rerender(<CreditTranscriptReview snapshot={sample()} />);
    expect(screen.queryByRole('button', { name: '60 分' })).toBeNull();
    auth.uid = 'a'; auth.loading = true; view.rerender(<CreditTranscriptReview snapshot={sample()} />);
    expect(read).not.toHaveBeenCalled();
  });
  it('empty grades do not clear the current personal plan', () => {
    localStorage.setItem(key, JSON.stringify({ ...emptyCreditPlan(), recognized: '90' }));
    const input = sample(); input.records.grades = [];
    render(<CreditTranscriptReview snapshot={input} />);
    expect(screen.getByText('目前沒有可核對的成績')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '預覽套用差異' })).toBeNull();
    expect(JSON.parse(localStorage.getItem(key)!).recognized).toBe('90');
  });
  it('duplicate names are omitted from bulk selection and selecting two is blocked', () => {
    const input = sample(); input.records.grades.push({ ...input.records.grades[0], id: 'g2', semester: '1151' });
    render(<CreditTranscriptReview snapshot={input} />); pick();
    expect(screen.getByRole('checkbox', { name: '選取資料庫 1141' }).getAttribute('checked')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: '選取資料庫 1141' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '選取資料庫 1151' }));
    expect(screen.getByRole('alert').textContent).toContain('已有選取項目');
    fireEvent.click(screen.getByRole('button', { name: '預覽套用差異' })); confirm();
    expect(JSON.parse(localStorage.getItem(key)!).recognized).toBe('3');
  });
  it('preserves user category changes and requires an overlap decision', () => {
    localStorage.setItem(key, JSON.stringify({ ...emptyCreditPlan(), target: '128', courses: [
      { id: 'planned', name: '資料庫', credits: 3, term: 1, category: 'required', status: 'registered' },
    ] }));
    render(<CreditTranscriptReview snapshot={sample()} />); pick();
    fireEvent.change(screen.getByRole('combobox', { name: '資料庫的規劃分類' }), { target: { value: 'elective' } });
    fireEvent.click(screen.getByRole('button', { name: '預覽套用差異' }));
    confirm(); expect(JSON.parse(localStorage.getItem(key)!).courses).toHaveLength(1);
    fireEvent.click(screen.getByRole('radio', { name: '移除這門已修課程的未來安排' }));
    fireEvent.click(screen.getByRole('button', { name: '確認套用到個人規劃' }));
    const plan = JSON.parse(localStorage.getItem(key)!);
    expect(plan.courses).toHaveLength(0); expect(plan.target).toBe('128');
    expect(plan.categoryGoals.elective.recognized).toBe('3');
  });
  it('rejects stale local plans even without a cross-tab event', () => {
    render(<CreditTranscriptReview snapshot={sample()} />); preview();
    const changed = { ...emptyCreditPlan(), target: '150' }; localStorage.setItem(key, JSON.stringify(changed));
    confirm();
    expect(screen.getByRole('alert').textContent).toContain('原規劃已更新');
    expect(localStorage.getItem(key)).toBe(JSON.stringify(changed));
  });
  it('a storage event clears the outdated preview but keeps the reviewed selection', () => {
    render(<CreditTranscriptReview snapshot={sample()} />); preview();
    fireEvent(window, new StorageEvent('storage', { key, storageArea: localStorage, newValue: '{}' }));
    expect(screen.queryByText('核對更新前後')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('其他分頁');
    expect((screen.getByRole('checkbox', { name: '選取資料庫 1141' }) as HTMLInputElement).checked).toBe(true);
  });
  it('rechecks actual authentication at apply rather than trusting a stale rendered session', () => {
    render(<CreditTranscriptReview snapshot={sample()} />); preview(); auth.actualUid = 'b'; confirm();
    expect(screen.getByRole('alert').textContent).toContain('登入'); expect(localStorage.getItem(key)).toBeNull();
  });
  it('expired source timestamps block preview without modifying any plan', () => {
    const input = sample(); input.fetchedAt = new Date(Date.now() - 11 * 60_000).toISOString();
    render(<CreditTranscriptReview snapshot={input} />); preview();
    expect(screen.getByRole('alert').textContent).toContain('10 分鐘'); expect(localStorage.getItem(key)).toBeNull();
  });
  it('quota failure retains the preview and permits deliberate retry', () => {
    render(<CreditTranscriptReview snapshot={sample()} />); preview();
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('quota full'); });
    confirm(); expect(screen.getByRole('alert').textContent).toBe('quota full');
    expect(screen.queryByRole('heading', { name: '已帶入 3 學分' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '確認套用到個人規劃' }));
    expect(set).toHaveBeenCalledTimes(2); expect(screen.getByRole('heading', { name: '已帶入 3 學分' })).toBeTruthy();
  });
  it('source refresh resets unconfirmed selection instead of applying stale row positions', () => {
    const input = sample(); const view = render(<CreditTranscriptReview snapshot={input} />); pick();
    view.rerender(<CreditTranscriptReview snapshot={{ ...input, fetchedAt: new Date(Date.now() + 1000).toISOString() }} />);
    expect(screen.queryByRole('button', { name: '預覽套用差異' })).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });
});
