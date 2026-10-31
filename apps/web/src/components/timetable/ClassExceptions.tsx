'use client';

import { useState } from 'react';
import {
  buildPersonalToday,
  createCourseId,
  classDate,
  classMeetingKey,
  matchesClassException,
  classExceptionOriginal,
  saveClassException,
  withClassExceptions,
  previewClassException,
  type ClassException,
  type PersonalImportRecord,
} from '@campus/shared';
import styles from './timetable.module.css';

export function ClassExceptions({
  records,
  exceptions = [],
  schoolId,
  termKey,
  disabled,
  onSave,
}: {
  records: PersonalImportRecord[];
  exceptions?: ClassException[];
  schoolId: string;
  termKey?: string;
  disabled?: boolean;
  onSave: (next: ClassException[]) => Promise<unknown>;
}) {
  const [date, setDate] = useState(() => classDate(new Date()));
  const [selected, setSelected] = useState('');
  const [kind, setKind] = useState<ClassException['kind']>('cancel');
  const [target, setTarget] = useState(date);
  const [endDate, setEndDate] = useState(date);
  const [start, setStart] = useState('18:00');
  const [end, setEnd] = useState('20:00');
  const [room, setRoom] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const plan = buildPersonalToday(withClassExceptions(records, exceptions), {
    schoolId,
    termKey,
    now: new Date(`${date || classDate(new Date())}T12:00:00+08:00`),
  });
  const candidates = records.filter(
    (row) =>
      row.kind === 'timetable' &&
      row.schoolId === schoolId &&
      `${row.academicYear}|${row.semester}` === plan.termKey &&
      row.dayOfWeek === plan.weekday,
  );
  const row = candidates.find((item) => item.id === selected) || candidates[0];
  const preview =
    row && kind === 'move'
      ? previewClassException(records, exceptions, {
          id: 'preview',
          courseKey: classMeetingKey(row),
          original: row,
          originalDate: date,
          kind,
          date: target,
          endDate,
          startTime: start,
          endTime: end,
          location: room.trim() || row.location || '',
          createdAt: '',
        })
      : null;
  const overlap = preview
    ? buildPersonalToday(preview, {
        schoolId,
        termKey,
        now: new Date(`${target}T12:00:00+08:00`),
      }).today.some((entry) => entry.row.id === row?.id && entry.conflict)
    : false;
  const persist = async (next: ClassException[]) => {
    setSaving(true);
    setError('');
    try {
      await onSave(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '尚未儲存，請重試。');
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className={styles.panel} aria-label="單次調課與停課">
      <h2>這一天，照實際安排走</h2>
      <p>週課表保留原排課；這裡只改指定日期。補課可換日期、時間和教室。</p>
      <label className={styles.field}>
        查看日期
        <input
          type="date"
          value={date}
          required
          onChange={(event) => {
            if (event.target.value) {
              setDate(event.target.value);
              setSelected('');
            }
          }}
        />
      </label>
      <ul className={styles.list} aria-label="當日實際課程">
        {plan.today.map((entry) => (
          <li key={`${entry.row.id}:${entry.startAt}`}>
            <strong>{entry.row.title}</strong> · {entry.startTime}–{entry.endTime} ·{' '}
            {entry.row.location || '教室未填'}
            {entry.conflict && <span role="status"> 時間重疊，請核對</span>}
          </li>
        ))}
      </ul>
      {!plan.today.length && (
        <p>這天沒有已排定的課程。{plan.unplacedCount ? '仍有時間未完整的課程，請先核對。' : ''}</p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!row || disabled || saving) return;
          try {
            const original = classExceptionOriginal(row);
            const value: ClassException = {
              id: createCourseId(),
              courseKey: classMeetingKey(row),
              originalDate: date,
              kind,
              original,
              createdAt: new Date().toISOString(),
              ...(kind === 'move'
                ? { date: target, endDate, startTime: start, endTime: end, location: room.trim() || row.location || '' }
                : {}),
              ...(kind === 'room' ? { location: room } : {}),
            };
            void persist(saveClassException(exceptions, value));
          } catch (cause) {
            setError((cause as Error).message);
          }
        }}
      >
        <fieldset disabled={disabled || saving || !row}>
          <legend>調整原本在這天的課</legend>
          <label className={styles.field}>
            課程
            <select value={row?.id || ''} onChange={(event) => setSelected(event.target.value)}>
              {candidates.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title} · {item.startTime || `第 ${item.startPeriod} 節`}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            這次安排
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as ClassException['kind'])}
            >
              <option value="cancel">只停這一次</option>
              <option value="move">改期補課</option>
              <option value="room">只換教室</option>
            </select>
          </label>
          {kind === 'move' && (
            <div className={styles.toolbar}>
              <label>
                補課日期
                <input
                  type="date"
                  required
                  value={target}
                  onChange={(event) => {
                    setTarget(event.target.value);
                    setEndDate(event.target.value);
                  }}
                />
              </label>
              <label>
                開始
                <input
                  type="time"
                  required
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                />
              </label>
              <label>
                結束日期
                <input
                  type="date"
                  required
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                />
              </label>
              <label>
                結束
                <input
                  type="time"
                  required
                  value={end}
                  onChange={(event) => setEnd(event.target.value)}
                />
              </label>
            </div>
          )}
          {kind !== 'cancel' && (
            <label className={styles.field}>
              這次的教室
              <input
                value={room}
                maxLength={80}
                required={kind === 'room'}
                onChange={(event) => setRoom(event.target.value)}
              />
            </label>
          )}
          {overlap && <p role="alert">補課時間與其他課程重疊，請核對；仍可儲存。</p>}
          <button className="btn primary" type="submit">
            {saving ? '儲存中…' : '儲存這次安排'}
          </button>
        </fieldset>
      </form>
      {error && <p role="alert">{error}</p>}
      {exceptions.length > 0 && (
        <>
          <h3>已記下的調整</h3>
          <ul className={styles.list}>
            {exceptions.map((item) => (
              <li key={item.id}>
                <strong>{item.original.title}</strong> · {item.originalDate} ·{' '}
                {item.kind === 'cancel'
                  ? '停課'
                  : item.kind === 'room'
                    ? `換至 ${item.location}`
                    : `補課 ${item.date} ${item.startTime}–${item.endTime} ${item.location || ''}`}
                {!records.some((record) => matchesClassException(record, item.original)) && (
                  <p role="status">原課程時段已變更，此調整保留待核對，尚未套用。</p>
                )}
                <details>
                  <summary>原會次紀錄</summary>
                  <p>
                    {item.originalDate} · {item.original.startTime || `第 ${item.original.startPeriod} 節`}
                  </p>
                  <pre>{'原始匯入來源請至個人匯入紀錄查看'}</pre>
                </details>
                <button
                  type="button"
                  className="btn"
                  disabled={disabled || saving}
                  onClick={() => void persist(exceptions.filter((value) => value.id !== item.id))}
                >
                  恢復原安排
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
