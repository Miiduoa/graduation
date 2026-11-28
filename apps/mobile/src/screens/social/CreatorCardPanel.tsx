import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  CREATOR_CARD_LIMITS, EMPTY_CREATOR_CARD, validateCreatorCard, type CreatorCard,
} from '@campus/shared/src/creatorCard';
import { isCreatorCardAccessDenied, readCreatorCard, saveCreatorCard } from '../../services/creatorCard';
import { theme } from '../../ui/theme';
import { useThemeStyleSheet } from '../../ui/useThemeStyleSheet';

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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CreatorCard>(EMPTY_CREATOR_CARD);
  const currentDraft = useRef(draft);
  const replaceDraft = (value: CreatorCard) => {
    currentDraft.current = value;
    setDraft(value);
  };
  const [saving, setSaving] = useState(false);
  // Keep the submitted draft and its normalized server fields until a read
  // resolves the uncertain write. The ref also guards stale button callbacks.
  const pendingWrite = useRef<{ draft: CreatorCard; expected: CreatorCard } | null>(null);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const savingFlight = useRef<object | null>(null);
  const readBlocked = useRef(false);
  const cardVersion = useRef(0);
  const [openingLink, setOpeningLink] = useState(false);
  const openingLinkFlight = useRef(false);
  const [linkError, setLinkError] = useState('');
  // A pending OS handoff belongs to the URL visible when it was pressed.
  // A later edit may replace that URL before the old handoff rejects.
  const currentPortfolioLink = useRef('');
  const mounted = useRef(false);
  const [feedback, setFeedback] = useState('');
  currentPortfolioLink.current = state.status === 'ready' ? state.value?.linkUrl ?? '' : '';

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const blockDeniedRead = useCallback((error: unknown) => {
    const invalidScope = error instanceof Error && error.message === 'Creator card scope mismatch';
    if (!isCreatorCardAccessDenied(error) && !invalidScope) return false;
    readBlocked.current = true;
    currentPortfolioLink.current = '';
    setLinkError('');
    if (pendingWrite.current) setNeedsConfirmation(true);
    setState({ status: 'error' });
    return true;
  }, []);

  const acceptCard = useCallback((value: CreatorCard | null) => {
    if (readBlocked.current) return;
    cardVersion.current += 1;
    currentPortfolioLink.current = value?.linkUrl ?? '';
    setLinkError('');
    setState({ status: 'ready', value });
  }, []);

  useEffect(() => {
    let live = true;
    const version = cardVersion.current;
    setState({ status: 'loading' });
    void readCreatorCard(schoolId, ownerUid).then((value) => {
      if (!live || cardVersion.current !== version) return;
      // An explicit fresh display read can restore access. Its contents never
      // settle the separate pending write, even when they match the draft.
      readBlocked.current = false;
      acceptCard(value);
    }).catch((error: unknown) => {
      if (!live) return;
      if (blockDeniedRead(error) || cardVersion.current !== version) return;
      setState({ status: 'error' });
    });
    return () => { live = false; };
  }, [schoolId, ownerUid, attempt, acceptCard, blockDeniedRead]);

  const beginEdit = () => {
    if (!own || readBlocked.current || savingFlight.current || state.status !== 'ready') return;
    if (!pendingWrite.current) {
      replaceDraft(state.value ?? EMPTY_CREATOR_CARD);
      setFeedback('');
    }
    setEditing(true);
  };

  const changeDraft = (field: keyof CreatorCard, value: string) => {
    replaceDraft({ ...currentDraft.current, [field]: value });
    if (!pendingWrite.current) setFeedback('');
  };

  const cancelEdit = () => {
    if (savingFlight.current) return;
    setEditing(false);
    if (!pendingWrite.current) setFeedback('');
  };

  const confirmPreviousSave = async () => {
    const submitted = pendingWrite.current;
    if (!mounted.current || !own || !submitted || readBlocked.current || savingFlight.current || state.status !== 'ready') return;
    const operation = {};
    savingFlight.current = operation;
    setSaving(true);
    setFeedback('');
    let latest: CreatorCard | null;
    try {
      latest = await readCreatorCard(schoolId, ownerUid, { requireCommitted: true });
    } catch (error) {
      if (mounted.current && pendingWrite.current === submitted && savingFlight.current === operation) {
        blockDeniedRead(error);
        setFeedback('仍無法核對伺服器資料，草稿已保留，請稍後重試核對。');
      }
      return;
    } finally {
      if (mounted.current && savingFlight.current === operation) {
        savingFlight.current = null;
        setSaving(false);
      }
    }
    if (!mounted.current || pendingWrite.current !== submitted || readBlocked.current) return;

    acceptCard(latest);
    pendingWrite.current = null;
    setNeedsConfirmation(false);
    const { expected } = submitted;
    if (latest && latest.headline === expected.headline &&
      latest.bio === expected.bio && latest.linkUrl === expected.linkUrl) {
      finishSave(submitted.draft);
    } else {
      setFeedback('伺服器資料與上次送出的內容不同，草稿已保留。確認後可重新儲存。');
    }
  };

  const finishSave = (submittedDraft: CreatorCard) => {
    if (currentDraft.current === submittedDraft) {
      setEditing(false);
      setFeedback('社群簡介已儲存。');
    } else {
      setFeedback('上一筆已確認儲存，後續修改仍保留在草稿。');
    }
  };

  const submit = async () => {
    if (!mounted.current || !own || readBlocked.current || pendingWrite.current || savingFlight.current || state.status !== 'ready') return;
    const submittedDraft = currentDraft.current;
    let expected: CreatorCard;
    try {
      expected = validateCreatorCard(submittedDraft);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : '簡介格式有誤，請檢查後重試。');
      return;
    }

    const submitted = { draft: submittedDraft, expected };
    const operation = {};
    // Own this write before sending it, including the time its Promise has
    // not settled. Tab changes and ordinary reads cannot release this ticket.
    pendingWrite.current = submitted;
    savingFlight.current = operation;
    setSaving(true);
    setFeedback('');
    try {
      const confirmed = await saveCreatorCard(schoolId, ownerUid, submittedDraft);
      if (!mounted.current || pendingWrite.current !== submitted || readBlocked.current) return;
      acceptCard(confirmed);
      pendingWrite.current = null;
      setNeedsConfirmation(false);
      finishSave(submittedDraft);
    } catch (error) {
      if (!mounted.current || pendingWrite.current !== submitted || savingFlight.current !== operation) return;
      blockDeniedRead(error);
      setNeedsConfirmation(true);
      setFeedback('無法確認簡介是否已儲存，草稿已保留。請先核對伺服器資料，避免重複送出。');
    } finally {
      if (mounted.current && savingFlight.current === operation) {
        savingFlight.current = null;
        setSaving(false);
      }
    }
  };

  const openPortfolioLink = async (url: string) => {
    // Linking is an OS handoff: even a valid HTTPS URL may be rejected. Prevent
    // a second tap from launching another handoff while the first is pending.
    if (!mounted.current || readBlocked.current || currentPortfolioLink.current !== url || openingLinkFlight.current) return;
    openingLinkFlight.current = true;
    setOpeningLink(true);
    setLinkError('');
    try {
      await Linking.openURL(url);
    } catch {
      if (mounted.current && currentPortfolioLink.current === url) {
        setLinkError('無法開啟作品連結，請稍後再試。');
      }
    } finally {
      if (mounted.current) {
        openingLinkFlight.current = false;
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
          {own && (
            <View style={styles.actions}>
              {!state.value?.headline && !state.value?.bio && !state.value?.linkUrl &&
                <Text style={styles.note}>介紹你的興趣或作品，讓同學更容易認識你。</Text>}
              <CardButton label={state.value ? '編輯社群簡介' : '建立社群簡介'} onPress={beginEdit} />
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
