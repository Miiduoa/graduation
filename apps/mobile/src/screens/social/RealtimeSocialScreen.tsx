/* eslint-disable */
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  Alert,
  TextInput,
  Modal,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../../state/auth';
import { useSchool } from '../../state/school';
import { theme } from '../../ui/theme';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../../ui/navigationTheme';
import { getDb, isFirebaseMockMode } from '../../firebase';
import { listActiveStoriesForSchool, markStoryViewed } from '../../services/stories';
import { heartbeatCheckIn, peersAtPoi, clearPresence } from '../../services/checkins';
import { fetchSchoolDirectoryProfiles } from '../../services/memberDirectory';
import { useCampusSocialStackNav } from './CampusSocialNavContext';

type StoryLite = {
  id: string;
  kind?: string;
  text?: string;
  mediaUrl?: string | null;
};

const DEFAULT_POI = 'library-main';

export function RealtimeSocialScreen() {
  const injected = useCampusSocialStackNav();
  const fb = useNavigation<any>();
  const nav = injected ?? fb;
  const auth = useAuth();
  const { school } = useSchool();
  const [stories, setStories] = useState<any[]>([]);
  const [storiesLoading, setStoriesLoading] = useState(true);
  const [poiInput, setPoiInput] = useState(DEFAULT_POI);
  const [peers, setPeers] = useState<{ uid: string; name?: string }[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [heartbeatSession, setHeartbeatSession] = useState<string | null>(null);
  const [storyReader, setStoryReader] = useState<StoryLite | null>(null);
  const uid = auth.user?.uid;

  const refreshStories = useCallback(async () => {
    if (isFirebaseMockMode() || !school?.id) {
      setStories([]);
      return;
    }
    const rows = await listActiveStoriesForSchool(school.id, 40);
    setStories(rows);
  }, [school?.id]);

  const refreshPeers = useCallback(async () => {
    if (isFirebaseMockMode() || !school?.id) return;
    const poi = poiInput.trim() || DEFAULT_POI;
    const raw = await peersAtPoi(school.id, poi);
    const db = getDb();
    const unique = [
      ...new Set(raw.map((r) => r.uid).filter((x): x is string => typeof x === 'string' && !!x)),
    ].filter((x) => x !== uid);
    if (unique.length === 0) {
      setPeers([]);
      return;
    }
    const profiles = await fetchSchoolDirectoryProfiles(school.id, unique, db);
    const map: Record<string, string> = {};
    profiles.forEach((p) => {
      map[p.uid] = (p.displayName ?? p.uid.slice(0, 6)).trim();
    });
    setPeers(unique.map((id) => ({ uid: id, name: map[id] })));
  }, [school?.id, poiInput, uid]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setStoriesLoading(true);
      await refreshStories();
      await refreshPeers();
      if (!cancelled) setStoriesLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshStories, refreshPeers]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refreshStories(), refreshPeers()]);
    setRefreshing(false);
  };

  const tapHeart = async () => {
    if (!uid || !school?.id) {
      Alert.alert('請登入');
      return;
    }
    const poi = poiInput.trim() || DEFAULT_POI;
    try {
      if (heartbeatSession) {
        await clearPresence(school.id, heartbeatSession);
      }
      const sid = await heartbeatCheckIn(uid, school.id, poi);
      setHeartbeatSession(sid);
      await refreshPeers();
      Alert.alert('已打卡', `位置代號 · ${poi}\n將在數分鐘內對同點師生可見。`);
    } catch (e: any) {
      Alert.alert('打卡失敗', e?.message ?? String(e));
    }
  };

  const openStory = (row: StoryLite) => {
    setStoryReader(row);
    if (uid && !isFirebaseMockMode()) void markStoryViewed(row.id, uid).catch(() => {});
  };

  const openCompose = () => {
    if (!auth.user) {
      Alert.alert('請先登入');
      return;
    }
    nav?.navigate?.('StoryCompose' as never);
  };

  return (
    <View style={[styles.root, { paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }]}>
      <View style={styles.topActions}>
        <Text style={styles.title}>即時</Text>
        <Pressable onPress={openCompose} style={styles.storyBtn}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>發 Story</Text>
        </Pressable>
      </View>
      <Text style={styles.sub}>24h Story 與輕量 LBS</Text>

      <View style={styles.poiBar}>
        <Text style={{ color: theme.colors.text, fontWeight: '700' }}>POI ID</Text>
        <TextInput
          style={styles.poiInput}
          value={poiInput}
          onChangeText={setPoiInput}
          placeholderTextColor={theme.colors.textSecondary}
        />
        <Pressable style={styles.pulseBtn} onPress={tapHeart}>
          <Text style={{ color: '#fff', fontWeight: '800' }}>我在這裡</Text>
        </Pressable>
      </View>

      <Text style={styles.section}>同點位 · {peers.length}</Text>
      <FlatList
        horizontal
        data={peers.slice(0, 12)}
        keyExtractor={(p) => p.uid}
        style={{ marginBottom: 12, maxHeight: 46 }}
        ListEmptyComponent={
          <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>
            {isFirebaseMockMode() ? '模擬模式無資料' : '暫無同點對象'}
          </Text>
        }
        renderItem={({ item }) => (
          <View style={styles.peerChip}>
            <Text style={styles.peerTxt}>{item.name ?? item.uid.slice(0, 6)}</Text>
          </View>
        )}
      />

      <Text style={styles.section}>活躍 Story</Text>
      {storiesLoading ? (
        <ActivityIndicator style={{ marginTop: 12 }} />
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={stories}
          keyExtractor={(s) => s.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <Text style={{ color: theme.colors.textSecondary, marginTop: 10 }}>
              目前沒有未過期的 Story。點右上方發布。
            </Text>
          }
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          renderItem={({ item }) => (
            <Pressable style={styles.storyCard} onPress={() => openStory(item as StoryLite)}>
              <Text style={styles.kind}>{item.kind}</Text>
              <Text style={styles.storySnippet} numberOfLines={4}>
                {typeof item.text === 'string'
                  ? item.text
                  : typeof item.mediaUrl === 'string'
                    ? item.mediaUrl
                    : '（媒體／點開瀏覽）'}
              </Text>
            </Pressable>
          )}
        />
      )}
      <Modal visible={!!storyReader} transparent animationType="fade" onRequestClose={() => setStoryReader(null)}>
        <Pressable style={styles.storyBackdrop} onPress={() => setStoryReader(null)}>
          <View style={styles.storyPopup}>
            <Text style={{ color: '#fff', fontWeight: '900', marginBottom: 10 }}>
              {String(storyReader?.kind ?? 'Story')}
            </Text>
            <Text style={{ color: '#eef2ff', lineHeight: 22 }}>
              {typeof storyReader?.text === 'string' && storyReader.text.trim()
                ? storyReader.text
                : typeof storyReader?.mediaUrl === 'string' && storyReader.mediaUrl
                  ? storyReader.mediaUrl
                  : '此則為純視覺內容，完整瀏覽稍後將支援。'}
            </Text>
            <Pressable style={styles.storyDismiss} onPress={() => setStoryReader(null)}>
              <Text style={{ color: '#0f172a', fontWeight: '800' }}>關閉</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bg, paddingHorizontal: 14, paddingTop: 6 },
  topActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  storyBtn: {
    backgroundColor: theme.colors.social,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: theme.radius.md,
  },
  title: { fontSize: 18, fontWeight: '900', color: theme.colors.text },
  sub: { fontSize: 12, color: theme.colors.textSecondary, marginVertical: 6 },
  poiBar: { gap: 8, marginBottom: 12 },
  poiInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 10,
    color: theme.colors.text,
    backgroundColor: theme.colors.surface,
  },
  pulseBtn: {
    backgroundColor: theme.colors.accent,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: theme.radius.md,
    marginBottom: 4,
  },
  section: { fontWeight: '800', color: theme.colors.text, marginBottom: 8 },
  peerChip: {
    marginRight: 8,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  peerTxt: { fontSize: 13, fontWeight: '600', color: theme.colors.text },
  storyCard: {
    padding: 14,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  kind: { fontSize: 11, color: theme.colors.accent, fontWeight: '800', marginBottom: 8 },
  storySnippet: { fontSize: 14, color: theme.colors.text, lineHeight: 20 },
  storyBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.72)',
    justifyContent: 'center',
    padding: 22,
  },
  storyPopup: {
    padding: 20,
    borderRadius: theme.radius.md,
    backgroundColor: '#1f2937',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.22)',
    maxHeight: '80%',
  },
  storyDismiss: {
    alignSelf: 'flex-end',
    marginTop: 18,
    backgroundColor: '#e2e8f0',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: theme.radius.md,
  },
});

export default RealtimeSocialScreen;
