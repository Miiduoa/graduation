'use client';

import { useMemo } from 'react';
import { analyzeCreditPlan } from '@campus/shared/src/creditPlanInsights';
import { formatCredits, type CreditPlan } from '@campus/shared/src/creditPlanner';
import styles from './CreditPlanFeasibility.module.css';
import { CreditPlanScenarios } from './CreditPlanScenarios';

function numberOrDash(value: number | null): string {
  return value === null ? '—' : formatCredits(value);
}

/**
 * A schedule planning assistant based only on user-entered credits.
 * It does not load school records or assert official graduation eligibility.
 */
export function CreditPlanFeasibility({ plan }: { plan: CreditPlan }) {
  const result = useMemo(() => analyzeCreditPlan(plan), [plan]);
  return (
    <section className={styles.panel} aria-labelledby="credit-feasibility-title">
      <div className={styles.heading}>
        <span className={styles.kicker}>PLAN CHECK</span>
        <h3 id="credit-feasibility-title">距離你的修課目標，還需要什麼？</h3>
        <p>
          以你自行輸入的學分與學期安排試算。下列結果全部假設候選及已選課都能通過、而且獲得採計。
        </p>
      </div>
      <div className={styles.metrics}>
        <div>
          <span>每學期平均還需</span>
          <strong>{numberOrDash(result.averageNeededPerTerm)}<small> 學分</small></strong>
          <p>以目標扣除已確認學分，再平均分攤至規劃的學期；並非學校最低修課要求</p>
        </div>
        <div>
          <span>尚未分配學期</span>
          <strong>{numberOrDash(result.creditsWithoutSemester)}<small> 學分</small></strong>
          <p>包含你填寫的「其他預計學分」，以及仍未安排的目標缺口</p>
        </div>
        <div>
          <span>全部規劃通過仍缺</span>
          <strong>{numberOrDash(result.remainingAfterAllPlans)}<small> 學分</small></strong>
          <p>純粹是個人總學分目標的樂觀試算，不代表符合必修或畢業規定</p>
        </div>
      </div>
      <div className={styles.content}>
        <div>
          <h4>各學期進度推演</h4>
          <p>下方累積值只加上已排入學期的課程，不會私自把其他預計學分塞進某個學期。</p>
          <ol className={styles.timeline}>
            {result.terms.map((term) => (
              <li key={term.term}>
                <span className={styles.term}>第 {term.term} 學期</span>
                <span>規劃 {formatCredits(term.plannedCredits)} 學分</span>
                <strong>累積 {numberOrDash(term.cumulativeIfPassed)}</strong>
              </li>
            ))}
          </ol>
          {result.earliestTargetTerm !== null && (
            <p className={styles.earliest}>
              {result.earliestTargetTerm === 0
                ? '你手動填寫的已確認學分，已達個人總量目標。'
                : `若全部已排課程通過且獲採計，單看總量最快在第 ${result.earliestTargetTerm} 學期達到個人目標。`}
            </p>
          )}
        </div>
        <div>
          <h4>下一步優先處理</h4>
          <ul className={styles.guidance}>
            {result.guidance.map((item, index) => (
              <li key={index}>
                <span className={styles.marker} aria-hidden="true">{index + 1}</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className={styles.disclaimer}>
            這是修課規劃檢查，不是畢業資格審查；學制、學則、入學年度、重修、必修指定科目與實際開課仍應以校方資料為準。
          </p>
        </div>
      </div>
      <CreditPlanScenarios plan={plan} />
    </section>
  );
}
