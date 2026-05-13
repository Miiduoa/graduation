/* eslint-disable */
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  Switch,
  Pressable,
  ActivityIndicator,
  Alert,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useAuth } from '../../state/auth';
import { useSchool } from '../../state/school';
import { theme } from '../../ui/theme';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../../ui/navigationTheme';
import { isFirebaseMockMode } from '../../firebase';
import { createCampusPost } from '../../services/feed';
import { getOrCreateBoardAlias } from '../../services/aliasService';
import { listBoards, type CampusBoard } from '../../services/boards';

export function PostComposeScreen(props: any) {
  const auth = useAuth();
  const { school } = useSchool();
  const routeBoardId = props?.route?.params?.boardId as string | undefined;
  const routeDefaultAnon =
    props?.route?.params?.defaultAnonymous === true || props?.route?.params?.defaultAnonymous === false
      ? (props.route.params.defaultAnonymous as boolean)
      : true;

  const [boardId, setBoardId] = useState(routeBoardId ?? '');
  const [boardsPick, setBoardsPick] = useState<CampusBoard[]>([]);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [anonymous, setAnonymous] = useState(routeDefaultAnon);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (routeBoardId || isFirebaseMockMode() || !school?.id) return;
    void (async () => {
      try {
        const rows = await listBoards(school.id, 60);
        setBoardsPick(rows);
      } catch {
        setBoardsPick([]);
      }
    })();
  }, [school?.id, routeBoardId]);

  const submit = async () => {
    if (isFirebaseMockMode()) {
      Alert.alert('模擬模式', 'Firestore 停用中，無法發文。');
      return;
    }
    const uid = auth.user?.uid;
    const sid = school?.id;
    if (!uid || !sid) {
      Alert.alert('無法發文', '請確認已登入且已選擇學校。');
      return;
    }
    const bid = boardId.trim();
    if (!bid) {
      Alert.alert('請選看板或輸入看板 ID');
      return;
    }
    if (!title.trim()) {
      Alert.alert('請填標題', '');
      return;
    }
    if (!content.trim()) {
      Alert.alert('請輸入內文', '');
      return;
    }

    let aliasSnap: string | undefined;
    if (anonymous) {
      try {
        aliasSnap = await getOrCreateBoardAlias(uid, sid, bid);
      } catch {
        aliasSnap = '匿名使用者';
      }
    }

    setSending(true);
    try {
      const postRef = await createCampusPost({
        schoolId: sid,
        boardId: bid,
        title: title.trim(),
        content: content.trim(),
        anonymous,
        ...(anonymous ? { aliasSnapshot: aliasSnap } : { authorUid: uid }),
      });
      try {
        const { emitPostCreated } = await import('../../services/campusEventBus');
        emitPostCreated({ userId: uid, groupId: bid, postId: postRef.id });
      } catch {
        /* optional bus */
      }
      Alert.alert('已發佈', '貼文已送出', [
        {
          text: '好的',
          onPress: () => props?.navigation?.goBack?.(),
        },
      ]);
    } catch (e: any) {
      Alert.alert('發佈失敗', e?.message ?? String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + 32 }}>
        <Text style={styles.label}>看板</Text>
        {!routeBoardId && boardsPick.length > 0 ? (
          <View style={styles.boardChips}>
            {boardsPick.map((b) => {
              const on = boardId === b.id;
              return (
                <Pressable
                  key={b.id}
                  onPress={() => setBoardId(b.id)}
                  style={[styles.chip, on && styles.chipOn]}
                >
                  <Text style={{ color: on ? '#fff' : theme.colors.text, fontWeight: '700', fontSize: 13 }}>
                    {b.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        <Text style={styles.hintMuted}>
          {routeBoardId ? '已鎖定自看板的發文通道' : '可點選看板，或在下欄輸入自訂看板編號'}
        </Text>
        <TextInput
          value={boardId}
          editable={!routeBoardId}
          onChangeText={setBoardId}
          placeholder="看板編號（例：general）"
          style={styles.input}
          placeholderTextColor={theme.colors.textSecondary}
        />

        <View style={styles.row}>
          <Text style={styles.label}>匿名貼文</Text>
          <Switch value={anonymous} onValueChange={setAnonymous} />
        </View>

        <Text style={styles.label}>標題</Text>
        <TextInput value={title} onChangeText={setTitle} style={styles.input} placeholderTextColor={theme.colors.textSecondary} />

        <Text style={styles.label}>內文</Text>
        <TextInput
          value={content}
          onChangeText={setContent}
          multiline
          style={[styles.input, styles.multiline]}
          placeholderTextColor={theme.colors.textSecondary}
        />

        <Pressable
          style={[styles.submit, sending && { opacity: 0.6 }]}
          disabled={sending}
          onPress={() => submit()}
        >
          {sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>發布</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '700', color: theme.colors.text, marginBottom: 6 },
  hintMuted: { fontSize: 12, color: theme.colors.textSecondary, marginBottom: 8 },
  boardChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  chipOn: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    padding: 12,
    color: theme.colors.text,
    marginBottom: 14,
    backgroundColor: theme.colors.surface,
  },
  multiline: { minHeight: 140, textAlignVertical: 'top' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  submit: {
    backgroundColor: theme.colors.accent,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: theme.radius.md,
    marginTop: 8,
  },
  submitText: { color: '#fff', fontWeight: '800', fontSize: 16 },
});

export default PostComposeScreen;
