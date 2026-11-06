import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { StoryVideoPlayer, supportsStoryVideo } from './StoryVideoPlayer';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isFirebaseMockMode } from '../../firebase';
import {
  groupStoriesByAuthor,
  markStoryViewed,
  type CampusStoryDoc,
  type StoryAuthorGroup,
} from '../../services/stories';
import { isDemoUid } from '../../services/demoSession';
import { useCampusSocialStackNav } from './CampusSocialNavContext';
import { StoryAudiencePanel } from './StoryAudiencePanel';
import { StoryReplyPanel } from './StoryReplyPanel';

const STORY_DURATION = 7000;

/** Refresh at the next expiry, also when returning from a suspended app. */
export function useCampusStories(rows: CampusStoryDoc[], schoolId?: string, uid?: string) {
  const [clock, setClock] = useState(Date.now);
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set());
  const recorded = React.useRef(new Set<string>());
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
  const storyId = story?.id;
  const authorUid = story?.authorUid;
  const expiresAt = story?.expiresAt;
  useEffect(() => {
    if (!storyId) {
      if (selectedId) selectStory(null);
      return;
    }
    if (!uid || !schoolId || !authorUid || !expiresAt || expiresAt <= Date.now()) return;
    setSeen((previous) => (previous.has(storyId) ? previous : new Set(previous).add(storyId)));
    if (authorUid === uid || isFirebaseMockMode() || recorded.current.has(storyId)) return;
    recorded.current.add(storyId);
    void markStoryViewed({ id: storyId, schoolId, authorUid }, uid).catch(() => {
      // Reopen to retry. A network failure should not reset the local reading position.
      recorded.current.delete(storyId);
    });
  }, [selectedId, storyId, authorUid, expiresAt, uid, schoolId]);

  const openGroup = useCallback(
    (g: StoryAuthorGroup) => {
      const active = g.stories.filter((s) => s.schoolId === schoolId && s.expiresAt! > Date.now());
      selectStory((active.find((s) => !seen.has(s.id)) ?? active[0])?.id ?? null);
    },
    [schoolId, seen],
  );
  return { groups, groupIndex, index, openGroup, selectStory, seen, viewerUid: uid };
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
  if (!deck.viewerUid || !story || story.expiresAt! <= Date.now()) return null;
  const previousGroup = groups[groupIndex - 1];
  return (
    <StorySlide
      key={JSON.stringify([deck.viewerUid, story.schoolId])}
      viewerUid={deck.viewerUid}
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
  viewerUid: string;
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
  viewerUid,
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
  const [panelFor, setPanelFor] = useState<string | null>(null);
  const navigation = useCampusSocialStackNav();
  const [receipt, setReceipt] = useState<{ scope: string; conversationId: string } | null>(null);
  const scope = JSON.stringify([story.authorUid, story.id]);
  const canReply =
    story.allowReplies === true &&
    !group.isMine &&
    !isDemoUid(viewerUid) &&
    !isDemoUid(story.authorUid) &&
    !isFirebaseMockMode();
  const inspecting = group.isMine && panelFor === scope;
  const replying = canReply && panelFor === scope;
  if (panelFor !== null && panelFor !== scope) setPanelFor(null);
  const insets = useSafeAreaInsets();
  const [playing, setPlaying] = useState(false);
  const playbackActive = playing && !inspecting && !replying;
  const [imageAttempt, setImageAttempt] = useState(0);
  const imageSession = useMemo(
    () => ({ key: JSON.stringify([scope, story.kind, story.mediaUrl, imageAttempt]) }),
    [scope, story.kind, story.mediaUrl, imageAttempt],
  );
  const [imageResult, setImageResult] = useState<{
    session: typeof imageSession;
    status: 'loaded' | 'failed';
  } | null>(null);
  const currentImage = React.useRef<typeof imageSession | null>(null);
  React.useLayoutEffect(() => {
    currentImage.current = imageSession;
    return () => {
      currentImage.current = null;
    };
  }, [imageSession]);
  const hasVideo = story.kind === 'video';
  const hasImage = story.kind === 'image' && !!story.mediaUrl;
  const imageLoaded = imageResult?.session === imageSession && imageResult.status === 'loaded';
  const imageFailed =
    hasImage && imageResult?.session === imageSession && imageResult.status === 'failed';
  const ready = !hasImage || imageLoaded;
  const close = () => selectStory(null);
  const remaining = React.useRef(STORY_DURATION);
  const fill = useMemo(() => new Animated.Value(0), [story.id]);
  useEffect(() => {
    remaining.current = STORY_DURATION;
  }, [story.id]);

  useEffect(() => {
    if (!playing) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') setPlaying(false);
    });
    return () => subscription.remove();
  }, [playing]);
  useEffect(() => {
    if (!playbackActive || !ready || hasVideo) return;
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
  }, [playbackActive, ready, story.id, nextId, selectStory, fill, hasVideo]);

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
  const playLabel = playing ? '暫停播放' : hasVideo ? '播放影片' : '自動播放';

  const back = () => setPanelFor(null);
  const safeArea = {
    paddingTop: Math.max(12, insets.top),
    paddingBottom: Math.max(12, insets.bottom),
  };

  return (
    <Modal visible animationType="fade" onRequestClose={inspecting || replying ? back : close}>
      <View
        pointerEvents={replying ? 'none' : 'auto'}
        accessibilityViewIsModal={!inspecting && !replying}
        accessibilityElementsHidden={inspecting || replying}
        importantForAccessibility={inspecting || replying ? 'no-hide-descendants' : 'auto'}
        onAccessibilityEscape={close}
        style={[styles.shell, safeArea, inspecting && styles.hidden]}
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
            accessibilityState={{ disabled: imageFailed }}
            disabled={imageFailed}
            style={[styles.iconButton, imageFailed && styles.disabled]}
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
          style={[
            styles.canvas,
            !hasImage && !hasVideo && { backgroundColor: story.bgColor || '#243b35' },
          ]}
          {...swipe.panHandlers}
        >
          {hasVideo ? (
            <StoryClip
              key={story.id}
              uri={story.mediaUrl}
              playing={playbackActive}
              fill={fill}
              onEnd={() => selectStory(nextId ?? null)}
              onPause={() => setPlaying(false)}
            />
          ) : hasImage && !imageFailed ? (
            <Image
              key={imageSession.key}
              source={{ uri: story.mediaUrl! }}
              style={styles.photo}
              resizeMode="contain"
              accessibilityLabel="限時動態照片"
              onLoad={() => {
                if (currentImage.current === imageSession)
                  setImageResult({ session: imageSession, status: 'loaded' });
              }}
              onError={() => {
                if (currentImage.current !== imageSession) return;
                // Ignore queued native callbacks after a failure, retry, or navigation.
                currentImage.current = null;
                setImageResult({ session: imageSession, status: 'failed' });
                setPlaying(false);
              }}
            />
          ) : (
            <ScrollView key={story.id} contentContainerStyle={styles.centerText}>
              <Text style={styles.storyText}>
                {imageFailed ? '照片暫時無法顯示' : story.text || '（無內容）'}
              </Text>
              {imageFailed && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="重新載入照片"
                  style={[styles.step, { alignSelf: 'center', marginTop: 16 }]}
                  onPress={() => {
                    setPlaying(false);
                    setImageAttempt((attempt) => attempt + 1);
                  }}
                >
                  <Text style={styles.stepText}>重新載入照片</Text>
                </Pressable>
              )}
            </ScrollView>
          )}
          {!imageFailed && (
            <>
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
            </>
          )}
          {hasImage && !imageLoaded && !imageFailed && (
            <View
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel="照片載入中"
              accessibilityLiveRegion="polite"
              pointerEvents="none"
              style={styles.photoLoading}
            >
              <ActivityIndicator color="#fff" />
              <Text style={styles.stepText}>照片載入中…</Text>
            </View>
          )}
        </View>
        {((hasImage || hasVideo) && story.text) || story.poiName ? (
          <ScrollView
            key={story.id}
            style={styles.details}
            contentContainerStyle={styles.detailContent}
          >
            {(hasImage || hasVideo) && !!story.text && (
              <Text style={styles.caption}>{story.text}</Text>
            )}
            {!!story.poiName && <Text style={styles.counter}>{story.poiName}</Text>}
          </ScrollView>
        ) : null}
        {group.isMine ? (
          <Pressable
            accessibilityRole="button"
            style={styles.audienceButton}
            onPress={() => setPanelFor(scope)}
          >
            <Ionicons name="eye-outline" color="#b8e7d4" size={18} />
            <Text style={styles.stepText}>誰看過</Text>
          </Pressable>
        ) : (
          <View style={styles.replyActions}>
            <Text style={styles.audienceNotice}>作者可查看誰看過</Text>
            {canReply && receipt?.scope === scope && navigation && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="已送出私訊，查看對話"
                style={styles.replyButton}
                onPress={() => {
                  close();
                  navigation.navigate('訊息', {
                    screen: 'Chat',
                    params: { peerId: story.authorUid, conversationId: receipt.conversationId },
                  });
                }}
              >
                <Text accessibilityLiveRegion="polite" style={styles.stepText}>
                  已送出 · 查看私訊
                </Text>
              </Pressable>
            )}
            {canReply && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`私訊回覆給${author}`}
                style={styles.replyButton}
                onPress={() => setPanelFor(scope)}
              >
                <Ionicons name="chatbubble-outline" color="#b8e7d4" size={16} />
                <Text accessibilityLiveRegion="polite" style={styles.stepText}>
                  {receipt?.scope === scope ? '再回覆' : '私訊回覆'}
                </Text>
              </Pressable>
            )}
          </View>
        )}
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
      {canReply && (
        <StoryReplyPanel
          key={scope}
          open={replying}
          story={story}
          viewerUid={viewerUid}
          author={author}
          onBack={back}
          onSent={(conversationId) => {
            setReceipt({ scope, conversationId });
            back();
          }}
        />
      )}
      {inspecting && (
        <View
          style={[styles.shell, safeArea]}
          accessibilityViewIsModal
          onAccessibilityEscape={back}
        >
          <StoryAudiencePanel key={story.id} story={story} onBack={back} />
        </View>
      )}
    </Modal>
  );
}

function StoryClip({
  uri,
  playing,
  fill,
  onEnd,
  onPause,
}: {
  uri?: string | null;
  playing: boolean;
  fill: Animated.Value;
  onEnd: () => void;
  onPause: () => void;
}) {
  const [muted, setMuted] = useState(true);
  const [failed, setFailed] = useState(false);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [positionSeconds, setPositionSeconds] = useState(0);
  // Native callbacks may arrive after a swipe, close or pause.
  const session = useMemo(() => ({ playing }), [playing]);
  const current = React.useRef<typeof session | null>(null);
  React.useLayoutEffect(() => {
    current.current = session;
    return () => {
      current.current = null;
    };
  }, [session]);
  if (failed || !uri || !supportsStoryVideo) {
    return (
      <View style={styles.clipStatus}>
        <Text style={styles.stepText}>影片暫時無法播放</Text>
        {uri && supportsStoryVideo && (
          <Pressable
            accessibilityRole="button"
            style={styles.step}
            onPress={() => setFailed(false)}
          >
            <Text style={styles.stepText}>重新載入影片</Text>
          </Pressable>
        )}
      </View>
    );
  }
  return (
    <View style={styles.photo}>
      <StoryVideoPlayer
        source={{ uri, overrideFileExtensionAndroid: 'mp4' }}
        style={styles.photo}
        accessibilityLabel="限時動態影片"
        shouldPlay={playing}
        isMuted={muted}
        isLooping={false}
        onError={() => {
          if (!current.current) return;
          setMuted(true);
          setPositionSeconds(0);
          setDurationSeconds(0);
          setFailed(true);
          onPause();
        }}
        onReadyForDisplay={({ status }) => {
          if (current.current && status?.isLoaded && status.durationMillis)
            setDurationSeconds(Math.ceil(status.durationMillis / 1000));
        }}
        onPlaybackStatusUpdate={(status) => {
          if (
            current.current !== session ||
            !status.isLoaded ||
            !playing ||
            AppState.currentState === 'background' ||
            AppState.currentState === 'inactive'
          )
            return;
          if (status.durationMillis) {
            setPositionSeconds(Math.floor(status.positionMillis / 1000));
            fill.setValue(Math.min(1, status.positionMillis / status.durationMillis));
          }
          if (status.didJustFinish) onEnd();
        }}
      />
      <View style={styles.clipTools}>
        <Text style={styles.clipTime}>
          {durationSeconds ? `${positionSeconds} / ${durationSeconds} 秒` : '載入影片…'}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={muted ? '開啟影片聲音' : '將影片靜音'}
          style={styles.sound}
          onPress={() => setMuted(!muted)}
        >
          <Ionicons name={muted ? 'volume-mute' : 'volume-high'} color="white" size={20} />
        </Pressable>
      </View>
    </View>
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
  clipTools: {
    position: 'absolute',
    bottom: 8,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#242928',
    borderRadius: 22,
    paddingLeft: 12,
  },
  clipTime: { color: '#fff', fontSize: 13, fontVariant: ['tabular-nums'] },
  sound: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  clipStatus: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  photo: { width: '100%', height: '100%' },
  photoLoading: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
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
  hidden: { display: 'none' },
  replyActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  replyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 14,
    backgroundColor: '#20342d',
    borderRadius: 22,
  },
  audienceNotice: { color: '#c2cbc8', fontSize: 13 },
  audienceButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
    borderRadius: 12,
    backgroundColor: '#20342d',
  },
  disabled: { opacity: 0.4 },
  stepText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
