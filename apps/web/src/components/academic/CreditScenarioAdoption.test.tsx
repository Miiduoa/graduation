import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { creditPlanStorageKey, emptyCreditPlan, type CreditPlan } from '@/lib/creditPlanner';
import { CreditPlannerWorkspace } from './CreditPlannerWorkspace';

const key = creditPlanStorageKey('alice', 'pu');
function sample(): CreditPlan { return { ...emptyCreditPlan(), recognized: '60', target: '128',
  milestones: [{ id: 'eng', label: '英文門檻', done: false }], courses: [
    { id: 'one', name: '資料庫', credits: 3, term: 1, category: 'required', status: 'registered' },
    { id: 'two', name: '統計學', credits: 2.5, term: 2, category: 'elective', status: 'considering' },
  ] }; }
function page(uid = 'alice') { return <CreditPlannerWorkspace key={uid} userId={uid} schoolId="pu" schoolName="靜宜大學" />; }
async function setup(plan = sample()) {
  localStorage.setItem(key, JSON.stringify(plan)); const view = render(page());
  await screen.findByLabelText('課程名稱');
  fireEvent.click(screen.getByText('換個修法，先看差多少'));
  fireEvent.click(screen.getByRole('button', { name: '比較只修已選課' }));
  return view;
}
function preview() { fireEvent.click(screen.getByRole('button', { name: '預覽並採用此方案' })); }
async function apply() {
  preview(); fireEvent.click(screen.getByRole('button', { name: '確認採用到個人規劃' }));
  await screen.findByText('已採用到這台裝置的個人規劃。');
}
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
afterEach(() => vi.restoreAllMocks());

describe('Web 方案直接採用', () => {
  it('previews without writing, then saves and undoes exactly without JSON transfer', async () => {
    const original = sample(); await setup(original); const writes = vi.spyOn(Storage.prototype, 'setItem');
    preview(); expect(writes).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: '確認修課安排差異' })).toBe(document.activeElement);
    fireEvent.click(screen.getByRole('button', { name: '確認採用到個人規劃' }));
    await screen.findByText('已採用到這台裝置的個人規劃。');
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ recognized: '60', target: '128', milestones: original.milestones });
    expect(JSON.parse(localStorage.getItem(key)!).courses.map((r: { id: string }) => r.id)).toEqual(['one']);
    fireEvent.click(screen.getByRole('button', { name: '復原這次採用' }));
    await screen.findByText('已復原這次採用，回到原本的修課安排。');
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(original);
  });
  it('cancel leaves the original intact', async () => {
    await setup(); preview(); fireEvent.click(screen.getByRole('button', { name: '取消採用' }));
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(sample());
    expect(screen.queryByRole('button', { name: '確認採用到個人規劃' })).toBeNull();
  });
  it('blocks adoption while an unfinished course input is present, without clearing it', async () => {
    await setup(); fireEvent.change(screen.getByLabelText('課程名稱'), { target: { value: '尚未加入的課' } });
    expect((screen.getByRole('button', { name: '預覽並採用此方案' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('課程名稱') as HTMLInputElement).value).toBe('尚未加入的課');
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(sample());
  });
  it('refuses a preview after another tab saved, and does not autosave over that version', async () => {
    await setup(); preview(); const newer = { ...sample(), target: '140' };
    localStorage.setItem(key, JSON.stringify(newer));
    fireEvent.click(screen.getByRole('button', { name: '確認採用到個人規劃' }));
    await screen.findByText(/其他分頁已更新規劃，或本機資料無法讀取/);
    fireEvent.change(screen.getByLabelText('希望累計的學分'), { target: { value: '150' } });
    await screen.findByText(/本頁輸入仍保留但尚未儲存/);
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(newer);
  });
  it('preserves the preview on disk failure and supports retry', async () => {
    await setup(); preview(); const writes = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('disk full'); });
    fireEvent.click(screen.getByRole('button', { name: '確認採用到個人規劃' })); await screen.findByText('disk full');
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(sample()); writes.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: '確認採用到個人規劃' }));
    await screen.findByText('已採用到這台裝置的個人規劃。');
  });
  it('invalidates undo after any later saved edit', async () => {
    await setup(); await apply();
    fireEvent.change(screen.getByLabelText('希望累計的學分'), { target: { value: '150' } });
    await waitFor(() => expect(screen.queryByRole('button', { name: '復原這次採用' })).toBeNull());
    expect(JSON.parse(localStorage.getItem(key)!).target).toBe('150');
  });
  it('keeps undo available even if adopting the scenario removes all future courses', async () => {
    const original = sample(); original.courses.forEach(c => { c.status = 'considering'; });
    await setup(original); await apply();
    expect(JSON.parse(localStorage.getItem(key)!).courses).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '復原這次採用' }));
    await screen.findByText('已復原這次採用，回到原本的修課安排。');
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(original);
  });
  it('does not revive preview on account A to B to A', async () => {
    const view = await setup(); preview();
    await act(async () => { view.rerender(page('bob')); });
    await screen.findByLabelText('課程名稱');
    await act(async () => { view.rerender(page('alice')); });
    expect(screen.queryByRole('button', { name: '確認採用到個人規劃' })).toBeNull();
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(sample());
  });
});
