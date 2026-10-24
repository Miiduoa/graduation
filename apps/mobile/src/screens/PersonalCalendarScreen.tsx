import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import {
  buildPersonalEventsCalendar,
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
import { Screen, Button } from '../ui/components';
import { theme } from '../ui/theme';
import { usePersonalImportScope } from '../state/personalImportScope';
import { useSchool } from '../state/school';
import {
  appendPersonalImports,
  deletePersonalImport,
  editPersonalImport,
  loadPersonalImports,
  personalImportStorageKey,
  subscribePersonalImports,
} from '../services/personalImports';
import { shareICalContent } from '../services/ical';
import { safeNavigate } from '../utils/safeNavigate';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; records: PersonalImportRecord[]; syncEnabled: boolean };

export default function PersonalCalendarScreen() {
  const scope = usePersonalImportScope();
  const { school } = useSchool();
  const key = scope ? personalImportStorageKey(scope) : '';
  return (
    <PersonalCalendarWorkspace
      key={key || 'pending'}
      scopeKey={key}
      schoolName={school?.name || '未指定校園'}
    />
  );
}

function PersonalCalendarWorkspace({
  scopeKey,
  schoolName,
}: {
  scopeKey: string;
  schoolName: string;
}) {
  const navigation = useNavigation();
  const scope = usePersonalImportScope();
  const active = useRef(true);
  const requestId = useRef(0);
  const scopeSnapshot = useRef(scopeKey);
  scopeSnapshot.current = scopeKey;
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [month, setMonth] = useState('');
  const [mode, setMode] = useState<'idle' | 'create' | 'edit'>('idle');
  const [draft, setDraft] = useState<PersonalEventDraft>(() => emptyPersonalEventDraft());
  const [baseline, setBaseline] = useState<PersonalImportRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [formError, setFormError] = useState('');

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!scope) {
      setLoad({ status: 'loading' });
      return;
    }
    const expected = personalImportStorageKey(scope);
    try {
      const ledger = await loadPersonalImports(scope);
      if (!active.current || scopeSnapshot.current !== expected) return;
      setLoad({
        status: 'ready',
        records: ledger.records,
        syncEnabled: !!ledger.sync?.enabled,
      });
    } catch (error) {
      if (!active.current || scopeSnapshot.current !== expected) return;
      setLoad({
        status: 'error',
        message:
          error instanceof Error
            ? error.message
            : '儲存的匯入資料無法讀取，請保留此裝置上的資料並稍後重試。',
      });
    }
  }, [scope]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      if (!scope) return undefined;
      return subscribePersonalImports((change) => {
        if (personalImportStorageKey(change.scope) === scopeSnapshot.current) void refresh();
      });
    }, [refresh, scope]),
  );

  const events = useMemo(
    () => (load.status === 'ready' ? filterPersonalEvents(load.records, month) : []),
    [load, month],
  );
  const draftRow = personalEventRowFromDraft(
    draft,
    scope?.schoolId || 'personal',
    mode === 'edit' ? baseline : null,
  );
  const draftIssues = personalEventDraftIssues(draftRow);
  const ready = load.status === 'ready';
  const canMutate = !!scope && ready && !saving;

  const isActiveScope = () =>
    !!scope && active.current && scopeSnapshot.current === personalImportStorageKey(scope);

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
    setBaseline(null);
    setFormError('');
  };

  const runSave = async (action: () => Promise<void>, success: string) => {
    if (!canMutate || !scope || draftIssues.length) {
      setFormError(draftIssues[0]?.message || '請先確認行程內容。');
      return;
    }
    const ticket = ++requestId.current;
    setSaving(true);
    setFormError('');
    setNotice('');
    try {
      await action();
      if (!isActiveScope() || ticket !== requestId.current) return;
      setNotice(success);
      setMode('idle');
      setBaseline(null);
      setDraft(emptyPersonalEventDraft());
      await refresh();
    } catch (error) {
      if (!isActiveScope() || ticket !== requestId.current) return;
      setFormError(personalEventSaveError(error));
    } finally {
      if (active.current && ticket === requestId.current) setSaving(false);
    }
  };

  const saveCreate = () => {
    if (!scope) return;
    const scoped = { ...scope };
    void runSave(async () => {
      const row = personalEventRowFromDraft(draft, scoped.schoolId, null);
      await appendPersonalImports(scoped, [row], () => isActiveScope());
    }, personalImportSavedNotice(1, load.status === 'ready' && load.syncEnabled));
  };

  const saveEdit = () => {
    if (!scope || !baseline) return;
    const scoped = { ...scope };
    const original = baseline;
    void runSave(async () => {
      const row = personalEventRowFromDraft(draft, scoped.schoolId, original);
      await editPersonalImport(scoped, original, row, () => isActiveScope());
    }, '個人行程已更新。');
  };

  const removeSelected = () => {
    if (!scope || !baseline || !canMutate) return;
    Alert.alert('刪除行程？', `確定刪除「${baseline.title}」？刪除後無法復原。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '刪除',
        style: 'destructive',
        onPress: () => {
          const ticket = ++requestId.current;
          const scoped = { ...scope };
          const original = baseline;
          setSaving(true);
          setFormError('');
          setNotice('');
          void deletePersonalImport(scoped, original, () => isActiveScope())
            .then(async () => {
              if (!isActiveScope() || ticket !== requestId.current) return;
              setNotice('已刪除這筆個人行程。');
              setMode('idle');
              setBaseline(null);
              setDraft(emptyPersonalEventDraft());
              await refresh();
            })
            .catch((error) => {
              if (!isActiveScope() || ticket !== requestId.current) return;
              setFormError(personalEventSaveError(error));
            })
            .finally(() => {
              if (active.current && ticket === requestId.current) setSaving(false);
            });
        },
      },
    ]);
  };

  const exportRecords = async (
    target: PersonalImportRecord[],
    filename: string,
  ) => {
    if (load.status !== 'ready' || !scope) return;
    const scopedKey = personalImportStorageKey(scope);
    try {
      const result = buildPersonalEventsCalendar(target, {
        calendarName: `${schoolName} 個人行程`,
      });
      if (!result.eventCount) {
        setNotice('目前沒有可匯出的行程。');
        return;
      }
      await shareICalContent(result.content, filename, () => isActiveScope() && scopeSnapshot.current === scopedKey);
      if (!isActiveScope() || scopeSnapshot.current !== scopedKey) return;
      setNotice(personalEventExportNotice(result.eventCount));
    } catch (error) {
      if (!isActiveScope() || scopeSnapshot.current !== scopedKey) return;
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

  return (
    <Screen title="個人行事曆">
      <ScrollView contentContainerStyle={{ gap: 16, paddingBottom: 40 }}>
        <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
          這裡是 {schoolName} 的個人行程，不是學校正式紀錄。
          {load.status === 'ready'
            ? personalEventPersistenceCopy(load.syncEnabled)
            : '確認帳號與校園後再編輯。'}
        </Text>
        <Text style={{ color: theme.colors.muted, fontSize: 13, lineHeight: 20 }}>
          匯入或匯出行事曆檔只是整理自己的安排，不會完成報名，也不會自動設定提醒。
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Button text="新增行程" disabled={!canMutate} onPress={openCreate} />
          <Button
            text="從截圖或檔案匯入"
            onPress={() => {
              safeNavigate(navigation, 'PersonalImport', { kind: 'events' });
            }}
          />
          <Button text="匯出目前列表" disabled={!ready} onPress={exportCurrentList} />
          {load.status === 'error' ? (
            <Button
              text="重試讀取"
              onPress={() => {
                void refresh();
              }}
            />
          ) : null}
        </View>
        {field('查看月份（YYYY-MM，可留空）', month, setMonth, { placeholder: '2026-10' })}
        {!scope ? <Text style={{ color: theme.colors.muted }}>正在確認帳號…</Text> : null}
        {load.status === 'loading' ? (
          <Text style={{ color: theme.colors.muted }}>正在讀取行程…</Text>
        ) : null}
        {load.status === 'error' ? (
          <Text style={{ color: theme.colors.danger }}>
            {load.message} 讀取失敗時不會清空或覆寫現有資料；暫時無法新增或刪除。
          </Text>
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
              {mode === 'create' ? '新增行程' : `編輯 ${baseline?.title || '行程'}`}
            </Text>
            {field('標題', draft.title, (title) => setDraft({ ...draft, title }))}
            {field('日期（YYYY-MM-DD）', draft.date, (date) => setDraft({ ...draft, date }))}
            {field(
              draft.allDay ? '結束日期（不含當天，可留空）' : '結束日期（跨日才填）',
              draft.endDate,
              (endDate) => setDraft({ ...draft, endDate }),
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
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

        {ready && !events.length ? (
          <Text style={{ color: theme.colors.muted }}>
            這裡還沒有行程。按「新增行程」直接建立，或從截圖／檔案匯入。
          </Text>
        ) : null}
        {events.map((event) => (
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
              borderColor: theme.colors.border,
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
          </Pressable>
        ))}
      </ScrollView>
    </Screen>
  );
}
