import React, { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  CREATOR_CARD_LIMITS, EMPTY_CREATOR_CARD, validateCreatorCard, type CreatorCard,
} from '@campus/shared/src/creatorCard';
import { readCreatorCard, saveCreatorCard } from '../../services/creatorCard';
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
  const [saving, setSaving] = useState(false);
  // A write can succeed while its server confirmation read fails. Avoid
  // automatically sending a second write until the student checks the server.
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  // The ref is authoritative even for callbacks retained from an older render.
  // React state alone can be stale while an uncertain write awaits recheck.
  const needsConfirmationRef = useRef(false);
  const markConfirmationRequired = (required: boolean) => {
    needsConfirmationRef.current = required;
    setNeedsConfirmation(required);
  };
  const savingFlight = useRef(false);
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

  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    void readCreatorCard(schoolId, ownerUid).then((value) => {
      if (live) setState({ status: 'ready', value });
    }).catch(() => {
      if (live) setState({ status: 'error' });
    });
    return () => { live = false; };
  }, [schoolId, ownerUid, attempt]);

  const beginEdit = () => {
    if (!own || state.status !== 'ready') return;
    setDraft(state.value ?? EMPTY_CREATOR_CARD);
    markConfirmationRequired(false);
    setFeedback('');
    setEditing(true);
  };

  const changeDraft = (field: keyof CreatorCard, value: string) => {
    setDraft((previous) => ({ ...previous, [field]: value }));
    markConfirmationRequired(false);
    setFeedback('');
  };

  const confirmPreviousSave = async () => {
    if (!mounted.current || !own || !needsConfirmationRef.current || savingFlight.current || state.status !== 'ready') return;
    savingFlight.current = true;
    setSaving(true);
    setFeedback('');
    try {
      // readCreatorCard is server-only: cached or stale local values cannot
      // claim that an ambiguous prior write was persisted.
      const latest = await readCreatorCard(schoolId, ownerUid);
      if (!mounted.current) return;
      const expected = validateCreatorCard(draft);
      if (latest &&
        latest.headline === expected.headline &&
        latest.bio === expected.bio &&
        latest.linkUrl === expected.linkUrl) {
        currentPortfolioLink.current = latest.linkUrl;
        setLinkError('');
        setState({ status: 'ready', value: latest });
        setEditing(false);
        markConfirmationRequired(false);
        setFeedback('社群簡介已儲存。');
      } else {
        markConfirmationRequired(false);
        setFeedback('伺服器資料與草稿不同，草稿已保留。確認後可重新儲存。');
      }
    } catch {
      if (mounted.current) {
        setFeedback('仍無法核對伺服器資料，草稿已保留，請稍後重試核對。');
      }
    } finally {
      if (mounted.current) {
        savingFlight.current = false;
        setSaving(false);
      }
    }
  };

  const submit = async () => {
    // A synchronous ref guards multiple taps in the same render before React
    // commits the disabled state. A failed write releases it for a real retry.
    if (!mounted.current || !own || needsConfirmationRef.current || needsConfirmation || savingFlight.current || state.status !== 'ready') return;
    savingFlight.current = true;
    setSaving(true);
    setFeedback('');
    markConfirmationRequired(false);
    try {
      const confirmed = await saveCreatorCard(schoolId, ownerUid, draft);
      if (!mounted.current) return;
      currentPortfolioLink.current = confirmed.linkUrl;
      setLinkError('');
      markConfirmationRequired(false);
      setState({ status: 'ready', value: confirmed });
      setEditing(false);
      setFeedback('社群簡介已儲存。');
    } catch (error) {
      if (!mounted.current) return;
      const validationError = error instanceof Error && /最多|HTTPS|有效/.test(error.message);
      markConfirmationRequired(!validationError);
      setFeedback(validationError ? error.message
        : '無法確認簡介是否已儲存，草稿已保留。請先核對伺服器資料，避免重複送出。');
    } finally {
      if (mounted.current) {
        savingFlight.current = false;
        setSaving(false);
      }
    }
  };

  const openPortfolioLink = async (url: string) => {
    // Linking is an OS handoff: even a valid HTTPS URL may be rejected. Prevent
    // a second tap from launching another handoff while the first is pending.
    if (openingLinkFlight.current) return;
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
              onPress={() => { setEditing(false); markConfirmationRequired(false); setFeedback(''); }} />
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
          {!!feedback && <Text accessibilityRole="text" style={styles.success}>{feedback}</Text>}
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
