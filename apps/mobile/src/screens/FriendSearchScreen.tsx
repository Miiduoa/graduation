/* eslint-disable */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../ui/components';
import { theme } from '../ui/theme';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { isFirebaseMockMode } from '../firebase';
import type { SchoolDirectoryProfile } from '../services/memberDirectory';
import { searchSchoolDirectoryByDisplayNamePrefix } from '../services/memberDirectory';
import { RelationshipButtons } from '../components/RelationshipButtons';
import { PeerFollowButton } from '../components/PeerFollowButton';
import {
  getFriendshipBetween,
  type Friendship,
} from '../services/friends';

type RowProps = {
  profile: SchoolDirectoryProfile;
  friendship: Friendship | null | undefined;
  myUid: string;
  loadingRel: boolean;
  navigation: unknown;
  onFriendshipChange: (uid: string, f: Friendship | null) => void;
};

function FriendshipRow(props: RowProps) {
  const { profile, friendship, myUid, loadingRel, navigation: navigationProp, onFriendshipChange } =
    props;

  const label = profile.displayName ?? profile.uid.slice(0, 8);
  const sub = [profile.roleLabel, profile.department].filter(Boolean).join(' · ');

  return (
    <View style={styles.card}>
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle}>{label}</Text>
        {!!sub && <Text style={styles.cardSub}>{sub}</Text>}
        <Text style={styles.uidHint} numberOfLines={1}>
          {profile.uid}
        </Text>
      </View>
      <PeerFollowButton myUid={myUid} peerUid={profile.uid} compact />
      <RelationshipButtons
        profileUid={profile.uid}
        myUid={myUid}
        friendship={friendship}
        loadingRel={loadingRel}
        navigation={navigationProp}
        onFriendshipChange={onFriendshipChange}
        style={{ marginTop: 12, alignSelf: 'stretch' }}
      />
    </View>
  );
}

export function FriendSearchScreen(props: any) {
  const nav = props?.navigation;
  const presetUid = props?.route?.params?.presetUid as string | undefined;
  const auth = useAuth();
  const { school } = useSchool();
  const myUid = auth.user?.uid ?? '';

  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SchoolDirectoryProfile[]>([]);
  const [rels, setRels] = useState<Record<string, Friendship | null>>({});

  useEffect(() => {
    const t = setTimeout(() => setDebounced(text.trim()), 380);
    return () => clearTimeout(t);
  }, [text]);

  useEffect(() => {
    if (presetUid && typeof presetUid === 'string' && presetUid.trim().length >= 18) {
      setText(presetUid.trim());
    }
  }, [presetUid]);

  useEffect(() => {
    props?.navigation?.setOptions?.({ title: '搜尋／加好友' });
  }, [props?.navigation]);

  const fetchResults = useCallback(async () => {
    if (!school?.id || !debounced || debounced.length < 1 || isFirebaseMockMode()) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const rows = await searchSchoolDirectoryByDisplayNamePrefix(school.id, debounced, 24);
      setResults(rows.filter((r) => r.uid !== myUid));
      setRels({});
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [school?.id, debounced, myUid]);

  useEffect(() => {
    void fetchResults();
  }, [fetchResults]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!school?.id || !myUid || results.length === 0) return;
      const map: Record<string, Friendship | null> = {};
      await Promise.all(
        results.map(async (r) => {
          try {
            const f = await getFriendshipBetween(school.id!, myUid, r.uid);
            if (!cancelled) map[r.uid] = f;
          } catch {
            if (!cancelled) map[r.uid] = null;
          }
        }),
      );
      if (!cancelled) setRels(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [school?.id, myUid, results]);

  const onRelChange = (uid: string, f: Friendship | null) => {
    setRels((prev) => ({ ...prev, [uid]: f }));
  };

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
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View style={styles.searchWrap}>
          <View style={styles.searchBox}>
            <Ionicons name="search" size={18} color={theme.colors.muted} />
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="名字字首、暱稱，或貼上對方 UID"
              placeholderTextColor={theme.colors.muted}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {text.length > 0 && (
              <Pressable hitSlop={8} onPress={() => setText('')}>
                <Ionicons name="close-circle" size={18} color={theme.colors.muted} />
              </Pressable>
            )}
          </View>
          <Text style={styles.hint}>搜尋同校的 directory 通訊錄（Firestore displayName 字首比對）</Text>
        </View>

        {isFirebaseMockMode() ? (
          <View style={styles.center}>
            <Text style={styles.help}>模擬模式無法連線通訊錄</Text>
          </View>
        ) : loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.colors.accent} />
          </View>
        ) : (
          <FlatList
            data={results}
            keyExtractor={(item) => item.uid}
            contentContainerStyle={{ paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + 24, gap: 10 }}
            ListEmptyComponent={
              <View style={{ paddingVertical: 40 }}>
                <Text style={styles.help}>
                  {debounced.length < 1 ? '請輸入至少 1 字開始搜尋' : '找不到符合的同校成員'}
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <FriendshipRow
                profile={item}
                friendship={rels[item.uid]}
                myUid={myUid}
                loadingRel={!(item.uid in rels)}
                navigation={nav}
                onFriendshipChange={onRelChange}
              />
            )}
          />
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchWrap: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: theme.colors.surface2,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  input: { flex: 1, color: theme.colors.text, fontSize: 15 },
  hint: { color: theme.colors.muted, fontSize: 12, marginTop: 8 },
  card: {
    marginHorizontal: 16,
    padding: 14,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  cardTitle: { fontSize: 16, fontWeight: '800', color: theme.colors.text },
  cardSub: { fontSize: 12, color: theme.colors.textSecondary, marginTop: 4 },
  uidHint: { fontSize: 11, color: theme.colors.muted, marginTop: 6 },
  help: { color: theme.colors.muted, textAlign: 'center', fontSize: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
});

export default FriendSearchScreen;
