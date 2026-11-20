'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/AuthGuard';
import { getAuth } from '@/lib/firebase';
import type { AcademicSnapshot } from '@/lib/academicClient';
import { PLANNER_CATEGORIES, creditPlanStorageKey, formatCredits, type CreditPlan, type PlannerCategory } from '@/lib/creditPlanner';
import { isCreditReviewFresh, readTranscriptPlan, replaceTranscriptPlan } from '@/lib/creditTranscriptStorage';
import {
  reviewTranscript, reviewedCreditTotals, suggestedTranscriptSelection, transcriptPlanOverlaps,
  applyTranscriptReview, type TranscriptSelection, type TranscriptPlanChange,
} from '@campus/shared/src/creditTranscriptReview';
import styles from './CreditTranscriptReview.module.css';

type Props = { snapshot: AcademicSnapshot<'grades'> };
type Preview = { plan: CreditPlan; choices: Record<string, 'remove' | 'keep'> };
const message = (failure: unknown) => failure instanceof Error ? failure.message : '這次核對未完成，原規劃沒有更新。';

export function CreditTranscriptReview({ snapshot }: Props) {
  const { user, loading, error } = useAuth();
  if (loading || error || !user || user.uid !== snapshot.ownerUid || snapshot.schoolId !== 'pu') {
    return <section role="status">正在確認成績所屬帳號與校園，尚未讀取或修改個人規劃。</section>;
  }
  return <Review key={`${snapshot.ownerUid}:${snapshot.schoolId}:${snapshot.fetchedAt}`} snapshot={snapshot} />;
}

function Review({ snapshot }: Props) {
  const { ownerUid, schoolId, fetchedAt, records } = snapshot;
  const [passMark, setPassMark] = useState<number | null>(null);
  const [selected, setSelected] = useState<TranscriptSelection[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'review' | 'selected'>('all');
  const [limit, setLimit] = useState(25);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<TranscriptPlanChange | null>(null);
  const storageKey = creditPlanStorageKey(ownerUid, schoolId);
  const planHref = `/credit-planner?school=${encodeURIComponent(schoolId)}`;
  const reviewState = useMemo(() => {
    if (passMark === null) return { value: null, error: '' };
    try {
      return { value: reviewTranscript(records.grades.map((grade) => ({
        id: grade.id, courseName: grade.courseName, semester: grade.semester,
        courseType: grade.courseType, credits: grade.credits, score: grade.score, source: 'school' as const,
      })), passMark), error: '' };
    } catch (failure) { return { value: null, error: message(failure) }; }
  }, [records, passMark]);
  const review = reviewState.value;
  const totals = useMemo(() => {
    if (!review || !selected.length) return null;
    try { return reviewedCreditTotals(review, selected); } catch { return null; }
  }, [review, selected]);
  const overlaps = preview && totals ? transcriptPlanOverlaps(preview.plan, totals) : [];
  const visible = review?.rows.filter((row) => {
    const matches = `${row.name} ${row.semester}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
    return matches && (filter === 'all' || (filter === 'selected' ? selected.some((item) => item.key === row.key) :
      row.duplicateCount > 1 || !row.eligible || row.category === 'other'));
  }) ?? [];
  useEffect(() => {
    function onExternalChange(event: StorageEvent) {
      if (event.storageArea && event.storageArea !== window.localStorage) return;
      if (event.key !== storageKey && event.key !== null) return;
      setPreview(null); setAcknowledged(false);
      setError('個人規劃已在其他分頁變更，請重新預覽差異；核對選取仍保留。');
    }
    window.addEventListener('storage', onExternalChange);
    return () => window.removeEventListener('storage', onExternalChange);
  }, [storageKey]);

  function isCurrent() {
    return getAuth()?.currentUser?.uid === ownerUid && isCreditReviewFresh(fetchedAt);
  }
  function preparePreview() {
    if (!review || !totals || receipt) return;
    setError('');
    try {
      if (!isCurrent()) throw new Error('登入已變更或成績讀取已超過 10 分鐘，請重新讀取後核對。');
      const plan = readTranscriptPlan(window.localStorage, ownerUid, schoolId);
      setPreview({ plan, choices: {} }); setAcknowledged(false);
    } catch (failure) { setError(message(failure)); }
  }
  function apply() {
    if (!review || !preview || !acknowledged || receipt) return;
    setError('');
    try {
      const change = applyTranscriptReview(preview.plan, review, selected, preview.choices);
      replaceTranscriptPlan(window.localStorage, ownerUid, schoolId, preview.plan, change.next, isCurrent);
      setReceipt(change); setPreview(null);
    } catch (failure) { setError(message(failure)); }
  }
  function toggle(key: string) {
    if (!review) return;
    const row = review.rows.find((item) => item.key === key);
    if (!row?.eligible) return;
    if (selected.some((item) => item.key === key)) { setSelected((old) => old.filter((item) => item.key !== key)); return; }
    if (selected.some((item) => review.rows.find((other) => other.key === item.key)?.group === row.group)) {
      setError('同名或同課號群組已有選取項目，請先取消原項目，再選取這筆。'); return;
    }
    setError(''); setSelected((old) => [...old, { key, category: row.category }]);
  }

  if (receipt) return <section className={styles.root} aria-label="已修學分核對結果">
    <div className={styles.card}>
      <p className={styles.kicker}>已保存至此瀏覽器</p>
      <h2>已帶入 {formatCredits(receipt.totals.credits)} 學分</h2>
      <p role="status">核對了 {receipt.totals.selectedCount} 門課，移除 {receipt.removedCourseIds.length} 門經你確認的未來重複安排。</p>
      <p>只更新這個帳號、這間校園在此瀏覽器的個人規劃；沒有修改校方成績、正式採計規則或選課。</p>
      <Link className="btn primary" href={planHref}>查看更新後的學分規劃</Link>
    </div>
  </section>;
  return <section className={styles.root} aria-label="已修學分核對工作區">
    <header className={styles.heading}>
      <div><p className={styles.kicker}>從既有成績開始</p><h2>核對已修學分</h2>
        <p>先核對，再更新個人規劃；不更動校方成績。</p></div>
      <Link className="btn" href={planHref}>返回規劃</Link>
    </header>
    <details className={styles.source}><summary>{records.grades.length} 筆成績 · {records.semesters.length} 個學期 · 來源與採計說明</summary>
      <p className={styles.note}>只使用這次成功讀取的校務紀錄，可能不含抵免或其他學期。通過不等於正式採計；套用前請核對完整性。</p>
    </details>
    {error || reviewState.error ? <p role="alert" className={styles.error}>{error || reviewState.error}</p> : null}
    {!records.grades.length ? <div className={styles.card}><h3>目前沒有可核對的成績</h3><p>不會以空資料清零已確認學分，原規劃仍保留。</p></div> : preview && totals ? <>
      <div className={styles.card}>
        <h3>核對更新前後</h3>
        <div className={styles.total}><span>已確認合計</span><strong>{preview.plan.recognized || '未設定'} → {formatCredits(totals.credits)} <small>學分</small></strong></div>
        <div className={styles.grid}>{PLANNER_CATEGORIES.map(({ key, label }) => <div key={key} className={styles.metric}>
          <span>{label}</span><strong>{preview.plan.categoryGoals[key].recognized || '未設定'} → {formatCredits(totals.byCategory[key])}</strong>
        </div>)}</div>
        <p className={styles.note}>這會取代合計，不是加到舊數字。畢業目標、各分類目標、其他預計學分與非學分條件不變。若本次資料不完整，請返回選取，不要用較少的合計覆蓋原規劃。</p>
      </div>
      {overlaps.length ? <div className={styles.card}><h3>避免已修課程與未來規劃重複計算</h3>
        <p>同名不代表一定是同一門課，請逐筆決定。</p>
        {overlaps.map((course) => <fieldset className={styles.overlap} key={course.id}>
          <legend>{course.name} · 未來第 {course.term} 學期 · {course.credits} 學分</legend>
          <label><input type="radio" name={`overlap-${course.id}`} checked={preview.choices[course.id] === 'remove'}
            onChange={() => setPreview({ ...preview, choices: { ...preview.choices, [course.id]: 'remove' } })} />移除這門已修課程的未來安排</label>
          <label><input type="radio" name={`overlap-${course.id}`} checked={preview.choices[course.id] === 'keep'}
            onChange={() => setPreview({ ...preview, choices: { ...preview.choices, [course.id]: 'keep' } })} />不同課程，保留未來安排</label>
        </fieldset>)}
      </div> : null}
      <div className={styles.card}>
        <label className={styles.confirm}><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
          我已核對來源、採計與重修規則，確認用本次合計取代個人規劃。</label>
        <div className={styles.actions}>
          <button className="btn primary" type="button" disabled={!acknowledged || overlaps.some((course) => !preview.choices[course.id])} onClick={apply}>確認套用到個人規劃</button>
          <button className="btn" type="button" onClick={() => { setPreview(null); setAcknowledged(false); }}>返回選取與分類</button>
        </div>
      </div>
    </> : <>
      <details className={styles.standard} open={passMark === null}>
        <summary>{passMark === null ? '1 · 選擇核對標準' : `參考及格門檻 ${passMark} 分 · 點此調整`}</summary>
        <p className={styles.note}>依自己的學制選擇參考及格分數。未評分、未知等第、零學分與矛盾標記不會自動計入。改選標準會清除目前選取。</p>
        <div className={styles.actions}>{[60, 70].map((mark) => <button key={mark} type="button" aria-pressed={passMark === mark}
          className={`btn ${passMark === mark ? 'primary' : ''}`} onClick={() => { setPassMark(mark); setSelected([]); setLimit(25); }}>{mark} 分</button>)}</div>
      </details>
      {review ? <>
        <div className={styles.toolbar}><span aria-live="polite">已選 <strong>{selected.length}</strong> 門 · <strong>{totals ? formatCredits(totals.credits) : '0'}</strong> 學分</span>
          <button type="button" className="btn primary" disabled={!totals} onClick={preparePreview}>預覽套用差異</button></div>
        <div className={styles.card}><h3>2 · 核對課程與分類</h3>
          <div className={styles.actions}>
            <button type="button" className="btn" onClick={() => setSelected((old) => [...old, ...suggestedTranscriptSelection(review).filter((item) => !old.some((entry) => entry.key === item.key))])} title="僅選取明確通過且沒有同名或同課號疑義的校務紀錄">選取建議課程</button>
            <button type="button" className="btn" disabled={!selected.length} onClick={() => setSelected([])}>取消全部選取</button>
          </div>
          <label className={styles.search}>搜尋課程或學期<input value={query} onChange={(event) => { setQuery(event.target.value); setLimit(25); }} placeholder="輸入課程名稱或學期" /></label>
          <div className={styles.actions}>{([['all', '全部'], ['review', '需核對'], ['selected', '已選']] as const).map(([value, label]) =>
            <button type="button" className="btn" aria-pressed={filter === value} key={value} onClick={() => { setFilter(value); setLimit(25); }}>{label}</button>)}</div>
        </div>
        <ul className={styles.rows}>{visible.slice(0, limit).map((row) => {
          const picked = selected.find((item) => item.key === row.key);
          return <li className={styles.card} key={row.key}>
            <div className={styles.rowHead}><label className={styles.selectCourse}>
              <input type="checkbox" checked={Boolean(picked)} disabled={!row.eligible} aria-label={`選取${row.name} ${row.semester}`} onChange={() => toggle(row.key)} />
              <span><strong>{row.name}</strong><small>{row.semester || '學期未提供'} · 成績 {row.scoreLabel} · 原分類 {row.sourceType || '未提供'}</small></span>
            </label><strong>{row.credits ?? '—'} 學分</strong></div>
            <p className={styles.note}>{row.reason}{row.duplicateCount > 1 ? `；同名或同課號共 ${row.duplicateCount} 筆，核對後只能選取一筆。` : ''}</p>
            {picked ? <label className={styles.category}>{row.name}的規劃分類<select aria-label={`${row.name}的規劃分類`} value={picked.category}
              onChange={(event) => setSelected((old) => old.map((item) => item.key === row.key ? { ...item, category: event.target.value as PlannerCategory } : item))}>
              {PLANNER_CATEGORIES.map(({ key, label }) => <option value={key} key={key}>{label}</option>)}
            </select></label> : null}
          </li>;
        })}</ul>
        {!visible.length ? <p className={styles.note}>目前篩選沒有符合的課程，原成績沒有刪除。</p> : null}
        {visible.length > limit ? <button type="button" className="btn" onClick={() => setLimit((value) => value + 25)}>再顯示 {Math.min(25, visible.length - limit)} 筆</button> : null}
      </> : null}
    </>}
    <p className={styles.note}>原成績與核對選項僅在本次頁面記憶體，只有明確確認的合計保存到此瀏覽器。沒有雲端自動同步，也不會替你選課或修改校方成績。</p>
  </section>;
}
