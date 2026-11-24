'use client';

import { MonthCalendar } from './MonthCalendar';
import {
  isHorizontallyVisible,
  measureStickyInsets,
  scrollVerticallyIntoView,
} from './calendarScroll';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
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
import { browserRequest, useOptionalNuniSession } from '@/features/nuni/Session';
import { usePersonalImportScope, usePersonalImports } from '@/lib/usePersonalImports';
import {
  changePersonalImport,
  personalImportsStorageKey,
  savePersonalImportBatch,
  type PersonalImportScope,
} from '@/lib/personalImports';
import { loadHomeData } from '@/lib/homeOverview';
import { buildCampusNavigationSearch, campusServiceHref } from '@/lib/campusNavigationLinks';
import {
  calendarCourseDeadlinesInMonth,
  calendarCourseDeadlinesOnDate,
  calendarDeadlinesFromLmsTasks,
  loadNuniCalendarDeadlines,
  mergeCalendarCourseDeadlines,
  type CalendarCourseDeadline,
} from '@/lib/calendarCourseDeadlines';
import {
  CALENDAR_DUE_EMPTY,
  CALENDAR_DUE_EMPTY_DAY,
  CALENDAR_DUE_LOAD_ERROR,
  CALENDAR_DUE_TITLE,
  CALENDAR_DUE_UNSIGNED,
} from '@/lib/todayCourseWork';
import styles from '@/components/imports/PersonalImport.module.css';
import workspaceStyles from './PersonalCalendar.module.css';

function CalendarDateField({
  label,
  type,
  value,
  onChange,
  required,
  className = '',
}: {
  label: string;
  type: 'month' | 'date' | 'time';
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  className?: string;
}) {
  const inputId = useId();
  const valueId = `${inputId}-value`;
  const parts = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value);
  const readableValue =
    parts && type !== 'time'
      ? `${parts[1]} 年 ${Number(parts[2])} 月${parts[3] ? ` ${Number(parts[3])} 日` : ''}`
      : value;

  return (
    <div className={`${styles.field} ${className}`}>
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        aria-describedby={value ? valueId : undefined}
      />
      {value && (
        <time id={valueId} dateTime={value} className={workspaceStyles.nativeValue}>
          {readableValue}
        </time>
      )}
    </div>
  );
}

function EventFormFields({
  draft,
  disabled,
  onChange,
  titleRef,
}: {
  draft: PersonalEventDraft;
  disabled: boolean;
  onChange: (draft: PersonalEventDraft) => void;
  titleRef: RefObject<HTMLInputElement | null>;
}) {
  const set = (patch: Partial<PersonalEventDraft>) => onChange({ ...draft, ...patch });
  return (
    <fieldset disabled={disabled} className={styles.fieldset}>
      <div className={styles.fields}>
        <label className={styles.field}>
          標題
          <input
            ref={titleRef}
            type="text"
            maxLength={200}
            value={draft.title}
            onChange={(event) => set({ title: event.target.value })}
            required
          />
        </label>
        <CalendarDateField
          label="日期"
          type="date"
          value={draft.date}
          onChange={(date) => set({ date })}
          required
        />
        <CalendarDateField
          label={draft.allDay ? '結束日期（不含當天，可留空）' : '結束日期（跨日才填）'}
          type="date"
          value={draft.endDate}
          onChange={(endDate) => set({ endDate })}
        />
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
            <CalendarDateField
              label="開始時間"
              type="time"
              value={draft.startTime}
              onChange={(startTime) => set({ startTime })}
              required
            />
            <CalendarDateField
              label="結束時間"
              type="time"
              value={draft.endTime}
              onChange={(endTime) => set({ endTime })}
              required
            />
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
    params?.get('campus')?.trim() ||
    params?.get('schoolId')?.trim() ||
    params?.get('school')?.trim();
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
          <PersonalCalendarWorkspace
            key={visible.scopeKey}
            context={visible}
            paused={paused}
            requestedEventId={params?.get('eventId') ?? null}
          />
        </div>
      )}
    </>
  );
}

function PersonalCalendarWorkspace({
  context,
  paused,
  requestedEventId,
}: {
  context: ReturnType<typeof usePersonalImportScope>;
  paused: boolean;
  requestedEventId: string | null;
}) {
  const { user, loading: authLoading } = useAuth();
  const nuni = useOptionalNuniSession();
  const nuniLoading = nuni?.loading ?? false;
  const nuniContext = nuni?.session?.context;
  const nuniAccountId = nuni?.session?.platformAccountId;
  const signedIn = Boolean(user?.uid || nuniAccountId);
  const scope = context.scope;
  const scopeKey = context.scopeKey;
  const schoolSearch = buildCampusNavigationSearch(
    null,
    scope.schoolId === 'personal' ? null : { id: scope.schoolId },
    true,
  );
  const importHref = campusServiceHref('/import?kind=events', schoolSearch);
  const todayHref = campusServiceHref('/', schoolSearch);
  const ledger = usePersonalImports(scope, !paused);
  const [month, setMonth] = useState(() => emptyPersonalEventDraft().date.slice(0, 7));
  const [calendarView, setCalendarView] = useState<'month' | 'list'>('month');
  const [selectedDate, setSelectedDate] = useState('');
  const [dateRevealRevision, setDateRevealRevision] = useState(0);
  const [dues, setDues] = useState<{
    uid: string | null;
    items: CalendarCourseDeadline[];
    status: 'idle' | 'loading' | 'ready' | 'error';
  }>({ uid: null, items: [], status: 'idle' });
  const dueUid = user?.uid ?? null;
  const dueStatus = dues.uid === dueUid ? dues.status : 'idle';
  const [dueRetry, setDueRetry] = useState(0);
  const changeMonth = (value: string) => {
    setMonth(value);
    setSelectedDate('');
  };

  useEffect(() => {
    if (authLoading || nuniLoading || (!user?.uid && !nuniAccountId)) return;
    let active = true;
    const uid = user?.uid;
    const accountId = nuniAccountId;
    const sessionContext = nuniContext;
    void Promise.resolve()
      .then(async () => {
        if (active) setDues({ uid: uid ?? null, items: [], status: 'loading' });
        const [lmsResult, nuniResult] = await Promise.allSettled([
          uid ? loadHomeData(uid) : Promise.resolve(null),
          accountId && sessionContext
            ? loadNuniCalendarDeadlines(
                (path, input) => browserRequest(path, sessionContext, input),
                accountId,
                { cancelled: () => !active },
              )
            : Promise.resolve([] as CalendarCourseDeadline[]),
        ]);
        if (!active) return;
        if (nuniResult.status === 'fulfilled' && nuniResult.value === 'cancelled') return;
        const lms =
          lmsResult.status === 'fulfilled' && lmsResult.value
            ? calendarDeadlinesFromLmsTasks(lmsResult.value.tasks)
            : [];
        const classroom =
          nuniResult.status === 'fulfilled' && nuniResult.value !== 'cancelled'
            ? nuniResult.value
            : [];
        const lmsOk = lmsResult.status === 'fulfilled';
        const nuniOk = nuniResult.status === 'fulfilled' && nuniResult.value !== 'cancelled';
        if (!lmsOk && !nuniOk) {
          setDues({ uid: uid ?? null, items: [], status: 'error' });
          return;
        }
        setDues({
          uid: uid ?? null,
          items: mergeCalendarCourseDeadlines(classroom, lms),
          status: 'ready',
        });
      })
      .catch(() => {
        if (!active) return;
        setDues({ uid: uid ?? null, items: [], status: 'error' });
      });
    return () => {
      active = false;
    };
  }, [authLoading, nuniLoading, user?.uid, nuniAccountId, nuniContext, dueRetry]);
  const goToday = () => {
    const today = emptyPersonalEventDraft().date;
    setMonth(today.slice(0, 7));
    setSelectedDate(today);
    if (today === selectedDate) setDateRevealRevision((revision) => revision + 1);
  };
  const [mode, setMode] = useState<'idle' | 'create' | 'edit'>('idle');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PersonalEventDraft>(() => emptyPersonalEventDraft());
  const [initialDraft, setInitialDraft] = useState<PersonalEventDraft | null>(null);
  const editorRef = useRef<HTMLElement | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const createButtonRef = useRef<HTMLButtonElement | null>(null);
  const dayHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const daySummaryRef = useRef<HTMLDivElement | null>(null);
  const pendingDayReveal = useRef<string | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const pendingFocus = useRef<'editor' | 'return' | 'saved' | null>(null);
  const [editorRevision, setEditorRevision] = useState(0);
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
  const viewRevision = useRef(0);
  const locatedRequest = useRef<string | null>(null);
  const focusedRequest = useRef<string | null>(null);
  const linkedEventElement = useRef<HTMLLIElement | null>(null);
  // The URL selects an existing row in this owner's ledger. It never supplies event contents.
  const linkedEvent =
    !paused && ledger.ready && requestedEventId && requestedEventId.length <= 200
      ? ledger.records.find(
          (row) =>
            row.id === requestedEventId && row.kind === 'events' && row.schoolId === scope.schoolId,
        )
      : undefined;
  const linkedEventDate = linkedEvent?.date;

  useEffect(() => {
    locatedRequest.current = null;
    focusedRequest.current = null;
  }, [requestedEventId]);

  useEffect(() => {
    if (paused || !ledger.ready || !requestedEventId || !linkedEventDate) return;
    if (locatedRequest.current === requestedEventId) return;
    locatedRequest.current = requestedEventId;
    setMonth(linkedEventDate.slice(0, 7));
    setSelectedDate(linkedEventDate);
    setCalendarView('list');
  }, [paused, ledger.ready, requestedEventId, linkedEventDate]);

  useEffect(() => {
    if (
      paused ||
      !requestedEventId ||
      focusedRequest.current === requestedEventId ||
      calendarView !== 'list' ||
      selectedDate !== linkedEventDate ||
      !linkedEventElement.current
    )
      return;
    focusedRequest.current = requestedEventId;
    linkedEventElement.current.focus({ preventScroll: true });
    scrollVerticallyIntoView(linkedEventElement.current);
  }, [paused, requestedEventId, linkedEventDate, calendarView, selectedDate]);

  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useLayoutEffect(() => {
    suspended.current = paused;
    if (paused) pendingFocus.current = null;
  }, [paused]);

  useLayoutEffect(() => {
    viewRevision.current += 1;
  }, [month, selectedDate, calendarView]);

  const focusEditorTitle = () => {
    const title = titleRef.current;
    if (!title) return;
    title.focus({ preventScroll: true });
    scrollVerticallyIntoView(title);
  };

  useLayoutEffect(() => {
    if (paused || !pendingFocus.current) return;
    const target = pendingFocus.current;
    pendingFocus.current = null;
    if (target === 'editor' && mode !== 'idle') {
      focusEditorTitle();
      return;
    }
    if (mode !== 'idle') return;
    if (target === 'saved') {
      dayHeadingRef.current?.focus({ preventScroll: true });
      if (dayHeadingRef.current) scrollVerticallyIntoView(dayHeadingRef.current);
      return;
    }
    const trigger = returnFocusRef.current;
    // A month/list change can remove the original event control while editing.
    // Never restore focus into a hidden or disabled control.
    if (
      trigger?.isConnected &&
      !trigger.closest('[hidden]') &&
      !trigger.matches(':disabled') &&
      window.getComputedStyle(trigger).visibility === 'visible' &&
      isHorizontallyVisible(trigger)
    ) {
      trigger.focus({ preventScroll: true });
      scrollVerticallyIntoView(trigger);
      return;
    }
    const fallback = createButtonRef.current;
    fallback?.focus({ preventScroll: true });
    if (fallback) scrollVerticallyIntoView(fallback);
  }, [paused, mode, editorRevision, month, selectedDate]);

  const revealDayAgenda = useCallback(() => {
    const summary = daySummaryRef.current;
    if (!summary) return;

    const insets = measureStickyInsets();
    scrollVerticallyIntoView(summary, { align: 'start', insets });
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused !== document.body) {
      const { top, bottom } = focused.getBoundingClientRect();
      if (
        top >= insets.top &&
        bottom <= window.innerHeight - insets.bottom &&
        isHorizontallyVisible(focused)
      ) {
        return;
      }
    }
    dayHeadingRef.current?.focus({ preventScroll: true });
  }, []);

  useLayoutEffect(() => {
    const requestedDate = pendingDayReveal.current;
    pendingDayReveal.current = null;
    if (requestedDate && requestedDate === selectedDate && !paused) {
      revealDayAgenda();
    }
  }, [paused, revealDayAgenda, selectedDate, dateRevealRevision]);

  const selectMonthDay = (date: string) => {
    pendingDayReveal.current = date;
    if (date === selectedDate) {
      setDateRevealRevision((revision) => revision + 1);
    } else {
      setSelectedDate(date);
    }
  };

  const showMonthList = () => {
    setSelectedDate('');
    setCalendarView('list');
  };

  const monthEvents = useMemo(
    () => filterPersonalEvents(ledger.records, month),
    [ledger.records, month],
  );
  const events = selectedDate ? personalEventsOnDate(monthEvents, selectedDate) : monthEvents;
  const monthDues = useMemo(
    () => calendarCourseDeadlinesInMonth(dues.uid === dueUid ? dues.items : [], month),
    [dues, dueUid, month],
  );
  const visibleDues = selectedDate
    ? calendarCourseDeadlinesOnDate(dues.uid === dueUid ? dues.items : [], selectedDate)
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

  const mayDiscardDraft = () =>
    mode === 'idle' ||
    !initialDraft ||
    JSON.stringify(draft) === JSON.stringify(initialDraft) ||
    window.confirm('尚有未儲存的修改，要捨棄這些內容嗎？');

  const openCreate = (trigger?: HTMLElement) => {
    if (suspended.current || writing.current) return;
    if (!mayDiscardDraft()) return;
    const next = emptyPersonalEventDraft();
    next.date = selectedDate || (next.date.startsWith(month) ? next.date : `${month}-01`);
    setInitialDraft(next);
    returnFocusRef.current = trigger ?? createButtonRef.current;
    pendingFocus.current = 'editor';
    setEditorRevision((value) => value + 1);
    setMode('create');
    setSelectedId(null);
    setBaseline(null);
    setDraft(next);
    setFormError('');
    setNotice('');
  };

  const openEdit = (row: PersonalImportRecord, trigger?: HTMLElement) => {
    if (suspended.current || writing.current) return;
    if (
      mode === 'edit' &&
      baseline?.id === row.id &&
      JSON.stringify(baseline) === JSON.stringify(row)
    ) {
      focusEditorTitle();
      return;
    }
    if (!mayDiscardDraft()) return;
    const next = draftFromPersonalEvent(row);
    setInitialDraft(next);
    returnFocusRef.current =
      trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    pendingFocus.current = 'editor';
    setEditorRevision((value) => value + 1);
    setMode('edit');
    setSelectedId(row.id);
    setBaseline(row);
    setDraft(next);
    setFormError('');
    setNotice('');
  };

  const cancelForm = () => {
    if (suspended.current || writing.current) return;
    if (!mayDiscardDraft()) return;
    pendingFocus.current = 'return';
    setInitialDraft(null);
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
    const savedFromView = viewRevision.current;
    const preserveMonthList = mode === 'edit' && calendarView === 'list' && !selectedDate;
    writing.current = true;
    setSaving(true);
    setFormError('');
    setNotice('');
    try {
      await action();
      if (!active.current || ticket !== requestId.current || !isActiveScope(scoped)) return;
      // Preserve navigation during the write even if focus has since returned
      // to the body or revalidation has hidden the editor.
      const continueEditingContext =
        savedFromView === viewRevision.current &&
        (suspended.current ||
          editorRef.current?.contains(document.activeElement) ||
          document.activeElement === document.body);
      if (continueEditingContext) {
        setMonth(draft.date.slice(0, 7));
        if (!preserveMonthList) setSelectedDate(draft.date);
        if (!suspended.current) pendingFocus.current = preserveMonthList ? 'return' : 'saved';
      }
      setInitialDraft(null);
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
        if (
          !suspended.current &&
          (editorRef.current?.contains(document.activeElement) ||
            document.activeElement === document.body)
        )
          pendingFocus.current = 'return';
        setInitialDraft(null);
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
    <div className={`${styles.root} ${workspaceStyles.root}`}>
      <section className={`${styles.panel} ${workspaceStyles.panel}`} aria-label="個人行程工作區">
        <div className={`${styles.heading} ${workspaceStyles.heading}`}>
          <div>
            <p className={workspaceStyles.eyebrow}>{context.schoolName}</p>
            <h2>行程與安排</h2>
            <p className={workspaceStyles.subtitle}>選一天，查看行程或加入新的安排。</p>
          </div>
          <div className={styles.actions}>
            <button
              ref={createButtonRef}
              type="button"
              className="btn primary"
              disabled={!canMutate}
              onClick={(event) => openCreate(event.currentTarget)}
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
        <details className={`${styles.source} ${workspaceStyles.storage}`}>
          <summary>儲存與匯入說明</summary>
          <p className={styles.note}>
            這裡是 {context.schoolName}{' '}
            的個人行程，並與手機版一樣顯示已加入課程的作業截止。個人行程不是學校正式紀錄。
            {ledger.ready &&
              (ledger.syncEnabled
                ? personalEventPersistenceCopy(true)
                : '裝置同步尚未開啟。在此頁新增、編輯或刪除的行程會先保留於這台裝置；先前已存入帳號的資料仍以帳號紀錄為準。')}
          </p>
          <p className={styles.note}>
            從檔案匯入或匯出行事曆檔，只是整理自己的安排，不會完成報名，也不會自動設定系統提醒。{' '}
            <Link href={importHref}>從截圖或檔案匯入</Link>
          </p>
        </details>
        {exportNotice && <p role="status">{exportNotice}</p>}
        {!paused && ledger.ready && requestedEventId && (
          <p role="status">
            {linkedEvent
              ? `已定位到「${linkedEvent.title}」。`
              : '在目前帳號與校園的個人行事曆找不到這筆行程；它可能尚未同步或已移除。'}
          </p>
        )}
        <div className={workspaceStyles.toolbar}>
          <CalendarDateField
            className={workspaceStyles.monthField}
            label="查看月份"
            type="month"
            value={month}
            onChange={(value) => {
              if (isCalendarMonth(value)) changeMonth(value);
            }}
          />
          <div className={workspaceStyles.monthNavigation} role="group" aria-label="切換月份">
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
          </div>
          <div className={workspaceStyles.views} role="group" aria-label="檢視方式">
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
              onClick={showMonthList}
            >
              列表
            </button>
          </div>
        </div>
        {!paused && ledger.ready && !ledger.error && calendarView === 'month' && (
          <MonthCalendar
            records={monthEvents}
            month={month}
            selectedDate={selectedDate}
            dateRevealRevision={dateRevealRevision}
            onDate={selectMonthDay}
            onMonthChange={changeMonth}
            onEdit={openEdit}
            disabled={!canMutate}
          />
        )}
        {ledger.error && (
          <p role="alert">
            {ledger.error} 讀取失敗時不會清空或覆寫現有資料；請稍後重試，暫時無法新增或刪除。
          </p>
        )}
        {notice && <p role="status">{notice}</p>}

        {(mode === 'create' || mode === 'edit') && (
          <section
            ref={editorRef}
            className={workspaceStyles.editor}
            aria-label={mode === 'create' ? '新增行程' : '編輯行程'}
            aria-busy={saving || undefined}
          >
            <h3>{mode === 'create' ? '新增行程' : `編輯 ${baseline?.title || '行程'}`}</h3>
            <EventFormFields
              draft={draft}
              titleRef={titleRef}
              disabled={saving || paused}
              onChange={(next) => {
                if (!suspended.current && !writing.current) setDraft(next);
              }}
            />
            {draftIssues.length > 0 &&
              (mode === 'edit' || JSON.stringify(draft) !== JSON.stringify(initialDraft)) && (
                <ul className={styles.issues}>
                  {draftIssues.map((issue) => (
                    <li key={`${issue.code}-${issue.field}`}>{issue.message}</li>
                  ))}
                </ul>
              )}
            {formError && (
              <p id={formErrorId} role="alert">
                {formError}
              </p>
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

        <div>
          {selectedDate && (
            <div className={workspaceStyles.daySummary} ref={daySummaryRef}>
              <div>
                <h3 ref={dayHeadingRef} tabIndex={-1}>
                  {selectedDate} 的行程
                </h3>
                {ledger.ready && (
                  <p>{events.length ? `${events.length} 筆個人行程` : '尚無個人行程'}</p>
                )}
              </div>
              <button type="button" className="btn" onClick={showMonthList}>
                查看整月列表
              </button>
            </div>
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
              {!selectedDate && (
                <>
                  按「新增行程」直接建立，或<Link href={importHref}>從截圖或檔案匯入</Link>。
                </>
              )}
            </p>
          ) : calendarView === 'list' || selectedDate ? (
            <ul className={`${styles.saved} ${workspaceStyles.agenda}`} aria-label="個人行程列表">
              {events.map((event) => (
                <li
                  key={event.id}
                  ref={event.id === requestedEventId ? linkedEventElement : undefined}
                  tabIndex={event.id === requestedEventId ? -1 : undefined}
                  aria-current={event.id === requestedEventId ? 'true' : undefined}
                >
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
                    onClick={(click) => openEdit(event, click.currentTarget)}
                  >
                    編輯
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </section>

      <section
        className={`${styles.panel} ${workspaceStyles.panel}`}
        aria-labelledby="calendar-due-title"
        data-testid="calendar-due"
      >
        <div className={styles.heading}>
          <h2 id="calendar-due-title">{CALENDAR_DUE_TITLE}</h2>
          <Link className="btn" href={todayHref}>
            回今天看期限
          </Link>
        </div>
        {!signedIn && !authLoading && !nuniLoading ? (
          <p className={styles.empty}>
            {CALENDAR_DUE_UNSIGNED} <Link href={todayHref}>前往今天</Link>
          </p>
        ) : !signedIn ||
          dueStatus === 'loading' ||
          dueStatus === 'idle' ||
          authLoading ||
          nuniLoading ? (
          <p role="status">正在讀取作業截止…</p>
        ) : dueStatus === 'error' && visibleDues.length === 0 ? (
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
            <Link href={todayHref}>回今天</Link>
          </p>
        ) : (
          <ul className={styles.saved} data-testid="calendar-due-list">
            {visibleDues.map((item) => (
              <li key={item.id}>
                <div>
                  <time dateTime={item.dueDate}>{item.dueDate}</time>
                  <h3>{item.title}</h3>
                  <p>
                    {item.courseName} · 作業截止 · {item.sourceLabel}
                  </p>
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
