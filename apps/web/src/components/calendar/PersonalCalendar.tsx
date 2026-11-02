'use client';

import { MonthCalendar } from './MonthCalendar';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { useAuth } from '@/components/AuthGuard';
import { useOptionalSelectedSchool } from '@/components/SelectedSchoolProvider';
import { useOptionalNuniSession } from '@/features/nuni/Session';
import { usePersonalImportScope, usePersonalImports } from '@/lib/usePersonalImports';
import {
  changePersonalImport,
  personalImportsStorageKey,
  savePersonalImportBatch,
  type PersonalImportScope,
} from '@/lib/personalImports';
import { loadHomeData } from '@/lib/homeOverview';
import {
  CALENDAR_DUE_EMPTY,
  CALENDAR_DUE_EMPTY_DAY,
  CALENDAR_DUE_LOAD_ERROR,
  CALENDAR_DUE_TITLE,
  CALENDAR_DUE_UNSIGNED,
  calendarDueItemsFromTasks,
  calendarDueItemsInMonth,
  calendarDueItemsOnDate,
  type CalendarDueItem,
} from '@/lib/todayCourseWork';
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
  const auth = useAuth();
  const nuni = useOptionalNuniSession();
  const school = useOptionalSelectedSchool();
  const params = useSearchParams();
  const explicitSchool =
    params?.get('campus')?.trim() || params?.get('schoolId')?.trim() || params?.get('school')?.trim();
  const authErrorBlocks = !!auth.error && !nuni?.session;
  const identityPending =
    !!nuni?.loading ||
    !!nuni?.error ||
    !!nuni?.pendingLogout ||
    (!nuni?.session && (auth.loading || !!auth.error));
  const knownOwner = identityPending ? null : context.scope.owner;
  const fallbackOwner =
    auth.loading || auth.error ? null : auth.user ? `school:${auth.user.uid}` : 'guest';
  const paused = context.loading || authErrorBlocks || !!nuni?.error || !!nuni?.pendingLogout;
  const [confirmed, setConfirmed] = useState<typeof context | null>(null);
  const fallbackChanged =
    !!confirmed &&
    !confirmed.scope.owner.startsWith('platform:') &&
    fallbackOwner !== null &&
    fallbackOwner !== confirmed.scope.owner;
  const schoolChanged =
    !!confirmed &&
    !!explicitSchool &&
    !!school &&
    !school.loading &&
    school.catalogStatus === 'ready' &&
    context.scope.schoolId !== confirmed.scope.schoolId;
  if (
    confirmed &&
    (nuni?.pendingLogout ||
      fallbackChanged ||
      schoolChanged ||
      (paused && knownOwner !== null && knownOwner !== confirmed.scope.owner))
  )
    setConfirmed(null);
  else if (
    !paused &&
    (confirmed?.scopeKey !== context.scopeKey || confirmed?.schoolName !== context.schoolName)
  )
    setConfirmed(context);
  const retained =
    confirmed &&
    !fallbackChanged &&
    !schoolChanged &&
    (knownOwner === null || confirmed.scope.owner === knownOwner)
      ? confirmed
      : null;
  const visible = nuni?.pendingLogout ? null : paused ? retained : context;
  return (
    <>
      {nuni?.pendingLogout ? (
        <div role="status">
          <p>登出尚未完成，個人行程已隱藏。</p>
          <button
            type="button"
            className="btn"
            disabled={nuni.loading}
            onClick={() => void nuni.logout()}
          >
            重試登出
          </button>
        </div>
      ) : nuni?.error ? (
        <div role="alert">
          <p>
            暫時無法確認帳號。
            {retained ? '未儲存的內容仍保留，確認後可繼續。' : '請確認連線後再試。'}
          </p>
          <button type="button" className="btn" onClick={() => void nuni.refresh()}>
            重新確認帳號
          </button>
        </div>
      ) : authErrorBlocks ? (
        <div role="alert">
          <p>目前無法確認帳號，個人行程已暫時隱藏。重新整理會清除未儲存的草稿。</p>
          <button
            type="button"
            className="btn"
            onClick={() => {
              if (window.confirm('重新整理會清除未儲存的行程草稿。確定繼續？'))
                window.location.reload();
            }}
          >
            重新整理頁面
          </button>
        </div>
      ) : context.loading ? (
        <p role="status">正在確認個人行程的儲存位置…</p>
      ) : null}
      {visible && (
        <div hidden={paused}>
          <PersonalCalendarWorkspace key={visible.scopeKey} context={visible} paused={paused} />
        </div>
      )}
    </>
  );
}

function PersonalCalendarWorkspace({
  context,
  paused,
}: {
  context: ReturnType<typeof usePersonalImportScope>;
  paused: boolean;
}) {
  const { user, loading: authLoading } = useAuth();
  const scope = context.scope;
  const scopeKey = context.scopeKey;
  const ledger = usePersonalImports(scope, !paused);
  const [month, setMonth] = useState(() => emptyPersonalEventDraft().date.slice(0, 7));
  const [calendarView, setCalendarView] = useState<'month' | 'list'>('month');
  const [selectedDate, setSelectedDate] = useState('');
  const [dues, setDues] = useState<{
    uid: string | null;
    items: CalendarDueItem[];
    status: 'idle' | 'loading' | 'ready' | 'error';
  }>({ uid: null, items: [], status: 'idle' });
  const dueStatus = dues.uid === user?.uid ? dues.status : 'idle';
  const [dueRetry, setDueRetry] = useState(0);
  const changeMonth = (value: string) => {
    setMonth(value);
    setSelectedDate('');
  };

  useEffect(() => {
    if (authLoading || !user?.uid) return;
    let active = true;
    const uid = user.uid;
    void Promise.resolve()
      .then(() => {
        if (active) setDues({ uid, items: [], status: 'loading' });
        return loadHomeData(uid);
      })
      .then((home) => {
        if (!active) return;
        setDues({ uid, items: calendarDueItemsFromTasks(home.tasks), status: 'ready' });
      })
      .catch(() => {
        if (!active) return;
        setDues({ uid, items: [], status: 'error' });
      });
    return () => {
      active = false;
    };
  }, [authLoading, user?.uid, dueRetry]);
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
  const formErrorId = useId();
  const [exportNotice, setExportNotice] = useState('');
  const active = useRef(true);
  const suspended = useRef(paused);
  const writing = useRef(false);
  const requestId = useRef(0);

  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useLayoutEffect(() => {
    suspended.current = paused;
  }, [paused]);

  const monthEvents = useMemo(
    () => filterPersonalEvents(ledger.records, month),
    [ledger.records, month],
  );
  const events = selectedDate ? personalEventsOnDate(monthEvents, selectedDate) : monthEvents;
  const monthDues = useMemo(
    () => calendarDueItemsInMonth(dues.uid === user?.uid ? dues.items : [], month),
    [dues, user?.uid, month],
  );
  const visibleDues = selectedDate
    ? calendarDueItemsOnDate(monthDues, selectedDate)
    : monthDues;
  const draftRow = personalEventRowFromDraft(
    draft,
    scope.schoolId,
    mode === 'edit' ? baseline : null,
  );
  const draftIssues = personalEventDraftIssues(draftRow);
  const canMutate = !paused && ledger.ready && !saving;

  const isActiveScope = (target: PersonalImportScope) =>
    active.current && scopeKey === personalImportsStorageKey(target);

  const openCreate = () => {
    if (suspended.current || writing.current) return;
    setMode('create');
    setSelectedId(null);
    setBaseline(null);
    setDraft(emptyPersonalEventDraft());
    setFormError('');
    setNotice('');
  };

  const openEdit = (row: PersonalImportRecord) => {
    if (suspended.current || writing.current) return;
    setMode('edit');
    setSelectedId(row.id);
    setBaseline(row);
    setDraft(draftFromPersonalEvent(row));
    setFormError('');
    setNotice('');
  };

  const cancelForm = () => {
    if (suspended.current || writing.current) return;
    setMode('idle');
    setSelectedId(null);
    setBaseline(null);
    setFormError('');
  };

  const runSave = async (action: () => Promise<void>, success: string) => {
    if (!active.current || suspended.current || writing.current) return;
    if (!canMutate || draftIssues.length) {
      setFormError(draftIssues[0]?.message || '請先確認行程內容。');
      return;
    }
    const ticket = ++requestId.current;
    const scoped = { ...scope };
    writing.current = true;
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
      if (active.current && ticket === requestId.current) {
        writing.current = false;
        setSaving(false);
      }
    }
  };

  const saveCreate = () => {
    const scoped = { ...scope };
    void runSave(
      async () => {
        const row = personalEventRowFromDraft(draft, scoped.schoolId, null);
        await savePersonalImportBatch(
          scoped,
          [row],
          () => isActiveScope(scoped) && !suspended.current,
        );
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
      await changePersonalImport(
        scoped,
        original,
        row,
        () => isActiveScope(scoped) && !suspended.current,
      );
    }, '個人行程已更新。');
  };

  const removeSelected = () => {
    if (!baseline || !canMutate || suspended.current || writing.current) return;
    if (!window.confirm(`確定刪除「${baseline.title}」？刪除後無法復原。`)) return;
    const ticket = ++requestId.current;
    const scoped = { ...scope };
    const original = baseline;
    writing.current = true;
    setSaving(true);
    setFormError('');
    setNotice('');
    void changePersonalImport(
      scoped,
      original,
      null,
      () => isActiveScope(scoped) && !suspended.current,
    )
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
        if (active.current && ticket === requestId.current) {
          writing.current = false;
          setSaving(false);
        }
      });
  };

  const exportRecords = (target: PersonalImportRecord[], filename: string) => {
    if (!ledger.ready || suspended.current || !active.current) return;
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
          <h2>活動、考試、作業截止與自己的安排</h2>
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
          這裡是 {context.schoolName} 的個人行程，並與手機版一樣顯示已加入課程的作業截止。個人行程不是學校正式紀錄。
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
        {!paused && ledger.ready && !ledger.error && calendarView === 'month' && (
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

        {(mode === 'create' || mode === 'edit') && (
          <section className={styles.row} aria-label={mode === 'create' ? '新增行程' : '編輯行程'}>
            <h3>{mode === 'create' ? '新增行程' : `編輯 ${baseline?.title || '行程'}`}</h3>
            <EventFormFields
              draft={draft}
              disabled={saving || paused}
              onChange={(next) => {
                if (!suspended.current && !writing.current) setDraft(next);
              }}
            />
            {draftIssues.length > 0 && (
              <ul className={styles.issues}>
                {draftIssues.map((issue) => (
                  <li key={`${issue.code}-${issue.field}`}>{issue.message}</li>
                ))}
              </ul>
            )}
            {formError && (
              <p id={formErrorId} role="alert">{formError}</p>
            )}
            <div className={styles.actions}>
              {mode === 'create' ? (
                <button
                  type="button"
                  className="btn primary"
                  disabled={paused || !ledger.ready || draftIssues.length > 0}
                  aria-disabled={saving || undefined}
                  aria-describedby={formError ? formErrorId : undefined}
                  onClick={saveCreate}
                >
                  {saving ? '儲存中…' : '儲存行程'}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={paused || !ledger.ready || draftIssues.length > 0}
                    aria-disabled={saving || undefined}
                    aria-describedby={formError ? formErrorId : undefined}
                    onClick={saveEdit}
                  >
                    {saving ? '儲存中…' : '儲存修改'}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={paused || !ledger.ready}
                    aria-disabled={saving || undefined}
                    aria-describedby={formError ? formErrorId : undefined}
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

        {paused || ledger.loading ? (
          <p role="status">正在讀取行程…</p>
        ) : ledger.error ? null : !events.length ? (
          <p className={styles.empty}>
            {selectedDate
              ? visibleDues.length
                ? '這一天還沒有行程；下方仍可查看作業截止。'
                : CALENDAR_DUE_EMPTY_DAY
              : '這個月還沒有行程。'}
            {!selectedDate ? '按「新增行程」直接建立，或從上方「從截圖或檔案匯入」。' : null}
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

      <section className={styles.panel} aria-labelledby="calendar-due-title" data-testid="calendar-due">
        <div className={styles.heading}>
          <h2 id="calendar-due-title">{CALENDAR_DUE_TITLE}</h2>
          <Link className="btn" href="/">
            回今天看期限
          </Link>
        </div>
        {!user && !authLoading ? (
          <p className={styles.empty}>
            {CALENDAR_DUE_UNSIGNED} <Link href="/">前往今天</Link>
          </p>
        ) : !user || dueStatus === 'loading' || dueStatus === 'idle' || authLoading ? (
          <p role="status">正在讀取作業截止…</p>
        ) : dueStatus === 'error' ? (
          <>
            <p className={styles.empty} role="alert">
              {CALENDAR_DUE_LOAD_ERROR}
            </p>
            <button type="button" className="btn" onClick={() => setDueRetry((n) => n + 1)}>
              重試作業
            </button>
          </>
        ) : visibleDues.length === 0 ? (
          <p className={styles.empty}>
            {selectedDate ? CALENDAR_DUE_EMPTY_DAY : CALENDAR_DUE_EMPTY}{' '}
            <Link href="/">回今天</Link>
          </p>
        ) : (
          <ul className={styles.saved} data-testid="calendar-due-list">
            {visibleDues.map((item) => (
              <li key={item.id}>
                <div>
                  <time dateTime={item.dueDate}>{item.dueDate}</time>
                  <h3>{item.title}</h3>
                  <p>{item.courseName} · 作業截止</p>
                </div>
                <Link className="btn primary" href={item.href}>
                  查看作業
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
