/* eslint-disable */
import React, { useState, useEffect, useCallback, useRef } from 'react';
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
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { isFirebaseMockMode } from '../firebase';
import type { SchoolDirectoryProfile } from '../services/memberDirectory';
import { searchSchoolDirectoryByDisplayNamePrefix } from '../services/memberDirectory';
import { RelationshipButtons } from '../components/RelationshipButtons';
import { PeerFollowButton } from '../components/PeerFollowButton';
import { getFriendshipBetween, type Friendship } from '../services/friends';

type RowProps = {
  profile: SchoolDirectoryProfile;
  friendship: Friendship | null | undefined;
  myUid: string;
  loadingRel: boolean;
  navigation: unknown;
  onFriendshipChange: (uid: string, f: Friendship | null) => void;
};

function FriendshipRow(props: RowProps) {
  const styles = useThemeStyleSheet(createStyles);
  const {
    profile,
    friendship,
    myUid,
    loadingRel,
    navigation: navigationProp,
    onFriendshipChange,
  } = props;

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
  const styles = useThemeStyleSheet(createStyles);
  const auth = useAuth();
  const { school } = useSchool();
  const myUid = auth.user?.uid ?? '';
  if (auth.loading) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.accent} />
          <Text style={styles.help}>正在確認登入狀態…</Text>
        </View>
      </Screen>
    );
  }
  if (!myUid) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text style={styles.help}>登入後，就能尋找同校成員並傳送好友邀請。</Text>
        </View>
      </Screen>
    );
  }
  return (
    <FriendSearchContent
      key={JSON.stringify([myUid, school?.id])}
      myUid={myUid}
      schoolId={school?.id ?? ''}
      navigation={props?.navigation}
      presetUid={props?.route?.params?.presetUid}
    />
  );
}

function FriendSearchContent({
  myUid,
  schoolId,
  navigation: nav,
  presetUid,
}: {
  myUid: string;
  schoolId: string;
  navigation: any;
  presetUid?: string;
}) {
  const styles = useThemeStyleSheet(createStyles);

  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    query: string;
    rows: SchoolDirectoryProfile[];
    error: string;
  }>({
    query: '',
    rows: [],
    error: '',
  });
  const [rels, setRels] = useState<Record<string, Friendship | null>>({});
  const mounted = useRef(true);
  const requestVersion = useRef(0);
  const searchQuery = text.trim();
  const currentQuery = useRef(searchQuery);
  currentQuery.current = searchQuery;
  const results = result.query === searchQuery ? result.rows : [];
  const error = result.query === searchQuery ? result.error : '';
  const searching = searchQuery !== debounced || loading;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestVersion.current += 1;
    };
  }, []);

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
    nav?.setOptions?.({ title: '尋找同校成員' });
  }, [nav]);

  const fetchResults = useCallback(async () => {
    const version = ++requestVersion.current;
    const current = () =>
      mounted.current && requestVersion.current === version && currentQuery.current === debounced;
    if (!schoolId || !debounced || isFirebaseMockMode()) {
      setResult({ query: debounced, rows: [], error: '' });
      setLoading(false);
      return;
    }
    setLoading(true);
    setResult({ query: debounced, rows: [], error: '' });
    setRels({});
    try {
      const rows = await searchSchoolDirectoryByDisplayNamePrefix(schoolId, debounced, 24);
      if (current())
        setResult({ query: debounced, rows: rows.filter((r) => r.uid !== myUid), error: '' });
    } catch (cause) {
      if (!current()) return;
      const code = (cause as { code?: string })?.code ?? '';
      const message =
        code.endsWith('permission-denied') || code.endsWith('unauthenticated')
          ? '目前無法查詢這所學校的成員。請確認登入狀態與學校資格後再試。'
          : '暫時無法搜尋。請確認網路後再試，輸入的內容仍保留。';
      setResult({ query: debounced, rows: [], error: message });
    } finally {
      if (current()) setLoading(false);
    }
  }, [schoolId, debounced, myUid]);

  useEffect(() => {
    void fetchResults();
  }, [fetchResults]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!schoolId || result.query !== searchQuery || result.rows.length === 0) return;
      const map: Record<string, Friendship | null> = {};
      await Promise.all(
        result.rows.map(async (r) => {
          try {
            const f = await getFriendshipBetween(schoolId, myUid, r.uid);
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
  }, [schoolId, myUid, result, searchQuery]);

  const onRelChange = (uid: string, f: Friendship | null) => {
    if (!mounted.current || currentQuery.current !== result.query) return;
    setRels((prev) => ({ ...prev, [uid]: f }));
  };

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
              accessibilityLabel="搜尋同校成員"
              placeholder="輸入名字開頭，或貼上對方帳號 ID"
              maxLength={128}
              placeholderTextColor={theme.colors.muted}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {text.length > 0 && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="清除搜尋"
                hitSlop={8}
                onPress={() => setText('')}
              >
                <Ionicons name="close-circle" size={18} color={theme.colors.muted} />
              </Pressable>
            )}
          </View>
          <Text style={styles.hint}>
            只會顯示同校且允許被搜尋的成員。也可以請對方分享好友 QR Code。
          </Text>
        </View>

        {isFirebaseMockMode() ? (
          <View style={styles.center}>
            <Text style={styles.help}>示範模式未連接學校通訊錄。</Text>
          </View>
        ) : searching ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.colors.accent} />
            <Text style={styles.help}>正在搜尋…</Text>
          </View>
        ) : error ? (
          <View style={styles.center}>
            <Text accessibilityRole="alert" style={styles.help}>
              {error}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void fetchResults()}
              style={styles.retry}
            >
              <Text style={{ color: theme.colors.accent, fontWeight: '600' }}>重新搜尋</Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            data={results}
            keyExtractor={(item) => item.uid}
            contentContainerStyle={{ paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + 24, gap: 10 }}
            ListEmptyComponent={
              <View style={{ paddingVertical: 40 }}>
                <Text style={styles.help}>
                  {!schoolId
                    ? '請先選擇學校。'
                    : !searchQuery
                      ? '輸入名字開頭或帳號 ID，尋找想加的朋友。'
                      : '找不到符合的成員。請確認名字或帳號 ID，對方也可能尚未開啟搜尋。'}
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

const createStyles = () =>
  StyleSheet.create({
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
    cardTitle: { fontSize: 16, fontWeight: '700', color: theme.colors.text },
    cardSub: { fontSize: 12, color: theme.colors.textSecondary, marginTop: 4 },
    uidHint: { fontSize: 11, color: theme.colors.muted, marginTop: 6 },
    help: { color: theme.colors.muted, textAlign: 'center', fontSize: 14 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
    retry: { marginTop: 16, paddingHorizontal: 20, paddingVertical: 12 },
  });

export default FriendSearchScreen;
