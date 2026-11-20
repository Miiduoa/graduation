'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  NuniAssignment,
  NuniMaterial,
  NuniQuiz,
  NuniUnit,
  NuniWorkspace,
} from '@campus/shared/src/nuni';
import { nuniErrorMessage } from '@campus/shared/src/nuni';
import { formatTaipeiDateTime } from '@campus/shared/src/taipeiTime';
import {
  loadCourseMaterialsPage,
  restartCourseMaterialsPage,
  type CourseMaterialPageProgress,
} from '@/lib/courseMaterials';
import { MutationForm, useClasses } from './CourseUI';
import { buildCourseOutline, courseActivityStatus, courseTaskTotals } from './courseOutline';
import shared from './NuniApp.module.css';
import styles from './CourseLearningPath.module.css';

type Props = {
  workspace: NuniWorkspace;
  assignments: NuniAssignment[];
  units: NuniUnit[] | null;
  unitsError: string;
  assignmentsError?: string;
  assignmentsLoading?: boolean;
  refreshVersion?: number;
  reloadUnits: () => void;
  onUnitCreated: (unit: NuniUnit) => void;
  onNavigate?: (panel: 'materials' | 'assignments' | 'quizzes') => void;
};

function suggestedTime(value: string | null) {
  if (!value) return '';
  return formatTaipeiDateTime(value, { seconds: false });
}

export function CourseLearningPath({
  workspace, assignments, units, unitsError, assignmentsError = '', assignmentsLoading = false, refreshVersion = 0, reloadUnits, onUnitCreated, onNavigate,
}: Props) {
  const classes = useClasses();
  const courseApi = useRef(classes);
  const [materials, setMaterials] = useState<NuniMaterial[] | null>(null);
  const [materialsProgress, setMaterialsProgress] = useState<CourseMaterialPageProgress<NuniMaterial> | null>(
    null,
  );
  const [quizzes, setQuizzes] = useState<NuniQuiz[] | null>(null);
  const [error, setError] = useState('');
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [reading, setReading] = useState(true);
  const [loadingMoreMaterials, setLoadingMoreMaterials] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const request = useRef(0);
  const moreRequest = useRef(0);
  const teacher = workspace.memberRole !== 'student';
  const materialsComplete = materialsProgress?.complete === true;
  const materialsDenied = materialsProgress?.denied === true;
  const materialsNeedRestart = materialsProgress?.needsRestart === true;
  const quizzesLimited = (quizzes?.length ?? 0) >= 100;
  const materialsIncomplete =
    materials !== null &&
    !materialsDenied &&
    (!materialsComplete || !!materialsProgress?.error || materialsNeedRestart);
  const complete = units !== null && materials !== null && quizzes !== null && !materialsDenied;
  const groups = buildCourseOutline(units ?? [], materials ?? [], assignments, quizzes ?? []);
  const overall = courseTaskTotals(assignments, quizzes ?? [], now);
  const canClaimTaskMetrics = complete && !materialsIncomplete && !quizzesLimited && assignments.length < 100 && !unitsError && !error && !reading && !assignmentsError && !assignmentsLoading;

  useEffect(() => {
    courseApi.current = classes;
  });

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    let active = true;
    const sequence = ++request.current;
    moreRequest.current += 1;
    // Reset and reload when the course, refresh token, or explicit retry epoch changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReading(true);
    setError('');
    setCheckedAt(null);
    setMaterials(null);
    setMaterialsProgress(null);
    setQuizzes(null);
    setLoadingMoreMaterials(false);
    const fence = { cancelled: () => !active || request.current !== sequence };
    void Promise.allSettled([
      loadCourseMaterialsPage(courseApi.current, workspace.id, null, fence),
      courseApi.current.quizzes(workspace.id),
    ]).then(([materialsResult, quizzesResult]) => {
      if (fence.cancelled()) return;
      if (materialsResult.status === 'fulfilled') {
        const value = materialsResult.value;
        if (value !== 'cancelled') {
          setMaterialsProgress(value);
          setMaterials(value.denied ? null : value.items);
        }
      }
      if (quizzesResult.status === 'fulfilled') setQuizzes(quizzesResult.value);
      const messages = [
        materialsResult.status === 'rejected'
          ? `教材：${nuniErrorMessage(materialsResult.reason)}`
          : materialsResult.status === 'fulfilled' &&
              materialsResult.value !== 'cancelled' &&
              materialsResult.value.denied
            ? '教材：目前沒有這門課的教材權限。'
            : '',
        quizzesResult.status === 'rejected' ? `測驗：${nuniErrorMessage(quizzesResult.reason)}` : '',
      ].filter(Boolean);
      setError(messages.join(' '));
      setReading(false);
    });
    return () => {
      active = false;
    };
  }, [workspace.id, epoch, refreshVersion]);

  useEffect(() => {
    if (canClaimTaskMetrics) setCheckedAt(new Date().toISOString());
  }, [canClaimTaskMetrics]);

  async function loadMoreMaterials() {
    const current = materialsProgress;
    if (!current || reading || loadingMoreMaterials || current.denied || current.needsRestart) return;
    if (!current.nextCursor) return;
    const sequence = request.current;
    const token = ++moreRequest.current;
    setLoadingMoreMaterials(true);
    const fence = {
      cancelled: () => request.current !== sequence || moreRequest.current !== token,
    };
    const result = await loadCourseMaterialsPage(
      courseApi.current,
      workspace.id,
      { ...current, error: null },
      fence,
    );
    if (fence.cancelled() || result === 'cancelled') return;
    setMaterialsProgress(result);
    setMaterials(result.denied ? null : result.items);
    if (result.denied) {
      setError('教材：目前沒有這門課的教材權限。');
    }
    setLoadingMoreMaterials(false);
  }

  async function restartMaterials() {
    const current = materialsProgress;
    if (!current || reading || loadingMoreMaterials || current.denied || !current.needsRestart) {
      return;
    }
    const sequence = request.current;
    const token = ++moreRequest.current;
    setLoadingMoreMaterials(true);
    const fence = {
      cancelled: () => request.current !== sequence || moreRequest.current !== token,
    };
    const result = await restartCourseMaterialsPage(
      courseApi.current,
      workspace.id,
      current,
      fence,
    );
    if (fence.cancelled() || result === 'cancelled') return;
    setMaterialsProgress(result);
    setMaterials(result.denied ? null : result.items);
    if (result.denied) {
      setError('教材：目前沒有這門課的教材權限。');
    }
    setLoadingMoreMaterials(false);
  }

  return (
    <section className={styles.root} aria-label="學習路徑">
      <div className={styles.heading}>
        <div>
          <p className={shared.eyebrow}>課程進度</p>
          <h2>依章節學習</h2>
          <p className={shared.muted}>教材、作業與測驗按教師設定的章節整理。點選項目可直接開啟原始內容與繳交紀錄。</p>
        </div>
        <button type="button" className={`${shared.button} ${shared.secondary}`} disabled={reading} onClick={() => setEpoch((value) => value + 1)}>
          {reading ? '整理中…' : '更新章節內容'}
        </button>
      </div>
      <p className={styles.context}>來源：nuni 課程 · 本次讀取：{canClaimTaskMetrics && checkedAt ? formatTaipeiDateTime(checkedAt, { seconds: false }) : '尚未確認'}。作業或測驗未取得時，完整進度為未知；待評與缺件不換算成零分。</p>
      {!canClaimTaskMetrics && !reading && <p className={styles.context}>進度未知：清單未齊或部分讀取失敗，請更新後確認。</p>}
      {!teacher && canClaimTaskMetrics && (
        <div className={styles.summary} role="status">
          <div><strong>{overall.pending}</strong><span>可處理的待辦</span></div>
          <div><strong>{overall.completed} / {overall.assigned}</strong><span>已繳交或作答</span></div>
          <div><strong>{overall.suggestedSoon}</strong><span>建議時間在七天內或已過</span></div>
        </div>
      )}
      {teacher && (
        <p className={styles.context}>學生進度依作業繳交與測驗作答紀錄計算；正式課綱請以學校公告為準。</p>
      )}
      {workspace.state === 'archived' && <p className={styles.context}>課程已封存，原有章節仍可閱讀，但無法新增內容或送出作答。</p>}
      {units === null && (
        <div className={shared.notice} role="status">
          {unitsError ? `章節清單讀取失敗：${unitsError}` : '正在讀取章節清單…'}
          {unitsError && <button type="button" className={`${shared.button} ${shared.secondary}`} onClick={reloadUnits}>重試章節清單</button>}
        </div>
      )}
      {error && <p className={shared.notice} role="alert">{error} 可再次更新；完整進度未知，尚未取得的內容不當成已完成。</p>}
      {reading && <p role="status">正在核對教材與測驗…</p>}
      {!complete && !reading && <p className={styles.context}>部分內容尚未載入，暫時無法顯示完整進度。</p>}
      {quizzesLimited && (
        <p className={styles.context}>
          目前已載入 100 份測驗，清單與進度可能不完整。
        </p>
      )}
      {materialsIncomplete && materials && (
        <p className={styles.context}>
          教材尚有較早頁面未載入（目前已確認 {materials.length} 則）
          {materialsProgress?.error ? `：${materialsProgress.error}` : ''}
          ，章節內教材筆數可能不完整。
        </p>
      )}
      {complete && groups.length === 1 && groups[0].id === null && !groups[0].materials.length && !groups[0].assignments.length && !groups[0].quizzes.length && (
        <p className={styles.context}>這門課尚未有教材、作業或測驗。老師可先建立章節再發布內容。</p>
      )}
      <div className={styles.sections}>
        {groups.map((section, index) => {
          const totals = courseTaskTotals(section.assignments, section.quizzes, now);
          const empty = !section.materials.length && !section.assignments.length && !section.quizzes.length;
          return (
            <section key={section.id ?? 'unassigned'} className={styles.unit} aria-labelledby={`outline-unit-${index}`}>
              <div className={styles.unitHead}>
                <div>
                  <p className={styles.sequence}>{section.id ? `章節 ${index + 1}` : '未分章節'}</p>
                  <h3 id={`outline-unit-${index}`}>{section.title}</h3>
                </div>
                <span className={styles.unitCount}>
                  {section.materials.length} 教材
                  {materialsIncomplete ? '（尚未載完）' : ''}
                  {' · '}
                  {section.assignments.length} 作業 · {section.quizzes.length} 測驗
                  {quizzesLimited ? '（測驗可能未齊）' : ''}
                </span>
              </div>
              {!teacher && canClaimTaskMetrics && totals.assigned > 0 && (
                <p className={styles.progressText}>已完成 {totals.completed} / {totals.assigned} 項繳交或作答 · 待辦 {totals.pending} 項</p>
              )}
              {section.missingUnit && <p className={styles.context}>部分內容所屬的章節已無法查看，暫列於此。</p>}
              {empty ? (
                <p className={styles.empty}>還沒有安排學習內容。</p>
              ) : (
                <ul className={styles.contents}>
                  {section.materials.map((item) => (
                    <li key={item.id}>
                      <a href={`#material-${item.id}`} onClick={() => onNavigate?.('materials')}> <span className={styles.kind}>教材</span><span className={styles.itemTitle}>{item.title}</span><span className={styles.itemMeta}>開啟閱讀</span></a>
                    </li>
                  ))}
                  {section.assignments.map((item) => (
                    <li key={item.id}>
                      <a href={`#assignment-${item.id}`} onClick={() => onNavigate?.('assignments')}><span className={styles.kind}>作業</span><span className={styles.itemTitle}>{item.title}</span><span className={styles.itemMeta}>{teacher ? `${item.submissionCount} 份繳交` : courseActivityStatus(item, 'assignment')}{item.dueAt ? ` · 建議 ${suggestedTime(item.dueAt)}` : ''}</span></a>
                    </li>
                  ))}
                  {section.quizzes.map((item) => (
                    <li key={item.id}>
                      <a href={`#quiz-${item.id}`} onClick={() => onNavigate?.('quizzes')}><span className={styles.kind}>測驗</span><span className={styles.itemTitle}>{item.title}</span><span className={styles.itemMeta}>{teacher ? `${item.responseCount} 份作答` : courseActivityStatus(item, 'quiz')}{item.dueAt ? ` · 建議 ${suggestedTime(item.dueAt)}` : ''}</span></a>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      {materials && !materialsDenied && materialsNeedRestart && (
        <button
          type="button"
          className={`${shared.button} ${shared.secondary}`}
          disabled={loadingMoreMaterials || reading}
          onClick={() => void restartMaterials()}
        >
          {loadingMoreMaterials ? '重新讀取教材中…' : '重新讀取教材'}
        </button>
      )}
      {materials &&
        !materialsDenied &&
        !materialsNeedRestart &&
        (materialsProgress?.nextCursor || materialsProgress?.error) && (
        <button
          type="button"
          className={`${shared.button} ${shared.secondary}`}
          disabled={loadingMoreMaterials || reading}
          onClick={() => void loadMoreMaterials()}
        >
          {loadingMoreMaterials
            ? '載入較早教材中…'
            : materialsProgress?.error
              ? '重試載入較早教材'
              : '繼續載入較早教材'}
        </button>
      )}
      {teacher && workspace.state === 'active' && units !== null && (
        <details className={`${shared.panel} ${shared.compose}`}>
          <summary>建立新章節</summary>
          <p className={shared.muted}>建立章節後，在發布教材、作業或測驗時選擇所屬章節；已發布的內容不會被自動搬動。</p>
          <MutationForm label="建立章節" success="章節已建立，現在可以將新內容歸入這個章節。" submit={async (form, key) => {
            const title = String(form.get('title') || '').trim();
            const created = await courseApi.current.createUnit(workspace.id, { title, idempotencyKey: key });
            onUnitCreated(created);
          }}>
            <label>章節名稱<input name="title" required minLength={1} maxLength={80} placeholder="例如：第 03 週｜資料模型" /></label>
          </MutationForm>
        </details>
      )}
      <p className={styles.context}>教材閱讀不會自動標記完成；這裡的「完成」僅代表作業已繳交或測驗已作答。建議時間不會自動停止收件。</p>
    </section>
  );
}
