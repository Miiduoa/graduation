'use client';

import { useMemo, useRef, useState } from 'react';
import { formatCredits, restoreCreditPlan, type CreditPlan } from '@campus/shared/src/creditPlanner';
import {
  changeCreditScenario, compareCreditScenario, creditScenarioTargetLabel,
  filterCreditScenarioCourses, startCreditScenario,
  type CreditScenario, type CreditScenarioPreset,
} from '@campus/shared/src/creditPlanScenarios';
import styles from './CreditPlanScenarios.module.css';
import { CreditScenarioDeadline } from './CreditScenarioDeadline';
import type { CreditScenarioWriter } from '@campus/shared/src/creditScenarioAdoption';
import { CreditScenarioAdoptionActions } from './CreditScenarioAdoptionActions';

const number = (value: number | null) => value === null ? '未設定' : formatCredits(value);

export function CreditPlanScenarios({ plan, scenarioWriter, scenarioBlocked }: {
  plan: CreditPlan; scenarioWriter?: CreditScenarioWriter; scenarioBlocked?: string;
}) {
  const [scenario, setScenario] = useState<{ source: CreditPlan; value: CreditScenario } | null>(null);
  const [query, setQuery] = useState('');
  const [term, setTerm] = useState<number | null>(null);
  const [limit, setLimit] = useState(12);
  const [notice, setNotice] = useState<{ source: CreditPlan; text: string } | null>(null);
  const exportLock = useRef(false);
  const validPlan = useMemo(() => restoreCreditPlan(JSON.stringify(plan)) !== null, [plan]);
  const stale = scenario !== null && scenario.source !== plan;
  const result = useMemo(() => scenario && !stale ? compareCreditScenario(plan, scenario.value) : null,
    [plan, scenario, stale]);
  const rows = useMemo(() => filterCreditScenarioCourses(plan, query, term), [plan, query, term]);
  const comparison = result?.ok === true ? result : null;

  function begin(preset: CreditScenarioPreset) {
    if (!validPlan) return;
    setScenario({ source: plan, value: startCreditScenario(plan, preset) });
    setNotice(null);
  }
  function change(id: string, selected: string) {
    setScenario((current) => current && current.source === plan
      ? { ...current, value: changeCreditScenario(current.value, id, selected === 'omit' ? null : Number(selected)) }
      : current);
    setNotice(null);
  }
  function exportScenario() {
    if (!comparison?.changed || stale || exportLock.current) return;
    exportLock.current = true;
    let url: string | null = null;
    let link: HTMLAnchorElement | null = null;
    try {
      const data = JSON.stringify(comparison.plan);
      const blob = new Blob([data], { type: 'application/json;charset=utf-8' });
      if (blob.size > 90_000) throw new Error('方案超過 90 KB，請先減少內容再匯出。');
      url = URL.createObjectURL(blob);
      link = document.createElement('a');
      link.href = url;
      link.download = '學分比較方案.json';
      document.body.appendChild(link);
      link.click();
      setNotice({ source: plan, text: '已交給瀏覽器下載。原規劃不變；要採用此方案，可在「匯入 JSON」選取備份並確認取代。' });
    } catch (error) {
      setNotice({ source: plan, text: error instanceof Error ? error.message : '無法產生方案備份，原規劃不變。' });
    } finally {
      link?.remove();
      if (url) { const created = url; window.setTimeout(() => URL.revokeObjectURL(created), 0); }
      exportLock.current = false;
    }
  }

  return <details className={styles.panel}>
    <summary><span><strong>換個修法，先看差多少</strong>
      <small>比較不修某門課、延後修課或只修已選課；不直接更動原規劃。</small></span>
      <span aria-hidden="true">＋</span></summary>
    <div className={styles.body}>
      <p className={styles.note}>比較以這裡已加入規劃的課程為準，不包含尚未按「加入規劃」的課程表單。已選課狀態也由你手動標示，所有結果仍是假設通過且可採計。</p>
      {!validPlan ? <p className={styles.warning}>請先修正原規劃的無效欄位，再開始比較。</p> : null}
      {!plan.courses.length ? <p className={styles.empty}>先在課程清單加入一門課，就能比較不同修法。</p> : <>
        <div className={styles.actions}>
          <button type="button" disabled={!validPlan} onClick={() => begin('all')}>以全部課程開始比較</button>
          <button type="button" disabled={!validPlan} onClick={() => begin('registered')}>比較只修已選課</button>
          {scenario ? <button type="button" onClick={() => { setScenario(null); setNotice(null); }}>結束比較</button> : null}
        </div>
        {stale ? <p className={styles.warning} role="alert">原規劃已更新，舊比較不再適用。請按上方按鈕以最新內容重新開始。</p> : null}
        {result?.ok === false ? <p className={styles.warning} role="alert">{result.message}</p> : null}
        {comparison ? <>
          <CreditScenarioDeadline before={plan} after={comparison.plan} />
          <h4>調整比較課程</h4>
          <div className={styles.filters}>
            <label>搜尋比較課程<input type="search" value={query} maxLength={80} onChange={(event) => { setQuery(event.target.value); setLimit(12); }} placeholder="輸入課程名稱" /></label>
            <label>原安排學期<select value={term ?? 'all'} onChange={(event) => { setTerm(event.target.value === 'all' ? null : Number(event.target.value)); setLimit(12); }}>
              <option value="all">全部學期</option>{comparison.before.perTerm.map((row) => <option key={row.term} value={row.term}>第 {row.term} 學期</option>)}
            </select></label>
          </div>
          <p className={styles.note}>顯示 {Math.min(limit, rows.length)}／{rows.length} 門；搜尋與篩選不會排除其他課程的計算。</p>
          <ul className={styles.courses}>{rows.slice(0, limit).map((course) => {
            const choice = scenario!.value.choices.find((item) => item.courseId === course.id)!;
            return <li key={course.id}><div><strong>{course.name}</strong><p>原第 {course.term} 學期 · {formatCredits(course.credits)} 學分 · {course.status === 'registered' ? '已選課（未取得）' : '候選'}</p></div>
              <label>比較安排<select value={choice.term ?? 'omit'} aria-label={`${course.name}（原第 ${course.term} 學期）的比較安排`} onChange={(event) => change(course.id, event.target.value)}>
                <option value="omit">此方案不排入</option>{Array.from({ length: 8 }, (_, i) => i + 1).map((value) => <option key={value} value={value}>第 {value} 學期</option>)}
              </select></label></li>;
          })}</ul>
          {!rows.length ? <p className={styles.empty}>沒有符合篩選的課程；比較結果仍包含整份方案。</p> : null}
          {rows.length > limit ? <button type="button" onClick={() => setLimit((value) => value + 12)}>顯示更多比較課程</button> : null}
          <h4>完整方案比較（不限期限）</h4>
          <div className={styles.scoreboard}>
            <div><h4>原規劃</h4><span>全部通過仍缺</span><strong>{number(comparison.before.remaining)}<small> 學分</small></strong>
              <p>已排課程 {number(comparison.before.courseCredits)} 學分</p>
              <p>總量達標：{creditScenarioTargetLabel(comparison.beforeInsights.earliestTargetTerm, comparison.before.remaining !== null)}</p></div>
            <div><h4>比較方案</h4><span>全部通過仍缺</span><strong>{number(comparison.after.remaining)}<small> 學分</small></strong>
              <p>已排課程 {number(comparison.after.courseCredits)} 學分</p>
              <p>總量達標：{creditScenarioTargetLabel(comparison.afterInsights.earliestTargetTerm, comparison.after.remaining !== null)}</p></div>
          </div>
          <p className={styles.delta} aria-live="polite">{`不排入 ${comparison.omitted.length} 門、移動 ${comparison.moved.length} 門；總學分缺口變化：${comparison.remainingDelta === null ? '目標尚未完整設定' : (comparison.remainingDelta > 0 ? '+' : '') + formatCredits(comparison.remainingDelta) + ' 學分'}。`}</p>
          <div className={styles.results}>
            <section aria-label="各學期比較"><h4>每學期的負擔</h4>
              <table><thead><tr><th>未來學期</th><th>原規劃</th><th>比較方案</th></tr></thead><tbody>
                {comparison.terms.map((row) => <tr key={row.term}><th scope="row">第 {row.term} 學期</th><td>{formatCredits(row.before)}</td>
                  <td>{formatCredits(row.after)}{row.after > 25 ? <small> · 請核對負擔</small> : null}</td></tr>)}
              </tbody></table>
            </section>
            <section aria-label="分類缺口比較"><h4>分類還缺多少</h4>
              <table><thead><tr><th>類別</th><th>原規劃</th><th>比較方案</th></tr></thead><tbody>
                {comparison.categories.map((row) => <tr key={row.key}><th scope="row">{row.label}</th><td>{number(row.before)}</td><td>{number(row.after)}</td></tr>)}
              </tbody></table>
            </section>
          </div>
          <p className={styles.note}>表格單位為學分。達標學期只計已排入學期的課程，不把「其他預計學分」放進某學期。完整方案比較固定以 25 學分提醒，與上方個人每學期負擔提醒無關；25 不是學校上限。總量達標不代表畢業。</p>
        </> : null}
      </>}
      <CreditScenarioAdoptionActions plan={plan} candidate={comparison?.plan ?? null}
        writer={scenarioWriter} blocked={scenarioBlocked}
        onApplied={() => { setScenario(null); setNotice(null); }} />
      {comparison ? <>
          {comparison.afterInsights.possibleRetakes.length ? <p className={styles.warning}>此方案仍有同名課程，可能重複採計。比較沒有把課名相同視為同一門正式課程，請向系辦核對。</p> : null}
          <div className={styles.footer}>
            <strong>原規劃仍完整保留</strong>
            <p>「不排入」不代表退選，也不刪除校方紀錄。可直接預覽並採用；需要跨裝置移轉時，仍可匯出 JSON 備份。請另外保留原規劃備份。</p>
            <button type="button" disabled={!comparison.changed} onClick={exportScenario}>匯出此比較方案 JSON</button>
          </div>
        </> : null}
      {notice?.source === plan ? <p className={styles.note} aria-live="polite">{notice.text}</p> : null}
    </div>
  </details>;
}
