import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  applySenseAction,
  formatSenseRecord,
  parseSenseState,
  selectSenseCards,
  serializeSenseState,
  SENSE_CANCEL_ACTION,
  SENSE_EMPTY_TEXT,
  SENSE_HANDLE_CONFIRM,
  SENSE_MOBILE_SAVE_FAILED_TEXT,
  SENSE_SECTION_NOTE,
  SENSE_SECTION_TITLE,
  SENSE_SNOOZE_CONFIRM,
  SENSE_UNSIGNED_TEXT,
  SENSE_UNDO_ACTION,
  senseStorageKey,
  senseTruncationNote,
  undoLastSenseAction,
  type SenseCard,
  type SenseInputItem,
  type SensePhase,
  type SenseState,
} from '@campus/shared/src/todaySense';
import type { InboxTask } from '../data/types';
import { navigateFromInboxTask } from '../services/inboxActions';
import type { CourseNavigationRole } from '../utils/courseNavigation';
import { theme } from '../ui/theme';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';

export function inboxTasksToSenseItems(tasks: InboxTask[]): SenseInputItem[] {
  const items: SenseInputItem[] = [];
  for (const task of tasks) {
    if (task.kind !== 'live' && task.kind !== 'assignment' && task.kind !== 'quiz') continue;
    items.push({
      id: task.id,
      kind: task.kind,
      courseId: task.groupId,
      courseName: task.groupName,
      title: task.title,
      dueAt: task.dueAt ? task.dueAt.toISOString() : null,
    });
  }
  return items;
}

export function TodaySensePanel({
  uid,
  schoolId,
  tasks,
  phase,
  now,
  navigation,
  role,
}: {
  uid?: string | null;
  schoolId?: string | null;
  tasks: InboxTask[];
  phase: SensePhase;
  now: Date | null;
  navigation: Parameters<typeof navigateFromInboxTask>[0];
  role?: CourseNavigationRole;
}) {
  const s = useThemeStyleSheet(createStyles);
  const storageKey = uid ? senseStorageKey(uid, schoolId) : '';
  const [state, setState] = useState<SenseState>(() => parseSenseState(null));
  const [hydrated, setHydrated] = useState(() => !uid);
  const [saveError, setSaveError] = useState(false);
  const [pending, setPending] = useState<{ cardId: string; action: 'handle' | 'snooze' } | null>(
    null,
  );
  const items = useMemo(() => inboxTasksToSenseItems(tasks), [tasks]);

  useEffect(() => {
    let cancelled = false;
    setPending(null);
    setSaveError(false);
    if (!storageKey) {
      setState(parseSenseState(null));
      setHydrated(true);
      return;
    }
    setHydrated(false);
    AsyncStorage.getItem(storageKey)
      .then((raw) => {
        if (!cancelled) {
          setState(parseSenseState(raw));
          setHydrated(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState(parseSenseState(null));
          setHydrated(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  const write = useCallback(
    async (next: SenseState) => {
      if (!storageKey) {
        setState(next);
        setSaveError(false);
        return true;
      }
      try {
        await AsyncStorage.setItem(storageKey, serializeSenseState(next));
      } catch {
        setSaveError(true);
        return false;
      }
      setState(next);
      setSaveError(false);
      return true;
    },
    [storageKey],
  );

  if (phase === 'hidden' || phase === 'loading' || phase === 'error' || !now) return null;
  if (phase === 'ready' && !hydrated) return null;

  const { cards, hiddenCount } =
    phase === 'ready'
      ? selectSenseCards({ now, items, state })
      : { cards: [] as SenseCard[], hiddenCount: 0 };
  const extra = senseTruncationNote(hiddenCount);

  const openCard = (card: SenseCard) => {
    const task = tasks.find((row) => row.id === card.itemId);
    if (task) {
      navigateFromInboxTask(navigation, task, { role, isTeachingRole: false });
    }
  };

  const confirm = (card: SenseCard, action: 'handle' | 'snooze') => {
    void write(applySenseAction(state, action, card, now)).then(() => setPending(null));
  };

  return (
    <View style={s.section}>
      <Text accessibilityRole="header" style={s.title}>
        {SENSE_SECTION_TITLE}
      </Text>
      <Text style={s.note}>{SENSE_SECTION_NOTE}</Text>
      {saveError ? (
        <Text accessibilityRole="alert" style={s.saveError}>
          {SENSE_MOBILE_SAVE_FAILED_TEXT}
        </Text>
      ) : null}
      {phase === 'unsigned' ? (
        <Text style={s.empty}>{SENSE_UNSIGNED_TEXT}</Text>
      ) : cards.length === 0 ? (
        <Text style={s.empty}>{SENSE_EMPTY_TEXT}</Text>
      ) : (
        cards.map((card) => (
          <View key={card.id} style={s.card}>
            <Text style={s.cardTitle}>{card.title}</Text>
            <Text style={s.meta}>{card.courseName}</Text>
            <Text style={s.why}>{card.why}</Text>
            {pending?.cardId === card.id ? (
              <>
                <Text style={s.why}>
                  {card.actions.find((action) => action.id === pending.action)?.preview}
                </Text>
                <View style={s.actions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      pending.action === 'handle' ? SENSE_HANDLE_CONFIRM : SENSE_SNOOZE_CONFIRM
                    }
                    onPress={() => confirm(card, pending.action)}
                    style={s.primary}
                  >
                    <Text style={s.primaryText}>
                      {pending.action === 'handle' ? SENSE_HANDLE_CONFIRM : SENSE_SNOOZE_CONFIRM}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={SENSE_CANCEL_ACTION}
                    onPress={() => setPending(null)}
                  >
                    <Text style={s.link}>{SENSE_CANCEL_ACTION}</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <View style={s.actions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={card.actions[0].label}
                  onPress={() => openCard(card)}
                  style={s.primary}
                >
                  <Text style={s.primaryText}>{card.actions[0].label}</Text>
                </Pressable>
                {card.actions
                  .filter((action) => action.id === 'snooze' || action.id === 'handle')
                  .map((action) => (
                    <Pressable
                      key={action.id}
                      accessibilityRole="button"
                      accessibilityLabel={action.label}
                      onPress={() =>
                        setPending({ cardId: card.id, action: action.id as 'handle' | 'snooze' })
                      }
                    >
                      <Text style={s.link}>{action.label}</Text>
                    </Pressable>
                  ))}
              </View>
            )}
          </View>
        ))
      )}
      {extra ? <Text style={s.note}>{extra}</Text> : null}
      {phase === 'ready' && state.lastRecord ? (
        <View style={s.recordRow}>
          <Text style={s.note}>{formatSenseRecord(state.lastRecord)}</Text>
          {state.lastRecord.reversible ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={SENSE_UNDO_ACTION}
              onPress={() => {
                const result = undoLastSenseAction(state, now);
                if (result.ok) void write(result.state);
              }}
            >
              <Text style={s.link}>{SENSE_UNDO_ACTION}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const createStyles = () =>
  StyleSheet.create({
    section: { marginTop: 8, marginBottom: 8 },
    title: {
      color: theme.colors.text,
      fontSize: 18,
      fontWeight: '600',
      marginTop: 16,
      marginBottom: 8,
    },
    note: { color: theme.colors.muted, fontSize: 12, lineHeight: 20, marginBottom: 10 },
    saveError: { color: theme.colors.danger, fontSize: 13, lineHeight: 22, marginBottom: 10 },
    empty: { color: theme.colors.muted, fontSize: 13, lineHeight: 23, paddingVertical: 8 },
    card: {
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 6,
      padding: 18,
      marginBottom: 10,
    },
    cardTitle: { color: theme.colors.text, fontWeight: '600', fontSize: 16, lineHeight: 24 },
    meta: { color: theme.colors.muted, fontSize: 12, marginTop: 6 },
    why: { color: theme.colors.text, fontSize: 13, lineHeight: 22, marginTop: 10 },
    actions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 12,
      marginTop: 14,
    },
    primary: {
      backgroundColor: theme.colors.accent,
      borderRadius: 4,
      paddingHorizontal: 16,
      paddingVertical: 12,
      minHeight: 44,
      justifyContent: 'center',
    },
    primaryText: { color: theme.colors.onAccent, fontSize: 13, fontWeight: '600' },
    link: {
      color: theme.colors.accent,
      fontWeight: '600',
      fontSize: 13,
      minHeight: 44,
      paddingVertical: 12,
    },
    recordRow: { marginTop: 4 },
  });
