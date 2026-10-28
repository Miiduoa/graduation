'use client';

import { useMemo, useState } from 'react';
import { formatCredits, parseCredits, type CreditPlan } from '@campus/shared/src/creditPlanner';
import { compareCreditScenarioDeadline, creditDeadlineConclusion } from '@campus/shared/src/creditScenarioDeadline';
import styles from './CreditScenarioDeadline.module.css';

const number = (value: number | null) => value === null ? '未設定' : formatCredits(value);

/** This view only explains the in-memory scenario; it has no persistence or school API. */
export function CreditScenarioDeadline({ before, after }: { before: CreditPlan; after: CreditPlan }) {
  const [targetTerm, setTargetTerm] = useState(before.terms);
  const [limitText, setLimitText] = useState('25');
  const limit = parseCredits(limitText);
  const result = useMemo(() => compareCreditScenarioDeadline(before, after, {
    targetTerm, workloadLimit: limit ?? Number.NaN,
  }), [before, after, targetTerm, limit]);
  const report = result.ok === true ? result.report : null;
  const invalid = limit === null || limit < 1 || limit > 40;

  return <section className={styles.panel} aria-label="目標學期比較">
    <header><span className={styles.eyebrow}>看期限，不只看總量</span>
      <h4>這個學期前，學分來得及嗎？</h4>
      <p>只計入期限前排定的課程，並假設全部通過且獲採計。</p>
    </header>
    <div className={styles.controls}>
      <label>比較到哪個學期末<select value={targetTerm} onChange={(event) => setTargetTerm(Number(event.target.value))}>
        {Array.from({ length: 8 }, (_, index) => index + 1).map((term) => <option key={term} value={term}>未來第 {term} 學期末</option>)}
      </select></label>
      <label>個人每學期負擔提醒<input value={limitText} type="text" inputMode="decimal" maxLength={6}
        aria-label="個人每學期負擔提醒" aria-invalid={invalid} onChange={(event) => setLimitText(event.target.value)} />
        <small>1～40 學分；是你的規劃偏好，不是校方上限。</small></label>
    </div>
    {result.ok === false ? <p role="alert" className={styles.warning}>{result.message}</p> : null}
    {report ? <>
      <p role="status" className={styles.conclusion}>{creditDeadlineConclusion(report)}</p>
      <div className={styles.metrics}>
        <section aria-label="原規劃期限缺口"><span>原規劃 · 期限內還差</span>
          <strong>{number(report.before.remaining)}<small> 學分</small></strong>
          <p>期限前安排 {formatCredits(report.before.scheduled)} 學分</p></section>
        <section aria-label="比較方案期限缺口"><span>比較方案 · 期限內還差</span>
          <strong>{number(report.after.remaining)}<small> 學分</small></strong>
          <p>期限前安排 {formatCredits(report.after.scheduled)} 學分</p></section>
      </div>
      {report.remainingDelta !== null ? <p className={styles.delta}>期限內缺口變化：{report.remainingDelta > 0 ? '+' : ''}{formatCredits(report.remainingDelta)} 學分；全部課程結束後仍缺 {number(report.after.remainingAfterAll)} 學分。</p> : null}
      <details className={styles.breakdown}>
        <summary>核對期限內分類與每學期負擔</summary>
        <div className={styles.tables}>
          <table aria-label="期限內分類缺口"><caption>分類缺口 · 原規劃 → 比較方案</caption>
            <thead><tr><th>類別</th><th>原規劃</th><th>方案</th></tr></thead>
            <tbody>{report.categories.map((row) => <tr key={row.key}><th scope="row">{row.label}</th><td>{number(row.before)}</td><td>{number(row.after)}</td></tr>)}</tbody>
          </table>
          <table aria-label="期限內學期負擔"><caption>各學期學分 · 原規劃 → 比較方案</caption>
            <thead><tr><th>學期</th><th>原規劃</th><th>方案</th></tr></thead>
            <tbody>{report.terms.map((row) => <tr key={row.term}><th scope="row">第 {row.term} 學期</th><td>{formatCredits(row.before)}</td>
              <td>{formatCredits(row.after)}{row.overBy > 0 ? <small>超過提醒 {formatCredits(row.overBy)}</small> : null}</td></tr>)}</tbody>
          </table>
        </div>
        <p className={styles.note}>單位為學分；未設定的分類不當成零。還有 {report.pendingMilestones} 項個人非學分條件未勾選，{report.unknownCategories} 類門檻未填完整。</p>
        <p className={styles.note}>假設每學期不超過 {formatCredits(report.workloadLimit)} 學分，期限內的數學餘量是 {formatCredits(report.after.roomWithinLimit)} 學分；不代表有對應課程可選、符合先修或一定開課。</p>
        {report.capacityShortfall !== null && report.capacityShortfall > 0 ? <p className={styles.warning}>若維持這個負擔偏好，單看學分量仍放不下 {formatCredits(report.capacityShortfall)} 學分，需重新安排期限或負擔。</p> : null}
      </details>
      {report.laterCourses.length ? <details className={styles.breakdown}>
        <summary>{report.laterCourses.length} 門排在期限後，不計入期限內學分</summary>
        <ul className={styles.later}>{report.laterCourses.map((course) => <li key={course.id}>
          <strong>{course.name}</strong><span>第 {course.term} 學期 · {formatCredits(course.credits)} 學分</span>
        </li>)}</ul>
      </details> : null}
      {report.warnings.length ? <ul className={styles.warnings}>{report.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
      <p className={styles.note}>這不是畢業審查，也不會更動原規劃。期限與負擔提醒只用於當次比較，不寫入或匯出為校方規則。</p>
    </> : null}
  </section>;
}
