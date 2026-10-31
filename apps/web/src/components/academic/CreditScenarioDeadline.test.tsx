import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { emptyCreditPlan, type CreditPlan } from '@campus/shared/src/creditPlanner';
import { CreditScenarioDeadline } from './CreditScenarioDeadline';
import { CreditPlanScenarios } from './CreditPlanScenarios';

function sample(): CreditPlan {
  return { ...emptyCreditPlan(), recognized: '112', target: '128', terms: 3,
    categoryGoals: { ...emptyCreditPlan().categoryGoals, required: { recognized: '50', target: '62' } },
    courses: [
      { id: 'db', name: '資料庫', credits: 6, term: 1, category: 'required', status: 'registered' },
      { id: 'stat', name: '統計學', credits: 6, term: 2, category: 'required', status: 'considering' },
      { id: 'art', name: '藝術', credits: 4, term: 3, category: 'general', status: 'considering' },
    ], milestones: [{ id: 'english', label: '英文門檻', done: false }] };
}
function moved(plan: CreditPlan): CreditPlan {
  return { ...plan, courses: plan.courses.map((course) => course.id === 'stat' ? { ...course, term: 3 } : course) };
}
function deadline(term: string) { fireEvent.change(screen.getByLabelText('比較到哪個學期末'), { target: { value: term } }); }

describe('deadline comparison', () => {
  it('separates final credit sufficiency from deadline gap and category gaps', () => {
    const plan = sample(); render(<CreditScenarioDeadline before={plan} after={moved(plan)} />);
    deadline('2');
    expect(screen.getByRole('status').textContent).toContain('全部修完總量足夠，但第 2 學期末仍差 10');
    expect(within(screen.getByRole('region', { name: '原規劃期限缺口' })).getByText('4')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: '比較方案期限缺口' })).getByText('10')).toBeTruthy();
    const table = screen.getByRole('table', { name: '期限內分類缺口', hidden: true });
    expect(within(table).getByText('6')).toBeTruthy();
    expect(screen.getByText('2 門排在期限後，不計入期限內學分')).toBeTruthy();
  });
  it('includes deferred courses only once the chosen deadline reaches their term', () => {
    const plan = sample(); render(<CreditScenarioDeadline before={plan} after={moved(plan)} />);
    deadline('2'); deadline('3');
    expect(screen.getByRole('status').textContent).toContain('個人總量目標在假設下可達成');
    expect(screen.queryByText(/門排在期限後/)).toBeNull();
  });
  it('invalid workload input clears old results rather than showing an old success', () => {
    const plan = sample(); render(<CreditScenarioDeadline before={plan} after={plan} />);
    fireEvent.change(screen.getByLabelText('個人每學期負擔提醒'), { target: { value: '' } });
    expect(screen.getByRole('alert').textContent).toContain('1～40');
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.change(screen.getByLabelText('個人每學期負擔提醒'), { target: { value: '25' } });
    expect(screen.getByRole('status')).toBeTruthy();
  });
  it('shows arithmetic room separately from actual course availability', () => {
    const plan = sample(); render(<CreditScenarioDeadline before={plan} after={moved(plan)} />); deadline('2');
    fireEvent.change(screen.getByLabelText('個人每學期負擔提醒'), { target: { value: '5' } });
    expect(screen.getByText(/單看學分量仍放不下 5 學分/)).toBeTruthy();
    expect(screen.getByText(/不代表有對應課程可選/)).toBeTruthy();
  });
  it('unassigned credits and unknown categories are never claimed as completed', () => {
    const plan = { ...sample(), extra: '20' }; render(<CreditScenarioDeadline before={plan} after={moved(plan)} />); deadline('2');
    expect(screen.getByRole('status').textContent).toContain('仍差 10');
    expect(screen.getByText(/其他預計學分 20 尚未排入學期/)).toBeTruthy();
    expect(screen.getByText(/1 項個人非學分條件未勾選，3 類門檻未填完整/)).toBeTruthy();
  });
  it('does not fabricate a zero gap when goals are missing', () => {
    const plan = { ...sample(), target: '' }; render(<CreditScenarioDeadline before={plan} after={plan} />);
    expect(screen.getByRole('status').textContent).toContain('暫時不能判斷');
  });
  it('rejects comparing unlike baselines', () => {
    const plan = sample(); render(<CreditScenarioDeadline before={plan} after={{ ...plan, recognized: '128' }} />);
    expect(screen.getByRole('alert').textContent).toContain('重新開始比較');
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('is connected to the existing scenario controls without changing the original plan', () => {
    const plan = sample(), original = JSON.stringify(plan); render(<CreditPlanScenarios plan={plan} />);
    fireEvent.click(screen.getByText('換個修法，先看差多少'));
    fireEvent.click(screen.getByRole('button', { name: '以全部課程開始比較' })); deadline('2');
    fireEvent.change(screen.getByLabelText('統計學（原第 2 學期）的比較安排'), { target: { value: '3' } });
    expect(screen.getByRole('status').textContent).toContain('仍差 10');
    expect(JSON.stringify(plan)).toBe(original);
  });
  it('hides obsolete deadline results when the original plan changes', () => {
    const plan = sample(); const view = render(<CreditPlanScenarios plan={plan} />);
    fireEvent.click(screen.getByText('換個修法，先看差多少'));
    fireEvent.click(screen.getByRole('button', { name: '以全部課程開始比較' })); deadline('2');
    view.rerender(<CreditPlanScenarios plan={{ ...plan, recognized: '114' }} />);
    expect(screen.queryByRole('region', { name: '目標學期比較' })).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('原規劃已更新');
  });
});
