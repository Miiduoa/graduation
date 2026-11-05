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
  Image,
  RefreshControl,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  Alert,
  Dimensions,
  ScrollView,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../state/auth';
import { useSchool } from '../../state/school';
import { theme } from '../../ui/theme';
import { useThemeStyleSheet } from '../../ui/useThemeStyleSheet';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../../ui/navigationTheme';
import { getDb, isFirebaseMockMode } from '../../firebase';
import {
  listActiveStoriesForSchool,
  type CampusStoryDoc,
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
import { CampusStoryViewer, useCampusStories } from './CampusStoryViewer';
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

type StoryRequest = {
  requestedAuthorUid?: string;
  requestedSchoolId?: string;
  onRequestConsumed?: () => void;
};

export function RealtimeSocialScreen(props: StoryRequest = {}) {
  const { user, loading } = useAuth();
  const { school } = useSchool();
  if (loading) return <ActivityIndicator />;
  return <RealtimeSocialContent key={JSON.stringify([user?.uid, school?.id])} {...props} />;
}

function RealtimeSocialContent({ requestedAuthorUid, requestedSchoolId, onRequestConsumed }: StoryRequest) {
  const styles = useThemeStyleSheet(createStyles);
  const injected = useCampusSocialStackNav();
  const fb = useNavigation<any>();
  const nav = injected ?? fb;
  const auth = useAuth();
  const { school } = useSchool();
  const insets = useSafeAreaInsets();
  const uid = auth.user?.uid;

  const pois = useMemo(() => getSocialPoiList(), []);
  const [selectedPoi, setSelectedPoi] = useState<string>(defaultSocialPoiId());
  const [storyRows, setStoryRows] = useState<CampusStoryDoc[]>([]);
  const storyDeck = useCampusStories(storyRows, school?.id, uid);
  const { groups: storyGroups, openGroup } = storyDeck;
  const [storiesLoading, setStoriesLoading] = useState(true);
  const [storiesUnavailable, setStoriesUnavailable] = useState(false);
  const storyRequest = React.useRef(0);
  const [peers, setPeers] = useState<PeerProfile[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [heartbeatSession, setHeartbeatSession] = useState<string | null>(null);
  const [storyNotice, setStoryNotice] = useState('');
  const [nameByUid, setNameByUid] = useState<Record<string, string>>({});
  const [avatarByUid, setAvatarByUid] = useState<Record<string, string>>({});

  const refreshStories = useCallback(async () => {
    const request = ++storyRequest.current;
    setStoriesLoading(true);
    setStoriesUnavailable(false);
    try {
      const rows = !isFirebaseMockMode() && school?.id && uid
        ? await listActiveStoriesForSchool(school.id, 80, { throwOnError: true })
        : [];
      if (request === storyRequest.current) setStoryRows(rows);
    } catch {
      if (request === storyRequest.current) {
        setStoryRows([]);
        setStoriesUnavailable(true);
      }
    } finally {
      if (request === storyRequest.current) setStoriesLoading(false);
    }
  }, [school?.id, uid]);

  const refreshPeers = useCallback(async () => {
    if (isFirebaseMockMode() || !school?.id || !uid) {
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
    void refreshStories();
    return () => { storyRequest.current += 1; };
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

  const consumedRequest = React.useRef('');
  useEffect(() => {
    if (!requestedAuthorUid) {
      consumedRequest.current = '';
      return;
    }
    const request = JSON.stringify([requestedSchoolId, requestedAuthorUid]);
    if (storiesLoading || storiesUnavailable || consumedRequest.current === request) return;
    consumedRequest.current = request;
    const group = requestedSchoolId === school?.id ? storyGroups.find(g => g.authorUid === requestedAuthorUid) : undefined;
    if (group) {
      openGroup(group);
      setStoryNotice('');
    } else {
      setStoryNotice('這則限時動態可能已到期或移除。');
    }
    onRequestConsumed?.();
  }, [requestedAuthorUid, requestedSchoolId, school?.id, storiesLoading, storiesUnavailable, storyGroups, openGroup, onRequestConsumed]);

  const returningFromComposer = React.useRef(false);
  useFocusEffect(useCallback(() => {
    if (returningFromComposer.current) {
      returningFromComposer.current = false;
      void refreshStories();
    }
  }, [refreshStories]));

  const openCompose = () => {
    if (!auth.user) {
      Alert.alert('請先登入');
      return;
    }
    returningFromComposer.current = true;
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
        {!!storyNotice && (
          <Text accessibilityRole="alert" style={[styles.softMuted, { paddingHorizontal: 14 }]}>
            {storyNotice}
          </Text>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: theme.space.lg, paddingHorizontal: 14 }}>
          <Text style={[styles.section, { flex: 1, paddingHorizontal: 0 }]}>校園限時動態</Text>
          <Pressable onPress={openCompose} style={styles.storyComposeBtn} accessibilityRole="button">
            <Ionicons name="add" size={16} color={theme.colors.onAccent} />
            <Text style={styles.storyComposeTxt}>新增限時動態</Text>
          </Pressable>
        </View>

        {storiesLoading ? (
          <ActivityIndicator style={{ marginTop: theme.space.md }} color={theme.colors.accent} />
        ) : storiesUnavailable ? (
          <View style={{ paddingHorizontal: 14 }}>
            <Text style={styles.softMuted}>暫時無法讀取限時動態，請確認連線與校園帳號。</Text>
            <Pressable accessibilityRole="button" onPress={refreshStories} style={styles.storyComposeBtn}>
              <Text style={styles.storyComposeTxt}>重新讀取限時動態</Text>
            </Pressable>
          </View>
        ) : storyGroups.length === 0 ? (
          <Text style={[styles.softMuted, { paddingHorizontal: 14 }]}>
            目前沒有限時動態。分享第一則校園近況吧。
          </Text>
        ) : (
          <View style={[styles.storyGrid, { paddingHorizontal: 14 }]}>
            {storyGroups.map((g) => {
              const latest = g.stories[g.stories.length - 1] ?? g.stories[0];
              const isImage = latest?.kind === 'image' && latest.mediaUrl;
              const isVideo = latest?.kind === 'video' && !!latest.mediaUrl;
              const author = g.isMine ? '我' : nameByUid[g.authorUid] || '同學';
              return (
                <Pressable
                  key={g.authorUid}
                  style={styles.storyCard}
                  onPress={() => openGroup(g)}
                  accessibilityRole="button"
                  accessibilityLabel={`查看 ${author} 的限時動態${isVideo ? '，最新一則是影片' : ''}`}
                >
                  {isImage ? (
                    <Image source={{ uri: latest!.mediaUrl as string }} style={styles.storyCardImg} />
                  ) : isVideo ? (
                    <View style={[styles.storyCardText, styles.videoCover]}>
                      <View style={styles.videoBadge}>
                        <Ionicons name="play" size={12} color="#f3faf6" />
                        <Text style={styles.videoLabel}>影片</Text>
                      </View>
                      {!!latest?.text && <Text numberOfLines={3} style={styles.storyCardTxt}>{latest.text}</Text>}
                    </View>
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
                      {g.isMine ? '我的限時動態' : nameByUid[g.authorUid] ?? g.authorUid.slice(0, 6)}
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

      <CampusStoryViewer deck={storyDeck} names={nameByUid} />
    </View>
  );
}

const createStyles = () => StyleSheet.create({
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
  videoCover: { alignItems: 'flex-start', gap: 12, backgroundColor: '#243b33' },
  videoBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: '#90afa1', borderRadius: 20, paddingHorizontal: 9, paddingVertical: 4 },
  videoLabel: { fontSize: 12, fontWeight: '600', color: '#f3faf6' },
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

});

export default RealtimeSocialScreen;
