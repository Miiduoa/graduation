/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../ui/components';
import { theme } from '../ui/theme';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { useAuth } from '../state/auth';
import { shouldBlockForNoLogin, isDemoUid } from '../services/demoSession';
import { useSchool } from '../state/school';
import { getDb, isFirebaseMockMode } from '../firebase';
import { fetchSchoolDirectoryProfileMap } from '../services/memberDirectory';
import { listFollowingIds, listFollowersIds, unfollowUser } from '../services/follows';
import { PeerFollowButton } from '../components/PeerFollowButton';
import { getPersona, isDemoPersonaUid, PERSONAS, type PersonaIdentity } from '../data/demoPersona';


// Demo following/followers from demoPersona contactUids
function getDemoFollowData(myUid: string) {
  const me = isDemoPersonaUid(myUid) ? getPersona(myUid) : null;
  if (!me) return { following: [] as string[], followers: [] as string[], profileMap: {} as Record<string, { displayName?: string | null; roleLabel?: string | null }> };
  const following = me.contactUids ?? [];
  const all = Object.values(PERSONAS) as PersonaIdentity[];
  const followers = all.filter((p) => p.uid !== myUid && (p.contactUids ?? []).includes(myUid)).map((p) => p.uid);
  const profileMap: Record<string, { displayName?: string | null; roleLabel?: string | null }> = {};
  for (const uid of [...following, ...followers]) {
    const p = getPersona(uid);
    if (p) profileMap[uid] = { displayName: p.fullName, roleLabel: p.shortLabel ?? null };
  }
  return { following, followers, profileMap };
}

export function FollowingListsScreen(props: any) {
  const nav = props?.navigation;
  const auth = useAuth();
  const { school } = useSchool();
  const myUid = auth.user?.uid ?? '';

  const [tab, setTab] = useState<'following' | 'followers'>('following');
  const [following, setFollowing] = useState<string[]>([]);
  const [followers, setFollowers] = useState<string[]>([]);
  const [profileMap, setProfileMap] = useState<
    Record<string, { displayName?: string | null; roleLabel?: string | null }>
  >({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!school?.id || !myUid || isFirebaseMockMode()) {
      const demo = getDemoFollowData(myUid);
      setFollowing(demo.following);
      setFollowers(demo.followers);
      setProfileMap(demo.profileMap);
      return;
    }
    const [fIds, ferIds] = await Promise.all([
      listFollowingIds(school.id, myUid, 200),
      listFollowersIds(school.id, myUid, 200),
    ]);
    setFollowing(fIds);
    setFollowers(ferIds);
    const uniq = [...new Set([...fIds, ...ferIds])];
    const map = await fetchSchoolDirectoryProfileMap(school.id, uniq, getDb());
    setProfileMap(map);
  }, [school?.id, myUid]);

  useFocusEffect(
    useCallback(() => {
      let c = false;
      (async () => {
        setLoading(true);
        try {
          if (!c) await load();
        } finally {
          if (!c) setLoading(false);
        }
      })();
      return () => {
        c = true;
      };
    }, [load]),
  );

  React.useEffect(() => {
    props?.navigation?.setOptions?.({ title: '追蹤與粉絲' });
  }, [props?.navigation]);

  const data = tab === 'following' ? following : followers;

  const onPull = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  async function unfollowTap(target: string) {
    if (!school?.id || isFirebaseMockMode()) return;
    try {
      await unfollowUser(school.id, myUid, target);
      await load();
    } catch (e: any) {
      Alert.alert('取消追蹤失敗', e?.message ?? String(e));
    }
  }

  if (shouldBlockForNoLogin({ uid: auth.user?.uid ?? null, hasUser: !!auth.user })) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text style={styles.muted}>請先登入</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.tabs}>
        <Pressable
          style={[styles.tab, tab === 'following' && styles.tabOn]}
          onPress={() => setTab('following')}
        >
          <Text style={[styles.tabTxt, tab === 'following' && styles.tabTxtOn]}>
            追蹤中 · {following.length}
          </Text>
        </Pressable>
        <Pressable style={[styles.tab, tab === 'followers' && styles.tabOn]} onPress={() => setTab('followers')}>
          <Text style={[styles.tabTxt, tab === 'followers' && styles.tabTxtOn]}>
            粉絲 · {followers.length}
          </Text>
        </Pressable>
      </View>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.accent} />
        </View>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={data}
          keyExtractor={(id) => id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPull} />}
          ListEmptyComponent={
            <Text style={[styles.muted, { padding: 32, textAlign: 'center' }]}>
              {tab === 'following' ? '尚未追蹤任何人' : '尚無人追蹤你'}
            </Text>
          }
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + 20 }}
          renderItem={({ item: uid }) => {
            const pm = profileMap[uid];
            const label = pm?.displayName ?? uid.slice(0, 10);
            return (
              <View style={styles.card}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>{label}</Text>
                  {pm?.roleLabel ? (
                    <Text style={styles.sub}>{pm.roleLabel}</Text>
                  ) : (
                    <Text style={styles.sub} numberOfLines={1}>
                      {uid}
                    </Text>
                  )}
                  {tab === 'followers' ? <PeerFollowButton myUid={myUid} peerUid={uid} compact /> : null}
                </View>
                <View style={{ alignItems: 'flex-end', gap: 8 }}>
                  <Pressable hitSlop={8} onPress={() => nav?.navigate?.('Chat', { peerId: uid })}>
                    <Ionicons name="chatbubble-outline" size={22} color={theme.colors.accent} />
                  </Pressable>
                  {tab === 'following' ? (
                    <Pressable onPress={() => void unfollowTap(uid)} hitSlop={6} style={{ paddingVertical: 4 }}>
                      <Text style={{ color: theme.colors.danger, fontWeight: '700', fontSize: 13 }}>取消追蹤</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { color: theme.colors.muted, fontSize: 14 },
  tabs: { flexDirection: 'row', marginHorizontal: 16, marginTop: 8, gap: 10 },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
  },
  tabOn: { borderColor: theme.colors.accent, backgroundColor: theme.colors.accentSoft },
  tabTxt: { fontSize: 13, fontWeight: '700', color: theme.colors.textSecondary },
  tabTxtOn: { color: theme.colors.accent },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 14,
    marginBottom: 10,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    gap: 12,
  },
  title: { fontSize: 16, fontWeight: '700', color: theme.colors.text },
  sub: { fontSize: 12, color: theme.colors.textSecondary, marginTop: 4 },
});

export default FollowingListsScreen;
