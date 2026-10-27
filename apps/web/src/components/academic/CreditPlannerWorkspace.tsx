'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  MAX_PLANNED_COURSES,
  PLANNER_CATEGORIES,
  creditPlanStorageKey,
  creditPlanSummary,
  emptyCreditPlan,
  exportCreditPlanCsv,
  formatCredits,
  parseCredits,
  restoreCreditPlan,
  type CreditPlan,
  type PlannedCourse,
  type PlannerCategory,
  type PlannerCourseStatus,
} from '@/lib/creditPlanner';
import styles from './CreditPlannerWorkspace.module.css';
import { CreditPlannerRequirements } from './CreditPlannerRequirements';
import { CreditPlanFeasibility } from './CreditPlanFeasibility';

type CourseDraft = {
  name: string;
  credits: string;
  category: PlannerCategory;
  term: number;
  status: PlannerCourseStatus;
};

const emptyCourse: CourseDraft = {
  name: '',
  credits: '3',
  category: 'elective',
  term: 1,
  status: 'considering',
};

function newCourseId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}

function downloadFile(content: string, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadPlan(plan: CreditPlan) {
  downloadFile(exportCreditPlanCsv(plan), 'text/csv;charset=utf-8', '學分規劃.csv');
}

function downloadBackup(plan: CreditPlan) {
  downloadFile(JSON.stringify(plan, null, 2), 'application/json;charset=utf-8', '學分規劃備份.json');
}

function isInvalid(value: string) {
  return value.trim().length > 0 && parseCredits(value) === null;
}

export function CreditPlannerWorkspace({
  schoolId,
  schoolName,
  userId,
}: {
  schoolId: string | null;
  schoolName: string;
  userId: string | null;
}) {
  const key = useMemo(() => creditPlanStorageKey(userId, schoolId), [userId, schoolId]);
  const backupInput = useRef<HTMLInputElement>(null);
  const skipInvalidDraftSave = useRef(false);
  const [plan, setPlan] = useState<CreditPlan>(emptyCreditPlan);
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState('');
  const [draft, setDraft] = useState<CourseDraft>(emptyCourse);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState('');
  const [removed, setRemoved] = useState<{ course: PlannedCourse; index: number } | null>(null);
  const summary = useMemo(() => creditPlanSummary(plan), [plan]);

  useEffect(() => {
    let restored: CreditPlan | null = null;
    try {
      const raw = window.localStorage.getItem(key);
      restored = restoreCreditPlan(raw);
      if (raw && !restored) {
        skipInvalidDraftSave.current = true;
        setSaveNotice('先前的本機草稿格式有誤，已略過；原資料暫時保留，建立新規劃後會取代它。');
      }
    } catch {
      setSaveNotice('瀏覽器不允許儲存，這次規劃可能在重新整理後遺失。');
    }
    setPlan(restored ?? emptyCreditPlan());
    setHydratedKey(key);
  }, [key]);

  useEffect(() => {
    if (hydratedKey !== key) return;
    if (skipInvalidDraftSave.current) {
      skipInvalidDraftSave.current = false;
      return;
    }
    // An incomplete number (such as "12.") must not overwrite the last valid draft.
    if (!restoreCreditPlan(JSON.stringify(plan))) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(plan));
    } catch {
      setSaveNotice('無法將草稿存在這台瀏覽器，請先匯出 CSV 備份。');
    }
  }, [plan, key, hydratedKey]);

  function updateField(field: 'recognized' | 'target' | 'extra', value: string) {
    setPlan((current) => ({ ...current, [field]: value }));
    setRemoved(null);
  }

  function saveCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = draft.name.trim();
    const credits = parseCredits(draft.credits);
    if (!name || name.length > 80) {
      setFormError('請填入 1–80 字的課程名稱。');
      return;
    }
    if (credits === null || credits <= 0 || credits > 30) {
      setFormError('每門課請填 0.01–30 學分，最多兩位小數。');
      return;
    }
    if (!editingId && plan.courses.length >= MAX_PLANNED_COURSES) {
      setFormError('單份規劃最多可加入 120 門課，請先整理舊課程。');
      return;
    }
    const course: PlannedCourse = {
      id: editingId ?? newCourseId(),
      name,
      credits,
      category: draft.category,
      term: draft.term,
      status: draft.status,
    };
    setPlan((current) => ({
      ...current,
      courses: editingId
        ? current.courses.map((existing) => (existing.id === editingId ? course : existing))
        : [...current.courses, course],
    }));
    setEditingId(null);
    setDraft({ ...emptyCourse, term: draft.term, category: draft.category });
    setFormError('');
    setRemoved(null);
  }

  function editCourse(course: PlannedCourse) {
    setEditingId(course.id);
    setDraft({
      name: course.name,
      credits: formatCredits(course.credits),
      term: course.term,
      category: course.category,
      status: course.status,
    });
    setFormError('');
    setRemoved(null);
  }

  function deleteCourse(course: PlannedCourse) {
    const index = plan.courses.findIndex((entry) => entry.id === course.id);
    if (index < 0) return;
    setPlan((current) => ({ ...current, courses: current.courses.filter((entry) => entry.id !== course.id) }));
    setRemoved({ course, index });
    if (editingId === course.id) {
      setEditingId(null);
      setDraft(emptyCourse);
    }
  }

  function undoDelete() {
    if (!removed) return;
    const { course, index } = removed;
    setPlan((current) => {
      if (current.courses.some((entry) => entry.id === course.id)) return current;
      const courses = [...current.courses];
      courses.splice(Math.min(index, courses.length), 0, course);
      return { ...current, courses };
    });
    setRemoved(null);
  }

  async function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > 90_000) {
      setSaveNotice('備份檔案超過 90 KB，無法匯入。');
      return;
    }
    try {
      const imported = restoreCreditPlan(await file.text());
      if (!imported) {
        setSaveNotice('備份格式不符或資料無效，現有規劃不變。');
        return;
      }
      if (!window.confirm('確定以這份 JSON 備份取代目前的個人學分規劃？目前規劃可以先匯出備份。')) {
        setSaveNotice('已取消匯入，現有規劃不變。');
        return;
      }
      setPlan(imported);
      setDraft(emptyCourse);
      setEditingId(null);
      setRemoved(null);
      setFormError('');
      setSaveNotice('備份已匯入這個帳號與校園的本機規劃。');
    } catch {
      setSaveNotice('備份檔案無法讀取，現有規劃不變。');
    }
  }

  function resetPlan() {
    if (!window.confirm('確定清除這間學校、這個帳號在本機的學分規劃？這個動作無法復原。')) return;
    setPlan(emptyCreditPlan());
    setDraft(emptyCourse);
    setEditingId(null);
    setRemoved(null);
    setFormError('');
    setSaveNotice('已清除這份規劃，不會影響學校成績。');
  }

  if (hydratedKey !== key) {
    return (
      <section className={styles.workspace} aria-label="個人學分試算">
        <p className={styles.muted}>正在讀取這台瀏覽器的學分規劃…</p>
      </section>
    );
  }

  const hasInput = summary.recognized !== null && summary.target !== null;
  const validExtra = summary.extra !== null;
  const progressText = summary.remaining === null
    ? '填入已確認學分與目標，就能開始試算。'
    : '假設所有規劃課程都修畢、通過且獲採計，距離目標還差 ' +
      formatCredits(summary.remaining) + ' 學分。';

  return (
    <section className={styles.workspace} aria-label="個人學分試算">
      <div className={styles.heading}>
        <div>
          <span className={styles.kicker}>YOUR CREDIT PLAN</span>
          <h2>每一學分，都算得清楚。</h2>
          <p>{schoolName ? schoolName + ' · ' : ''}自己的畢業進度，由你安排。先試算、再逐學期排課。</p>
        </div>
        <div className={styles.actions}>
          <button type="button" onClick={() => downloadPlan(plan)} className={styles.secondary}>
            匯出 CSV
          </button>
          <button type="button" onClick={() => downloadBackup(plan)} className={styles.secondary}>
            備份 JSON
          </button>
          <button type="button" onClick={() => backupInput.current?.click()} className={styles.secondary}>
            匯入備份
          </button>
          <input
            ref={backupInput}
            type="file"
            accept=".json,application/json"
            className={styles.backupInput}
            aria-label="匯入 JSON 備份"
            onChange={(event) => void importBackup(event)}
          />
          <button type="button" onClick={resetPlan} className={styles.textButton}>
            清除規劃
          </button>
        </div>
      </div>

      <p className={styles.sourceNote}>
        <span className={styles.localBadge}>僅存在這台瀏覽器</span>
        學分、課程與狀態皆為你自行輸入；未自動認列學校成績，也不會送出選課。
        {userId ? ' 已依目前帳號與校園隔離儲存。' : ' 訪客草稿也會留在這台裝置，公用電腦請記得清除。'}
      </p>

      <div className={styles.settings} aria-label="設定試算目標">
        <label className={styles.field}>
          已確認可採計學分（自行填寫）
          <input
            value={plan.recognized}
            aria-label="已確認可採計學分（自行填寫）"
            onChange={(event) => updateField('recognized', event.target.value)}
            inputMode="decimal"
            type="number"
            min="0"
            max="1000"
            step="any"
            placeholder="例如：60"
            aria-invalid={isInvalid(plan.recognized)}
          />
          <small>請依系辦或正式審查填寫，系統不從修課紀錄推定。</small>
        </label>
        <label className={styles.field}>
          希望累計的學分
          <input
            value={plan.target}
            aria-label="希望累計的學分"
            onChange={(event) => updateField('target', event.target.value)}
            inputMode="decimal"
            type="number"
            min="0"
            max="1000"
            step="any"
            placeholder="例如：128"
            aria-invalid={isInvalid(plan.target)}
          />
          <small>目標由你設定，不是學校預設畢業門檻。</small>
        </label>
        <label className={styles.field}>
          預計再修學分
          <input
            value={plan.extra}
            aria-label="預計再修學分"
            onChange={(event) => updateField('extra', event.target.value)}
            inputMode="decimal"
            type="number"
            min="0"
            max="1000"
            step="any"
            placeholder="未列成課程可先填"
            aria-invalid={isInvalid(plan.extra)}
          />
          <small>只填下方未建成課程的額外學分，避免重複計算。</small>
        </label>
      </div>

      {(isInvalid(plan.recognized) || isInvalid(plan.target) || !validExtra) && (
        <p className={styles.error} role="alert">學分須為 0–1000 之間、最多兩位小數的數字；修正後才會保存。</p>
      )}
      <div className={styles.metrics}>
        <div className={styles.metric}>
          <span>已確認可採計</span>
          <strong>{summary.recognized === null ? '—' : formatCredits(summary.recognized)}<small> 學分</small></strong>
          <p>你提供的正式認列數字</p>
        </div>
        <div className={styles.metric}>
          <span>額外規劃</span>
          <strong>{summary.planned === null ? '—' : formatCredits(summary.planned)}<small> 學分</small></strong>
          <p>{formatCredits(summary.courseCredits)} 課程 + {summary.extra === null ? '—' : formatCredits(summary.extra)} 其他</p>
        </div>
        <div className={styles.metricAccent}>
          <span>預估距離目標</span>
          <strong>{summary.remaining === null ? '—' : formatCredits(summary.remaining)}<small> 學分</small></strong>
          <p>全部通過且可採計的假設下</p>
        </div>
      </div>
      <div className={styles.forecast} role="status">
        <div className={styles.forecastCopy}>
          <strong>{progressText}</strong>
          {hasInput && validExtra && (
            <span>
              不含新規劃時，距目標還差 {formatCredits(summary.missingBefore ?? 0)} 學分；
              預估累計 {formatCredits(summary.projected ?? 0)} / {formatCredits(summary.target ?? 0)}。
            </span>
          )}
        </div>
        {hasInput && validExtra && summary.target !== null && summary.target > 0 && (
          <div
            className={styles.progress}
            role="progressbar"
            aria-label="預估學分目標進度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={summary.progress}
          >
            <span style={{ width: summary.progress + '%' }} />
          </div>
        )}
      </div>

      <CreditPlanFeasibility plan={plan} />

      <div className={styles.sectionHeading}>
        <div>
          <span className={styles.kicker}>PLAN BY SEMESTER</span>
          <h3>把學分拆成每學期的行動</h3>
        </div>
        <label className={styles.termSelect}>
          顯示未來學期
          <select
            value={plan.terms}
            onChange={(event) => setPlan((current) => ({ ...current, terms: Number(event.target.value) }))}
          >
            {Array.from({ length: 8 }, (_, i) => i + 1).map((term) => (
              <option value={term} key={term}>{term} 學期</option>
            ))}
          </select>
        </label>
      </div>
      <div className={styles.terms}>
        {summary.perTerm.map(({ term, courses, credits }) => (
          <div key={term} className={styles.termCard}>
            <div className={styles.termTop}>
              <span>未來第 {term} 學期</span>
              <strong>{formatCredits(credits)} <small>學分</small></strong>
            </div>
            <div className={styles.termTrack}>
              <span style={{ width: Math.min(100, (credits / 25) * 100) + '%' }} />
            </div>
            <p>
              {courses.length} 門課
              {credits > 25 ? ' · 超過 25 學分，請核對選課上限' : credits === 0 ? ' · 尚未安排課程' : ' · 可繼續安排'}
            </p>
          </div>
        ))}
      </div>
      <p className={styles.footnote}>25 學分僅作為畫面上的修課負擔提醒，不是各校正式上下限；部分課程也可能不計入畢業。</p>

      <div className={styles.courseLayout}>
        <form className={styles.addCard} onSubmit={saveCourse}>
          <div className={styles.cardTitle}>
            <span className={styles.kicker}>COURSE BUILDER</span>
            <h3>{editingId ? '修改規劃課程' : '加入一門課程'}</h3>
            <p>候選與已選課都屬於未取得學分，不會自動變成「已確認」。</p>
          </div>
          <label className={styles.field}>
            課程名稱
            <input
              value={draft.name}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
              maxLength={80}
              placeholder="例如：資料庫系統"
              required
            />
          </label>
          <div className={styles.formRow}>
            <label className={styles.field}>
              學分
              <input
                value={draft.credits}
                onChange={(event) => setDraft((current) => ({ ...current, credits: event.target.value }))}
                type="number"
                inputMode="decimal"
                min="0.01"
                max="30"
                step="any"
                required
              />
            </label>
            <label className={styles.field}>
              預計學期
              <select
                value={draft.term}
                onChange={(event) => setDraft((current) => ({ ...current, term: Number(event.target.value) }))}
              >
                {Array.from({ length: 8 }, (_, i) => i + 1).map((term) => (
                  <option key={term} value={term}>第 {term} 學期</option>
                ))}
              </select>
            </label>
          </div>
          <div className={styles.formRow}>
            <label className={styles.field}>
              類別（自行分類）
              <select
                value={draft.category}
                onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value as PlannerCategory }))}
              >
                {PLANNER_CATEGORIES.map(({ key: category, label }) => (
                  <option key={category} value={category}>{label}</option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              安排狀態
              <select
                value={draft.status}
                onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as PlannerCourseStatus }))}
              >
                <option value="considering">候選課程</option>
                <option value="registered">已選課（未取得）</option>
              </select>
            </label>
          </div>
          {formError && <p className={styles.error} role="alert">{formError}</p>}
          <div className={styles.formActions}>
            <button type="submit" className={styles.primary}>{editingId ? '儲存修改' : '加入規劃'}</button>
            {editingId && (
              <button
                className={styles.secondary}
                type="button"
                onClick={() => { setEditingId(null); setDraft(emptyCourse); setFormError(''); }}
              >
                取消編輯
              </button>
            )}
          </div>
        </form>
        <div className={styles.courseList}>
          <div className={styles.cardTitle}>
            <span className={styles.kicker}>MY COURSES</span>
            <h3>已安排課程 <span className={styles.count}>{plan.courses.length}</span></h3>
            <p>已選課 {formatCredits(summary.registered)} 學分 · 候選 {formatCredits(summary.candidate)} 學分</p>
          </div>
          {removed && (
            <div className={styles.undo} role="status">
              已移除「{removed.course.name}」
              <button type="button" onClick={undoDelete}>復原</button>
            </div>
          )}
          {plan.courses.length === 0 ? (
            <div className={styles.empty}>
              <strong>尚未安排任何課程</strong>
              <p>從左側加入第一門課，這裡會自動顯示學期、狀態與預估學分。</p>
            </div>
          ) : (
            <ul className={styles.courses}>
              {[...plan.courses].sort((a, b) => a.term - b.term).map((course) => (
                <li key={course.id} className={styles.courseRow}>
                  <div className={styles.courseDetails}>
                    <strong>{course.name}</strong>
                    <p>
                      未來第 {course.term} 學期 · {PLANNER_CATEGORIES.find((category) => category.key === course.category)?.label}
                      {' · '}{course.status === 'registered' ? '已選課（未取得）' : '候選'}
                    </p>
                  </div>
                  <div className={styles.courseControls}>
                    <span>{formatCredits(course.credits)} <small>學分</small></span>
                    <button type="button" onClick={() => editCourse(course)} aria-label={'編輯' + course.name}>編輯</button>
                    <button type="button" onClick={() => deleteCourse(course)} aria-label={'移除' + course.name}>移除</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {plan.courses.length > 0 && (
        <div className={styles.categories} aria-label="規劃課程類別">
          {summary.byCategory.map(({ key: category, label, credits }) => (
            <div key={category}>
              <span>{label}</span>
              <strong>{formatCredits(credits)} 學分</strong>
              <div className={styles.categoryTrack}>
                <span style={{ width: summary.courseCredits > 0 ? credits / summary.courseCredits * 100 + '%' : '0%' }} />
              </div>
            </div>
          ))}
        </div>
      )}
      <CreditPlannerRequirements plan={plan} setPlan={setPlan} />
      <p className={styles.disclaimer}>
        <strong>重要：</strong>這份規劃不等於畢業資格審查。必修、通識領域、重修抵免、學程限制及非學分條件都須依入學年度與校方正式規定確認。
        課程狀態與類別都由你手動設定，不保證會開課、選上、修過或獲得認列。
      </p>
      {saveNotice && <p className={styles.saveNotice}>{saveNotice}</p>}
    </section>
  );
}
