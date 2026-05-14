/* eslint-disable */
/**
 * =============================================================================
 * Campus Game — 本地 AI 美術資產 + 校園節點模擬 + 同 POI 好友輕即時
 * =============================================================================
 * 資產：`apps/mobile/assets/generated-game/*`（預設 `scripts/generate-campus-game-flux.py` 為免費 PIL；可加 `--comfy` 換本機出圖）
 * 深連結：`campus://home/campus-game`（需在設定開啟「在遊戲中展示我的所在校園節點」才會向 Firebase LBS heartbeat）
 * =============================================================================
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Image,
  ImageBackground,
  Share,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { theme } from '../ui/theme';
import { useThemeMode } from '../state/theme';
import { gameAvatarFrames, generatedGameAssets } from '../ui/generatedGameAssets';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { usePreferences } from '../state/preferences';
import {
  earnXP,
  getGamificationState,
  type GamificationState,
} from '../services/gamificationEngine';
import { emitXPEarned } from '../services/campusEventBus';
import { getDb, isFirebaseMockMode } from '../firebase';
import {
  heartbeatCheckIn,
  peersAtPoi,
  clearPresence,
} from '../services/checkins';
import {
  listAcceptedFriends,
  opponentUidFromFriendship,
} from '../services/friends';
import { fetchSchoolDirectoryProfileMap, type SchoolDirectoryProfile } from '../services/memberDirectory';

const DAILY_XP_STORAGE = '@campus_game:daily_explore_xp_date';
const SCORE_VERSION = 'v2';

/** 對齊社交即時畫面的 POI slug 風格 */
type CampusNode = {
  id: string;
  label: string;
  blurb: string;
  poiId: string;
};

const MOCK_CAMPUS_NODES: CampusNode[] = [
  {
    id: 'lib',
    label: '圖書館廣場',
    blurb: '自修與相遇的高頻節點（對應 LBS：`library-main`）',
    poiId: 'library-main',
  },
  {
    id: 'dorm',
    label: '宿舍圈',
    blurb: '晚間生活圈（對應 LBS：`dorm-zone`）',
    poiId: 'dorm-zone',
  },
  {
    id: 'food',
    label: '餐廳巷',
    blurb: '午餐踩點（對應 LBS：`cafeteria-row`）',
    poiId: 'cafeteria-row',
  },
  {
    id: 'green',
    label: '草皮廣場',
    blurb: '社團與休閒（對應 LBS：`plaza-green`）',
    poiId: 'plaza-green',
  },
];

function AnimatedGameAvatar({
  reduceMotion,
  size,
}: {
  reduceMotion: boolean;
  size: number;
}) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (reduceMotion) return undefined;
    const ms = 900;
    const t = setInterval(() => {
      setIdx((i) => (i + 1) % gameAvatarFrames.length);
    }, ms);
    return () => clearInterval(t);
  }, [reduceMotion]);

  return (
    <Image
      source={gameAvatarFrames[reduceMotion ? 0 : idx]}
      style={{ width: size, height: size, borderRadius: theme.radius.md }}
      resizeMode="cover"
      accessibilityLabel="遊戲角色（預設免費程序化圖；可選換本機 Comfy）"
    />
  );
}

/** 依 MOCK 順序取第一個已造訪節點的 poiId（作為備援 heartbeat） */
function firstVisitedPoi(visited: Set<string>): CampusNode | null {
  for (const n of MOCK_CAMPUS_NODES) {
    if (visited.has(n.id)) return n;
  }
  return null;
}

export function CampusGameScreen() {
  useThemeMode();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const auth = useAuth();
  const { school } = useSchool();
  const { preferences } = usePreferences();
  const displayName = auth.profile?.displayName ?? auth.user?.displayName ?? '同學';
  const department = auth.profile?.department ?? '';
  const userId = auth.user?.uid ?? 'guest';

  const [visited, setVisited] = useState<Set<string>>(() => new Set());
  const [gamification, setGamification] = useState<GamificationState | null>(null);
  const [lastXpMessage, setLastXpMessage] = useState<string | null>(null);
  const [dailyBlocked, setDailyBlocked] = useState(false);
  const [poiPeersLoading, setPoiPeersLoading] = useState(false);
  /** poiId → 相交好友概要 */
  const [friendsAtPoi, setFriendsAtPoi] = useState<Record<string, SchoolDirectoryProfile[]>>({});

  const heartbeatSessionRef = useRef<string | null>(null);

  const prefsShare = preferences.gameShareCampusPresence;

  const refreshGamification = useCallback(() => {
    void getGamificationState(displayName, department)
      .then(setGamification)
      .catch(() => setGamification(null));
  }, [department, displayName]);

  useFocusEffect(
    useCallback(() => {
      refreshGamification();
    }, [refreshGamification]),
  );

  useEffect(() => {
    void (async () => {
      const today = new Date().toISOString().split('T')[0];
      const last = await AsyncStorage.getItem(DAILY_XP_STORAGE);
      setDailyBlocked(last === today);
    })();
  }, [lastXpMessage]);

  const clearHeartbeat = useCallback(async () => {
    const sid = heartbeatSessionRef.current;
    heartbeatSessionRef.current = null;
    if (sid && school?.id) {
      try {
        await clearPresence(school.id, sid);
      } catch {
        /* ignore */
      }
    }
  }, [school?.id]);

  /** 對外 presence：優先最近一次「進入」的節點，否則取列表順序第一個已造訪 */
  const reconcileHeartbeat = useCallback(
    async (nextVisited: Set<string>, touched: CampusNode | null, turnedOn: boolean) => {
      if (!prefsShare || isFirebaseMockMode() || !auth.user?.uid || !school?.id) {
        await clearHeartbeat();
        return;
      }
      if (nextVisited.size === 0) {
        await clearHeartbeat();
        return;
      }
      let chosen: CampusNode | null = null;
      if (turnedOn && touched && nextVisited.has(touched.id)) {
        chosen = touched;
      } else {
        chosen = firstVisitedPoi(nextVisited);
      }
      if (!chosen) {
        await clearHeartbeat();
        return;
      }
      await clearHeartbeat();
      try {
        const sid = await heartbeatCheckIn(auth.user.uid, school.id, chosen.poiId);
        heartbeatSessionRef.current = sid;
      } catch {
        /* ignore transient */
      }
    },
    [auth.user?.uid, clearHeartbeat, prefsShare, school?.id],
  );

  /** 離開畫面或關閉開關：清 presence */
  useFocusEffect(
    useCallback(() => {
      return () => {
        void clearHeartbeat();
      };
    }, [clearHeartbeat]),
  );

  useEffect(() => {
    if (!prefsShare) {
      void clearHeartbeat();
      return;
    }
    // 使用中途中開啟「分享」／回到畫面：若已有踏點，補發一次對應 POI 的心跳
    if (
      visited.size === 0 ||
      isFirebaseMockMode() ||
      !auth.user?.uid ||
      !school?.id
    ) {
      return;
    }
    const hint = firstVisitedPoi(visited);
    queueMicrotask(() => void reconcileHeartbeat(visited, hint, false));
  }, [prefsShare, clearHeartbeat, auth.user?.uid, school?.id, visited, reconcileHeartbeat]);

  const toggleNode = (node: CampusNode) => {
    setVisited((prev) => {
      const wasOn = prev.has(node.id);
      const next = new Set(prev);
      if (wasOn) {
        next.delete(node.id);
      } else {
        next.add(node.id);
      }
      const turnedOn = !wasOn;
      queueMicrotask(() => void reconcileHeartbeat(next, node, turnedOn));
      return next;
    });
  };

  const loadFriendsPresence = useCallback(async () => {
    if (
      !prefsShare ||
      isFirebaseMockMode() ||
      !school?.id ||
      !auth.user?.uid ||
      userId === 'guest'
    ) {
      setFriendsAtPoi({});
      return;
    }
    setPoiPeersLoading(true);
    try {
      const friendships = await listAcceptedFriends(school.id, auth.user.uid);
      const buddy = new Set(
        friendships.map((f) => opponentUidFromFriendship(f, auth.user!.uid)),
      );

      const result: Record<string, SchoolDirectoryProfile[]> = {};

      await Promise.all(
        MOCK_CAMPUS_NODES.map(async (n) => {
          const raw = await peersAtPoi(school.id!, n.poiId);
          const intersect = raw.map((r) => r.uid).filter((u) => buddy.has(u));
          if (intersect.length === 0) {
            result[n.poiId] = [];
            return;
          }
          const pmap = await fetchSchoolDirectoryProfileMap(school.id!, intersect, getDb());
          result[n.poiId] = intersect
            .map((uid) => pmap[uid])
            .filter((p): p is SchoolDirectoryProfile => !!p);
        }),
      );

      setFriendsAtPoi(result);
    } catch {
      setFriendsAtPoi({});
    } finally {
      setPoiPeersLoading(false);
    }
  }, [prefsShare, school?.id, auth.user, userId]);

  useFocusEffect(
    useCallback(() => {
      if (!prefsShare) {
        setFriendsAtPoi({});
        return undefined;
      }
      void loadFriendsPresence();
      const id = setInterval(() => void loadFriendsPresence(), 38000);
      return () => clearInterval(id);
    }, [prefsShare, loadFriendsPresence]),
  );

  const allVisited = MOCK_CAMPUS_NODES.every((n) => visited.has(n.id));
  const strollScore = useMemo(
    () => visited.size * 25 + (gamification?.totalXP ?? 0),
    [visited, gamification],
  );

  const claimExploreXp = async () => {
    if (!allVisited || dailyBlocked) return;
    const today = new Date().toISOString().split('T')[0];
    const last = await AsyncStorage.getItem(DAILY_XP_STORAGE);
    if (last === today) {
      setDailyBlocked(true);
      setLastXpMessage('今日已領取過探索獎勵。');
      return;
    }

    try {
      const result = await earnXP('explore_campus');
      await AsyncStorage.setItem(DAILY_XP_STORAGE, today);
      setDailyBlocked(true);
      setLastXpMessage(`+${result.xpGained} XP（探索校園）`);
      const g = await getGamificationState(displayName, department);
      setGamification(g);
      emitXPEarned({
        userId,
        action: 'explore_campus',
        amount: result.xpGained,
        newTotal: result.totalXP,
        newLevel: g.level,
      });
    } catch {
      setLastXpMessage('領取失敗，請稍後再試。');
    }
  };

  const shareFriendChallenge = async () => {
    const xp = gamification?.totalXP ?? 0;
    const lvl = gamification?.level ?? 1;
    const msg = [
      `【校園漫步挑戰｜${SCORE_VERSION}】`,
      `${displayName} 邀你一起逛校園節點！`,
      `我的累積 XP：${xp}（Lv.${lvl}）｜本局踏點：${visited.size}/${MOCK_CAMPUS_NODES.length}`,
      `用 App 開啟：campus://home/campus-game`,
    ].join('\n');
    try {
      await Share.share({ message: msg, title: '校園漫步挑戰' });
    } catch {
      /* ignore */
    }
  };

  const openCampusMap = () => {
    try {
      navigation.getParent()?.navigate?.('校園', { screen: 'Map' });
    } catch {
      /* ignore */
    }
  };

  const openDmWithFriend = (uid: string) => {
    try {
      navigation.getParent()?.navigate('訊息' as never, {
        screen: 'Chat',
        params: { peerId: uid },
      } as never);
    } catch {
      /* ignore */
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.bg }}
      contentContainerStyle={{
        paddingTop: insets.top + theme.space.md,
        paddingBottom: insets.bottom + theme.space.xl,
        paddingHorizontal: theme.layout.screenPadding,
        gap: theme.space.lg,
      }}
    >
      <Text style={{ fontSize: 22, fontWeight: '800', color: theme.colors.text }}>校園漫步</Text>
      <Text style={{ fontSize: 14, color: theme.colors.textSecondary, lineHeight: 20 }}>
        角色與場景圖由 `assets/generated-game` 打包進 App；開發机上預設以 Pillow 免費產圖（不需 API）。請在設定開啟「在遊戲中展示我的所在校園節點」以啟動同 POI 好友列表與 Firebase 短期心跳。
      </Text>

      {!prefsShare ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space.sm,
            padding: theme.space.sm,
            borderRadius: theme.radius.md,
            backgroundColor: theme.colors.surfaceMuted,
            borderWidth: 1,
            borderColor: theme.colors.border,
          }}
        >
          <Ionicons name="eye-off-outline" size={22} color={theme.colors.muted} />
          <Text style={{ flex: 1, fontSize: 13, color: theme.colors.textSecondary }}>
            你未開啟遊戲位置分享（設定 → 校園漫步）。仍可踏點與領 XP，但不會送出心跳或載入好友同框。
          </Text>
        </View>
      ) : null}

      <Pressable
        onPress={openCampusMap}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          paddingVertical: theme.space.sm,
          borderRadius: theme.radius.lg,
          borderWidth: 1,
          borderColor: theme.colors.accent + '55',
          backgroundColor: theme.colors.card,
          opacity: pressed ? 0.9 : 1,
        })}
      >
        <Ionicons name="map-outline" size={20} color={theme.colors.accent} />
        <Text style={{ color: theme.colors.accent, fontWeight: '700' }}>開啟校園地圖</Text>
      </Pressable>

      <View
        style={{
          flexDirection: 'row',
          gap: theme.space.md,
          alignItems: 'center',
          backgroundColor: theme.colors.card,
          borderRadius: theme.radius.lg,
          padding: theme.space.md,
          borderWidth: 1,
          borderColor: theme.colors.border,
        }}
      >
        <AnimatedGameAvatar
          reduceMotion={preferences.reduceMotion}
          size={72}
        />
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: '700', color: theme.colors.text }}>{displayName}</Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginTop: 4 }}>
            累積 XP：{gamification?.totalXP ?? '…'} · Lv.{gamification?.level ?? '…'}
          </Text>
          <Text style={{ color: theme.colors.accent, fontSize: 13, marginTop: 4, fontWeight: '600' }}>
            本局漫步分：{strollScore}
          </Text>
        </View>
      </View>

      <ImageBackground
        source={generatedGameAssets.sceneCampus}
        resizeMode="cover"
        imageStyle={{
          borderRadius: theme.radius.lg,
          opacity: theme.mode === 'dark' ? 0.42 : 0.55,
        }}
        style={{
          borderRadius: theme.radius.lg,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
        }}
      >
        <View
          style={{
            padding: theme.space.md,
            gap: theme.space.sm,
            backgroundColor:
              theme.mode === 'dark' ? theme.colors.surface + 'E6' : 'rgba(255,255,255,0.92)',
          }}
        >
          <Text style={{ fontWeight: '700', color: theme.colors.text }}>校園節點</Text>

          {poiPeersLoading ? (
            <ActivityIndicator color={theme.colors.accent} style={{ alignSelf: 'flex-start' }} />
          ) : null}

          {MOCK_CAMPUS_NODES.map((node) => {
            const on = visited.has(node.id);
            const fam = friendsAtPoi[node.poiId] ?? [];
            return (
              <Pressable
                key={node.id}
                onPress={() => toggleNode(node)}
                style={({ pressed }) => ({
                  padding: theme.space.sm,
                  borderRadius: theme.radius.md,
                  backgroundColor: on ? theme.colors.accent + '22' : theme.colors.card,
                  borderWidth: 1,
                  borderColor: on ? theme.colors.accent : theme.colors.border,
                  opacity: pressed ? 0.9 : 1,
                })}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.sm }}>
                  <Ionicons
                    name={on ? 'checkmark-circle' : 'ellipse-outline'}
                    size={22}
                    color={on ? theme.colors.accent : theme.colors.muted}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '600', color: theme.colors.text }}>{node.label}</Text>
                    <Text style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 2 }}>
                      {node.blurb}
                    </Text>
                  </View>
                </View>
                {prefsShare && (
                  <>
                    <Text style={{ fontSize: 11, color: theme.colors.muted, marginTop: 8 }}>
                      POI：{node.poiId}
                    </Text>
                    {fam.length === 0 ? (
                      <Text style={{ fontSize: 11, color: theme.colors.muted, marginTop: 4 }}>
                        此刻與你已互加好友、且同在節點心跳內的同學：無
                      </Text>
                    ) : (
                      <View style={{ marginTop: 8 }}>
                        <Text style={{ fontSize: 12, fontWeight: '600', color: theme.colors.textSecondary }}>
                          好友同框
                        </Text>
                        <ScrollView
                          horizontal
                          showsHorizontalScrollIndicator={false}
                          contentContainerStyle={{
                            flexDirection: 'row',
                            gap: theme.space.sm,
                            marginTop: 6,
                            paddingRight: theme.space.md,
                          }}
                        >
                          {fam.map((item) => (
                            <Pressable
                              key={item.uid}
                              onPress={() => openDmWithFriend(item.uid)}
                              style={{
                                alignItems: 'center',
                                width: 58,
                              }}
                            >
                              {item.avatarUrl ? (
                                <Image
                                  source={{ uri: item.avatarUrl }}
                                  style={{
                                    width: 40,
                                    height: 40,
                                    borderRadius: 20,
                                    borderWidth: 1,
                                    borderColor: theme.colors.border,
                                  }}
                                  accessibilityLabel={(item.displayName ?? item.uid)?.slice(0, 24)}
                                />
                              ) : (
                                <View
                                  style={{
                                    width: 40,
                                    height: 40,
                                    borderRadius: 20,
                                    backgroundColor: theme.colors.accent + '44',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                  }}
                                >
                                  <Text
                                    style={{
                                      fontSize: 13,
                                      fontWeight: '700',
                                      color: theme.colors.accent,
                                    }}
                                  >
                                    {(item.displayName ?? item.uid)?.slice(0, 1) ?? '?'}
                                  </Text>
                                </View>
                              )}
                              <Text
                                numberOfLines={1}
                                style={{
                                  fontSize: 10,
                                  color: theme.colors.muted,
                                  marginTop: 2,
                                }}
                              >
                                {item.displayName ?? item.uid}
                              </Text>
                            </Pressable>
                          ))}
                        </ScrollView>
                      </View>
                    )}
                  </>
                )}
              </Pressable>
            );
          })}
        </View>
      </ImageBackground>

      {lastXpMessage ? (
        <Text style={{ color: theme.colors.accent, fontWeight: '600' }}>{lastXpMessage}</Text>
      ) : null}

      <Pressable
        onPress={claimExploreXp}
        disabled={!allVisited || dailyBlocked}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          paddingVertical: theme.space.md,
          borderRadius: theme.radius.lg,
          backgroundColor: !allVisited || dailyBlocked ? theme.colors.muted + '55' : theme.colors.accent,
          opacity: pressed ? 0.92 : 1,
        })}
      >
        <Ionicons name="sparkles" size={20} color={theme.colors.onAccent} />
        <Text style={{ color: theme.colors.onAccent, fontWeight: '800' }}>
          {dailyBlocked ? '今日探索獎勵已領' : allVisited ? '領取探索 XP' : '踏遍四個節點以領取 XP'}
        </Text>
      </Pressable>

      <Pressable
        onPress={shareFriendChallenge}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          paddingVertical: theme.space.md,
          borderRadius: theme.radius.lg,
          borderWidth: 1,
          borderColor: theme.colors.social + '66',
          backgroundColor: theme.colors.socialSoft,
          opacity: pressed ? 0.9 : 1,
        })}
      >
        <Ionicons name="share-social-outline" size={20} color={theme.colors.social} />
        <Text style={{ color: theme.colors.social, fontWeight: '700' }}>邀請好友挑戰（分享連結）</Text>
      </Pressable>

      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border }} />
      <Text style={{ fontSize: 12, color: theme.colors.muted, lineHeight: 18 }}>
        Presence 為短期心跳（Firestore `lbsPresence`），非 MMORPG 權威狀態；雙方皆需在設定開啟分享才看得到同框好友。Mock
        Firebase 模式下不送出、不載入 peers。
      </Text>
    </ScrollView>
  );
}

export default CampusGameScreen;
