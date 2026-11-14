'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import {
  CAMPUS_FOCUS_OPTIONS,
  CAMPUS_GOAL_OPTIONS,
  CAMPUS_LIVING_OPTIONS,
  CAMPUS_PHASE_OPTIONS,
  CAMPUS_STAGE_OPTIONS,
  createDefaultCampusPreferences,
  type CampusPersonalizationPreferences,
  type CampusRecommendationResult,
} from '@campus/shared/src/campusPersonalization';
import { taipeiParts } from '@campus/shared/src/taipeiTime';
import styles from './CampusPersonalization.module.css';

type Preferences = CampusPersonalizationPreferences;
type PhaseKind = NonNullable<Preferences['phaseOverride']>['kind'];

export type CampusPersonalizationProps = {
  preferences: Preferences;
  recommendations: CampusRecommendationResult;
  onSave: (value: Preferences) => boolean;
  storageError?: string;
  schoolName?: string;
  now: Date;
};

const DAY_MS = 86_400_000;
const MAX_PHASE_DAYS = 90;
const PHASE_SOURCES = {
  manual: '依你設定的日期',
  event: '依你的個人行程',
  default: '依目前偏好安排',
} as const;

function taipeiDate(now: Date): string {
  const parts = taipeiParts(now);
  return parts
    ? `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
    : '';
}

function dateStamp(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const year = Number(value.slice(0, 4));
  if (year < 1900 || year > 2200) return null;
  const stamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value
    ? stamp
    : null;
}

function addDays(date: string, days: number): string {
  const stamp = dateStamp(date);
  if (stamp === null) return '';
  const result = new Date(stamp + days * DAY_MS).toISOString().slice(0, 10);
  return result > '2200-12-31' ? '2200-12-31' : result;
}

function phaseProblem(phase: Preferences['phaseOverride']): string {
  if (!phase) return '';
  const start = dateStamp(phase.startDate);
  const end = dateStamp(phase.endDate);
  if (start === null || end === null) return '請填寫有效的開始與結束日期。';
  if (end < start) return '結束日期要與開始日期同一天，或在開始日期之後。';
  if ((end - start) / DAY_MS + 1 > MAX_PHASE_DAYS) return '一次最多安排 90 天；之後可以再調整。';
  return '';
}

function phaseLabel(kind: PhaseKind): string {
  return CAMPUS_PHASE_OPTIONS.find((option) => option.value === kind)?.label ?? '準備期間';
}

function PreferenceEditor({
  preferences,
  now,
  onSave,
  onCancel,
  onSkip,
}: {
  preferences: Preferences;
  now: Date;
  onSave: (value: Preferences) => boolean;
  onCancel: () => void;
  onSkip: () => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<Preferences>(() => ({
    ...preferences,
    goals: [...preferences.goals],
    phaseOverride: preferences.phaseOverride ? { ...preferences.phaseOverride } : null,
  }));
  const [error, setError] = useState('');
  const errorRef = useRef<HTMLParagraphElement>(null);
  const today = taipeiDate(now);
  const phase = draft.phaseOverride;
  const expired = !!phase && !!today && phase.endDate < today && !phaseProblem(phase);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  function update<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setError('');
  }

  function toggleGoal(goal: Preferences['goals'][number], checked: boolean) {
    setDraft((current) => ({
      ...current,
      goals: checked
        ? current.goals.includes(goal) || current.goals.length >= 3
          ? current.goals
          : [...current.goals, goal]
        : current.goals.filter((value) => value !== goal),
    }));
    setError('');
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = phaseProblem(draft.phaseOverride);
    if (problem) {
      setError(problem);
      return;
    }
    onSave({ ...draft, configured: true });
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate aria-label="首頁安排偏好">
      <div className={styles.primaryFields}>
        <label className={styles.field} htmlFor={`${id}-stage`}>
          <span>你目前的階段</span>
          <select
            id={`${id}-stage`}
            value={draft.stage}
            onChange={(event) => update('stage', event.target.value as Preferences['stage'])}
          >
            {CAMPUS_STAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <fieldset className={styles.choices}>
          <legend>最近想先顧好什麼？</legend>
          <div className={styles.choiceRow}>
            {CAMPUS_FOCUS_OPTIONS.map((option) => (
              <label key={option.value} className={styles.choice}>
                <input
                  type="radio"
                  name={`${id}-focus`}
                  value={option.value}
                  checked={draft.focus === option.value}
                  onChange={() => update('focus', option.value)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <details className={styles.more}>
        <summary>更多安排（選填）</summary>
        <div className={styles.moreFields}>
          <label className={styles.field} htmlFor={`${id}-living`}>
            <span>通勤或住宿方式</span>
            <select
              id={`${id}-living`}
              value={draft.living}
              onChange={(event) => update('living', event.target.value as Preferences['living'])}
            >
              {CAMPUS_LIVING_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <fieldset className={styles.choices} aria-describedby={`${id}-goals-hint`}>
            <legend>最近想完成的事</legend>
            <p id={`${id}-goals-hint`} className={styles.hint}>
              最多選 3 項，也可以先不選。
            </p>
            <div className={styles.choiceRow}>
              {CAMPUS_GOAL_OPTIONS.map((option) => (
                <label key={option.value} className={styles.choice}>
                  <input
                    type="checkbox"
                    checked={draft.goals.includes(option.value)}
                    disabled={draft.goals.length >= 3 && !draft.goals.includes(option.value)}
                    onChange={(event) => toggleGoal(option.value, event.target.checked)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className={styles.field} htmlFor={`${id}-phase`}>
            <span>這段時間的重點</span>
            <select
              id={`${id}-phase`}
              value={phase?.kind ?? ''}
              onChange={(event) => {
                const kind = event.target.value as PhaseKind | '';
                update(
                  'phaseOverride',
                  kind
                    ? {
                        kind,
                        startDate: phase?.startDate ?? today,
                        endDate: phase?.endDate ?? addDays(today, 6),
                      }
                    : null,
                );
              }}
              aria-describedby={`${id}-phase-hint`}
            >
              <option value="">依行程自動安排</option>
              {CAMPUS_PHASE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <p id={`${id}-phase-hint`} className={styles.hint}>
            可以自己指定準備期間，結束後會自動恢復依行程安排。
          </p>
          {phase ? (
            <div className={styles.dates}>
              <label className={styles.field} htmlFor={`${id}-start`}>
                <span>開始日期</span>
                <input
                  id={`${id}-start`}
                  type="date"
                  value={phase.startDate}
                  min="1900-01-01"
                  max="2200-12-31"
                  required
                  aria-describedby={`${id}-date-hint${error ? ` ${id}-error` : ''}`}
                  aria-invalid={!!error && !!phaseProblem(phase)}
                  onChange={(event) =>
                    update('phaseOverride', { ...phase, startDate: event.target.value })
                  }
                />
              </label>
              <label className={styles.field} htmlFor={`${id}-end`}>
                <span>結束日期（包含當天）</span>
                <input
                  id={`${id}-end`}
                  type="date"
                  value={phase.endDate}
                  min={phase.startDate || '1900-01-01'}
                  max={
                    addDays(phase.startDate, MAX_PHASE_DAYS - 1) > '2200-12-31'
                      ? '2200-12-31'
                      : addDays(phase.startDate, MAX_PHASE_DAYS - 1) || '2200-12-31'
                  }
                  required
                  aria-describedby={`${id}-date-hint${error ? ` ${id}-error` : ''}`}
                  aria-invalid={!!error && !!phaseProblem(phase)}
                  onChange={(event) =>
                    update('phaseOverride', { ...phase, endDate: event.target.value })
                  }
                />
              </label>
              <p id={`${id}-date-hint`} className={styles.dateHint}>
                {expired
                  ? '這段期間已結束。若要繼續，請調整日期；保留原日期則不會套用。'
                  : '以台灣日期安排，一次最多 90 天。'}
              </p>
            </div>
          ) : null}
        </div>
      </details>

      {error ? (
        <p id={`${id}-error`} ref={errorRef} className={styles.error} role="alert" tabIndex={-1}>
          {error}
        </p>
      ) : null}
      <div className={styles.actions}>
        <button type="submit" className={styles.primary}>
          套用首頁安排
        </button>
        {preferences.configured ? (
          <button type="button" className={styles.secondary} onClick={onCancel}>
            取消
          </button>
        ) : (
          <button type="button" className={styles.secondary} onClick={onSkip}>
            先略過
          </button>
        )}
      </div>
    </form>
  );
}

export function CampusPersonalization({
  preferences,
  recommendations,
  onSave,
  storageError,
  schoolName,
  now,
}: CampusPersonalizationProps) {
  const id = useId();
  const [editing, setEditing] = useState(!preferences.configured);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const saveError = useRef<HTMLParagraphElement>(null);
  const stage = CAMPUS_STAGE_OPTIONS.find((option) => option.value === preferences.stage)?.label;
  const focus = CAMPUS_FOCUS_OPTIONS.find((option) => option.value === preferences.focus)?.label;
  const summary = [preferences.stage === 'unspecified' ? null : stage, focus, schoolName]
    .filter(Boolean)
    .join(' · ');
  const today = taipeiDate(now);
  const override = preferences.phaseOverride;
  const expired = !!override && !!today && override.endDate < today;
  const future = !!override && !!today && override.startDate > today;

  useEffect(() => {
    if (message && !editing) editButton.current?.focus();
  }, [message, editing]);
  useEffect(() => {
    if (failed) saveError.current?.focus();
  }, [failed]);

  function save(value: Preferences, skipped = false) {
    const saved = onSave(value);
    setFailed(!saved);
    if (saved) {
      setMessage(skipped ? '已先使用一般安排，之後可以再調整。' : '首頁安排已更新。');
      setEditing(false);
    }
    return saved;
  }

  return (
    <section className={styles.section} aria-labelledby={`${id}-title`}>
      <div className={styles.heading}>
        <div>
          <h2 id={`${id}-title`}>{editing ? '讓首頁更適合你' : '接下來可以做'}</h2>
          <p className={styles.intro}>
            {editing ? '選擇目前的階段與重點，安排適合你的校園日常。' : summary}
          </p>
        </div>
        {!editing ? (
          <button
            ref={editButton}
            type="button"
            className={styles.edit}
            onClick={() => {
              setEditing(true);
              setMessage('');
              setFailed(false);
            }}
          >
            調整安排
          </button>
        ) : null}
      </div>
      <p className={styles.storage}>此裝置記住你的選擇，隨時可以調整。</p>
      {storageError || failed ? (
        <p ref={saveError} className={styles.error} role="alert" tabIndex={-1}>
          {storageError || '這次未能儲存。你的選擇還在，請稍後再試。'}
        </p>
      ) : null}
      {message ? (
        <p className={styles.hint} role="status">
          {message}
        </p>
      ) : null}

      {editing ? (
        <PreferenceEditor
          key={JSON.stringify(preferences)}
          preferences={preferences}
          now={now}
          onSave={save}
          onCancel={() => setEditing(false)}
          onSkip={() => {
            save({ ...createDefaultCampusPreferences(), configured: true }, true);
          }}
        />
      ) : (
        <>
          <div className={styles.phase}>
            <div className={styles.phaseHeading}>
              <h3>{recommendations.phase.label}</h3>
              <span>{PHASE_SOURCES[recommendations.phase.source]}</span>
            </div>
            <p>{recommendations.phase.reason}</p>
            {expired ? (
              <p className={styles.hint}>
                先前設定的{phaseLabel(override.kind)}已在 {override.endDate} 結束。
              </p>
            ) : future ? (
              <p className={styles.hint}>
                你設定的{phaseLabel(override.kind)}將於 {override.startDate} 開始。
              </p>
            ) : null}
          </div>
          <ul className={styles.recommendations} aria-label="為你推薦的下一步">
            {recommendations.recommendations.slice(0, 3).map((item) => (
              <li key={item.id}>
                <Link href={item.href} className={styles.recommendation}>
                  <span className={styles.recommendationBody}>
                    <strong>{item.title}</strong>
                    <span>{item.description}</span>
                    <small>因為{item.reason.replace(/^因為[，、：\s]*/u, '')}</small>
                  </span>
                  <span className={styles.arrow} aria-hidden="true">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
