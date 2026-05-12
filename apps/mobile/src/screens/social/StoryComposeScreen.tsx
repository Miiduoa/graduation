/* eslint-disable */
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  Alert,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useAuth } from '../../state/auth';
import { useSchool } from '../../state/school';
import { theme } from '../../ui/theme';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../../ui/navigationTheme';
import { isFirebaseMockMode } from '../../firebase';
import { publishStory } from '../../services/stories';

export function StoryComposeScreen(props: any) {
  const auth = useAuth();
  const { school } = useSchool();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const publish = async () => {
    if (isFirebaseMockMode()) {
      Alert.alert('模擬模式', '無法寫入 Firestore');
      return;
    }
    const uid = auth.user?.uid;
    const sid = school?.id;
    if (!uid || !sid) {
      Alert.alert('請登入並選擇學校');
      return;
    }
    const t = body.trim();
    if (!t) {
      Alert.alert('請輸入文字');
      return;
    }
    setBusy(true);
    try {
      await publishStory({
        schoolId: sid,
        authorUid: uid,
        kind: 'text',
        text: t,
        expiresAtMs: Date.now() + 24 * 3600 * 1000,
      });
      Alert.alert('已發佈', 'Story 將在約 24 小時後過期（依 expiresAt）。', [
        { text: '好的', onPress: () => props?.navigation?.goBack?.() },
      ]);
    } catch (e: any) {
      Alert.alert('失敗', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: theme.colors.bg }}
    >
      <View style={{ padding: 16, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
        <Text style={styles.hint}>純文字 24 小時 Story（之後可加圖片上傳）</Text>
        <TextInput
          value={body}
          onChangeText={setBody}
          multiline
          placeholder="跟大家分享此刻⋯"
          placeholderTextColor={theme.colors.textSecondary}
          style={styles.area}
          maxLength={500}
        />
        <Pressable style={[styles.btn, busy && { opacity: 0.6 }]} disabled={busy} onPress={publish}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnTx}>發佈 Story</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  hint: { color: theme.colors.textSecondary, marginBottom: 12, fontSize: 13 },
  area: {
    minHeight: 160,
    textAlignVertical: 'top',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    padding: 12,
    color: theme.colors.text,
    fontSize: 16,
    backgroundColor: theme.colors.surface,
    marginBottom: 16,
  },
  btn: {
    backgroundColor: theme.colors.accent,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: theme.radius.md,
  },
  btnTx: { color: '#fff', fontWeight: '800', fontSize: 16 },
});

export default StoryComposeScreen;
