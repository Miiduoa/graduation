import { Video, ResizeMode } from 'expo-av';
import { usePrivateMedia } from '../../services/usePrivateMedia';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Animated,
  AppState,
  Easing,
  Image,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isFirebaseMockMode } from '../../firebase';
import {
  groupStoriesByAuthor,
  markStoryViewed,
  type CampusStoryDoc,
  type StoryAuthorGroup,
} from '../../services/stories';

const STORY_DURATION = 7000;

/** Refresh at the next expiry, also when returning from a suspended app. */
export function useCampusStories(rows: CampusStoryDoc[], schoolId?: string, uid?: string) {
  const [clock, setClock] = useState(Date.now);
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set());
  const [selectedId, selectStory] = useState<string | null>(null);
  const groups = useMemo(() => {
    const now = Math.max(clock, Date.now());
    return groupStoriesByAuthor(
      rows.filter(
        (row) =>
          uid &&
          schoolId &&
          row.schoolId === schoolId &&
          typeof row.expiresAt === 'number' &&
          Number.isFinite(row.expiresAt) &&
          row.expiresAt > now,
      ),
      uid,
    );
  }, [rows, schoolId, uid, clock]);

  useEffect(() => {
    const expires = groups.flatMap((g) => g.stories.map((s) => s.expiresAt!));
    if (!expires.length) return;
    const refresh = () => setClock(Date.now());
    const timer = setTimeout(
      refresh,
      Math.min(2147483647, Math.max(0, Math.min(...expires) - Date.now())),
    );
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [groups]);

  const groupIndex = selectedId
    ? groups.findIndex((g) => g.stories.some((s) => s.id === selectedId))
    : -1;
  const group = groups[groupIndex];
  const index = group?.stories.findIndex((s) => s.id === selectedId) ?? -1;
  const story = group?.stories[index];
  useEffect(() => {
    if (selectedId && !story) selectStory(null);
    if (
      story &&
      uid &&
      !seen.has(story.id) &&
      story.expiresAt! > Date.now() &&
      !isFirebaseMockMode()
    ) {
      setSeen((previous) => new Set(previous).add(story.id));
      void markStoryViewed(story.id, uid).catch(() => {});
    }
  }, [selectedId, story, uid, seen]);

  const openGroup = useCallback(
    (g: StoryAuthorGroup) => {
      const active = g.stories.filter((s) => s.schoolId === schoolId && s.expiresAt! > Date.now());
      selectStory((active.find((s) => !seen.has(s.id)) ?? active[0])?.id ?? null);
    },
    [schoolId, seen],
  );
  return { groups, groupIndex, index, openGroup, selectStory, seen };
}

export function CampusStoryViewer({
  deck,
  names,
}: {
  deck: ReturnType<typeof useCampusStories>;
  names: Record<string, string>;
}) {
  const { groups, groupIndex, index, selectStory } = deck;
  const group = groups[groupIndex];
  const story = group?.stories[index];
  if (!story || story.expiresAt! <= Date.now()) return null;
  const previousGroup = groups[groupIndex - 1];
  return (
    <StorySlide
      story={story}
      group={group}
      index={index}
      author={group.isMine ? '我的限時動態' : names[group.authorUid] || '同學'}
      previousId={
        group.stories[index - 1]?.id ?? previousGroup?.stories[previousGroup.stories.length - 1]?.id
      }
      nextId={group.stories[index + 1]?.id ?? groups[groupIndex + 1]?.stories[0]?.id}
      previousAuthorId={groups[groupIndex - 1]?.stories[0]?.id}
      nextAuthorId={groups[groupIndex + 1]?.stories[0]?.id}
      selectStory={selectStory}
    />
  );
}

type SlideProps = {
  story: CampusStoryDoc;
  group: StoryAuthorGroup;
  index: number;
  author: string;
  previousId?: string;
  nextId?: string;
  previousAuthorId?: string;
  nextAuthorId?: string;
  selectStory: (id: string | null) => void;
};

function StorySlide({
  story,
  group,
  index,
  author,
  previousId,
  nextId,
  previousAuthorId,
  nextAuthorId,
  selectStory,
}: SlideProps) {
  const insets = useSafeAreaInsets();
  const [playing, setPlaying] = useState(false);
  const [loadedImage, setLoadedImage] = useState('');
  const [failedImage, setFailedImage] = useState('');
  const mediaUrl = usePrivateMedia(story.mediaUrl);
  const hasImage = (story.kind === 'image' || story.kind === 'video') && !!story.mediaUrl;
  const imageFailed = hasImage && (!mediaUrl || failedImage === story.id);
  const ready = !hasImage || loadedImage === story.id || imageFailed;
  const close = () => selectStory(null);
  const remaining = React.useRef(STORY_DURATION);
  const [fill] = useState(() => new Animated.Value(0));
  useEffect(() => {
    remaining.current = STORY_DURATION;
    fill.setValue(0);
  }, [story.id, fill]);

  useEffect(() => {
    if (!playing) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') setPlaying(false);
    });
    return () => subscription.remove();
  }, [playing]);
  useEffect(() => {
    if (!playing || !ready) return;
    const start = Date.now();
    const duration = remaining.current;
    const progress = Animated.timing(fill, {
      toValue: 1,
      duration,
      easing: Easing.linear,
      useNativeDriver: true,
      isInteraction: false,
    });
    progress.start();
    const timer = setTimeout(() => selectStory(nextId ?? null), duration);
    return () => {
      clearTimeout(timer);
      progress.stop();
      remaining.current = Math.max(0, duration - (Date.now() - start));
    };
  }, [playing, ready, story.id, nextId, selectStory, fill]);

  const swipe = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_event, { dx, dy }) =>
          Math.abs(dx) > 18 && Math.abs(dx) > Math.abs(dy) * 1.5,
        onPanResponderRelease: (_event, { dx, dy }) => {
          if (Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
          const target = dx < 0 ? nextAuthorId : previousAuthorId;
          if (target) selectStory(target);
        },
      }),
    [nextAuthorId, previousAuthorId, selectStory],
  );
  const total = group.stories.length;
  const nextLabel = nextId ? '下一則' : '看完了';
  const playLabel = playing ? '暫停播放' : '自動播放';

  return (
    <Modal visible animationType="fade" onRequestClose={close}>
      <View
        accessibilityViewIsModal
        onAccessibilityEscape={close}
        style={[
          styles.shell,
          { paddingTop: Math.max(12, insets.top), paddingBottom: Math.max(12, insets.bottom) },
        ]}
      >
        <View style={[styles.progress, total > 16 && { gap: 1 }]}>
          {group.stories.map((s, i) => (
            <View
              key={s.id}
              style={[styles.segment, i < index && styles.seen, i === index && styles.current]}
            >
              {i === index && (
                <Animated.View style={[styles.fill, { transform: [{ scaleX: fill }] }]} />
              )}
            </View>
          ))}
        </View>
        <View style={styles.header}>
          <View style={styles.identity} accessibilityLiveRegion="polite">
            <Text numberOfLines={1} style={styles.author}>
              {author}
            </Text>
            <Text style={styles.counter}>
              第 {index + 1} 則，共 {total} 則
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={playLabel}
            style={styles.iconButton}
            onPress={() => setPlaying((value) => !value)}
          >
            <Ionicons name={playing ? 'pause' : 'play'} color="white" size={20} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="關閉限時動態"
            style={styles.iconButton}
            onPress={close}
          >
            <Ionicons name="close" color="white" size={24} />
          </Pressable>
        </View>
        <View
          style={[styles.canvas, !hasImage && { backgroundColor: story.bgColor || '#243b35' }]}
          {...swipe.panHandlers}
        >
          {story.kind === 'video' && mediaUrl && !imageFailed ? (
            <Video
              key={story.id}
              source={{ uri: mediaUrl }}
              style={styles.photo}
              resizeMode={ResizeMode.CONTAIN}
              useNativeControls
              shouldPlay
              onLoad={() => setLoadedImage(story.id)}
              onError={() => setFailedImage(story.id)}
            />
          ) : hasImage && !imageFailed ? (
            <Image
              key={story.id}
              source={{ uri: mediaUrl! }}
              style={styles.photo}
              resizeMode="contain"
              accessibilityLabel="限時動態照片"
              onLoad={() => setLoadedImage(story.id)}
              onError={() => setFailedImage(story.id)}
            />
          ) : (
            <ScrollView key={story.id} contentContainerStyle={styles.centerText}>
              <Text style={styles.storyText}>
                {imageFailed ? '照片暫時無法顯示' : story.text || '（無內容）'}
              </Text>
            </ScrollView>
          )}
          <Pressable
            accessible={false}
            importantForAccessibility="no"
            disabled={!previousId}
            style={[styles.tapZone, { left: 0 }]}
            onPress={() => previousId && selectStory(previousId)}
          />
          <Pressable
            accessible={false}
            importantForAccessibility="no"
            style={[styles.tapZone, { right: 0 }]}
            onPress={() => selectStory(nextId ?? null)}
          />
        </View>
        {(hasImage && story.text) || story.poiName ? (
          <ScrollView
            key={story.id}
            style={styles.details}
            contentContainerStyle={styles.detailContent}
          >
            {hasImage && !!story.text && <Text style={styles.caption}>{story.text}</Text>}
            {!!story.poiName && <Text style={styles.counter}>{story.poiName}</Text>}
          </ScrollView>
        ) : null}
        <View style={styles.controls}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !previousId }}
            disabled={!previousId}
            style={[styles.step, !previousId && styles.disabled]}
            onPress={() => previousId && selectStory(previousId)}
          >
            <Ionicons name="chevron-back" color="white" size={18} />
            <Text style={styles.stepText}>上一則</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={styles.step}
            onPress={() => selectStory(nextId ?? null)}
          >
            <Text style={styles.stepText}>{nextLabel}</Text>
            <Ionicons name={nextId ? 'chevron-forward' : 'checkmark'} color="white" size={18} />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, paddingHorizontal: 12, backgroundColor: '#0b0d0d' },
  progress: { flexDirection: 'row', gap: 4 },
  segment: { height: 3, flex: 1, borderRadius: 3, backgroundColor: '#4a4e4d' },
  seen: { backgroundColor: '#fff' },
  current: { backgroundColor: '#929b98' },
  fill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#fff',
    transformOrigin: 'left center',
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6 },
  identity: { flex: 1, paddingLeft: 4 },
  author: { color: '#fff', fontWeight: '700', fontSize: 17 },
  counter: { color: '#c2cbc8', fontSize: 13 },
  iconButton: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  canvas: { flex: 1, overflow: 'hidden', borderRadius: 16, backgroundColor: '#000' },
  photo: { width: '100%', height: '100%' },
  centerText: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  storyText: {
    color: 'white',
    fontWeight: '700',
    textAlign: 'center',
    fontSize: 22,
    lineHeight: 32,
  },
  tapZone: { position: 'absolute', top: 0, bottom: 0, width: '24%' },
  details: { flexGrow: 0, maxHeight: '30%' },
  detailContent: { gap: 4, paddingHorizontal: 4, paddingTop: 8 },
  caption: { color: '#fff', fontSize: 16, lineHeight: 23 },
  controls: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 8, gap: 8 },
  step: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 22,
    backgroundColor: '#242928',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  disabled: { opacity: 0.4 },
  stepText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
