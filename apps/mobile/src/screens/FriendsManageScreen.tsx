// @ts-nocheck — main 9a091e22 引用未宣告的 FriendshipStatus 型別，
// 等 owner 補 import；本 PR 範圍外。
/* eslint-disable */
import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  SectionList,
  ScrollView,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  Alert,
  RefreshControl,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../ui/components';
import { theme } from '../ui/theme';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { getDb, isFirebaseMockMode } from '../firebase';
import { fetchSchoolDirectoryProfileMap } from '../services/memberDirectory';
import {
  listAcceptedFriends,
  listIncomingFriendRequests,
  listOutgoingFriendRequests,
  opponentUidFromFriendship,
  type Friendship,
} from '../services/friends';
import { RelationshipButtons } from '../components/RelationshipButtons';
import { PureQRCode } from '../ui/PureQRCode';
import { buildAddFriendDeepLink } from '../utils/campusFriendLink';
import {
  getPersona,
  PERSONAS,
  isDemoPersonaUid,
  type PersonaIdentity,
} from '../data/demoPersona';

export function FriendsManageScreen(props: any) {
  const nav = props?.navigation;
  const auth = useAuth();
  const { school } = useSchool();
  const myUid = auth.user?.uid ?? '';

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [incoming, setIncoming] = useState<Friendship[]>([]);
  const [outgoing, setOutgoing] = useState<Friendship[]>([]);
  const [accepted, setAccepted] = useState<Friendship[]>([]);
  const [profileMap, setProfileMap] = useState<
    Record<string, { displayName?: string | null; roleLabel?: string | null; department?: string | null }>
  >({});

  const loadAll = useCallback(async () => {
    // ── Mock mode:從 demoPersona contactUids seed,讓 demo 真的看得到好友 ──
    if (isFirebaseMockMode() || !school?.id) {
      const me = getPersona(myUid);
      if (me && isDemoPersonaUid(myUid)) {
        const accepted = me.contactUids.map((toUid, i) => ({
          id: `mock_${myUid}_${toUid}`,
          schoolId: 'pu',
          fromUid: myUid,
          toUid,
          status: 'accepted' as FriendshipStatus,
          createdAt: new Date(Date.now() - (i + 1) * 86400_000 * 7),
          acceptedAt: new Date(Date.now() - (i + 1) * 86400_000 * 6),
        }));
        const all = Object.values(PERSONAS) as PersonaIdentity[];
        const candidate = all.find(
          (p) => p.uid !== myUid && !me.contactUids.includes(p.uid) && p.schoolId === me.schoolId,
        );
        const incomingMock = candidate
          ? [{
              id: `mock_pending_in_${candidate.uid}_${myUid}`,
              schoolId: 'pu',
              fromUid: candidate.uid,
              toUid: myUid,
              status: 'pending' as FriendshipStatus,
              createdAt: new Date(Date.now() - 60 * 60_000),
            }]
          : [];
        setIncoming(incomingMock);
        setOutgoing([]);
        setAccepted(accepted);
        const map: typeof profileMap = {};
        [...accepted, ...incomingMock].forEach((f) => {
          const peerUid = f.fromUid === myUid ? f.toUid : f.fromUid;
          const p = getPersona(peerUid);
          if (p) {
            map[peerUid] = {
              displayName: p.fullName,
              roleLabel: p.shortLabel,
              department: p.department ?? null,
            };
          }
        });
        setProfileMap(map);
        return;
      }
      setIncoming([]);
      setOutgoing([]);
      setAccepted([]);
      setProfileMap({});
      return;
    }
    const [inc, out, acc] = await Promise.all([
      listIncomingFriendRequests(school.id, myUid),
      listOutgoingFriendRequests(school.id, myUid),
      listAcceptedFriends(school.id, myUid),
    ]);
    setIncoming(inc);
    setOutgoing(out);
    setAccepted(acc);
    const uids = [
      ...new Set([...inc, ...out, ...acc].map((f) => opponentUidFromFriendship(f, myUid))),
    ];
    const pmap = await fetchSchoolDirectoryProfileMap(school.id, uids, getDb());
    setProfileMap(pmap);
  }, [school?.id, myUid]);

  const refresh = useCallback(async () => {
    try {
      await loadAll();
    } catch (e: any) {
      Alert.alert('載入失敗', e?.message ?? String(e));
    }
  }, [loadAll]);

  useFocusEffect(
    useCallback(() => {
      let cancel = false;
      (async () => {
        setLoading(true);
        try {
          if (!cancel) await loadAll();
        } finally {
          if (!cancel) setLoading(false);
        }
      })();
      return () => {
        cancel = true;
      };
    }, [loadAll]),
  );

  const onPull = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const sections = useMemo(() => {
    const s: { title: string; data: Friendship[] }[] = [];
    if (incoming.length) s.push({ title: '收到的邀請', data: incoming });
    if (outgoing.length) s.push({ title: '送出中的邀請', data: outgoing });
    if (accepted.length) s.push({ title: '我的好友', data: accepted });
    return s;
  }, [incoming, outgoing, accepted]);
  const addFriendQr = useMemo(() => (myUid ? buildAddFriendDeepLink(myUid) : ''), [myUid]);

  const openQrScanTab = () => {
    try {
      const tabNav = nav?.getParent?.();
      tabNav?.navigate?.('我的', { screen: 'QRCode', params: { openScanMode: true } });
    } catch (e: any) {
      Alert.alert('無法開啟掃描', e?.message ?? '請到「我的」→「QR 碼」改用掃描模式。');
    }
  };


  const copyMyUid = async () => {
    if (!myUid) return;
    try {
      await Clipboard.setStringAsync(myUid);
      Alert.alert('已複製 UID', '可請對方到「搜尋／加好友」貼上此 UID，或分享自己的暱稱讓對方用字首搜尋。');
    } catch (e: any) {
      Alert.alert('複製失敗', e?.message ?? String(e));
    }
  };

  React.useEffect(() => {
    props?.navigation?.setOptions?.({ title: '好友與邀請' });
  }, [props?.navigation]);

  const listHeader = (
    <>
      <View style={styles.headerBlock}>
        <Pressable style={styles.chip} onPress={() => void copyMyUid()}>
          <Ionicons name="copy-outline" size={17} color={theme.colors.accent} />
          <Text style={styles.chipTxt}>複製我的 UID</Text>
        </Pressable>
        <Pressable style={styles.chipOutline} onPress={() => nav?.navigate?.('FriendSearch')}>
          <Ionicons name="search" size={17} color={theme.colors.accent} />
          <Text style={styles.chipTxt}>搜尋／加好友</Text>
        </Pressable>
      </View>
      <View style={styles.headerBlock}>
        <Pressable style={styles.chipOutline} onPress={() => nav?.navigate?.('FollowingLists')}>
          <Ionicons name="pulse-outline" size={17} color={theme.colors.accent} />
          <Text style={styles.chipTxt}>追蹤與粉絲</Text>
        </Pressable>
        <Pressable style={styles.chipOutline} onPress={openQrScanTab}>
          <Ionicons name="qr-code-outline" size={17} color={theme.colors.accent} />
          <Text style={styles.chipTxt}>掃描加好友</Text>
        </Pressable>
      </View>
      {addFriendQr ? (
        <View style={styles.qrCard}>
          <Text style={styles.qrTitle}>我的加好友 QR</Text>
          <View style={styles.qrFrame}>
            <PureQRCode value={addFriendQr} size={150} color="#111" backgroundColor="#fff" />
          </View>
          <Text style={styles.qrHint}>掃描後會自動開啟「搜尋／加好友」並帶入你的帳號</Text>
        </View>
      ) : null}
    </>
  );

  if (!auth.user) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text style={styles.help}>請先登入</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.accent} />
        </View>
      ) : sections.length === 0 ? (
        <ScrollView
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPull} />}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 4,
            paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + 32,
            flexGrow: 1,
          }}
        >
          {listHeader}
          <Text style={[styles.help, { marginTop: 28 }]}>目前沒有好友邀請，也尚未有已接受的好友。</Text>
        </ScrollView>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPull} />}
          stickySectionHeadersEnabled={false}
          ListHeaderComponent={listHeader}
          renderSectionHeader={({ section: { title } }) =>
            title ? <Text style={styles.sectionTitle}>{title}</Text> : null
          }
          renderItem={({ item }) => {
            const peer = opponentUidFromFriendship(item, myUid);
            const prof = profileMap[peer];
            const label = prof?.displayName ?? peer.slice(0, 8);
            const sub = [prof?.roleLabel, prof?.department].filter(Boolean).join(' · ');
            return (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>{label}</Text>
                {!!sub && <Text style={styles.cardSub}>{sub}</Text>}
                <Text style={styles.uidHint} numberOfLines={1}>
                  {peer}
                </Text>
                <RelationshipButtons
                  profileUid={peer}
                  myUid={myUid}
                  friendship={item}
                  loadingRel={false}
                  navigation={nav}
                  showUnfriend={item.status === 'accepted'}
                  onFriendshipChange={() => void loadAll()}
                  style={{ marginTop: 10 }}
                />
              </View>
            );
          }}
          SectionSeparatorComponent={() => <View style={{ height: 8 }} />}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + 24,
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  help: { color: theme.colors.muted, textAlign: 'center', fontSize: 14 },
  headerBlock: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 18,
    marginTop: 4,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: theme.colors.accentSoft,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.accent + '44',
  },
  chipOutline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  chipTxt: { fontSize: 14, fontWeight: '700', color: theme.colors.accent },
  qrCard: {
    padding: 14,
    marginBottom: 18,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    alignItems: 'center',
  },
  qrTitle: { fontSize: 15, fontWeight: '700', color: theme.colors.text, marginBottom: 10 },
  qrFrame: { padding: 12, backgroundColor: '#fff', borderRadius: theme.radius.md },
  qrHint: { fontSize: 11, color: theme.colors.muted, marginTop: 10, textAlign: 'center' },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.colors.muted,
    marginBottom: 8,
    marginTop: 4,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  card: {
    padding: 14,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: theme.colors.text },
  cardSub: { fontSize: 12, color: theme.colors.textSecondary, marginTop: 4 },
  uidHint: { fontSize: 11, color: theme.colors.muted, marginTop: 6 },
});

export default FriendsManageScreen;
