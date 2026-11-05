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
  Switch,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import { STORY_VIDEO_CONTENT_TYPE, STORY_VIDEO_MAX_BYTES } from '@campus/shared/src/storyVideo';
import { StoryVideoPlayer, supportsStoryVideo } from './StoryVideoPlayer';
import { VideoExportPreset } from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../state/auth';
import { useSchool } from '../../state/school';
import { theme } from '../../ui/theme';
import { useThemeStyleSheet } from '../../ui/useThemeStyleSheet';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../../ui/navigationTheme';
import { isProvidenceSchoolId } from '../../data/schoolIds';
import { findSocialPoi } from '../../services/campusSocialPois';
import { isFirebaseMockMode } from '../../firebase';
import { publishStory, reserveStoryId } from '../../services/stories';
import { storage } from '../../services/storage';
import { uploadStoryImage, uploadStoryVideo, STORY_IMAGE_LIMIT, STORY_VIDEO_MAX_MS } from '../../services/mediaUpload';

const BG_COLORS = ['#0f172a', '#7c5dfa', '#0ea5e9', '#10b981', '#f97316', '#ef4444'];
const TTL_24H = 24 * 3600 * 1000;
const MAX_TEXT = 220;
type Attachment = { kind: 'image'; uri: string; mime: string } | { kind: 'video'; uri: string; durationMs: number; selection: number };

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

  const [media, setMedia] = useState<Attachment | null>(null);
  const [candidate, setCandidate] = useState<{ uri: string; selection: number } | null>(null);
  const selection = useRef(0);
  const kind = candidate ? 'video' : media?.kind ?? 'text';
  const videoKey = candidate?.selection ?? (media?.kind === 'video' ? media.selection : undefined);
  const videoUri = candidate?.uri ?? (media?.kind === 'video' ? media.uri : null);
  const [body, setBody] = useState('');
  const [allowReplies, setAllowReplies] = useState(true);
  const [bgColor, setBgColor] = useState(BG_COLORS[0]);
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

  const pick = async (type: 'image' | 'video') => {
    if (publishing.current) return;
    if (type === 'video' && !supportsStoryVideo) {
      Alert.alert('影片功能需要更新', '請更新 App，再選擇影片。');
      return;
    }
    const seq = ++selection.current;
    setCandidate(null);
    try {
      const file = await storage.pickImage(type === 'image'
        ? { quality: 0.85, aspect: [9, 16] }
        : { mediaTypes: 'videos', videoExportPreset: VideoExportPreset.H264_1280x720 });
      if (!file || !active.current || selection.current !== seq || publishing.current) return;
      if (type === 'image') {
        if (!file.type?.startsWith('image/') || file.size >= STORY_IMAGE_LIMIT) {
          Alert.alert('無法使用這張照片', '請選擇小於 10 MB 的圖片。');
          return;
        }
        draft.current = null;
        setMedia({ kind: 'image', uri: file.uri, mime: file.type });
      } else if (file.type !== STORY_VIDEO_CONTENT_TYPE || file.size >= STORY_VIDEO_MAX_BYTES || (file.durationMs ?? 0) > STORY_VIDEO_MAX_MS) {
        Alert.alert('無法使用這段影片', '請選擇 30 秒以內、小於 100 MB 的 MP4 影片。');
      } else {
        setCandidate({ uri: file.uri, selection: seq });
      }
    } catch (e: any) {
      if (active.current && selection.current === seq) Alert.alert('開啟相簿失敗', e?.message ?? String(e));
    }
  };

  function rejectCandidate(seq: number) {
    if (!active.current || selection.current !== seq) return;
    selection.current++;
    setCandidate(null);
    Alert.alert('無法使用這段影片', '請選擇可播放、30 秒以內的 MP4 影片。');
  }

  useEffect(() => {
    if (!candidate) return;
    // Audio-only and damaged files may never produce a video frame.
    const timer = setTimeout(() => rejectCandidate(candidate.selection), 15_000);
    return () => clearTimeout(timer);
  }, [candidate]);

  function clearMedia() {
    selection.current++;
    draft.current = null;
    setCandidate(null);
    setMedia(null);
  }

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
    if (candidate || publishing.current) return;
    publishing.current = true;
    setBusy(true);
    try {
      const uri = media?.uri ?? null;
      if (!draft.current || draft.current.uri !== uri) {
        draft.current = { id: reserveStoryId(), uri, url: null };
      }
      const entry = draft.current;
      if (media && !entry.url) {
        entry.url = media.kind === 'video'
          ? await uploadStoryVideo(sid, entry.id, uid, media.uri, media.durationMs)
          : await uploadStoryImage(sid, entry.id, uid, media.uri, media.mime);
      }
      if (!active.current) return;
      await publishStory(entry.id, {
        allowReplies,
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
        {/* ─── Type selector ─── */}
        <View style={styles.kindRow}>
          <Pressable style={[styles.kindBtn, kind === 'text' && styles.kindBtnOn]} disabled={busy} onPress={clearMedia}>
            <Ionicons name="text-outline" size={16} color={kind === 'text' ? theme.colors.onAccent : theme.colors.textSecondary} />
            <Text style={[styles.kindBtnTxt, kind === 'text' && { color: theme.colors.onAccent }]}>文字</Text>
          </Pressable>
          <Pressable style={[styles.kindBtn, kind === 'image' && styles.kindBtnOn]} disabled={busy} onPress={() => pick('image')}>
            <Ionicons name="image-outline" size={16} color={kind === 'image' ? theme.colors.onAccent : theme.colors.textSecondary} />
            <Text style={[styles.kindBtnTxt, kind === 'image' && { color: theme.colors.onAccent }]}>
              {kind === 'image' ? '更換圖片' : '選擇圖片'}
            </Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={busy} style={[styles.kindBtn, kind === 'video' && styles.kindBtnOn]} onPress={() => pick('video')}>
            <Ionicons name="videocam-outline" size={16} color={kind === 'video' ? theme.colors.onAccent : theme.colors.textSecondary} />
            <Text style={[styles.kindBtnTxt, kind === 'video' && { color: theme.colors.onAccent }]}>{kind === 'video' ? '更換影片' : '選擇影片'}</Text>
          </Pressable>
          {kind !== 'text' ? (
            <Pressable style={styles.kindClear} disabled={busy} onPress={clearMedia}>
              <Ionicons name="trash-outline" size={14} color={theme.colors.danger} />
              <Text style={styles.kindClearTxt}>{kind === 'video' ? '移除影片' : '清除圖片'}</Text>
            </Pressable>
          ) : null}
        </View>

        <Text style={styles.hintMuted} accessibilityLiveRegion="polite">
          {candidate ? '正在確認影片長度與畫面…' : media?.kind === 'video' ? `影片長度 ${Math.ceil(media.durationMs / 1000)} 秒` : '影片支援 30 秒以內、小於 100 MB 的 MP4。'}
        </Text>

        {/* ─── Preview ─── */}
        <Text style={styles.label}>預覽</Text>
        <View style={[styles.preview, kind === 'video' && styles.previewClip, { backgroundColor: kind === 'text' ? bgColor : '#000' }]}>
          {kind === 'image' && media?.kind === 'image' ? (
            <Image source={{ uri: media.uri }} style={styles.previewImg} resizeMode="contain" />
          ) : null}
          {videoUri && (
            <StoryVideoPlayer key={videoKey} source={{ uri: videoUri }}
              style={styles.previewImg}
              accessibilityLabel="影片預覽" useNativeControls={!candidate} isMuted
              onReadyForDisplay={({ naturalSize, status }) => {
                if (!candidate || !active.current || selection.current !== candidate.selection) return;
                const durationMs = status?.isLoaded ? status.durationMillis : undefined;
                if (!durationMs || !Number.isFinite(durationMs) || durationMs > STORY_VIDEO_MAX_MS ||
                    durationMs <= 0 || !naturalSize.width || !naturalSize.height) {
                  rejectCandidate(candidate.selection);
                  return;
                }
                selection.current++;
                draft.current = null;
                setMedia({ kind: 'video', ...candidate, durationMs });
                setCandidate(null);
              }}
              onError={() => { if (candidate) rejectCandidate(candidate.selection); }}
            />
          )}
          {kind !== 'video' && body.trim().length > 0 ? (
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

        {kind === 'video' && !!body.trim() && <Text style={styles.previewCaption}>{body.trim()}</Text>}

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
          editable={!busy}
          placeholder={kind === 'video' ? '為這段影片加上一句話（選填）' : kind === 'image' ? '為這張圖加上一句話（選填）' : '跟大家分享此刻⋯'}
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

        <View style={styles.replyPreference}>
          <Text style={styles.replyPreferenceText}>允許同校成員私訊回覆</Text>
          <Switch
            accessibilityLabel="允許同校成員私訊回覆"
            value={allowReplies}
            disabled={busy}
            onValueChange={setAllowReplies}
          />
        </View>

        <Pressable style={[styles.btn, (busy || candidate) && { opacity: 0.65 }]} disabled={busy || !!candidate} onPress={publish}>
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
  previewClip: { aspectRatio: 4 / 3 },
  previewCaption: { padding: 10, color: theme.colors.text, fontSize: 15, lineHeight: 22 },
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

  kindRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, alignItems: 'center' },
  kindBtn: {
    minHeight: 44,
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
  kindClear: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 'auto' },
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

  replyPreference: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 52, marginTop: 12 },
  replyPreferenceText: { flex: 1, color: theme.colors.text, fontSize: 15 },
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
