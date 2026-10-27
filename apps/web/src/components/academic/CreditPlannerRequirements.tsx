'use client';

import { useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import {
  MAX_MILESTONES,
  PLANNER_CATEGORIES,
  creditPlanSummary,
  formatCredits,
  parseCredits,
  type CreditPlan,
  type PlannerCategory,
} from '@/lib/creditPlanner';
import styles from './CreditPlannerRequirements.module.css';

function invalidCredit(value: string) {
  return value.trim() !== '' && parseCredits(value) === null;
}

export function CreditPlannerRequirements({
  plan,
  setPlan,
}: {
  plan: CreditPlan;
  setPlan: Dispatch<SetStateAction<CreditPlan>>;
}) {
  const [milestoneName, setMilestoneName] = useState('');
  const [message, setMessage] = useState('');
  const summary = creditPlanSummary(plan);
  const goalsEntered = PLANNER_CATEGORIES.some(({ key }) =>
    plan.categoryGoals[key].target.trim() || plan.categoryGoals[key].recognized.trim(),
  );

  function updateGoal(key: PlannerCategory, field: 'target' | 'recognized', value: string) {
    setPlan((current) => ({
      ...current,
      categoryGoals: {
        ...current.categoryGoals,
        [key]: { ...current.categoryGoals[key], [field]: value },
      },
    }));
  }

  function addMilestone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const label = milestoneName.trim();
    if (label.length < 2 || label.length > 80) {
      setMessage('請輸入 2–80 字的條件名稱。');
      return;
    }
    if (plan.milestones.length >= MAX_MILESTONES) {
      setMessage('每份規劃最多可以追蹤 24 項非學分條件。');
      return;
    }
    const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    setPlan((current) => ({
      ...current,
      milestones: [...current.milestones, { id, label, done: false }],
    }));
    setMilestoneName('');
    setMessage('');
  }

  return (
    <details className={styles.details}>
      <summary>
        <span className={styles.summaryText}>
          <strong>進階檢查：分類門檻與非學分條件</strong>
          <small>可選填，核對必修／選修／通識及英檢等畢業條件</small>
        </span>
        <span aria-hidden="true" className={styles.chevron}>⌄</span>
      </summary>
      <div className={styles.body}>
        <p className={styles.intro}>
          各校、各入學年度的門檻不同，這裡不內建推測的畢業規則。請依學校正式審查，
          自行填寫每個類別「已確認可採計」與「目標」；課程只會加到你手動指定的類別。
          同一門課若可跨類別採計，仍須由系辦確認。
        </p>
        <div className={styles.categoryGoals}>
          {PLANNER_CATEGORIES.map(({ key, label }) => {
            const row = summary.categoryGaps.find((entry) => entry.key === key)!;
            return (
              <section key={key} className={styles.goalCard} aria-label={label + '分類門檻'}>
                <header>
                  <strong>{label}</strong>
                  <span>規劃 {formatCredits(row.planned)} 學分</span>
                </header>
                <div className={styles.inputs}>
                  <label>
                    已確認採計
                    <input
                      type="number"
                      inputMode="decimal"
                      step="any"
                      min="0"
                      max="1000"
                      value={plan.categoryGoals[key].recognized}
                      onChange={(event) => updateGoal(key, 'recognized', event.target.value)}
                      aria-invalid={invalidCredit(plan.categoryGoals[key].recognized)}
                      aria-label={label + '已確認採計學分'}
                      placeholder="未設定"
                    />
                  </label>
                  <label>
                    目標門檻
                    <input
                      type="number"
                      inputMode="decimal"
                      step="any"
                      min="0"
                      max="1000"
                      value={plan.categoryGoals[key].target}
                      onChange={(event) => updateGoal(key, 'target', event.target.value)}
                      aria-invalid={invalidCredit(plan.categoryGoals[key].target)}
                      aria-label={label + '目標門檻'}
                      placeholder="未設定"
                    />
                  </label>
                </div>
                <p className={styles.gap}>
                  {row.remaining === null
                    ? '兩欄都填妥後顯示分類缺口'
                    : '若課程都通過且可採計，此類還差 ' + formatCredits(row.remaining) + ' 學分'}
                </p>
              </section>
            );
          })}
        </div>
        {goalsEntered && summary.categoryOvercount && (
          <p className={styles.warning} role="alert">
            你填的各類別已採計學分加總，大於上方的總已確認學分。可能有重複採計，請核對後再使用分類缺口。
          </p>
        )}
        {PLANNER_CATEGORIES.some(({ key }) =>
          invalidCredit(plan.categoryGoals[key].recognized) || invalidCredit(plan.categoryGoals[key].target),
        ) && (
          <p className={styles.warning} role="alert">
            分類學分需要 0–1000 之間、最多兩位小數的有效數字；目前變更不會儲存。
          </p>
        )}

        <div className={styles.milestoneHeader}>
          <h3>非學分條件</h3>
          <p>自訂並自行勾選，例如語言檢定、服務學習。勾選不代表學校已認定完成。</p>
        </div>
        <form className={styles.milestoneForm} onSubmit={addMilestone}>
          <label>
            新增條件
            <input
              value={milestoneName}
              onChange={(event) => setMilestoneName(event.target.value)}
              placeholder="例如：通過英文能力門檻"
              maxLength={80}
              required
            />
          </label>
          <button type="submit">加入條件</button>
        </form>
        {message && <p className={styles.warning} role="alert">{message}</p>}
        {plan.milestones.length > 0 ? (
          <>
            <p className={styles.milestoneCount}>
              自行勾選 {summary.milestonesComplete} / {plan.milestones.length} 項
            </p>
            <ul className={styles.milestones}>
              {plan.milestones.map((milestone) => (
                <li key={milestone.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={milestone.done}
                      onChange={(event) => setPlan((current) => ({
                        ...current,
                        milestones: current.milestones.map((entry) =>
                          entry.id === milestone.id ? { ...entry, done: event.target.checked } : entry,
                        ),
                      }))}
                    />
                    <span>{milestone.label}</span>
                  </label>
                  <button
                    type="button"
                    aria-label={'移除條件' + milestone.label}
                    onClick={() => setPlan((current) => ({
                      ...current,
                      milestones: current.milestones.filter((entry) => entry.id !== milestone.id),
                    }))}
                  >
                    移除
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className={styles.empty}>尚未加入非學分條件。請依自己的學制與系所規則建立清單。</p>
        )}
      </div>
    </details>
  );
}
