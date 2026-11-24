import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import {
  buildPersonalEventsCalendar,
  personalEventsOnDate,
  shiftCalendarMonth,
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
import { PersonalMonthCalendar } from './PersonalMonthCalendar';
import { Screen, Button } from '../ui/components';
import { theme } from '../ui/theme';
import { usePersonalImportScope } from '../state/personalImportScope';
import { useNuniSession } from '../state/nuniSession';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import {
  appendPersonalImports,
  deletePersonalImport,
  editPersonalImport,
  loadPersonalImports,
  personalImportStorageKey,
  subscribePersonalImports,
  type PersonalImportScope,
  type PersonalImportWriteGuard,
} from '../services/personalImports';
import { shareICalContent } from '../services/ical';
import type { CampusEventCalendarDraft } from '../services/campusEventCalendarDraft';
import { safeNavigate } from '../utils/safeNavigate';
import {
  ALL_DAY_REMINDER_HOUR,
  ALL_DAY_REMINDER_MINUTE,
  PERSONAL_EVENT_REMINDER_DEVICE_NOTE,
  TIMED_LEAD_OPTIONS,
  reminderPreferenceLabel,
  reminderStatusCopy,
  type PersonalEventReminderEntry,
  type TimedLeadMinutes,
} from '../services/personalEventReminderModel';
import {
  PersonalEventReminderJournalCorruptError,
  subscribePersonalEventReminderJournal,
} from '../services/personalEventReminderJournal';
import {
  disablePersonalEventReminder,
  enableAllDayPersonalEventReminder,
  enableTimedPersonalEventReminder,
  listPersonalEventReminderEntries,
  openPersonalReminderSettings,
  reconcilePersonalEventReminders,
  retryPersonalEventReminder,
} from '../services/personalEventReminders';
import {
  clearPersonalEventReminderRuntimeFailure,
  getPersonalEventReminderRuntimeFailure,
  PERSONAL_EVENT_REMINDER_STORAGE_FAILURE_MESSAGE,
  publishPersonalEventReminderRuntimeFailure,
  subscribePersonalEventReminderRuntimeFailure,
  userFacingReminderFailureMessage,
} from '../services/personalEventReminderRuntimeState';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; records: PersonalImportRecord[]; syncEnabled: boolean };

type FocusParams = { eventId?: string } | undefined;

function useCalendarAccount(scope: PersonalImportScope | null) {
  const platform = useNuniSession();
  const legacy = useAuth();
  const firebaseUid = legacy.user?.uid;
  const lastFirebaseUid = useRef(firebaseUid);
  // Firebase and Nuni can resolve independently during an account transition.
  const firebaseChanged =
    !!firebaseUid && !!lastFirebaseUid.current &&
    firebaseUid !== lastFirebaseUid.current;
  const workspaceUid = (scope && firebaseUid) || lastFirebaseUid.current;
  useLayoutEffect(() => {
    if (firebaseUid && (scope || !lastFirebaseUid.current)) lastFirebaseUid.current = firebaseUid;
  }, [firebaseUid, scope]);
  const loggingOut = !!platform.pendingLogout;
  const sessionRejected = !platform.session && !!platform.error;
  const observedOwner = platform.session
    ? `nuni:${platform.session.platformAccountId}`
    : !sessionRejected && firebaseUid
      ? `firebase:${firebaseUid}`
      : null;
  const knownOwner = scope?.owner ?? (firebaseChanged ? null : observedOwner);
  return { knownOwner, loggingOut, sessionRejected, firebaseChanged, workspaceUid };
}

/** A separate stack entry keeps a campus suggestion from replacing an open personal draft. */
export function CampusEventCalendarDraftScreen() {
  const { params } =
    useRoute<
      RouteProp<
        { CampusEventCalendarDraft: { campusEvent: CampusEventCalendarDraft } },
        'CampusEventCalendarDraft'
      >
    >();
  const scope = usePersonalImportScope();
  const { knownOwner, loggingOut, sessionRejected, firebaseChanged } = useCalendarAccount(scope);
  const { school, schoolId, selectionReady } = useSchool();
  const campusEvent = params?.campusEvent;
  const knownSchoolId = school?.id || schoolId || '';
  const schoolCleared = !!selectionReady && !knownSchoolId;
  const schoolChanged =
    !!campusEvent && !!selectionReady && !!knownSchoolId && knownSchoolId !== campusEvent.schoolId;
  const ownerChanged = !!knownOwner && knownOwner !== campusEvent?.owner;
  const scopeChanged =
    !!scope && (scope.owner !== campusEvent?.owner || scope.schoolId !== campusEvent.schoolId);
  const invalidated =
    firebaseChanged || ownerChanged || scopeChanged || schoolChanged || sessionRejected || schoolCleared;
  const expired = useRef(false);
  useLayoutEffect(() => {
    if (invalidated) expired.current = true;
  }, [invalidated]);
  const needsNewDraft = invalidated || expired.current || loggingOut;
  if (!campusEvent?.draft || needsNewDraft) {
    return (
      <Screen>
        <Text style={{ color: theme.colors.text }}>
          {needsNewDraft
            ? '請回到目前校園的活動頁重新開啟草稿。'
            : '正在確認帳號與校園…'}
        </Text>
      </Screen>
    );
  }
  return (
    <PersonalCalendarWorkspace
      key={JSON.stringify([
        campusEvent.owner,
        campusEvent.schoolId,
        campusEvent.source,
        campusEvent.eventId,
      ])}
      scopeKey={personalImportStorageKey(campusEvent)}
      schoolName={school.name}
      initialDraft={campusEvent.draft}
    />
  );
}


function parsePersonalImportKey(key: string): { owner: string; schoolId: string } | null {
  const prefix = 'campus.personal-imports.v1:';
  if (!key.startsWith(prefix)) return null;
  const rest = key.slice(prefix.length);
  const split = rest.lastIndexOf(':');
  if (split <= 0) return null;
  try {
    return {
      owner: decodeURIComponent(rest.slice(0, split)),
      schoolId: decodeURIComponent(rest.slice(split + 1)),
    };
  } catch {
    return null;
  }
}

export default function PersonalCalendarScreen() {
  const scope = usePersonalImportScope();
  const { knownOwner, loggingOut, sessionRejected, firebaseChanged, workspaceUid } =
    useCalendarAccount(scope);
  const { school, schoolId, selectionReady } = useSchool();
  const route = useRoute();
  const key = scope ? personalImportStorageKey(scope) : '';
  const lastReadyKey = useRef(key);
  const knownSchoolId = school?.id || schoolId || '';
  const schoolCleared = !!selectionReady && !knownSchoolId;
  const staleSticky = (() => {
    if (firebaseChanged || loggingOut || sessionRejected || schoolCleared) return true;
    const previous = parsePersonalImportKey(lastReadyKey.current);
    if (!previous) return false;
    if (knownOwner && previous.owner !== knownOwner) return true;
    if (selectionReady && knownSchoolId && previous.schoolId !== knownSchoolId) return true;
    return false;
  })();
  if (key) lastReadyKey.current = key;
  else if (staleSticky) lastReadyKey.current = '';
  // Keep the same workspace through a brief revalidation so an in-flight save
  // can finish or surface an error instead of silently dropping the draft.
  // Logout or a known owner/school switch is not revalidation: drop the sticky
  // key so the previous workspace cannot reappear or accept late reads.
  const workspaceKey = key || (!staleSticky && lastReadyKey.current) || 'pending';
  const focusEventId = (route.params as FocusParams)?.eventId;
  return (
    <PersonalCalendarWorkspace
      key={JSON.stringify([workspaceKey, workspaceUid])}
      scopeKey={workspaceKey === 'pending' ? '' : workspaceKey}
      schoolName={school?.name || '未指定校園'}
      focusEventId={focusEventId}
    />
  );
}

function PersonalCalendarWorkspace({
  scopeKey,
  schoolName,
  focusEventId,
  initialDraft,
}: {
  scopeKey: string;
  schoolName: string;
  focusEventId?: string;
  initialDraft?: PersonalEventDraft;
}) {
  const navigation = useNavigation();
  const scope = usePersonalImportScope();
  const platformSession = useNuniSession();
  const loggingOut = !!platformSession.pendingLogout || (!platformSession.session && !!platformSession.error);
  const active = useRef(true);
  const readSequence = useRef(0);
  const latestRead = useRef({ ledger: 0, reminders: 0 });
  const resolvedKey = scope ? personalImportStorageKey(scope) : '';
  const verifiedKey = resolvedKey === scopeKey && !loggingOut ? resolvedKey : '';
  const currentScope = useRef({ resolvedKey, verifiedKey, loggingOut });
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const ready = load.status === 'ready';
  const ledgerReady = useRef(ready);
  const [month, setMonth] = useState(() =>
    (initialDraft ?? emptyPersonalEventDraft()).date.slice(0, 7),
  );
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
  const [mode, setMode] = useState<'idle' | 'create' | 'edit'>(initialDraft ? 'create' : 'idle');
  const [draft, setDraft] = useState<PersonalEventDraft>(
    () => initialDraft ?? emptyPersonalEventDraft(),
  );
  const [fromCampusEvent, setFromCampusEvent] = useState(!!initialDraft);
  const [baseline, setBaseline] = useState<PersonalImportRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [formError, setFormError] = useState('');
  const [reminders, setReminders] = useState<Record<string, PersonalEventReminderEntry>>({});
  const [reminderBusyId, setReminderBusyId] = useState<string | null>(null);
  const [reminderBlocked, setReminderBlocked] = useState<string | null>(null);
  const focusedOnce = useRef<string | null>(null);

  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    // A return to the same account and school still starts a new verification.
    currentScope.current = { resolvedKey, verifiedKey, loggingOut };
    setReminderBusyId(null);
  }, [resolvedKey, verifiedKey, loggingOut]);

  useLayoutEffect(() => {
    ledgerReady.current = ready;
  }, [ready]);

  const beginVerifiedOperation = useCallback((expected: string) => {
    const verification = currentScope.current;
    if (!active.current || verification.verifiedKey !== expected) return;
    return () => active.current && currentScope.current === verification;
  }, []);

  const beginRead = useCallback((resource: keyof typeof latestRead.current, expected: string) => {
    const isCurrent = beginVerifiedOperation(expected);
    if (!isCurrent) return;
    const sequence = ++readSequence.current;
    latestRead.current[resource] = sequence;
    return () => isCurrent() && latestRead.current[resource] === sequence;
  }, [beginVerifiedOperation]);

  const refreshReminders = useCallback(async () => {
    if (!scope) return;
    const isCurrentRead = beginRead('reminders', personalImportStorageKey(scope));
    if (!isCurrentRead) return;
    try {
      const entries = await listPersonalEventReminderEntries(scope);
      if (!isCurrentRead()) return;
      setReminders(entries);
      const runtime = getPersonalEventReminderRuntimeFailure(scope);
      setReminderBlocked(runtime?.message ?? null);
    } catch (error) {
      if (!isCurrentRead()) return;
      if (error instanceof PersonalEventReminderJournalCorruptError) {
        // Preserve corrupt raw storage; do not replace with empty success.
        setReminderBlocked(reminderStatusCopy('corrupt_blocked'));
        return;
      }
      // Ordinary I/O failure: keep prior entries (desired state) and show retryable error.
      const message = userFacingReminderFailureMessage(error);
      publishPersonalEventReminderRuntimeFailure(scope, message);
      setReminderBlocked(message || PERSONAL_EVENT_REMINDER_STORAGE_FAILURE_MESSAGE);
    }
  }, [beginRead, scope]);

  const refresh = useCallback(async () => {
    if (!active.current) return;
    if (!scope) {
      if (!currentScope.current.verifiedKey) setLoad({ status: 'loading' });
      return;
    }
    const isCurrentRead = beginRead('ledger', personalImportStorageKey(scope));
    if (!isCurrentRead) return;
    try {
      const ledger = await loadPersonalImports(scope);
      if (!isCurrentRead()) return;
      setLoad({
        status: 'ready',
        records: ledger.records,
        syncEnabled: !!ledger.sync?.enabled,
      });
    } catch (error) {
      if (!isCurrentRead()) return;
      setLoad({
        status: 'error',
        message:
          error instanceof Error
            ? error.message
            : '儲存的匯入資料無法讀取，請保留此裝置上的資料並稍後重試。',
      });
    }
    await refreshReminders();
  }, [beginRead, scope, refreshReminders]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      if (!scope) return undefined;
      const unsubLedger = subscribePersonalImports((change) => {
        if (personalImportStorageKey(change.scope) === currentScope.current.verifiedKey) void refresh();
      });
      const unsubJournal = subscribePersonalEventReminderJournal((changed) => {
        if (
          scope &&
          changed.owner === scope.owner &&
          changed.schoolId === scope.schoolId &&
          personalImportStorageKey(scope) === currentScope.current.verifiedKey
        ) {
          void refreshReminders();
        }
      });
      // Runtime failure publication is not a reconcile trigger — UI only.
      const unsubRuntime = subscribePersonalEventReminderRuntimeFailure((failure) => {
        if (!active.current || personalImportStorageKey(scope) !== currentScope.current.verifiedKey) return;
        if (failure && failure.owner === scope.owner && failure.schoolId === scope.schoolId) {
          setReminderBlocked(failure.message);
        } else {
          setReminderBlocked(null);
        }
      });
      return () => {
        unsubLedger();
        unsubJournal();
        unsubRuntime();
      };
    }, [refresh, refreshReminders, scope]),
  );

  const monthEvents = useMemo(
    () => (load.status === 'ready' ? filterPersonalEvents(load.records, month) : []),
    [load, month],
  );
  const events = selectedDate ? personalEventsOnDate(monthEvents, selectedDate) : monthEvents;

  const draftRow = personalEventRowFromDraft(
    draft,
    scope?.schoolId || 'personal',
    mode === 'edit' ? baseline : null,
  );
  const draftIssues = personalEventDraftIssues(draftRow);
  const canMutate = !!verifiedKey && ready && !saving;

  useEffect(() => {
    if (!focusEventId || load.status !== 'ready' || !scope) return;
    if (focusedOnce.current === focusEventId) return;
    const record = load.records.find(
      (row) => row.id === focusEventId && row.kind === 'events' && row.schoolId === scope.schoolId,
    );
    focusedOnce.current = focusEventId;
    if (!record) {
      setNotice('找不到這筆個人行程，可能已刪除、已改期，或屬於其他帳號／校園。');
      return;
    }
    if (record.date && record.date.length >= 7) setMonth(record.date.slice(0, 7));
    setMode('edit');
    setBaseline(record);
    setDraft(draftFromPersonalEvent(record));
    setFormError('');
    setNotice('已開啟指定的個人行程（此裝置）。');
  }, [focusEventId, load, scope]);

  const openCreate = () => {
    setMode('create');
    setBaseline(null);
    setDraft(emptyPersonalEventDraft());
    setFormError('');
    setNotice('');
  };

  const openEdit = (row: PersonalImportRecord) => {
    setMode('edit');
    setBaseline(row);
    setDraft(draftFromPersonalEvent(row));
    setFormError('');
    setNotice('');
  };

  const cancelForm = () => {
    setMode('idle');
    setFromCampusEvent(false);
    setBaseline(null);
    setFormError('');
  };

  const mutationLock = useRef(false);
  const runMutation = async (
    scoped: PersonalImportScope,
    action: (guard: PersonalImportWriteGuard) => Promise<string>,
    confirmationScope?: typeof currentScope.current,
  ) => {
    if (!active.current || mutationLock.current) return;
    const requestedScope = confirmationScope ?? currentScope.current;
    const expected = personalImportStorageKey(scoped);
    if (
      requestedScope !== currentScope.current ||
      requestedScope.verifiedKey !== expected ||
      !ledgerReady.current
    ) {
      setFormError('目前無法確認行事曆可寫入，請稍後再試。');
      return;
    }

    // Only an operation admitted while verified may continue through revalidation.
    const canContinue = () => {
      const latest = currentScope.current;
      return active.current && !latest.loggingOut &&
        (!latest.resolvedKey || latest.resolvedKey === expected);
    };
    // A destructive confirmation belongs to a single uninterrupted verification.
    const guard: PersonalImportWriteGuard = {
      canContinue,
      canCommitFirstWrite: confirmationScope
        ? () => currentScope.current === confirmationScope
        : undefined,
    };
    mutationLock.current = true;
    setSaving(true);
    setFormError('');
    setNotice('');
    try {
      const result = await action(guard);
      if (!canContinue()) return;
      setNotice(result);
      cancelForm();
      setDraft(emptyPersonalEventDraft());
      await refresh();
    } catch (error) {
      if (canContinue()) setFormError(personalEventSaveError(error));
    } finally {
      mutationLock.current = false;
      if (active.current) setSaving(false);
    }
  };

  const saveCreate = () => {
    if (!scope) {
      setFormError('目前無法確認登入狀態，請稍後再儲存。');
      return;
    }
    if (draftIssues.length) {
      setFormError(draftIssues[0].message);
      return;
    }
    void runMutation(scope, async (guard) => {
      const row = personalEventRowFromDraft(draft, scope.schoolId, null);
      const { added } = await appendPersonalImports(scope, [row], guard);
      return added
        ? personalImportSavedNotice(added, load.status === 'ready' && load.syncEnabled)
        : '個人行事曆已經有這筆行程。';
    });
  };

  const saveEdit = () => {
    if (!scope || !baseline) {
      setFormError('目前無法確認登入狀態，請稍後再儲存。');
      return;
    }
    if (draftIssues.length) {
      setFormError(draftIssues[0].message);
      return;
    }
    void runMutation(scope, async (guard) => {
      const row = personalEventRowFromDraft(draft, scope.schoolId, baseline);
      await editPersonalImport(scope, baseline, row, guard);
      return '個人行程已更新。';
    });
  };

  const removeSelected = () => {
    if (!scope || !baseline || !canMutate) return;
    const confirmationScope = currentScope.current;
    Alert.alert('刪除行程？', `確定刪除「${baseline.title}」？刪除後無法復原。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '刪除',
        style: 'destructive',
        onPress: () => {
          void runMutation(
            scope,
            async (guard) => {
              await deletePersonalImport(scope, baseline, guard);
              return '已刪除這筆個人行程。';
            },
            confirmationScope,
          );
        },
      },
    ]);
  };

  const exportRecords = async (target: PersonalImportRecord[], filename: string) => {
    if (load.status !== 'ready' || !scope) return;
    const isCurrent = beginVerifiedOperation(personalImportStorageKey(scope));
    if (!isCurrent) return;
    try {
      const result = buildPersonalEventsCalendar(target, {
        calendarName: `${schoolName} 個人行程`,
      });
      if (!result.eventCount) {
        setNotice('目前沒有可匯出的行程。');
        return;
      }
      await shareICalContent(result.content, filename, isCurrent);
      if (!isCurrent()) return;
      setNotice(personalEventExportNotice(result.eventCount));
    } catch (error) {
      if (!isCurrent()) return;
      setFormError(personalEventSaveError(error));
    }
  };

  /** Always exports the visible month/list filter — never a stale edit selection. */
  const exportCurrentList = () =>
    void exportRecords(
      load.status === 'ready' ? filterPersonalEvents(load.records, month) : [],
      'campus-one-personal-events.ics',
    );

  const exportSelectedOnly = () => {
    if (!baseline || load.status !== 'ready') return;
    void exportRecords(
      load.records.filter((row) => row.id === baseline.id && row.kind === 'events'),
      'campus-one-personal-event.ics',
    );
  };

  const applyReminder = async (
    record: PersonalImportRecord,
    action: (isCurrent: () => boolean) => Promise<{
      entry: PersonalEventReminderEntry;
      permission: { granted: boolean; canAskAgain: boolean; unsupported: boolean };
    }>,
  ) => {
    if (!scope || reminderBusyId) return;
    const isCurrent = beginVerifiedOperation(personalImportStorageKey(scope));
    if (!isCurrent) return;
    setReminderBusyId(record.id);
    setFormError('');
    try {
      const result = await action(isCurrent);
      if (!isCurrent()) return;
      setReminders((prev) => ({ ...prev, [record.id]: result.entry }));
      const statusNote = reminderStatusCopy(result.entry.status, result.entry.lastError);
      // Never claim scheduled/off success after a failed required transition.
      if (
        result.entry.status === 'error' ||
        result.entry.status === 'permission_needed' ||
        result.entry.status === 'limit_deferred' ||
        result.entry.status === 'corrupt_blocked'
      ) {
        setNotice(statusNote);
      } else if (
        result.entry.preference.enabled &&
        !result.permission.granted &&
        !result.permission.unsupported
      ) {
        setNotice(statusNote);
        if (!result.permission.canAskAgain) {
          Alert.alert(
            '此裝置通知已關閉',
            '提醒設定仍保留在此裝置。可到系統設定開啟通知後再重試。',
            [
              { text: '稍後', style: 'cancel' },
              { text: '前往設定', onPress: openPersonalReminderSettings },
            ],
          );
        }
      } else {
        setNotice(statusNote);
      }
      await refreshReminders();
    } catch (error) {
      if (!isCurrent()) return;
      setFormError(error instanceof Error ? error.message : '提醒設定沒有完成，行程本身不受影響。');
    } finally {
      if (isCurrent()) setReminderBusyId(null);
    }
  };

  const field = (
    label: string,
    value: string,
    onChange: (value: string) => void,
    options?: { multiline?: boolean; placeholder?: string },
  ) => (
    <View style={{ gap: 6 }}>
      <Text style={{ color: theme.colors.muted, fontSize: 13 }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        editable={!saving}
        placeholder={options?.placeholder}
        multiline={options?.multiline}
        onChangeText={onChange}
        style={{
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: 8,
          paddingHorizontal: 12,
          paddingVertical: 10,
          color: theme.colors.text,
          backgroundColor: theme.colors.surface,
        }}
      />
    </View>
  );

  const reminderControls = (record: PersonalImportRecord) => {
    const entry = reminders[record.id];
    const enabled = !!entry?.preference.enabled;
    const busy = reminderBusyId === record.id;
    const status = entry ? reminderStatusCopy(entry.status, entry.lastError) : '此裝置提醒：關閉';
    const needsRetry =
      entry &&
      (entry.status === 'error' ||
        entry.status === 'permission_needed' ||
        entry.status === 'pending' ||
        entry.status === 'limit_deferred');

    return (
      <View style={{ gap: 8, marginTop: 8 }} accessibilityLabel={`提醒設定 ${record.title}`}>
        <Text style={{ color: theme.colors.muted, fontSize: 13, lineHeight: 18 }}>
          {PERSONAL_EVENT_REMINDER_DEVICE_NOTE}
        </Text>
        {reminderBlocked ? (
          <View style={{ gap: 8 }}>
            <Text style={{ color: theme.colors.danger, fontSize: 12 }}>{reminderBlocked}</Text>
            <Button
              text="重試提醒同步"
              disabled={!canMutate || busy}
              onPress={() => {
                if (!scope) return;
                const isCurrent = beginVerifiedOperation(personalImportStorageKey(scope));
                if (!isCurrent) return;
                clearPersonalEventReminderRuntimeFailure(scope);
                setReminderBlocked(null);
                void reconcilePersonalEventReminders(scopedCopy(scope), {
                  active: isCurrent,
                })
                  .then(() => {
                    if (isCurrent()) return refreshReminders();
                  })
                  .catch((error) => {
                    if (!isCurrent()) return;
                    const message = userFacingReminderFailureMessage(error);
                    publishPersonalEventReminderRuntimeFailure(scope, message);
                    setReminderBlocked(message);
                  });
              }}
            />
          </View>
        ) : null}
        <Text style={{ color: theme.colors.text, fontSize: 13 }}>
          {entry ? reminderPreferenceLabel(entry.preference) : '此裝置提醒：關閉'}
        </Text>
        <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{status}</Text>
        {record.allDay ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Button
              text={
                enabled
                  ? `關閉此裝置提醒`
                  : `啟用：當天 ${String(ALL_DAY_REMINDER_HOUR).padStart(2, '0')}:${String(ALL_DAY_REMINDER_MINUTE).padStart(2, '0')}（台灣時間）`
              }
              disabled={!canMutate || busy}
              onPress={() => {
                if (!scope) return;
                if (enabled) {
                  void applyReminder(record, (isCurrent) =>
                    disablePersonalEventReminder(scopedCopy(scope), record, isCurrent),
                  );
                } else {
                  void applyReminder(record, (isCurrent) =>
                    enableAllDayPersonalEventReminder(scopedCopy(scope), record, isCurrent),
                  );
                }
              }}
            />
          </View>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {TIMED_LEAD_OPTIONS.map((lead) => {
              const selected =
                enabled &&
                entry?.preference.enabled &&
                entry.preference.mode === 'timed' &&
                entry.preference.leadMinutes === lead;
              const label = lead === 0 ? '開始時' : `提前 ${lead} 分`;
              return (
                <Button
                  key={lead}
                  text={selected ? `✓ ${label}` : label}
                  disabled={!canMutate || busy}
                  onPress={() => {
                    if (!scope) return;
                    void applyReminder(record, (isCurrent) =>
                      enableTimedPersonalEventReminder(
                        scopedCopy(scope),
                        record,
                        lead as TimedLeadMinutes,
                        isCurrent,
                      ),
                    );
                  }}
                />
              );
            })}
            {enabled ? (
              <Button
                text="關閉此裝置提醒"
                disabled={!canMutate || busy}
                onPress={() => {
                  if (!scope) return;
                  void applyReminder(record, (isCurrent) =>
                    disablePersonalEventReminder(scopedCopy(scope), record, isCurrent),
                  );
                }}
              />
            ) : null}
          </View>
        )}
        {needsRetry ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Button
              text="重試此裝置提醒"
              disabled={!canMutate || busy}
              onPress={() => {
                if (!scope) return;
                void applyReminder(record, (isCurrent) =>
                  retryPersonalEventReminder(scopedCopy(scope), record, isCurrent),
                );
              }}
            />
            {Platform.OS !== 'web' ? (
              <Button
                text="開啟系統通知設定"
                disabled={busy}
                onPress={openPersonalReminderSettings}
              />
            ) : null}
          </View>
        ) : null}
      </View>
    );
  };

  // Revalidation may hide an idle unsaved campus draft, but never hide an
  // in-flight save or the error/receipt that tells the user what happened.
  if (initialDraft && !scope && !saving && !formError && !notice) {
    return (
      <Screen>
        <Text style={{ color: theme.colors.muted }}>正在確認帳號與校園…</Text>
      </Screen>
    );
  }
  return (
    <Screen title={initialDraft ? undefined : '個人行事曆'}>
      <ScrollView contentContainerStyle={{ gap: 16, paddingBottom: 40 }}>
        <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
          這裡是 {schoolName} 的個人行程，不是學校正式紀錄。
          {load.status === 'ready'
            ? personalEventPersistenceCopy(load.syncEnabled)
            : '確認帳號與校園後再編輯。'}
        </Text>
        <Text style={{ color: theme.colors.muted, fontSize: 13, lineHeight: 20 }}>
          匯入或匯出行事曆檔只是整理自己的安排，不會完成報名，也不會自動設定提醒。提醒需在此裝置另行開啟。
        </Text>
        {!fromCampusEvent && (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Button text="新增行程" disabled={!canMutate} onPress={openCreate} />
              <Button
                text="從截圖或檔案匯入"
                onPress={() => {
                  safeNavigate(navigation, 'PersonalImport', { kind: 'events' });
                }}
              />
              <Button text="匯出所選月份" disabled={!ready} onPress={exportCurrentList} />
            </View>
            <Text style={{ color: theme.colors.text, fontSize: 18 }}>{month}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Button text="上一月" onPress={() => changeMonth(shiftCalendarMonth(month, -1))} />
              <Button text="回今天" onPress={goToday} />
              <Button text="下一月" onPress={() => changeMonth(shiftCalendarMonth(month, 1))} />
              <Button text="月格" onPress={() => setCalendarView('month')} />
              <Button
                text="列表"
                onPress={() => {
                  setCalendarView('list');
                  setSelectedDate('');
                }}
              />
            </View>
            {ready && calendarView === 'month' ? (
              <PersonalMonthCalendar
                key={month}
                records={monthEvents}
                month={month}
                selectedDate={selectedDate}
                onDate={setSelectedDate}
                onEdit={openEdit}
                disabled={!canMutate}
              />
            ) : null}
            {selectedDate ? (
              <View>
                <Text style={{ color: theme.colors.text }}>{selectedDate} 的行程</Text>
                <Button
                  text="查看整月列表"
                  onPress={() => {
                    setSelectedDate('');
                    setCalendarView('list');
                  }}
                />
              </View>
            ) : null}
          </>
        )}
        {!scope ? <Text style={{ color: theme.colors.muted }}>正在確認帳號…</Text> : null}
        {load.status === 'loading' ? (
          <Text style={{ color: theme.colors.muted }}>正在讀取行程…</Text>
        ) : null}
        {load.status === 'error' ? (
          <>
            <Text style={{ color: theme.colors.danger }}>
              {load.message} 讀取失敗時不會清空或覆寫現有資料；暫時無法新增或刪除。
            </Text>
            <Button text="重試讀取" onPress={() => void refresh()} />
          </>
        ) : null}
        {notice ? <Text style={{ color: theme.colors.accent }}>{notice}</Text> : null}
        {formError ? <Text style={{ color: theme.colors.danger }}>{formError}</Text> : null}

        {(mode === 'create' || mode === 'edit') && (
          <View
            style={{
              gap: 12,
              borderWidth: 1,
              borderColor: theme.colors.border,
              borderRadius: 12,
              padding: 14,
              backgroundColor: theme.colors.surface,
            }}
          >
            <Text style={{ fontSize: 17, fontWeight: '700', color: theme.colors.text }}>
              {fromCampusEvent
                ? '確認活動行程'
                : mode === 'create'
                  ? '新增行程'
                  : `編輯 ${baseline?.title || '行程'}`}
            </Text>
            {fromCampusEvent ? (
              <Text style={{ color: theme.colors.muted }}>
                {initialDraft?.endTime
                  ? '已帶入活動頁公布的資料（台灣時間），可修改後儲存。'
                  : '活動只公布了開始時間（台灣時間）。請填寫你預計離開的時間再儲存。'}
              </Text>
            ) : null}
            {field('標題', draft.title, (title) => setDraft({ ...draft, title }))}
            {field('日期（YYYY-MM-DD）', draft.date, (date) => setDraft({ ...draft, date }))}
            {field(
              draft.allDay ? '結束日期（不含當天，可留空）' : '結束日期（跨日才填）',
              draft.endDate,
              (endDate) => setDraft({ ...draft, endDate }),
            )}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <Text style={{ color: theme.colors.text }}>全天</Text>
              <Switch
                value={draft.allDay}
                disabled={saving}
                onValueChange={(allDay) =>
                  setDraft({
                    ...draft,
                    allDay,
                    ...(allDay
                      ? { startTime: '', endTime: '' }
                      : { startTime: '09:00', endTime: '10:00' }),
                  })
                }
              />
            </View>
            {!draft.allDay ? (
              <>
                {field('開始時間（HH:MM）', draft.startTime, (startTime) =>
                  setDraft({ ...draft, startTime }),
                )}
                {field('結束時間（HH:MM）', draft.endTime, (endTime) =>
                  setDraft({ ...draft, endTime }),
                )}
              </>
            ) : null}
            {field('地點（選填）', draft.location, (location) => setDraft({ ...draft, location }))}
            {draftIssues.map((issue) => (
              <Text key={`${issue.code}-${issue.field}`} style={{ color: theme.colors.danger }}>
                {issue.message}
              </Text>
            ))}
            {mode === 'edit' && baseline ? reminderControls(baseline) : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {mode === 'create' ? (
                <Button
                  text={saving ? '儲存中…' : '儲存行程'}
                  disabled={!canMutate || draftIssues.length > 0}
                  onPress={saveCreate}
                />
              ) : (
                <>
                  <Button
                    text={saving ? '儲存中…' : '儲存修改'}
                    disabled={!canMutate || draftIssues.length > 0}
                    onPress={saveEdit}
                  />
                  <Button text="刪除這筆" disabled={!canMutate} onPress={removeSelected} />
                  <Button text="匯出這筆" disabled={!ready} onPress={exportSelectedOnly} />
                </>
              )}
              <Button text="取消" disabled={saving} onPress={cancelForm} />
            </View>
          </View>
        )}

        {ready && !fromCampusEvent && !events.length ? (
          <Text style={{ color: theme.colors.muted }}>
            {selectedDate ? '這一天還沒有行程。' : '這個月還沒有行程。'}
            按「新增行程」直接建立，或從截圖／檔案匯入。
          </Text>
        ) : null}
        {(calendarView === 'list' || selectedDate ? events : []).map((event) => (
          <Pressable
            key={event.id}
            accessibilityRole="button"
            disabled={!ready || saving}
            onPress={() => openEdit(event)}
            style={{
              gap: 4,
              padding: 14,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: baseline?.id === event.id ? theme.colors.accent : theme.colors.border,
              backgroundColor: theme.colors.surface,
            }}
          >
            <Text style={{ color: theme.colors.muted, fontSize: 13 }}>
              {event.date}
              {event.endDate && event.endDate !== event.date
                ? ` 至 ${event.endDate}${event.allDay ? '（不含結束日）' : ''}`
                : ''}
            </Text>
            <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '600' }}>
              {event.title}
            </Text>
            <Text style={{ color: theme.colors.muted }}>
              {event.allDay ? '全天' : `${event.startTime}–${event.endTime}`} ·{' '}
              {event.location || '地點未填'}
            </Text>
            <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
              {personalEventSourceLabel(event)}
            </Text>
            <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
              {reminders[event.id]
                ? reminderPreferenceLabel(reminders[event.id]!.preference)
                : '此裝置提醒：關閉'}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </Screen>
  );
}

function scopedCopy(scope: { owner: string; schoolId: string }) {
  return { owner: scope.owner, schoolId: scope.schoolId };
}
