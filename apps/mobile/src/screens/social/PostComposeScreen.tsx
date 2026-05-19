/* eslint-disable */
/**
 * 校園社群 — 發文 Compose
 *
 * 變更（vs. 舊版）：
 *  - 加入圖片附件（最多 4 張）：透過 storage.pickImage → uploadCampusMedia 寫 Firebase Storage
 *  - 加入標籤輸入（逗號分隔、最多 5 個）
 *  - 顯示已選看板的「預設匿名」chip，並依此 default 預填 anonymous switch
 *  - 內文字數限制與顯示 counter
 *
 * 維持：
 *  - createCampusPost 既有寫入格式
 *  - emitPostCreated 通知校園事件匯流
 *  - 匿名時用 getOrCreateBoardAlias 取 stable alias
 */
import React, { useState, useEffect, useMemo } from 'react';
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
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../state/auth';
import { useSchool } from '../../state/school';
import { theme } from '../../ui/theme';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../../ui/navigationTheme';
import { isFirebaseMockMode } from '../../firebase';
import { createCampusPost } from '../../services/feed';
import { getOrCreateBoardAlias } from '../../services/aliasService';
import {
  listBoards,
  CAMPUS_BOARD_TYPE_LABEL,
  type CampusBoard,
  type CampusBoardType,
} from '../../services/boards';
import { storage } from '../../services/storage';
import { uploadCampusMedia } from '../../services/campusMedia';

const MAX_MEDIA = 4;
const MAX_TITLE = 60;
const MAX_BODY = 1500;
const MAX_TAGS = 5;

type LocalDraft = {
  uri: string;
  width?: number;
  height?: number;
  mime?: string;
  uploaded?: string;
  uploading?: boolean;
};

export function PostComposeScreen(props: any) {
  const auth = useAuth();
  const { school } = useSchool();
  const routeBoardId = props?.route?.params?.boardId as string | undefined;
  const routeDefaultAnon =
    props?.route?.params?.defaultAnonymous === true || props?.route?.params?.defaultAnonymous === false
      ? (props.route.params.defaultAnonymous as boolean)
      : true;

  const [boardId, setBoardId] = useState(routeBoardId ?? '');
  const [boards, setBoards] = useState<CampusBoard[]>([]);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [anonymous, setAnonymous] = useState(routeDefaultAnon);
  const [tagsRaw, setTagsRaw] = useState('');
  const [drafts, setDrafts] = useState<LocalDraft[]>([]);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (isFirebaseMockMode() || !school?.id) return;
    void (async () => {
      try {
        const rows = await listBoards(school.id, 80);
        setBoards(rows);
      } catch {
        setBoards([]);
      }
    })();
  }, [school?.id]);

  const selectedBoard = useMemo(() => boards.find((b) => b.id === boardId), [boards, boardId]);

  useEffect(() => {
    if (selectedBoard?.defaultAnonymous != null) {
      setAnonymous(selectedBoard.defaultAnonymous);
    }
  }, [selectedBoard?.defaultAnonymous]);

  const pickImage = async () => {
    if (drafts.length >= MAX_MEDIA) {
      Alert.alert('已達上限', `最多上傳 ${MAX_MEDIA} 張`);
      return;
    }
    try {
      const file = await storage.pickImage({ quality: 0.85 });
      if (!file) return;
      setDrafts((prev) => [
        ...prev,
        { uri: file.uri, mime: file.type, uploading: false },
      ]);
    } catch (e: any) {
      Alert.alert('開啟相簿失敗', e?.message ?? String(e));
    }
  };

  const removeDraft = (uri: string) => {
    setDrafts((prev) => prev.filter((d) => d.uri !== uri));
  };

  const uploadDrafts = async (uid: string, sid: string): Promise<string[]> => {
    const out: string[] = [];
    for (let i = 0; i < drafts.length; i++) {
      const d = drafts[i];
      if (d.uploaded) {
        out.push(d.uploaded);
        continue;
      }
      // mark uploading
      setDrafts((prev) => prev.map((x) => (x.uri === d.uri ? { ...x, uploading: true } : x)));
      try {
        const res = await uploadCampusMedia({
          scope: 'posts',
          schoolId: sid,
          uid,
          uri: d.uri,
          mime: d.mime,
        });
        out.push(res.url);
        setDrafts((prev) =>
          prev.map((x) => (x.uri === d.uri ? { ...x, uploaded: res.url, uploading: false } : x)),
        );
      } catch (e: any) {
        setDrafts((prev) => prev.map((x) => (x.uri === d.uri ? { ...x, uploading: false } : x)));
        throw e;
      }
    }
    return out;
  };

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
      Alert.alert('請填標題');
      return;
    }
    if (!content.trim() && drafts.length === 0) {
      Alert.alert('請輸入內文或加入至少一張圖');
      return;
    }
    const tags = tagsRaw
      .split(/[,，、\s]+/)
      .map((t) => t.trim().replace(/^#/, ''))
      .filter(Boolean)
      .slice(0, MAX_TAGS);

    setSending(true);
    try {
      let mediaUrls: string[] = [];
      if (drafts.length > 0) {
        mediaUrls = await uploadDrafts(uid, sid);
      }

      let aliasSnap: string | undefined;
      if (anonymous) {
        try {
          aliasSnap = await getOrCreateBoardAlias(uid, sid, bid);
        } catch {
          aliasSnap = '匿名使用者';
        }
      }

      const postRef = await createCampusPost({
        schoolId: sid,
        boardId: bid,
        title: title.trim(),
        content: content.trim(),
        anonymous,
        tags,
        mediaUrls,
        ...(anonymous ? { aliasSnapshot: aliasSnap } : { authorUid: uid }),
      });
      try {
        const { emitPostCreated } = await import('../../services/campusEventBus');
        emitPostCreated({ userId: uid, groupId: bid, postId: postRef.id });
      } catch {
        /* bus is optional */
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
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + 32 }}>
        <Text style={styles.label}>看板</Text>
        {!routeBoardId && boards.length > 0 ? (
          <View style={styles.boardChips}>
            {boards.map((b) => {
              const on = boardId === b.id;
              return (
                <Pressable key={b.id} onPress={() => setBoardId(b.id)} style={[styles.chip, on && styles.chipOn]}>
                  <Text style={[styles.chipTxt, on && { color: theme.colors.onAccent }]}>{b.name}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        <Text style={styles.hintMuted}>
          {routeBoardId ? '已鎖定看板' : '從上方點選看板，或直接輸入看板 ID'}
        </Text>
        <TextInput
          value={boardId}
          editable={!routeBoardId}
          onChangeText={setBoardId}
          placeholder="看板編號（例：general）"
          style={styles.input}
          placeholderTextColor={theme.colors.muted}
        />
        {selectedBoard ? (
          <View style={styles.boardMeta}>
            <Text style={styles.boardMetaTxt}>
              {CAMPUS_BOARD_TYPE_LABEL[(selectedBoard.type ?? 'topic') as CampusBoardType]}板
              {selectedBoard.defaultAnonymous ? ' · 預設匿名' : ''}
            </Text>
          </View>
        ) : null}

        <View style={styles.row}>
          <Text style={styles.label}>匿名貼文</Text>
          <Switch value={anonymous} onValueChange={setAnonymous} />
        </View>

        <Text style={styles.label}>標題</Text>
        <TextInput
          value={title}
          onChangeText={(t) => setTitle(t.slice(0, MAX_TITLE))}
          placeholder="一句話描述你的貼文"
          placeholderTextColor={theme.colors.muted}
          style={styles.input}
        />
        <Text style={styles.counter}>{title.length} / {MAX_TITLE}</Text>

        <Text style={styles.label}>內文</Text>
        <TextInput
          value={content}
          onChangeText={(t) => setContent(t.slice(0, MAX_BODY))}
          multiline
          placeholder="想分享什麼？"
          placeholderTextColor={theme.colors.muted}
          style={[styles.input, styles.multiline]}
        />
        <Text style={styles.counter}>{content.length} / {MAX_BODY}</Text>

        <Text style={styles.label}>圖片（最多 {MAX_MEDIA} 張）</Text>
        <View style={styles.mediaWrap}>
          {drafts.map((d) => (
            <View key={d.uri} style={styles.mediaCell}>
              <Image source={{ uri: d.uri }} style={styles.mediaImg} />
              {d.uploading ? (
                <View style={styles.mediaOverlay}>
                  <ActivityIndicator color={theme.colors.onAccent} />
                </View>
              ) : null}
              <Pressable hitSlop={6} style={styles.mediaRemove} onPress={() => removeDraft(d.uri)}>
                <Ionicons name="close" size={14} color="#fff" />
              </Pressable>
            </View>
          ))}
          {drafts.length < MAX_MEDIA ? (
            <Pressable style={styles.mediaAdd} onPress={pickImage} accessibilityLabel="加入圖片">
              <Ionicons name="image-outline" size={24} color={theme.colors.textSecondary} />
              <Text style={styles.mediaAddTxt}>+ 圖片</Text>
            </Pressable>
          ) : null}
        </View>

        <Text style={styles.label}>標籤（逗號分隔，最多 {MAX_TAGS} 個）</Text>
        <TextInput
          value={tagsRaw}
          onChangeText={setTagsRaw}
          placeholder="例：分享, 學期心得, #程設"
          placeholderTextColor={theme.colors.muted}
          style={styles.input}
        />

        <Pressable
          style={[styles.submit, sending && { opacity: 0.65 }]}
          disabled={sending}
          onPress={submit}
          accessibilityRole="button"
        >
          {sending ? (
            <ActivityIndicator color={theme.colors.onAccent} />
          ) : (
            <Text style={styles.submitText}>發布</Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '700', color: theme.colors.text, marginTop: 14, marginBottom: 6 },
  hintMuted: { fontSize: 12, color: theme.colors.textSecondary, marginBottom: 8 },
  counter: { textAlign: 'right', fontSize: 10, color: theme.colors.muted, marginTop: 4 },

  boardChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  chipOn: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
  chipTxt: { color: theme.colors.text, fontWeight: '700', fontSize: 13 },

  boardMeta: {
    backgroundColor: theme.colors.accentSoft ?? 'rgba(124,93,250,0.10)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    marginBottom: 6,
    marginTop: 6,
    alignSelf: 'flex-start',
  },
  boardMetaTxt: { color: theme.colors.accent, fontSize: 11, fontWeight: '700' },

  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: theme.colors.text,
    backgroundColor: theme.colors.surface,
  },
  multiline: { minHeight: 160, textAlignVertical: 'top' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 },

  mediaWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  mediaCell: {
    width: 80,
    height: 80,
    borderRadius: theme.radius.sm,
    overflow: 'hidden',
    backgroundColor: theme.colors.surface,
  },
  mediaImg: { width: '100%', height: '100%' },
  mediaOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaAdd: {
    width: 80,
    height: 80,
    borderRadius: theme.radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  mediaAddTxt: { fontSize: 11, color: theme.colors.textSecondary, fontWeight: '700' },

  submit: {
    backgroundColor: theme.colors.accent,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: theme.radius.md,
    marginTop: 18,
  },
  submitText: { color: theme.colors.onAccent, fontWeight: '700', fontSize: 16 },
});

export default PostComposeScreen;
