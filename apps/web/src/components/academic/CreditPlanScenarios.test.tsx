import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyCreditPlan, type CreditPlan } from '@campus/shared/src/creditPlanner';
import { CreditPlanScenarios } from './CreditPlanScenarios';

function sample(): CreditPlan {
  return { ...emptyCreditPlan(), recognized: '60', target: '80', courses: [
    { id: 'one', name: '資料庫', credits: 3, term: 1, category: 'required', status: 'registered' },
    { id: 'two', name: '統計學', credits: 2.5, term: 2, category: 'elective', status: 'considering' },
  ] };
}
function open() { fireEvent.click(screen.getByText('換個修法，先看差多少')); }
beforeEach(() => vi.restoreAllMocks());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('網頁修課比較', () => {
  it('compares omission and movement without writing to storage or mutating the source', () => {
    const plan = sample();
    const original = JSON.stringify(plan);
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    render(<CreditPlanScenarios plan={plan} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: '以全部課程開始比較' }));
    fireEvent.change(screen.getByLabelText('統計學（原第 2 學期）的比較安排'), { target: { value: 'omit' } });
    expect(screen.getByText(/不排入 1 門、移動 0 門/).textContent).toContain('+2.5 學分');
    fireEvent.change(screen.getByLabelText('資料庫（原第 1 學期）的比較安排'), { target: { value: '4' } });
    expect(screen.getByText(/不排入 1 門、移動 1 門/)).toBeTruthy();
    expect(JSON.stringify(plan)).toBe(original);
    expect(storage).not.toHaveBeenCalled();
  });

  it('filters displayed courses without changing totals and offers a registered-only preset', () => {
    render(<CreditPlanScenarios plan={sample()} />); open();
    fireEvent.click(screen.getByRole('button', { name: '比較只修已選課' }));
    expect((screen.getByLabelText('統計學（原第 2 學期）的比較安排') as HTMLSelectElement).value).toBe('omit');
    fireEvent.change(screen.getByLabelText('搜尋比較課程'), { target: { value: '資料庫' } });
    expect(screen.queryByLabelText('統計學（原第 2 學期）的比較安排')).toBeNull();
    expect(screen.getByText(/不排入 1 門、移動 0 門/).textContent).toContain('+2.5 學分');
  });

  it('invalidates the old comparison when the original plan changes', () => {
    const plan = sample();
    const view = render(<CreditPlanScenarios plan={plan} />); open();
    fireEvent.click(screen.getByRole('button', { name: '比較只修已選課' }));
    view.rerender(<CreditPlanScenarios plan={{ ...plan, recognized: '70' }} />);
    expect(screen.getByRole('alert').textContent).toContain('原規劃已更新');
    expect(screen.queryByRole('button', { name: '匯出此比較方案 JSON' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '以全部課程開始比較' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows empty and invalid states without offering fabricated comparisons', () => {
    const view = render(<CreditPlanScenarios plan={emptyCreditPlan()} />); open();
    expect(screen.getByText(/先在課程清單加入一門課/)).toBeTruthy();
    view.rerender(<CreditPlanScenarios plan={{ ...sample(), target: '-1' }} />);
    expect((screen.getByRole('button', { name: '以全部課程開始比較' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/請先修正原規劃/)).toBeTruthy();
  });

  it('does not label an unknown target as already satisfied', () => {
    render(<CreditPlanScenarios plan={{ ...sample(), recognized: '', target: '' }} />); open();
    fireEvent.click(screen.getByRole('button', { name: '以全部課程開始比較' }));
    expect(screen.getAllByText(/總量達標：目標尚未完整設定/)).toHaveLength(2);
    expect(within(screen.getByRole('region', { name: '分類缺口比較' })).getAllByText('未設定')).toHaveLength(8);
  });

  it('downloads a compatible scenario backup only on explicit action and leaves the original untouched', async () => {
    const plan = sample();
    const original = JSON.stringify(plan);
    const create = vi.fn((_blob: Blob) => 'blob:scenario');
    const revoke = vi.fn();
    const NativeURL = URL;
    class TestURL extends NativeURL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    }
    vi.stubGlobal('URL', TestURL);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<CreditPlanScenarios plan={plan} />); open();
    fireEvent.click(screen.getByRole('button', { name: '比較只修已選課' }));
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '匯出此比較方案 JSON' }));
    expect(create).toHaveBeenCalledTimes(1);
    const blob = create.mock.calls[0][0] as unknown as Blob;
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsText(blob);
    });
    expect(JSON.parse(text).courses.map((row: { id: string }) => row.id)).toEqual(['one']);
    expect(JSON.parse(text).recognized).toBe('60');
    expect(JSON.stringify(plan)).toBe(original);
    expect(screen.getByText(/已交給瀏覽器下載/)).toBeTruthy();
  });
});
