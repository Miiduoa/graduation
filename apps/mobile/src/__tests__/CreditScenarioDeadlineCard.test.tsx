import React from 'react';
import { fireEvent, render, within } from '@testing-library/react-native';
import { emptyCreditPlan, type CreditPlan } from '@campus/shared/src/creditPlanner';
import { CreditScenarioDeadlineCard } from '../screens/creditAudit/CreditScenarioDeadlineCard';

function sample(): CreditPlan {
  return { ...emptyCreditPlan(), recognized: '112', target: '128', terms: 3,
    categoryGoals: { ...emptyCreditPlan().categoryGoals, required: { recognized: '50', target: '62' } },
    courses: [
      { id: 'db', name: '資料庫', credits: 6, term: 1, category: 'required', status: 'registered' },
      { id: 'stat', name: '統計學', credits: 6, term: 2, category: 'required', status: 'considering' },
      { id: 'art', name: '藝術', credits: 4, term: 3, category: 'general', status: 'considering' },
    ], milestones: [{ id: 'english', label: '英文門檻', done: false }] };
}
const moved = (plan: CreditPlan): CreditPlan => ({ ...plan, courses: plan.courses.map((row) => row.id === 'stat' ? { ...row, term: 3 } : row) });

test('native deadline controls reveal the deferred-credit gap without mutating the plan', () => {
  const plan = sample(), original = JSON.stringify(plan);
  const view = render(<CreditScenarioDeadlineCard before={plan} after={moved(plan)} />);
  fireEvent.press(view.getByLabelText('提前一學期比較'));
  expect(view.getByText('全部修完總量足夠，但第 2 學期末仍差 10 學分。')).toBeTruthy();
  expect(within(view.getByLabelText('原規劃期限缺口')).getByText('期限前安排 12 學分')).toBeTruthy();
  expect(within(view.getByLabelText('比較方案期限缺口')).getByText('期限前安排 6 學分')).toBeTruthy();
  expect(JSON.stringify(plan)).toBe(original);
});
test('native deadline is bounded to eight terms with accessible disabled buttons', () => {
  const plan = sample(); const view = render(<CreditScenarioDeadlineCard before={plan} after={plan} />);
  for (let i = 0; i < 10; i++) fireEvent.press(view.getByLabelText('提前一學期比較'));
  expect(view.getByText('比較到未來第 1 學期末')).toBeTruthy();
  expect(view.getByLabelText('提前一學期比較').props.accessibilityState.disabled).toBe(true);
  for (let i = 0; i < 10; i++) fireEvent.press(view.getByLabelText('延後一學期比較'));
  expect(view.getByText('比較到未來第 8 學期末')).toBeTruthy();
  expect(view.getByLabelText('延後一學期比較').props.accessibilityState.disabled).toBe(true);
});
test('invalid input removes stale totals and valid decimal input restores them', () => {
  const plan = sample(); const view = render(<CreditScenarioDeadlineCard before={plan} after={plan} />);
  expect(view.getByLabelText('個人每學期負擔提醒').props.accessibilityState.invalid).toBe(false);
  fireEvent.changeText(view.getByLabelText('個人每學期負擔提醒'), '1e2');
  expect(view.getByRole('alert').props.children).toContain('1～40');
  expect(view.getByLabelText('個人每學期負擔提醒').props.accessibilityState.invalid).toBe(true);
  expect(view.queryByLabelText('比較方案期限缺口')).toBeNull();
  fireEvent.changeText(view.getByLabelText('個人每學期負擔提醒'), '18.5');
  expect(view.getByLabelText('個人每學期負擔提醒').props.accessibilityState.invalid).toBe(false);
  expect(view.getByLabelText('比較方案期限缺口')).toBeTruthy();
});
test('native detailed view explains capacity, unknown classifications and future-only courses', () => {
  const plan = sample(); const view = render(<CreditScenarioDeadlineCard before={plan} after={moved(plan)} />);
  fireEvent.press(view.getByLabelText('提前一學期比較'));
  fireEvent.changeText(view.getByLabelText('個人每學期負擔提醒'), '5');
  expect(view.getByLabelText('2 門排在期限後，不計入期限內學分')).toBeTruthy();
  fireEvent.press(view.getByLabelText('核對期限內分類與每學期負擔'));
  expect(view.getByText(/單看學分量仍放不下 5 學分/)).toBeTruthy();
  expect(view.getByText(/1 項個人非學分條件未勾選，3 類門檻未填完整/)).toBeTruthy();
});
test('later-course summary stays visible without expanding the category breakdown', () => {
  const plan = sample(); const view = render(<CreditScenarioDeadlineCard before={plan} after={moved(plan)} />);
  fireEvent.press(view.getByLabelText('提前一學期比較'));
  expect(view.getByLabelText('2 門排在期限後，不計入期限內學分')).toBeTruthy();
  expect(view.queryByText('統計學')).toBeNull();
  fireEvent.press(view.getByLabelText('2 門排在期限後，不計入期限內學分'));
  expect(view.getByText('統計學')).toBeTruthy();
  expect(view.getByText('藝術')).toBeTruthy();
});
test('extra-only totals do not claim unqualified full-plan sufficiency', () => {
  const plan = { ...sample(), recognized: '120', target: '128', extra: '8', courses: [] };
  const view = render(<CreditScenarioDeadlineCard before={plan} after={plan} />);
  expect(view.getByText(/含尚未排入學期的其他預計學分後，全部修完總量可達標，但第 3 學期末仍差 8/)).toBeTruthy();
  expect(view.queryByText(/全部修完總量足夠/)).toBeNull();
});
test('extra credits do not enter the deadline and blanks do not become zero', () => {
  const plan = { ...sample(), extra: '20', recognized: '' };
  const view = render(<CreditScenarioDeadlineCard before={plan} after={plan} />);
  expect(view.getByText('目標尚未設定完整，暫時不能判斷期限缺口。')).toBeTruthy();
  expect(view.getByText(/其他預計學分 20 尚未排入學期/)).toBeTruthy();
});
test('unlike goals cannot be presented as a schedule-only comparison', () => {
  const plan = sample(); const view = render(<CreditScenarioDeadlineCard before={plan} after={{ ...plan, target: '90' }} />);
  expect(view.getByRole('alert').props.children).toContain('重新開始比較');
  expect(view.queryByLabelText('比較方案期限缺口')).toBeNull();
});
