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
import { MutationForm, useClasses } from './CourseUI';
import { buildCourseOutline, courseActivityStatus, courseTaskTotals } from './courseOutline';
import shared from './NuniApp.module.css';
import styles from './CourseLearningPath.module.css';

type Props = {
  workspace: NuniWorkspace;
  assignments: NuniAssignment[];
  units: NuniUnit[] | null;
  unitsError: string;
  refreshVersion?: number;
  reloadUnits: () => void;
  onUnitCreated: (unit: NuniUnit) => void;
  onNavigate?: (panel: 'materials' | 'assignments' | 'quizzes') => void;
};

function suggestedTime(value: string | null) {
  if (!value) return '';
  return new Date(value).toLocaleString('zh-TW', { dateStyle: 'medium', timeStyle: 'short' });
}

export function CourseLearningPath({
  workspace, assignments, units, unitsError, refreshVersion = 0, reloadUnits, onUnitCreated, onNavigate,
}: Props) {
  const classes = useClasses();
  const courseApi = useRef(classes);
  const [materials, setMaterials] = useState<NuniMaterial[] | null>(null);
  const [quizzes, setQuizzes] = useState<NuniQuiz[] | null>(null);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(true);
  const [epoch, setEpoch] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const request = useRef(0);
  const teacher = workspace.memberRole !== 'student';
  const complete = units !== null && materials !== null && quizzes !== null;
  const groups = buildCourseOutline(units ?? [], materials ?? [], assignments, quizzes ?? []);
  const overall = courseTaskTotals(assignments, quizzes ?? [], now);
  const hasLimitedResult = (materials?.length ?? 0) >= 100 || (quizzes?.length ?? 0) >= 100;

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    let active = true;
    const sequence = ++request.current;
    setReading(true);
    setError('');
    setMaterials(null);
    setQuizzes(null);
    void Promise.allSettled([
      courseApi.current.materials(workspace.id),
      courseApi.current.quizzes(workspace.id),
    ]).then(([materialsResult, quizzesResult]) => {
      if (!active || request.current !== sequence) return;
      if (materialsResult.status === 'fulfilled') setMaterials(materialsResult.value);
      if (quizzesResult.status === 'fulfilled') setQuizzes(quizzesResult.value);
      const messages = [
        materialsResult.status === 'rejected' ? `教材：${nuniErrorMessage(materialsResult.reason)}` : '',
        quizzesResult.status === 'rejected' ? `測驗：${nuniErrorMessage(quizzesResult.reason)}` : '',
      ].filter(Boolean);
      setError(messages.join(' '));
      setReading(false);
    });
    return () => {
      active = false;
    };
  }, [workspace.id, epoch, refreshVersion]);

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
      {!teacher && complete && (
        <div className={styles.summary} role="status">
          <div><strong>{overall.pending}</strong><span>可處理的待辦</span></div>
          <div><strong>{overall.completed} / {overall.assigned}</strong><span>已繳交或作答</span></div>
          <div><strong>{overall.suggestedSoon}</strong><span>建議時間在七天內或已過</span></div>
        </div>
      )}
      {teacher && (
        <p className={styles.context}>章節是教學內容分類，不代表學校正式課綱；學生的進度只依平台實際作業與測驗回執計算。</p>
      )}
      {workspace.state === 'archived' && <p className={styles.context}>課程已封存，原有章節仍可閱讀，但無法新增內容或送出作答。</p>}
      {units === null && (
        <div className={shared.notice} role="status">
          {unitsError ? `章節清單讀取失敗：${unitsError}` : '正在讀取章節清單…'}
          {unitsError && <button type="button" className={`${shared.button} ${shared.secondary}`} onClick={reloadUnits}>重試章節清單</button>}
        </div>
      )}
      {error && <p className={shared.notice} role="alert">{error} 可再次更新，尚未取得的內容不計入進度。</p>}
      {reading && <p role="status">正在核對教材與測驗…</p>}
      {!complete && !reading && <p className={styles.context}>部分資料尚未取得，以下只顯示已確認的內容，不推算整門課的完成比例。</p>}
      {hasLimitedResult && <p className={styles.context}>教材或測驗已達目前 API 的 100 筆顯示上限，清單和進度可能不完整。</p>}
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
                <span className={styles.unitCount}>{section.materials.length} 教材 · {section.assignments.length} 作業 · {section.quizzes.length} 測驗</span>
              </div>
              {!teacher && complete && totals.assigned > 0 && (
                <p className={styles.progressText}>已完成 {totals.completed} / {totals.assigned} 項繳交或作答 · 待辦 {totals.pending} 項</p>
              )}
              {section.missingUnit && <p className={styles.context}>部分內容原本所屬的章節已無法核對，暫時集中顯示於此，未變更任何原始資料。</p>}
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
