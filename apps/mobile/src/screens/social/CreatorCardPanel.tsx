import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  CREATOR_CARD_LIMITS, EMPTY_CREATOR_CARD, validateCreatorCard, type CreatorCard,
} from '@campus/shared/src/creatorCard';
import {
  creatorCardFieldMatches, hasHiddenCreatorCardValue,
  readCreatorCard, saveCreatorCard,
} from '../../services/creatorCard';
import { theme } from '../../ui/theme';
import { useThemeStyleSheet } from '../../ui/useThemeStyleSheet';

const CREATOR_CARD_SAVE_TIMEOUT_MS = 15_000;
const CREATOR_CARD_CONFIRM_TIMEOUT_MS = 15_000;
const CREATOR_CARD_LINK_TIMEOUT_MS = 15_000;

const CARD_FIELDS = ['headline', 'bio', 'linkUrl'] as const;

type CardField = keyof CreatorCard;
type FieldRevisions = Partial<Record<CardField, number>>;
type RecoverableDraft = Partial<Record<CardField, {
  value: string; expected: string; revision: number; onlyWhenMissing: boolean;
}>>;
type SubmittedWrite = {
  draft: CreatorCard;
  expected: CreatorCard;
  edits: readonly CardField[];
  revisions: FieldRevisions;
};

type CardState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; value: CreatorCard | null };

function CardButton({ label, onPress, disabled = false, primary = false, busy = false }: {
  label: string; onPress: () => void; disabled?: boolean; primary?: boolean; busy?: boolean;
}) {
  const styles = useThemeStyleSheet(createStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, primary && styles.primary,
        (pressed || disabled) && { opacity: 0.6 }]}
    >
      <Text style={[styles.buttonLabel, primary && styles.primaryLabel]}>{label}</Text>
    </Pressable>
  );
}

type CreatorCardPanelProps = {
  schoolId: string;
  ownerUid: string;
  own: boolean;
};

export function CreatorCardPanel(props: CreatorCardPanelProps) {
  // A new instance per profile/authorization scope prevents old draft, feedback
  // and pending save responses from appearing under another account or school.
  return <ScopedCreatorCardPanel
    key={JSON.stringify([props.schoolId, props.ownerUid, props.own])}
    {...props}
  />;
}

function ScopedCreatorCardPanel({
  schoolId, ownerUid, own,
}: CreatorCardPanelProps) {
  const styles = useThemeStyleSheet(createStyles);
  const [state, setState] = useState<CardState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState(false);
  const editingNow = useRef(false);
  const setEditorOpen = (open: boolean) => {
    editingNow.current = open;
    setEditing(open);
  };
  const currentCard = useRef<CreatorCard | null>(null);
  const [draft, setDraft] = useState<CreatorCard>(EMPTY_CREATOR_CARD);
  const currentDraft = useRef(draft);
  // Keep clear operations even when the field originally displayed as empty.
  const editedFields = useRef(new Set<CardField>());
  // Reverting a value is still a user edit. With no pending write, cancelling
  // rolls field revisions back to the last submission.
  const nextRevision = useRef(0);
  const revisions = useRef<FieldRevisions>({});
  const submittedRevisions = useRef<FieldRevisions>({});
  const [recoverable, setRecoverable] = useState<RecoverableDraft>({});
  const replaceDraft = useCallback((value: CreatorCard) => {
    currentDraft.current = value;
    setDraft(value);
  }, []);
  const [saving, setSaving] = useState(false);
  // Keep the submitted draft and its normalized server fields until a read
  // resolves the uncertain write. The ref also guards stale button callbacks.
  const pendingWrite = useRef<SubmittedWrite | null>(null);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const savingFlight = useRef(false);
  const confirmationFlight = useRef<object | null>(null);
  const [checking, setChecking] = useState(false);
  const editorLocked = () => savingFlight.current || confirmationFlight.current !== null;
  const actionsDisabled = saving || checking;
  const [openingLink, setOpeningLink] = useState(false);
  const openingLinkFlight = useRef<{ url: string } | null>(null);
  const [linkError, setLinkError] = useState('');
  // A pending OS handoff belongs to the URL visible when it was pressed.
  // A later edit may replace that URL before the old handoff rejects.
  const currentPortfolioLink = useRef('');
  const mounted = useRef(false);
  const [feedback, setFeedback] = useState('');
  currentPortfolioLink.current = state.status === 'ready' ? state.value?.linkUrl ?? '' : '';

  const acceptSavedPortfolioLink = useCallback((url: string) => {
    if (currentPortfolioLink.current !== url) {
      // A handoff for a replaced URL no longer owns the visible link's busy
      // state. The OS Promise can still resolve, but it must not touch this UI.
      openingLinkFlight.current = null;
      setOpeningLink(false);
    }
    currentPortfolioLink.current = url;
    setLinkError('');
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const acceptCard = useCallback((value: CreatorCard | null) => {
    currentCard.current = value;
    acceptSavedPortfolioLink(value?.linkUrl ?? '');
    setState({ status: 'ready', value });
  }, [acceptSavedPortfolioLink]);

  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    void readCreatorCard(schoolId, ownerUid, { requireCommitted: true }).then((value) => {
      if (live) acceptCard(value);
    }).catch(() => {
      if (live) setState({ status: 'error' });
    });
    return () => { live = false; };
  }, [schoolId, ownerUid, attempt, acceptCard]);

  const beginEdit = () => {
    if (!own || editorLocked() || state.status !== 'ready') return;
    if (!pendingWrite.current) {
      editedFields.current.clear();
      replaceDraft(state.value ?? EMPTY_CREATOR_CARD);
      setFeedback('');
    }
    setEditorOpen(true);
  };

  const changeDraft = (field: keyof CreatorCard, value: string) => {
    // Native text events queued before the inputs were disabled can still arrive.
    if (!editingNow.current) return;
    if (currentDraft.current[field] === value &&
      (value !== '' || !currentCard.current || !hasHiddenCreatorCardValue(currentCard.current, field))) return;
    revisions.current[field] = ++nextRevision.current;
    if (value && value === currentCard.current?.[field] && !savingFlight.current && !pendingWrite.current) {
      editedFields.current.delete(field);
    } else {
      editedFields.current.add(field);
    }
    replaceDraft({ ...currentDraft.current, [field]: value });
    if (!pendingWrite.current) setFeedback('');
  };

  const cancelEdit = () => {
    if (editorLocked()) return;
    setEditorOpen(false);
    if (pendingWrite.current) return;
    revisions.current = { ...submittedRevisions.current };
    editedFields.current.clear();
    replaceDraft(currentCard.current ?? EMPTY_CREATOR_CARD);
    setFeedback('');
  };

  const settleWrite = (submitted: SubmittedWrite, latest: CreatorCard | null, manual: boolean) => {
    const matches = latest && CARD_FIELDS.every((field) =>
      creatorCardFieldMatches(latest, field, submitted.expected[field]));
    if (!matches && !manual) {
      setNeedsConfirmation(true);
      setFeedback('伺服器資料與上次送出的內容不同。草稿已保留，請先核對伺服器資料，避免重複送出。');
      return;
    }
    const snapshot = currentDraft.current;
    const activeEdits = editedFields.current;
    if (!matches) {
      for (const field of submitted.edits) activeEdits.add(field);
    }

    const unconfirmed: RecoverableDraft = {};
    for (const field of CARD_FIELDS) {
      const edited = activeEdits.has(field);
      if (latest && !edited) continue;
      const value = snapshot[field];
      unconfirmed[field] = {
        value,
        expected: value === submitted.draft[field] ? submitted.expected[field] : value,
        revision: revisions.current[field] ?? 0,
        onlyWhenMissing: !edited,
      };
    }

    pendingWrite.current = null;
    setNeedsConfirmation(false);
    if (matches) {
      finishSave(latest, submitted);
    } else {
      acceptCard(latest);
      setFeedback(Object.keys(unconfirmed).length
        ? '伺服器資料與上次送出的內容不同。草稿已保留，可在編輯時還原。'
        : '伺服器資料與上次送出的內容不同，已載入最新資料。');
    }
    setRecoverable((previous) => {
      const nextRecoverable = { ...previous };
      for (const field of CARD_FIELDS) {
        const entry = unconfirmed[field];
        if (entry && (!entry.onlyWhenMissing || !previous[field])) nextRecoverable[field] = entry;
      }
      return nextRecoverable;
    });
    if (!editingNow.current) activeEdits.clear();
  };

  const checkServer = async (
    submitted: SubmittedWrite, read: () => Promise<CreatorCard | null>, manual = false,
  ) => {
    // The read started after acknowledgement owns confirmation over an older manual read.
    const check = {};
    confirmationFlight.current = check;
    const isCurrent = () => mounted.current && pendingWrite.current === submitted &&
      confirmationFlight.current === check;
    setChecking(true);
    const timeout = manual ? setTimeout(() => {
      if (isCurrent()) setFeedback('核對等待逾時，草稿已保留，仍在等待伺服器回應。');
    }, CREATOR_CARD_CONFIRM_TIMEOUT_MS) : undefined;

    try {
      const latest = await read();
      if (isCurrent()) settleWrite(submitted, latest, manual);
      return latest;
    } catch (error) {
      if (isCurrent() && (manual || !savingFlight.current)) {
        setFeedback('仍無法核對伺服器資料，草稿已保留，請稍後重試核對。');
      }
      throw error;
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      if (confirmationFlight.current === check) {
        confirmationFlight.current = null;
        if (mounted.current) setChecking(false);
      }
    }
  };

  const confirmPreviousSave = async () => {
    const submitted = pendingWrite.current;
    if (!mounted.current || !own || !submitted || editorLocked() || state.status !== 'ready') return;
    setFeedback('');
    try {
      await checkServer(submitted,
        () => readCreatorCard(schoolId, ownerUid, { requireCommitted: true }), true);
    } catch {
      // The pending write stays blocked until a server check succeeds.
    }
  };

  const restorableEntry = (field: CardField) => {
    const entry = recoverable[field];
    return entry && (!entry.onlyWhenMissing || currentCard.current === null) &&
      (revisions.current[field] ?? 0) <= entry.revision ? entry : undefined;
  };

  const restoreDraft = () => {
    if (!editingNow.current || editorLocked() || pendingWrite.current) return;
    const next = { ...currentDraft.current };
    let restored = false;
    for (const field of CARD_FIELDS) {
      const entry = restorableEntry(field);
      if (!entry) continue;
      restored = true;
      next[field] = entry.value;
      editedFields.current.add(field);
    }
    if (!restored) return;
    replaceDraft(next);
    setFeedback('已還原未確認的草稿，請核對內容後再儲存。');
  };

  const finishSave = (confirmed: CreatorCard, submitted: SubmittedWrite) => {
    const hasLaterEdits = editedFields.current.size > 0;
    if (!hasLaterEdits) setEditorOpen(false);
    acceptCard(confirmed);
    setRecoverable((previous) => {
      const remaining = { ...previous };
      for (const field of CARD_FIELDS) {
        const entry = remaining[field];
        if (entry && (submitted.edits.includes(field) ||
          creatorCardFieldMatches(confirmed, field, entry.expected))) delete remaining[field];
      }
      return remaining;
    });
    setFeedback(hasLaterEdits
      ? '上一筆已確認儲存，後續修改仍保留在草稿。'
      : '社群簡介已儲存。');
  };

  const submit = async () => {
    if (!mounted.current || !own || !editingNow.current || pendingWrite.current || editorLocked() || state.status !== 'ready') return;
    const submittedDraft = currentDraft.current;
    let expected: CreatorCard;
    try {
      expected = validateCreatorCard(submittedDraft);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : '簡介格式有誤，請檢查後重試。');
      return;
    }

    const base = currentCard.current;
    const edits = CARD_FIELDS.filter((field) => editedFields.current.has(field) &&
      (!base || base[field] !== expected[field] ||
        (expected[field] === '' && hasHiddenCreatorCardValue(base, field))));
    editedFields.current.clear();
    savingFlight.current = true;
    setSaving(true);
    setFeedback('');
    const submitted: SubmittedWrite = {
      draft: submittedDraft, expected, edits,
      revisions: { ...revisions.current },
    };
    for (const field of edits) {
      submittedRevisions.current[field] = submitted.revisions[field];
    }
    pendingWrite.current = submitted;
    const markUnconfirmed = () => {
      setNeedsConfirmation(true);
      setFeedback('無法確認簡介是否已儲存，草稿已保留。請先核對伺服器資料，避免重複送出。');
    };
    let timedOut = false;
    let readCompleted = false;
    // Allow manual verification after timeout once any active server read settles.
    const saveTimeout = setTimeout(() => {
      timedOut = true;
      if (!mounted.current) return;
      markUnconfirmed();
      savingFlight.current = false;
      setSaving(false);
    }, CREATOR_CARD_SAVE_TIMEOUT_MS);
    try {
      const confirmed = await saveCreatorCard(schoolId, ownerUid, submittedDraft,
        (read) => {
          if (!mounted.current || pendingWrite.current !== submitted) {
            throw new Error('Creator card save superseded');
          }
          return checkServer(submitted, read).then((latest) => {
            readCompleted = true;
            return latest;
          });
        });
      if (mounted.current && pendingWrite.current === submitted) {
        pendingWrite.current = null;
        setNeedsConfirmation(false);
        finishSave(confirmed, submitted);
      }
    } catch {
      if (mounted.current && !timedOut && !readCompleted && pendingWrite.current === submitted) markUnconfirmed();
    } finally {
      clearTimeout(saveTimeout);
      if (mounted.current && !timedOut) {
        savingFlight.current = false;
        setSaving(false);
      }
    }
  };

  const openPortfolioLink = async (url: string) => {
    // One handoff per currently visible URL. When a newly saved URL replaces
    // it, the old unresolved OS Promise loses ownership of the busy state.
    if (openingLinkFlight.current) return;
    const handoff = { url };
    openingLinkFlight.current = handoff;
    setOpeningLink(true);
    setLinkError('');
    let openTimeout: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
      // The OS may never settle this handoff. Bound only the visible busy
      // state: timeout does not cancel openURL or prove the browser stayed
      // closed. The student must explicitly decide whether to try again.
      await Promise.race([
        Linking.openURL(url),
        new Promise<never>((_, reject) => {
          openTimeout = setTimeout(() => {
            timedOut = true;
            reject(new Error('Creator portfolio link handoff timed out'));
          }, CREATOR_CARD_LINK_TIMEOUT_MS);
        }),
      ]);
    } catch {
      if (mounted.current && openingLinkFlight.current === handoff &&
        currentPortfolioLink.current === url) {
        setLinkError(timedOut
          ? '開啟作品連結等待逾時，請先確認瀏覽器是否已開啟，再決定是否重試。'
          : '無法開啟作品連結，請稍後再試。');
      }
    } finally {
      if (openTimeout !== undefined) clearTimeout(openTimeout);
      if (mounted.current && openingLinkFlight.current === handoff) {
        openingLinkFlight.current = null;
        setOpeningLink(false);
      }
    }
  };

  if (state.status === 'loading') return (
    <View style={styles.container}>
      <Text accessibilityRole="text" style={styles.note}>正在讀取社群簡介…</Text>
    </View>
  );
  if (state.status === 'error') return (
    <View style={styles.container}>
      <Text accessibilityRole="alert" style={styles.note}>社群簡介暫時無法讀取。</Text>
      <CardButton label="重新讀取社群簡介" onPress={() => {
        setState({ status: 'loading' });
        setAttempt((n) => n + 1);
      }} />
    </View>
  );
  return (
    <View style={styles.container} accessibilityLabel="社群簡介">
      {checking && <Text accessibilityRole="text" style={styles.note}>核對中</Text>}
      {editing ? (
        <View style={styles.editor}>
          <Text style={styles.label}>一句話介紹 · {draft.headline.length}/{CREATOR_CARD_LIMITS.headline}</Text>
          <TextInput
            accessibilityLabel="一句話介紹"
            value={draft.headline}
            onChangeText={(headline) => changeDraft('headline', headline)}
            maxLength={CREATOR_CARD_LIMITS.headline}
            placeholder="例如：記錄校園日常的攝影愛好者"
            placeholderTextColor={theme.colors.textSecondary}
            style={styles.input}
            editable={!actionsDisabled}
          />
          {state.value && hasHiddenCreatorCardValue(state.value, 'headline') && (
            <CardButton label="清除舊一句話介紹" disabled={actionsDisabled}
              onPress={() => changeDraft('headline', '')} />
          )}
          <Text style={styles.label}>個人簡介 · {draft.bio.length}/{CREATOR_CARD_LIMITS.bio}</Text>
          <TextInput
            accessibilityLabel="個人簡介"
            value={draft.bio}
            onChangeText={(bio) => changeDraft('bio', bio)}
            multiline
            maxLength={CREATOR_CARD_LIMITS.bio}
            placeholder="分享興趣、社團、作品或你想和同學交流的事。"
            placeholderTextColor={theme.colors.textSecondary}
            style={[styles.input, styles.bioInput]}
            editable={!actionsDisabled}
            textAlignVertical="top"
          />
          {state.value && hasHiddenCreatorCardValue(state.value, 'bio') && (
            <CardButton label="清除舊個人簡介" disabled={actionsDisabled}
              onPress={() => changeDraft('bio', '')} />
          )}
          <Text style={styles.label}>作品連結（選填）</Text>
          <TextInput
            accessibilityLabel="作品連結"
            value={draft.linkUrl}
            onChangeText={(linkUrl) => changeDraft('linkUrl', linkUrl)}
            maxLength={CREATOR_CARD_LIMITS.linkUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://"
            placeholderTextColor={theme.colors.textSecondary}
            style={styles.input}
            editable={!actionsDisabled}
          />
          {state.value && hasHiddenCreatorCardValue(state.value, 'linkUrl') && (
            <CardButton label="清除舊作品連結" disabled={actionsDisabled}
              onPress={() => changeDraft('linkUrl', '')} />
          )}
          <Text style={styles.note}>這些內容只會顯示給所屬校園成員，不會帶入學號、電話或校務資料。</Text>
          {!needsConfirmation && CARD_FIELDS.some(restorableEntry) && (
            <CardButton label="還原未確認的草稿" disabled={actionsDisabled} onPress={restoreDraft} />
          )}
          {!!feedback && <Text accessibilityRole="alert" style={styles.error}>{feedback}</Text>}
          <View style={styles.actions}>
            <CardButton label={saving && !needsConfirmation ? '正在確認儲存…' : '儲存簡介'}
              primary disabled={actionsDisabled || needsConfirmation} busy={actionsDisabled}
              onPress={() => void submit()} />
            {needsConfirmation && (
              <CardButton label={checking ? '正在核對伺服器…' : '核對儲存結果'}
                disabled={actionsDisabled} busy={checking} onPress={() => void confirmPreviousSave()} />
            )}
            <CardButton label="取消編輯" disabled={actionsDisabled}
              onPress={cancelEdit} />
          </View>
        </View>
      ) : (
        <View>
          {!!state.value?.headline && <Text style={styles.headline}>{state.value.headline}</Text>}
          {!!state.value?.bio && <Text style={styles.bio}>{state.value.bio}</Text>}
          {!!state.value?.linkUrl && (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="查看作品連結"
              accessibilityState={{ disabled: openingLink, busy: openingLink }}
              disabled={openingLink}
              onPress={() => void openPortfolioLink(state.value!.linkUrl)}
              style={styles.external}
            >
              <Text style={styles.externalText}>查看作品連結</Text>
            </Pressable>
          )}
          {!!linkError && <Text accessibilityRole="alert" style={styles.error}>{linkError}</Text>}
          {own && needsConfirmation && (
            <View style={styles.pendingReview}>
              <Text accessibilityRole="alert" style={styles.error}>
                儲存結果尚未確認。{feedback || '草稿已保留，請先核對伺服器資料。'}
              </Text>
              <CardButton
                label={checking ? '正在核對伺服器…' : '核對儲存結果'}
                disabled={actionsDisabled}
                busy={checking}
                onPress={() => void confirmPreviousSave()}
              />
            </View>
          )}
          {own && (
            <View style={styles.actions}>
              {!state.value?.headline && !state.value?.bio && !state.value?.linkUrl &&
                <Text style={styles.note}>介紹你的興趣或作品，讓同學更容易認識你。</Text>}
              <CardButton label={state.value ? '編輯社群簡介' : '建立社群簡介'}
                disabled={actionsDisabled} onPress={beginEdit} />
            </View>
          )}
          {!needsConfirmation && !!feedback && <Text accessibilityRole="text" style={styles.success}>{feedback}</Text>}
        </View>
      )}
    </View>
  );
}

const createStyles = () => StyleSheet.create({
  container: { marginTop: 18, minWidth: 0 },
  editor: { gap: 9 },
  label: { fontSize: 13, fontWeight: '600', color: theme.colors.text },
  headline: { fontSize: 15, fontWeight: '700', lineHeight: 23, color: theme.colors.text, marginBottom: 7 },
  bio: { fontSize: 14, lineHeight: 22, color: theme.colors.text },
  note: { color: theme.colors.textSecondary, fontSize: 12, lineHeight: 19 },
  input: {
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface, color: theme.colors.text,
    borderRadius: 10, minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14,
  },
  bioInput: { height: 108 },
  pendingReview: { marginTop: 12, gap: 10, alignItems: 'flex-start', minWidth: 0 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 9, marginTop: 12 },
  button: {
    minHeight: 44, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border,
    borderRadius: 10, backgroundColor: theme.colors.surface,
  },
  primary: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
  buttonLabel: { color: theme.colors.text, fontSize: 14, fontWeight: '600' },
  primaryLabel: { color: theme.colors.onAccent },
  external: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center' },
  externalText: { fontSize: 14, color: theme.colors.accent, textDecorationLine: 'underline' },
  error: { color: theme.colors.danger, fontSize: 13, lineHeight: 19 },
  success: { color: theme.colors.textSecondary, fontSize: 13, marginTop: 8 },
});
