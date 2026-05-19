/* eslint-disable */
/**
 * 校園社群 — 即時（Story + LBS）
 *
 * 變更（vs. 舊版）：
 *  - POI 不再讓使用者打字 → 改成水平 chip 列，從 services/campusSocialPois 取真實校園 POI
 *  - Story 全螢幕 viewer（中央顯示，含進度條、左右切換、暗背景）
 *  - Story 卡片排版改為 grid，可顯示圖片預覽
 *  - 「我在這裡」打卡會在 chip 上顯示 ACTIVE 標記
 *  - 同點位列表顯示頭像 / 姓名（從 directory 取）
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Image,
  RefreshControl,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  Alert,
  Modal,
  Dimensions,
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../state/auth';
import { useSchool } from '../../state/school';
import { theme } from '../../ui/theme';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../../ui/navigationTheme';
import { getDb, isFirebaseMockMode } from '../../firebase';
import {
  listActiveStoriesForSchool,
  markStoryViewed,
  groupStoriesByAuthor,
  type CampusStoryDoc,
  type StoryAuthorGroup,
} from '../../services/stories';
import { heartbeatCheckIn, peersAtPoi, clearPresence } from '../../services/checkins';
import { fetchSchoolDirectoryProfiles } from '../../services/memberDirectory';
import {
  getSocialPoiList,
  defaultSocialPoiId,
  findSocialPoi,
  SOCIAL_POI_CATEGORY_LABEL,
  type SocialPoi,
  type SocialPoiCategory,
} from '../../services/campusSocialPois';
import { useCampusSocialStackNav } from './CampusSocialNavContext';

type PeerProfile = {
  uid: string;
  name?: string;
  avatarUrl?: string | null;
  department?: string | null;
};

const POI_CAT_ICON: Record<SocialPoiCategory, keyof typeof Ionicons.glyphMap> = {
  library: 'book-outline',
  cafeteria: 'restaurant-outline',
  sports: 'fitness-outline',
  academic: 'school-outline',
  social: 'people-outline',
  transit: 'bus-outline',
};

export function RealtimeSocialScreen() {
  const injected = useCampusSocialStackNav();
  const fb = useNavigation<any>();
  const nav = injected ?? fb;
  const auth = useAuth();
  const { school } = useSchool();
  const insets = useSafeAreaInsets();
  const uid = auth.user?.uid;

  const pois = useMemo(() => getSocialPoiList(), []);
  const [selectedPoi, setSelectedPoi] = useState<string>(defaultSocialPoiId());
  const [storyGroups, setStoryGroups] = useState<StoryAuthorGroup[]>([]);
  const [storiesLoading, setStoriesLoading] = useState(true);
  const [peers, setPeers] = useState<PeerProfile[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [heartbeatSession, setHeartbeatSession] = useState<string | null>(null);
  const [viewerState, setViewerState] = useState<{ group: StoryAuthorGroup; index: number } | null>(null);
  const [nameByUid, setNameByUid] = useState<Record<string, string>>({});
  const [avatarByUid, setAvatarByUid] = useState<Record<string, string>>({});

  const refreshStories = useCallback(async () => {
    if (isFirebaseMockMode() || !school?.id) {
      setStoryGroups([]);
      return;
    }
    const rows = await listActiveStoriesForSchool(school.id, 80);
    setStoryGroups(groupStoriesByAuthor(rows, uid));
  }, [school?.id, uid]);

  const refreshPeers = useCallback(async () => {
    if (isFirebaseMockMode() || !school?.id) {
      setPeers([]);
      return;
    }
    const raw = await peersAtPoi(school.id, selectedPoi);
    const db = getDb();
    const unique = [
      ...new Set(raw.map((r) => r.uid).filter((x): x is string => typeof x === 'string' && !!x)),
    ].filter((x) => x !== uid);
    if (unique.length === 0) {
      setPeers([]);
      return;
    }
    const profiles = await fetchSchoolDirectoryProfiles(school.id, unique, db);
    setPeers(
      unique.map((id) => {
        const p = profiles.find((q) => q.uid === id);
        return {
          uid: id,
          name: p?.displayName ?? id.slice(0, 6),
          avatarUrl: p?.avatarUrl ?? null,
          department: p?.department ?? null,
        };
      }),
    );
  }, [school?.id, selectedPoi, uid]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStoriesLoading(true);
      await refreshStories();
      if (!cancelled) setStoriesLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshStories]);

  useEffect(() => {
    void refreshPeers();
  }, [refreshPeers]);

  // hydrate story author display names
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!school?.id) return;
      const uids = [...new Set(storyGroups.map((g) => g.authorUid))];
      if (uids.length === 0) return;
      const profiles = await fetchSchoolDirectoryProfiles(school.id, uids, getDb());
      if (cancelled) return;
      const nm: Record<string, string> = {};
      const av: Record<string, string> = {};
      profiles.forEach((p) => {
        nm[p.uid] = (p.displayName ?? p.uid.slice(0, 6)).trim();
        if (p.avatarUrl) av[p.uid] = p.avatarUrl;
      });
      setNameByUid(nm);
      setAvatarByUid(av);
    })();
    return () => {
      cancelled = true;
    };
  }, [storyGroups, school?.id]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refreshStories(), refreshPeers()]);
    setRefreshing(false);
  };

  const tapHeart = async () => {
    if (!uid || !school?.id) {
      Alert.alert('請先登入');
      return;
    }
    if (isFirebaseMockMode()) {
      Alert.alert('模擬模式', '無法寫入 Firestore');
      return;
    }
    try {
      if (heartbeatSession) {
        await clearPresence(school.id, heartbeatSession);
      }
      const sid = await heartbeatCheckIn(uid, school.id, selectedPoi);
      setHeartbeatSession(sid);
      await refreshPeers();
      const poi = findSocialPoi(selectedPoi);
      Alert.alert('已打卡', `位置：${poi?.name ?? selectedPoi}\n將在 15 分鐘內對同點師生可見。`);
    } catch (e: any) {
      Alert.alert('打卡失敗', e?.message ?? String(e));
    }
  };

  const openStoryGroup = (g: StoryAuthorGroup) => {
    setViewerState({ group: g, index: 0 });
    const story = g.stories[0];
    if (story && uid && !isFirebaseMockMode()) void markStoryViewed(story.id, uid).catch(() => {});
  };

  const advanceStory = (delta: number) => {
    setViewerState((prev) => {
      if (!prev) return prev;
      const nextIndex = prev.index + delta;
      if (nextIndex < 0 || nextIndex >= prev.group.stories.length) return null;
      const story = prev.group.stories[nextIndex];
      if (story && uid && !isFirebaseMockMode()) void markStoryViewed(story.id, uid).catch(() => {});
      return { group: prev.group, index: nextIndex };
    });
  };

  const openCompose = () => {
    if (!auth.user) {
      Alert.alert('請先登入');
      return;
    }
    nav?.navigate?.('StoryCompose' as never, { poiId: selectedPoi, poiName: findSocialPoi(selectedPoi)?.name });
  };

  return (
    <View style={[styles.root, { paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + insets.bottom }]}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        {/* ─── POI chips ─── */}
        <Text style={styles.section}>我在哪</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 14, gap: 8 }}>
          {pois.map((poi) => {
            const active = poi.id === selectedPoi;
            const isCheckedIn = active && heartbeatSession != null;
            return (
              <Pressable
                key={poi.id}
                onPress={() => setSelectedPoi(poi.id)}
                style={[styles.poiChip, active && styles.poiChipActive]}
                accessibilityRole="button"
                accessibilityLabel={`選擇 ${poi.name}`}
              >
                <Ionicons
                  name={POI_CAT_ICON[poi.category]}
                  size={14}
                  color={active ? theme.colors.onAccent : theme.colors.textSecondary}
                />
                <Text style={[styles.poiChipTxt, active && { color: theme.colors.onAccent }]}>
                  {poi.name}
                </Text>
                {isCheckedIn ? <View style={styles.poiDot} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.poiSummary}>
          <View style={{ flex: 1 }}>
            <Text style={styles.poiSummaryName}>{findSocialPoi(selectedPoi)?.name ?? selectedPoi}</Text>
            <Text style={styles.poiSummaryHint}>
              {SOCIAL_POI_CATEGORY_LABEL[findSocialPoi(selectedPoi)?.category ?? 'social']}
              {findSocialPoi(selectedPoi)?.hint ? ` · ${findSocialPoi(selectedPoi)?.hint}` : ''}
            </Text>
          </View>
          <Pressable
            style={[styles.pulseBtn, heartbeatSession && styles.pulseBtnActive]}
            onPress={tapHeart}
            accessibilityRole="button"
          >
            <Ionicons name={heartbeatSession ? 'pulse' : 'location-outline'} size={16} color={theme.colors.onAccent} />
            <Text style={styles.pulseBtnTxt}>{heartbeatSession ? '更新打卡' : '我在這裡'}</Text>
          </Pressable>
        </View>

        {/* ─── Peers at POI ─── */}
        <Text style={[styles.section, { marginTop: theme.space.lg }]}>同點位 · {peers.length}</Text>
        <View style={{ paddingHorizontal: 14 }}>
          {peers.length === 0 ? (
            <Text style={styles.softMuted}>
              {isFirebaseMockMode() ? '模擬模式無資料' : '暫無同點對象，按「我在這裡」加入清單。'}
            </Text>
          ) : (
            <View style={styles.peerWrap}>
              {peers.slice(0, 12).map((p) => (
                <View key={p.uid} style={styles.peerCard}>
                  {p.avatarUrl ? (
                    <Image source={{ uri: p.avatarUrl }} style={styles.peerAvatar} />
                  ) : (
                    <View style={[styles.peerAvatar, styles.peerAvatarFb]}>
                      <Text style={styles.peerAvatarTxt}>{(p.name ?? '?').slice(0, 1)}</Text>
                    </View>
                  )}
                  <Text numberOfLines={1} style={styles.peerName}>
                    {p.name}
                  </Text>
                  {p.department ? (
                    <Text numberOfLines={1} style={styles.peerDept}>
                      {p.department}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          )}
        </View>

        {/* ─── Stories ─── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: theme.space.lg, paddingHorizontal: 14 }}>
          <Text style={[styles.section, { flex: 1, paddingHorizontal: 0 }]}>校園 Story</Text>
          <Pressable onPress={openCompose} style={styles.storyComposeBtn} accessibilityRole="button">
            <Ionicons name="add" size={16} color={theme.colors.onAccent} />
            <Text style={styles.storyComposeTxt}>發 Story</Text>
          </Pressable>
        </View>

        {storiesLoading ? (
          <ActivityIndicator style={{ marginTop: theme.space.md }} color={theme.colors.accent} />
        ) : storyGroups.length === 0 ? (
          <Text style={[styles.softMuted, { paddingHorizontal: 14 }]}>
            目前沒有未過期的 Story，點右上「發 Story」分享此刻。
          </Text>
        ) : (
          <View style={[styles.storyGrid, { paddingHorizontal: 14 }]}>
            {storyGroups.map((g) => {
              const latest = g.stories[g.stories.length - 1] ?? g.stories[0];
              const isImage = latest?.kind === 'image' && latest.mediaUrl;
              return (
                <Pressable
                  key={g.authorUid}
                  style={styles.storyCard}
                  onPress={() => openStoryGroup(g)}
                  accessibilityRole="button"
                >
                  {isImage ? (
                    <Image source={{ uri: latest!.mediaUrl as string }} style={styles.storyCardImg} />
                  ) : (
                    <View
                      style={[
                        styles.storyCardText,
                        { backgroundColor: latest?.bgColor || theme.colors.surfaceElevated },
                      ]}
                    >
                      <Text numberOfLines={5} style={styles.storyCardTxt}>
                        {latest?.text || '（媒體）'}
                      </Text>
                    </View>
                  )}
                  <View style={styles.storyCardFooter}>
                    {avatarByUid[g.authorUid] ? (
                      <Image source={{ uri: avatarByUid[g.authorUid] }} style={styles.storyAuthorAv} />
                    ) : (
                      <View style={[styles.storyAuthorAv, styles.storyAuthorAvFb]}>
                        <Text style={styles.storyAuthorAvTxt}>
                          {(nameByUid[g.authorUid] ?? '?').slice(0, 1)}
                        </Text>
                      </View>
                    )}
                    <Text numberOfLines={1} style={styles.storyAuthorName}>
                      {g.isMine ? '我的 Story' : nameByUid[g.authorUid] ?? g.authorUid.slice(0, 6)}
                    </Text>
                    {g.stories.length > 1 ? (
                      <Text style={styles.storyCount}>· {g.stories.length}</Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>

      <StoryViewerModal
        state={viewerState}
        onClose={() => setViewerState(null)}
        onAdvance={advanceStory}
      />
    </View>
  );
}

// ─── Story Viewer Modal（全螢幕） ───────────────────────────

function StoryViewerModal(props: {
  state: { group: StoryAuthorGroup; index: number } | null;
  onClose: () => void;
  onAdvance: (delta: number) => void;
}) {
  const { state, onClose, onAdvance } = props;
  if (!state) return null;
  const story = state.group.stories[state.index];
  if (!story) return null;
  const total = state.group.stories.length;
  const screenW = Dimensions.get('window').width;

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose}>
      <Pressable style={styles.viewerBackdrop} onPress={onClose}>
        <Pressable style={styles.viewerInner} onPress={(e) => e.stopPropagation?.()}>
          {/* 進度條 */}
          <View style={styles.viewerProgressBar}>
            {Array.from({ length: total }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.viewerProgressSegment,
                  i < state.index && { backgroundColor: '#ffffff' },
                  i === state.index && { backgroundColor: '#ffffffcc' },
                ]}
              />
            ))}
          </View>

          {/* 內容（圖片或文字） */}
          <View style={styles.viewerCanvas}>
            {story.kind === 'image' && story.mediaUrl ? (
              <Image source={{ uri: story.mediaUrl }} style={styles.viewerImage} resizeMode="contain" />
            ) : (
              <View
                style={[
                  styles.viewerText,
                  { backgroundColor: story.bgColor || '#0f172a' },
                ]}
              >
                <Text style={styles.viewerTextTxt}>{story.text || '（無內容）'}</Text>
              </View>
            )}
          </View>

          {/* 左右切換 hit zones */}
          <Pressable
            style={[styles.viewerHitLeft, { width: screenW * 0.35 }]}
            onPress={() => onAdvance(-1)}
            accessibilityLabel="上一則"
          />
          <Pressable
            style={[styles.viewerHitRight, { width: screenW * 0.55 }]}
            onPress={() => onAdvance(+1)}
            accessibilityLabel="下一則"
          />

          {/* 關閉鈕 */}
          <Pressable style={styles.viewerClose} onPress={onClose} hitSlop={10}>
            <Ionicons name="close" size={22} color="#fff" />
          </Pressable>

          {/* 底部資訊 */}
          {story.poiName ? (
            <View style={styles.viewerMeta}>
              <Ionicons name="location" size={12} color="#fff" />
              <Text style={styles.viewerMetaTxt}>{story.poiName}</Text>
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bg, paddingTop: theme.space.sm },

  section: {
    paddingHorizontal: 14,
    fontWeight: '700',
    color: theme.colors.text,
    marginBottom: 8,
    fontSize: 14,
  },
  softMuted: { color: theme.colors.textSecondary, fontSize: 13, marginVertical: 8 },

  poiChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: theme.colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  poiChipActive: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
  poiChipTxt: { fontSize: 12, color: theme.colors.textSecondary, fontWeight: '700' },
  poiDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.success,
    marginLeft: 4,
  },

  poiSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
    marginHorizontal: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: theme.colors.surfaceElevated ?? theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  poiSummaryName: { color: theme.colors.text, fontWeight: '700', fontSize: 15 },
  poiSummaryHint: { color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 },
  pulseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: theme.colors.accent,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.radius.md,
  },
  pulseBtnActive: { backgroundColor: theme.colors.success },
  pulseBtnTxt: { color: theme.colors.onAccent, fontWeight: '700', fontSize: 13 },

  peerWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  peerCard: {
    width: 84,
    alignItems: 'center',
    padding: 8,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  peerAvatar: { width: 44, height: 44, borderRadius: 22 },
  peerAvatarFb: { alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accent },
  peerAvatarTxt: { color: theme.colors.onAccent, fontWeight: '700' },
  peerName: { marginTop: 6, fontSize: 12, color: theme.colors.text, fontWeight: '600' },
  peerDept: { fontSize: 10, color: theme.colors.textSecondary },

  storyComposeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: theme.colors.accent,
    borderRadius: 999,
  },
  storyComposeTxt: { color: theme.colors.onAccent, fontWeight: '700', fontSize: 12 },

  storyGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  storyCard: {
    width: (Dimensions.get('window').width - 14 * 2 - 10) / 2,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  storyCardImg: { width: '100%', aspectRatio: 9 / 14 },
  storyCardText: {
    width: '100%',
    aspectRatio: 9 / 14,
    padding: 14,
    justifyContent: 'center',
  },
  storyCardTxt: { color: '#fff', fontSize: 14, lineHeight: 20, fontWeight: '600' },
  storyCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 8,
  },
  storyAuthorAv: { width: 20, height: 20, borderRadius: 10 },
  storyAuthorAvFb: {
    backgroundColor: theme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyAuthorAvTxt: { color: theme.colors.onAccent, fontWeight: '700', fontSize: 11 },
  storyAuthorName: { fontSize: 12, color: theme.colors.text, fontWeight: '700', flex: 1 },
  storyCount: { fontSize: 11, color: theme.colors.textSecondary },

  viewerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    padding: 12,
  },
  viewerInner: { flex: 1, justifyContent: 'center' },
  viewerProgressBar: {
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 8,
    marginTop: 30,
  },
  viewerProgressSegment: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  viewerCanvas: { flex: 1, marginTop: 12, justifyContent: 'center' },
  viewerImage: { width: '100%', height: '100%' },
  viewerText: { flex: 1, padding: 24, justifyContent: 'center', borderRadius: theme.radius.md },
  viewerTextTxt: { color: '#fff', fontSize: 22, lineHeight: 32, fontWeight: '700', textAlign: 'center' },
  viewerHitLeft: { position: 'absolute', top: 60, bottom: 60, left: 0 },
  viewerHitRight: { position: 'absolute', top: 60, bottom: 60, right: 0 },
  viewerClose: { position: 'absolute', top: 36, right: 16, padding: 8 },
  viewerMeta: {
    position: 'absolute',
    bottom: 28,
    left: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  viewerMetaTxt: { color: '#fff', fontSize: 12, fontWeight: '700' },
});

export default RealtimeSocialScreen;
