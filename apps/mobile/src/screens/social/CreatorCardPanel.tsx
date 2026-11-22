import React, { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  CREATOR_CARD_LIMITS, EMPTY_CREATOR_CARD, validateCreatorCard, type CreatorCard,
} from '@campus/shared/src/creatorCard';
import { readCreatorCard, saveCreatorCard } from '../../services/creatorCard';
import { theme } from '../../ui/theme';
import { useThemeStyleSheet } from '../../ui/useThemeStyleSheet';

const CREATOR_CARD_SAVE_TIMEOUT_MS = 15_000;
const CREATOR_CARD_CONFIRM_TIMEOUT_MS = 15_000;
const CREATOR_CARD_READ_TIMEOUT_MS = 15_000;
const CREATOR_CARD_LINK_TIMEOUT_MS = 15_000;

type CardState =
  | { status: 'loading' }
  | { status: 'error'; timedOut: boolean }
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

type CreatorCardPanelProps = { schoolId: string; ownerUid: string; own: boolean };

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
  const profileReads = useRef({
    pending: 0, latestWasEmpty: false, cardAttempt: -1, closed: false,
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CreatorCard>(EMPTY_CREATOR_CARD);
  const currentDraft = useRef(draft);
  const preserveDraft = useRef(false);
  const replaceDraft = (value: CreatorCard) => {
    currentDraft.current = value;
    setDraft(value);
  };
  const [saving, setSaving] = useState(false);
  // Keep the submitted draft and its normalized server fields until a read
  // resolves the uncertain write. The ref also guards stale button callbacks.
  const pendingWrite = useRef<{ draft: CreatorCard; expected: CreatorCard; confirmationAttempt: number } | null>(null);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const savingFlight = useRef(false);
  const [openingLink, setOpeningLink] = useState(false);
  const openingLinkFlight = useRef<{ url: string } | null>(null);
  const [linkError, setLinkError] = useState('');
  // A pending OS handoff belongs to the URL visible when it was pressed.
  // A later edit may replace that URL before the old handoff rejects.
  const currentPortfolioLink = useRef('');
  const mounted = useRef(false);
  const [feedback, setFeedback] = useState('');
  currentPortfolioLink.current = state.status === 'ready' ? state.value?.linkUrl ?? '' : '';

  const acceptSavedPortfolioLink = (url: string) => {
    if (currentPortfolioLink.current !== url) {
      // A handoff for a replaced URL no longer owns the visible link's busy
      // state. The OS Promise can still resolve, but it must not touch this UI.
      openingLinkFlight.current = null;
      setOpeningLink(false);
    }
    currentPortfolioLink.current = url;
    setLinkError('');
  };

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    const reads = profileReads.current;
    if (reads.closed || reads.cardAttempt >= 0) return;
    let latestAttempt = true;
    reads.pending++;
    reads.latestWasEmpty = false;
    // A server-only read can remain pending indefinitely on a bad connection.
    // Give the student a retry instead of trapping the profile in loading.
    const canApply = () => mounted.current && !reads.closed;
    const canShowError = () => canApply() && latestAttempt && reads.cardAttempt < 0;
    const timeout = setTimeout(() => {
      if (canShowError()) setState({ status: 'error', timedOut: true });
    }, CREATOR_CARD_READ_TIMEOUT_MS);
    void readCreatorCard(schoolId, ownerUid).then((value) => {
      if (!canApply()) return;
      if (value === null) {
        if (latestAttempt) reads.latestWasEmpty = true;
        return;
      }
      if (attempt <= reads.cardAttempt) return;
      reads.cardAttempt = attempt;
      setState({ status: 'ready', value });
    }).catch(() => {
      if (canShowError()) setState({ status: 'error', timedOut: false });
    }).finally(() => {
      clearTimeout(timeout);
      reads.pending--;
      // Only an empty latest read can establish absence, once no outstanding
      // read can still supply a published card.
      if (canApply() && reads.pending === 0 && reads.latestWasEmpty && reads.cardAttempt < 0) {
        setState({ status: 'ready', value: null });
      }
    });
    return () => { latestAttempt = false; clearTimeout(timeout); };
  }, [schoolId, ownerUid, attempt]);

  const beginEdit = () => {
    if (!own || savingFlight.current || state.status !== 'ready') return;
    if (!preserveDraft.current) {
      replaceDraft(state.value ?? EMPTY_CREATOR_CARD);
      setFeedback('');
    }
    setEditing(true);
  };

  const changeDraft = (field: keyof CreatorCard, value: string) => {
    if (currentDraft.current[field] === value) return;
    replaceDraft({ ...currentDraft.current, [field]: value });
    if (!pendingWrite.current) setFeedback('');
  };

  const cancelEdit = () => {
    if (savingFlight.current) return;
    setEditing(false);
    if (!preserveDraft.current && state.status === 'ready') {
      replaceDraft(state.value ?? EMPTY_CREATOR_CARD);
    }
    if (!pendingWrite.current) setFeedback('');
  };

  const confirmPreviousSave = async () => {
    const submitted = pendingWrite.current;
    if (!mounted.current || !own || !submitted || savingFlight.current || state.status !== 'ready') return;
    const attempt = ++submitted.confirmationAttempt;
    const isLatest = () => mounted.current && pendingWrite.current === submitted &&
      submitted.confirmationAttempt === attempt;
    savingFlight.current = true;
    setSaving(true);
    setFeedback('');
    // Keep listening after the UI timeout until a retry supersedes this check.
    const timeout = setTimeout(() => {
      if (!isLatest()) return;
      savingFlight.current = false;
      setSaving(false);
      setFeedback('核對等待逾時，草稿已保留，請重新核對；不會自動再次儲存。');
    }, CREATOR_CARD_CONFIRM_TIMEOUT_MS);
    let latest: CreatorCard | null;
    try {
      latest = await readCreatorCard(schoolId, ownerUid, { requireCommitted: true });
    } catch {
      if (isLatest()) {
        savingFlight.current = false;
        setSaving(false);
        setFeedback('仍無法核對伺服器資料，草稿已保留，請稍後重試核對。');
      }
      return;
    } finally {
      clearTimeout(timeout);
    }

    if (!isLatest()) return;
    const { expected } = submitted;
    const matches = latest && latest.headline === expected.headline &&
      latest.bio === expected.bio && latest.linkUrl === expected.linkUrl;

    pendingWrite.current = null;
    savingFlight.current = false;
    setSaving(false);
    setNeedsConfirmation(false);
    acceptSavedPortfolioLink(latest?.linkUrl ?? '');
    setState({ status: 'ready', value: latest });
    if (matches) {
      finishSave(submitted.draft);
    } else {
      setFeedback('伺服器資料與上次送出的內容不同，草稿已保留。確認後可重新儲存。');
    }
  };

  const finishSave = (submittedDraft: CreatorCard) => {
    // Only the submitted version was confirmed. Edits delivered during
    // confirmation still belong to the draft that the editor must retain.
    preserveDraft.current = currentDraft.current !== submittedDraft;
    if (currentDraft.current === submittedDraft) {
      setEditing(false);
      setFeedback('社群簡介已儲存。');
    } else {
      setFeedback('上一筆已確認儲存，後續修改仍保留在草稿。');
    }
  };

  const submit = async () => {
    if (!mounted.current || !own || pendingWrite.current || savingFlight.current || state.status !== 'ready') return;
    const submittedDraft = currentDraft.current;
    let expected: CreatorCard;
    try {
      expected = validateCreatorCard(submittedDraft);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : '簡介格式有誤，請檢查後重試。');
      return;
    }

    profileReads.current.closed = true;
    savingFlight.current = true;
    setSaving(true);
    setFeedback('');
    const submitted = { draft: submittedDraft, expected, confirmationAttempt: 0 };
    const markUnconfirmed = () => {
      preserveDraft.current = true;
      pendingWrite.current = submitted;
      setNeedsConfirmation(true);
      setFeedback('無法確認簡介是否已儲存，草稿已保留。請先核對伺服器資料，避免重複送出。');
    };
    let timedOut = false;
    // Release the UI while the original save can still confirm this pending write.
    const saveTimeout = setTimeout(() => {
      timedOut = true;
      if (!mounted.current) return;
      markUnconfirmed();
      savingFlight.current = false;
      setSaving(false);
    }, CREATOR_CARD_SAVE_TIMEOUT_MS);
    try {
      const confirmed = await saveCreatorCard(schoolId, ownerUid, submittedDraft);
      if (!mounted.current || (timedOut && pendingWrite.current !== submitted)) return;
      if (timedOut) {
        pendingWrite.current = null;
        savingFlight.current = false;
        setSaving(false);
        setNeedsConfirmation(false);
      }
      acceptSavedPortfolioLink(confirmed.linkUrl);
      setState({ status: 'ready', value: confirmed });
      finishSave(submittedDraft);
    } catch {
      if (mounted.current && !timedOut) markUnconfirmed();
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
      <Text accessibilityRole="alert" style={styles.note}>{state.timedOut
        ? '讀取社群簡介逾時，請重新讀取。'
        : '社群簡介暫時無法讀取。'}</Text>
      <CardButton label="重新讀取社群簡介" onPress={() => setAttempt((n) => n + 1)} />
    </View>
  );
  return (
    <View style={styles.container} accessibilityLabel="社群簡介">
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
            editable={!saving}
          />
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
            editable={!saving}
            textAlignVertical="top"
          />
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
            editable={!saving}
          />
          <Text style={styles.note}>這些內容只會顯示給所屬校園成員，不會帶入學號、電話或校務資料。</Text>
          {!!feedback && <Text accessibilityRole="alert" style={styles.error}>{feedback}</Text>}
          <View style={styles.actions}>
            <CardButton label={saving && !needsConfirmation ? '正在確認儲存…' : '儲存簡介'}
              primary disabled={saving || needsConfirmation} busy={saving}
              onPress={() => void submit()} />
            {needsConfirmation && (
              <CardButton label={saving ? '正在核對伺服器…' : '核對儲存結果'}
                disabled={saving} busy={saving} onPress={() => void confirmPreviousSave()} />
            )}
            <CardButton label="取消編輯" disabled={saving}
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
                label={saving ? '正在核對伺服器…' : '核對儲存結果'}
                disabled={saving}
                busy={saving}
                onPress={() => void confirmPreviousSave()}
              />
            </View>
          )}
          {own && (
            <View style={styles.actions}>
              {!state.value?.headline && !state.value?.bio && !state.value?.linkUrl &&
                <Text style={styles.note}>介紹你的興趣或作品，讓同學更容易認識你。</Text>}
              <CardButton label={state.value ? '編輯社群簡介' : '建立社群簡介'}
                disabled={saving} onPress={beginEdit} />
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
