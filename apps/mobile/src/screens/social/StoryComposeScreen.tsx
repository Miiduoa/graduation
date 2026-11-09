import { claimPrivateFile } from '../../services/privateFiles';
/* eslint-disable */
/**
 * 校園社群 — 發 Story Compose
 *
 * 變更（vs. 舊版）：
 *  - 文字 Story：可選背景色（6 色 palette）
 *  - 圖片 Story：相簿選圖 → 上傳 Firebase Storage → 發佈，圖片可加文字 overlay（描述）
 *  - 自動帶入 POI（從 route.params.poiId / poiName，由 RealtimeSocialScreen 傳入）
 *  - 預覽卡片即時反映選色與內容
 */
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
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
import { useThemeStyleSheet } from '../../ui/useThemeStyleSheet';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../../ui/navigationTheme';
import { isProvidenceSchoolId } from '../../data/schoolIds';
import { findSocialPoi } from '../../services/campusSocialPois';
import { isFirebaseMockMode } from '../../firebase';
import { publishStory, reserveStoryId, type StoryKind } from '../../services/stories';
import { storage } from '../../services/storage';
import { uploadStoryImage, STORY_IMAGE_LIMIT } from '../../services/mediaUpload';

const BG_COLORS = ['#0f172a', '#7c5dfa', '#0ea5e9', '#10b981', '#f97316', '#ef4444'];
const TTL_24H = 24 * 3600 * 1000;
const MAX_TEXT = 220;

export function StoryComposeScreen(props: any) {
  const { user, loading } = useAuth();
  const { school } = useSchool();
  if (loading) return <ActivityIndicator />;
  return <StoryComposer key={JSON.stringify([user?.uid, school?.id])} {...props} />;
}

function StoryComposer(props: any) {
  const styles = useThemeStyleSheet(createStyles);
  const auth = useAuth();
  const { school } = useSchool();
  const initialPoi = isProvidenceSchoolId(school?.id) ? findSocialPoi(props?.route?.params?.poiId) : null;
  const initialPoiId = initialPoi?.id ?? null;
  const initialPoiName = initialPoi?.name ?? null;

  const [kind, setKind] = useState<StoryKind>('text');
  const [body, setBody] = useState('');
  const [bgColor, setBgColor] = useState(BG_COLORS[0]);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageMime, setImageMime] = useState<string | null>(null);
  const [poiId, setPoiId] = useState<string | null>(initialPoiId);
  const [poiName, setPoiName] = useState<string | null>(initialPoiName);
  const [busy, setBusy] = useState(false);

  const publishing = useRef(false);
  const active = useRef(true);
  const draft = useRef<{ id: string; uri: string | null; url: string | null } | null>(null);
  React.useLayoutEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  useEffect(() => {
    if (initialPoiId) setPoiId(initialPoiId);
    if (initialPoiName) setPoiName(initialPoiName);
  }, [initialPoiId, initialPoiName]);

  const pickImage = async () => {
    try {
      const file = await storage.pickImage({ quality: 0.85, aspect: [9, 16] });
      if (!file || !active.current) return;
      if (!file.type?.startsWith('image/') || file.size >= STORY_IMAGE_LIMIT) {
        Alert.alert('無法使用這張照片', '請選擇小於 10 MB 的圖片。');
        return;
      }
      setImageUri(file.uri);
      setImageMime(file.type);
      setKind('image');
    } catch (e: any) {
      Alert.alert('開啟相簿失敗', e?.message ?? String(e));
    }
  };

  const clearImage = () => {
    setImageUri(null);
    setImageMime(null);
    setKind('text');
  };

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
    if (kind === 'text' && !body.trim()) {
      Alert.alert('請輸入文字');
      return;
    }
    if (kind === 'image' && !imageUri) {
      Alert.alert('請選擇圖片');
      return;
    }

    if (publishing.current) return;
    publishing.current = true;
    setBusy(true);
    try {
      const uri = kind === 'image' ? imageUri : null;
      if (!draft.current || draft.current.uri !== uri) {
        draft.current = { id: reserveStoryId(), uri, url: null };
      }
      const entry = draft.current;
      if (uri && !entry.url) {
        entry.url = await uploadStoryImage(sid, entry.id, uid, uri, imageMime ?? '');
      }
      if (entry.url) {
        try { await claimPrivateFile(entry.url, `schools/${sid}/stories/${entry.id}`); }
        catch (error) { if ((error as { statusCode?: number }).statusCode === 410) entry.url = null; throw error; }
      }
      if (!active.current) return;
      await publishStory(entry.id, {
        schoolId: sid,
        authorUid: uid,
        kind,
        text: body.trim(),
        mediaUrl: entry.url,
        bgColor,
        poiId,
        poiName,
        expiresAtMs: Date.now() + TTL_24H,
      });

      if (!active.current) return;
      props?.navigation?.goBack?.();
      Alert.alert('已發布限時動態', '同校成員可在接下來 24 小時內觀看。');
    } catch (e: any) {
      if (!active.current) return;
      publishing.current = false;
      setBusy(false);
      const message = e?.code === 'permission-denied' || e?.code === 'storage/unauthorized'
        ? '目前沒有發布權限，請確認登入帳號與學校。'
        : e?.code || !e?.message ? '請確認網路連線後再試一次，草稿已保留。' : e.message;
      Alert.alert('發布失敗', message);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView pointerEvents={busy ? 'none' : 'auto'} contentContainerStyle={{ padding: 16, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + 32 }}>
        {/* ─── Preview ─── */}
        <Text style={styles.label}>預覽</Text>
        <View style={[styles.preview, { backgroundColor: kind === 'image' ? '#000' : bgColor }]}>
          {kind === 'image' && imageUri ? (
            <Image source={{ uri: imageUri }} style={styles.previewImg} resizeMode="contain" />
          ) : null}
          {body.trim().length > 0 ? (
            <View style={styles.previewTextWrap}>
              <Text style={styles.previewText} numberOfLines={6}>
                {body.trim()}
              </Text>
            </View>
          ) : kind === 'text' ? (
            <View style={styles.previewPlaceholder}>
              <Ionicons name="bulb-outline" size={18} color="rgba(255,255,255,0.8)" />
              <Text style={styles.previewPlaceholderTxt}>內容會即時顯示在這裡</Text>
            </View>
          ) : null}
          {poiName ? (
            <View style={styles.previewPoi}>
              <Ionicons name="location" size={11} color="#fff" />
              <Text style={styles.previewPoiTxt}>{poiName}</Text>
            </View>
          ) : null}
        </View>

        {/* ─── Type selector ─── */}
        <View style={styles.kindRow}>
          <Pressable style={[styles.kindBtn, kind === 'text' && styles.kindBtnOn]} onPress={() => setKind('text')}>
            <Ionicons name="text-outline" size={16} color={kind === 'text' ? theme.colors.onAccent : theme.colors.textSecondary} />
            <Text style={[styles.kindBtnTxt, kind === 'text' && { color: theme.colors.onAccent }]}>文字</Text>
          </Pressable>
          <Pressable style={[styles.kindBtn, kind === 'image' && styles.kindBtnOn]} onPress={pickImage}>
            <Ionicons name="image-outline" size={16} color={kind === 'image' ? theme.colors.onAccent : theme.colors.textSecondary} />
            <Text style={[styles.kindBtnTxt, kind === 'image' && { color: theme.colors.onAccent }]}>
              {imageUri ? '更換圖片' : '選擇圖片'}
            </Text>
          </Pressable>
          {imageUri ? (
            <Pressable style={styles.kindClear} onPress={clearImage}>
              <Ionicons name="trash-outline" size={14} color={theme.colors.danger} />
              <Text style={styles.kindClearTxt}>清除圖片</Text>
            </Pressable>
          ) : null}
        </View>

        {/* ─── BG palette（only for text）─── */}
        {kind === 'text' ? (
          <>
            <Text style={styles.label}>背景色</Text>
            <View style={styles.palette}>
              {BG_COLORS.map((c) => {
                const on = bgColor === c;
                return (
                  <Pressable
                    key={c}
                    onPress={() => setBgColor(c)}
                    style={[styles.swatch, { backgroundColor: c, borderColor: on ? theme.colors.accent : 'rgba(0,0,0,0.15)', borderWidth: on ? 3 : 1 }]}
                    accessibilityLabel={`背景色 ${c}`}
                  />
                );
              })}
            </View>
          </>
        ) : null}

        <Text style={styles.label}>文字內容</Text>
        <TextInput
          value={body}
          onChangeText={(t) => setBody(t.slice(0, MAX_TEXT))}
          multiline
          placeholder={kind === 'image' ? '為這張圖加上一句話（選填）' : '跟大家分享此刻⋯'}
          placeholderTextColor={theme.colors.muted}
          style={styles.area}
        />
        <Text style={styles.counter}>{body.length} / {MAX_TEXT}</Text>

        {poiId ? (
          <View style={styles.poiChip}>
            <Ionicons name="location" size={12} color={theme.colors.accent} />
            <Text style={styles.poiChipTxt}>{poiName ?? poiId}</Text>
            <Pressable onPress={() => { setPoiId(null); setPoiName(null); }} hitSlop={6}>
              <Ionicons name="close-circle" size={14} color={theme.colors.muted} />
            </Pressable>
          </View>
        ) : null}

        <Pressable style={[styles.btn, busy && { opacity: 0.65 }]} disabled={busy} onPress={publish}>
          {busy ? (
            <ActivityIndicator color={theme.colors.onAccent} />
          ) : (
            <Text style={styles.btnTx}>發布限時動態</Text>
          )}
        </Pressable>
        <Text style={styles.hintMuted}>發布後，同校成員可在動態列和「即時」觀看 24 小時。</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const createStyles = () => StyleSheet.create({
  label: { fontSize: 13, fontWeight: '700', color: theme.colors.text, marginTop: 12, marginBottom: 6 },
  counter: { textAlign: 'right', fontSize: 10, color: theme.colors.muted, marginTop: 4 },

  preview: {
    aspectRatio: 9 / 16,
    width: '100%',
    borderRadius: theme.radius.md,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 18,
  },
  previewImg: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  previewTextWrap: { padding: 8 },
  previewText: { fontSize: 22, lineHeight: 32, fontWeight: '700', color: '#fff', textAlign: 'center' },
  previewPlaceholder: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  previewPlaceholderTxt: { color: 'rgba(255,255,255,0.9)', fontSize: 14 },
  previewPoi: {
    position: 'absolute',
    bottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.35)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  previewPoiTxt: { color: '#fff', fontSize: 11, fontWeight: '700' },

  kindRow: { flexDirection: 'row', gap: 8, marginTop: 12, alignItems: 'center' },
  kindBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: theme.colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  kindBtnOn: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
  kindBtnTxt: { color: theme.colors.textSecondary, fontSize: 13, fontWeight: '700' },
  kindClear: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 'auto' },
  kindClearTxt: { color: theme.colors.danger, fontSize: 12, fontWeight: '700' },

  palette: { flexDirection: 'row', gap: 10 },
  swatch: { width: 36, height: 36, borderRadius: 18 },

  area: {
    minHeight: 100,
    textAlignVertical: 'top',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    padding: 12,
    color: theme.colors.text,
    fontSize: 16,
    backgroundColor: theme.colors.surface,
  },

  poiChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: theme.colors.accentSoft ?? 'rgba(124,93,250,0.10)',
    marginTop: 8,
  },
  poiChipTxt: { color: theme.colors.accent, fontSize: 12, fontWeight: '700' },

  btn: {
    backgroundColor: theme.colors.accent,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: theme.radius.md,
    marginTop: 16,
  },
  btnTx: { color: theme.colors.onAccent, fontWeight: '700', fontSize: 16 },
  hintMuted: { fontSize: 11, color: theme.colors.textSecondary, marginTop: 8, textAlign: 'center' },
});

export default StoryComposeScreen;
