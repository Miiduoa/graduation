import React, { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  CREATOR_CARD_LIMITS, EMPTY_CREATOR_CARD, type CreatorCard,
} from '@campus/shared/src/creatorCard';
import { readCreatorCard, saveCreatorCard } from '../../services/creatorCard';
import { theme } from '../../ui/theme';
import { useThemeStyleSheet } from '../../ui/useThemeStyleSheet';

type CardState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; value: CreatorCard | null };

function CardButton({ label, onPress, disabled = false, primary = false }: {
  label: string; onPress: () => void; disabled?: boolean; primary?: boolean;
}) {
  const styles = useThemeStyleSheet(createStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, primary && styles.primary,
        (pressed || disabled) && { opacity: 0.6 }]}
    >
      <Text style={[styles.buttonLabel, primary && styles.primaryLabel]}>{label}</Text>
    </Pressable>
  );
}

export function CreatorCardPanel({
  schoolId, ownerUid, own,
}: { schoolId: string; ownerUid: string; own: boolean }) {
  const styles = useThemeStyleSheet(createStyles);
  const [state, setState] = useState<CardState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CreatorCard>(EMPTY_CREATOR_CARD);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');

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
    setFeedback('');
    setEditing(true);
  };

  const submit = async () => {
    if (!own || saving || state.status !== 'ready') return;
    setSaving(true);
    setFeedback('');
    try {
      const confirmed = await saveCreatorCard(schoolId, ownerUid, draft);
      setState({ status: 'ready', value: confirmed });
      setEditing(false);
      setFeedback('社群簡介已儲存。');
    } catch (error) {
      setFeedback(error instanceof Error && /最多|HTTPS|有效/.test(error.message)
        ? error.message
        : '儲存尚未完成，輸入內容已保留，請確認連線及校籍後重試。');
    } finally {
      setSaving(false);
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
            onChangeText={(headline) => setDraft((value) => ({ ...value, headline }))}
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
            onChangeText={(bio) => setDraft((value) => ({ ...value, bio }))}
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
            onChangeText={(linkUrl) => setDraft((value) => ({ ...value, linkUrl }))}
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
            <CardButton label={saving ? '正在確認儲存…' : '儲存簡介'}
              primary disabled={saving} onPress={() => void submit()} />
            <CardButton label="取消編輯" disabled={saving}
              onPress={() => { setEditing(false); setFeedback(''); }} />
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
              onPress={() => void Linking.openURL(state.value!.linkUrl)}
              style={styles.external}
            >
              <Text style={styles.externalText}>查看作品連結</Text>
            </Pressable>
          )}
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
