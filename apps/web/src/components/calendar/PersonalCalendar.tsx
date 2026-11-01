'use client';

import { MonthCalendar } from './MonthCalendar';

import { useEffect, useRef, useState } from 'react';
import {
  buildPersonalEventsCalendar,
  personalEventsOnDate,
  shiftCalendarMonth,
  isCalendarMonth,
  draftFromPersonalEvent,
  emptyPersonalEventDraft,
  filterPersonalEvents,
  personalEventDraftIssues,
  personalEventExportNotice,
  personalEventPersistenceCopy,
  personalEventRowFromDraft,
  personalEventSaveError,
  personalEventSourceLabel,
  personalImportSavedNotice,
  type PersonalEventDraft,
  type PersonalImportRecord,
} from '@campus/shared';
import { usePersonalImportScope, usePersonalImports } from '@/lib/usePersonalImports';
import {
  changePersonalImport,
  personalImportsStorageKey,
  savePersonalImportBatch,
  type PersonalImportScope,
} from '@/lib/personalImports';
import styles from '@/components/imports/PersonalImport.module.css';

function EventFormFields({
  draft,
  disabled,
  onChange,
}: {
  draft: PersonalEventDraft;
  disabled: boolean;
  onChange: (draft: PersonalEventDraft) => void;
}) {
  const set = (patch: Partial<PersonalEventDraft>) => onChange({ ...draft, ...patch });
  return (
    <fieldset disabled={disabled} className={styles.fieldset}>
      <div className={styles.fields}>
        <label className={styles.field}>
          標題
          <input
            type="text"
            maxLength={200}
            value={draft.title}
            onChange={(event) => set({ title: event.target.value })}
            required
          />
        </label>
        <label className={styles.field}>
          日期
          <input
            type="date"
            value={draft.date}
            onChange={(event) => set({ date: event.target.value })}
            required
          />
        </label>
        <label className={styles.field}>
          {draft.allDay ? '結束日期（不含當天，可留空）' : '結束日期（跨日才填）'}
          <input
            type="date"
            value={draft.endDate}
            onChange={(event) => set({ endDate: event.target.value })}
          />
        </label>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={draft.allDay}
            onChange={(event) =>
              set({
                allDay: event.target.checked,
                ...(event.target.checked
                  ? { startTime: '', endTime: '' }
                  : { startTime: '09:00', endTime: '10:00' }),
              })
            }
          />
          全天
        </label>
        {!draft.allDay && (
          <>
            <label className={styles.field}>
              開始時間
              <input
                type="time"
                value={draft.startTime}
                onChange={(event) => set({ startTime: event.target.value })}
                required
              />
            </label>
            <label className={styles.field}>
              結束時間
              <input
                type="time"
                value={draft.endTime}
                onChange={(event) => set({ endTime: event.target.value })}
                required
              />
            </label>
          </>
        )}
        <label className={styles.field}>
          地點（選填）
          <input
            type="text"
            maxLength={300}
            value={draft.location}
            onChange={(event) => set({ location: event.target.value })}
          />
        </label>
      </div>
    </fieldset>
  );
}

function downloadIcs(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function PersonalCalendar() {
  const context = usePersonalImportScope();
  return <PersonalCalendarWorkspace key={context.scopeKey} />;
}

function PersonalCalendarWorkspace() {
  const context = usePersonalImportScope();
  const scope = context.scope;
  const scopeKey = context.scopeKey;
  const ledger = usePersonalImports(scope, !context.loading);
  const [month, setMonth] = useState(() => emptyPersonalEventDraft().date.slice(0, 7));
  const [calendarView, setCalendarView] = useState<'month' | 'list'>('month');
  const [selectedDate, setSelectedDate] = useState('');
  const changeMonth = (value: string) => {
    setMonth(value);
    setSelectedDate('');
  };
  const goToday = () => {
    const today = emptyPersonalEventDraft().date;
    setMonth(today.slice(0, 7));
    setSelectedDate(today);
  };
  const [mode, setMode] = useState<'idle' | 'create' | 'edit'>('idle');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PersonalEventDraft>(() => emptyPersonalEventDraft());
  const [baseline, setBaseline] = useState<PersonalImportRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [formError, setFormError] = useState('');
  const [exportNotice, setExportNotice] = useState('');
  const active = useRef(true);
  const requestId = useRef(0);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const monthEvents = filterPersonalEvents(ledger.records, month);
  const events = selectedDate ? personalEventsOnDate(monthEvents, selectedDate) : monthEvents;
  const draftRow = personalEventRowFromDraft(
    draft,
    scope.schoolId,
    mode === 'edit' ? baseline : null,
  );
  const draftIssues = personalEventDraftIssues(draftRow);
  const canMutate = !context.loading && ledger.ready && !saving;

  const isActiveScope = (target: PersonalImportScope) =>
    active.current && scopeKey === personalImportsStorageKey(target);

  const openCreate = () => {
    setMode('create');
    setSelectedId(null);
    setBaseline(null);
    setDraft(emptyPersonalEventDraft());
    setFormError('');
    setNotice('');
  };

  const openEdit = (row: PersonalImportRecord) => {
    setMode('edit');
    setSelectedId(row.id);
    setBaseline(row);
    setDraft(draftFromPersonalEvent(row));
    setFormError('');
    setNotice('');
  };

  const cancelForm = () => {
    setMode('idle');
    setSelectedId(null);
    setBaseline(null);
    setFormError('');
  };

  const runSave = async (action: () => Promise<void>, success: string) => {
    if (!canMutate || draftIssues.length) {
      setFormError(draftIssues[0]?.message || '請先確認行程內容。');
      return;
    }
    const ticket = ++requestId.current;
    const scoped = { ...scope };
    setSaving(true);
    setFormError('');
    setNotice('');
    try {
      await action();
      if (!active.current || ticket !== requestId.current || !isActiveScope(scoped)) return;
      setNotice(success);
      setMode('idle');
      setBaseline(null);
      setSelectedId(null);
      setDraft(emptyPersonalEventDraft());
    } catch (error) {
      if (!active.current || ticket !== requestId.current || !isActiveScope(scoped)) return;
      setFormError(personalEventSaveError(error));
    } finally {
      if (active.current && ticket === requestId.current) setSaving(false);
    }
  };

  const saveCreate = () => {
    const scoped = { ...scope };
    void runSave(
      async () => {
        const row = personalEventRowFromDraft(draft, scoped.schoolId, null);
        await savePersonalImportBatch(scoped, [row], () => isActiveScope(scoped));
      },
      personalImportSavedNotice(1, ledger.syncEnabled),
    );
  };

  const saveEdit = () => {
    if (!baseline) return;
    const scoped = { ...scope };
    const original = baseline;
    void runSave(async () => {
      const row = personalEventRowFromDraft(draft, scoped.schoolId, original);
      await changePersonalImport(scoped, original, row, () => isActiveScope(scoped));
    }, '個人行程已更新。');
  };

  const removeSelected = () => {
    if (!baseline || !canMutate) return;
    if (!window.confirm(`確定刪除「${baseline.title}」？刪除後無法復原。`)) return;
    const ticket = ++requestId.current;
    const scoped = { ...scope };
    const original = baseline;
    setSaving(true);
    setFormError('');
    setNotice('');
    void changePersonalImport(scoped, original, null, () => isActiveScope(scoped))
      .then(() => {
        if (!active.current || ticket !== requestId.current || !isActiveScope(scoped)) return;
        setNotice('已刪除這筆個人行程。');
        setMode('idle');
        setBaseline(null);
        setSelectedId(null);
        setDraft(emptyPersonalEventDraft());
      })
      .catch((error) => {
        if (!active.current || ticket !== requestId.current || !isActiveScope(scoped)) return;
        setFormError(personalEventSaveError(error));
      })
      .finally(() => {
        if (active.current && ticket === requestId.current) setSaving(false);
      });
  };

  const exportRecords = (target: PersonalImportRecord[], filename: string) => {
    if (!ledger.ready) return;
    setExportNotice('');
    try {
      const result = buildPersonalEventsCalendar(target, {
        calendarName: `${context.schoolName} 個人行程`,
      });
      if (!result.eventCount) {
        setExportNotice('目前沒有可匯出的行程。');
        return;
      }
      downloadIcs(result.content, filename);
      setExportNotice(personalEventExportNotice(result.eventCount));
    } catch (error) {
      setExportNotice(personalEventSaveError(error));
    }
  };

  /** Always exports the visible month/list filter — never a stale edit selection. */
  const exportCurrentList = () =>
    exportRecords(filterPersonalEvents(ledger.records, month), 'campus-one-personal-events.ics');

  const exportSelectedOnly = () => {
    if (!baseline) return;
    exportRecords(
      ledger.records.filter((row) => row.id === baseline.id && row.kind === 'events'),
      'campus-one-personal-event.ics',
    );
  };

  return (
    <div className={styles.root}>
      <section className={styles.panel}>
        <div className={styles.heading}>
          <h2>活動、考試與自己的安排</h2>
          <div className={styles.actions}>
            <button
              type="button"
              className="btn primary"
              disabled={!canMutate}
              onClick={openCreate}
            >
              新增行程
            </button>
            <button
              type="button"
              className="btn"
              disabled={!ledger.ready}
              onClick={exportCurrentList}
            >
              匯出所選月份
            </button>
          </div>
        </div>
        <p className={styles.note}>
          這裡是 {context.schoolName} 的個人行程，不是學校正式紀錄。
          {personalEventPersistenceCopy(ledger.syncEnabled)}
        </p>
        <details className={styles.source}>
          <summary>關於匯入與匯出</summary>
          <p className={styles.note}>
            從檔案匯入或匯出行事曆檔，只是整理自己的安排，不會完成報名，也不會自動設定系統提醒。
          </p>
        </details>
        {exportNotice && <p role="status">{exportNotice}</p>}
        <label className={styles.field}>
          查看月份
          <input
            type="month"
            value={month}
            onChange={(event) => {
              if (isCalendarMonth(event.target.value)) changeMonth(event.target.value);
            }}
          />
        </label>
        <div className={styles.actions}>
          <button
            type="button"
            className="btn"
            onClick={() => changeMonth(shiftCalendarMonth(month, -1))}
          >
            上一月
          </button>
          <button type="button" className="btn" onClick={goToday}>
            回今天
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => changeMonth(shiftCalendarMonth(month, 1))}
          >
            下一月
          </button>
          <button
            type="button"
            className="btn"
            aria-pressed={calendarView === 'month'}
            onClick={() => setCalendarView('month')}
          >
            月格
          </button>
          <button
            type="button"
            className="btn"
            aria-pressed={calendarView === 'list'}
            onClick={() => {
              setCalendarView('list');
              setSelectedDate('');
            }}
          >
            列表
          </button>
        </div>
        {!context.loading && ledger.ready && !ledger.error && calendarView === 'month' && (
          <MonthCalendar
            key={month}
            records={monthEvents}
            month={month}
            selectedDate={selectedDate}
            onDate={setSelectedDate}
            onEdit={openEdit}
            disabled={!canMutate}
          />
        )}
        {selectedDate && (
          <div className={styles.actions}>
            <h3>{selectedDate} 的行程</h3>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setSelectedDate('');
                setCalendarView('list');
              }}
            >
              查看整月列表
            </button>
          </div>
        )}
        {ledger.error && (
          <p role="alert">
            {ledger.error} 讀取失敗時不會清空或覆寫現有資料；請稍後重試，暫時無法新增或刪除。
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {formError && <p role="alert">{formError}</p>}

        {(mode === 'create' || mode === 'edit') && (
          <section className={styles.row} aria-label={mode === 'create' ? '新增行程' : '編輯行程'}>
            <h3>{mode === 'create' ? '新增行程' : `編輯 ${baseline?.title || '行程'}`}</h3>
            <EventFormFields draft={draft} disabled={saving} onChange={setDraft} />
            {draftIssues.length > 0 && (
              <ul className={styles.issues}>
                {draftIssues.map((issue) => (
                  <li key={`${issue.code}-${issue.field}`}>{issue.message}</li>
                ))}
              </ul>
            )}
            <div className={styles.actions}>
              {mode === 'create' ? (
                <button
                  type="button"
                  className="btn primary"
                  disabled={!canMutate || draftIssues.length > 0}
                  onClick={saveCreate}
                >
                  {saving ? '儲存中…' : '儲存行程'}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={!canMutate || draftIssues.length > 0}
                    onClick={saveEdit}
                  >
                    {saving ? '儲存中…' : '儲存修改'}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={!canMutate}
                    onClick={removeSelected}
                  >
                    刪除這筆
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={!ledger.ready}
                    onClick={exportSelectedOnly}
                  >
                    匯出這筆
                  </button>
                </>
              )}
              <button type="button" className="btn" disabled={saving} onClick={cancelForm}>
                取消
              </button>
            </div>
          </section>
        )}

        {context.loading || ledger.loading ? (
          <p role="status">正在讀取行程…</p>
        ) : ledger.error ? null : !events.length ? (
          <p className={styles.empty}>
            {selectedDate ? '這一天還沒有行程。' : '這個月還沒有行程。'}
            按「新增行程」直接建立，或從上方「從截圖或檔案匯入」。
          </p>
        ) : calendarView === 'list' || selectedDate ? (
          <ul className={styles.saved}>
            {events.map((event) => (
              <li key={event.id}>
                <div>
                  <time dateTime={event.date}>
                    {event.date}
                    {event.endDate && event.endDate !== event.date
                      ? ` 至 ${event.endDate}${event.allDay ? '（不含結束日）' : ''}`
                      : ''}
                  </time>
                  <h3>{event.title}</h3>
                  <p>
                    {event.allDay ? '全天' : `${event.startTime}–${event.endTime}`} ·{' '}
                    {event.location || '地點未填'}
                  </p>
                  <small>{personalEventSourceLabel(event)}</small>
                </div>
                <button
                  type="button"
                  className="btn"
                  disabled={!ledger.ready || saving}
                  aria-pressed={selectedId === event.id && mode === 'edit'}
                  onClick={() => openEdit(event)}
                >
                  編輯
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
