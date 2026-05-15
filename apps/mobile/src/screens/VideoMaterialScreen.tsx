/**
 * Video Material Screen — 本地播放教材影片
 *
 * 取代 webview 看影片的體驗。記錄播放進度 → 寫回 TronClass。
 * 用 expo-av Video（已隨 Expo SDK 包含）；若不可用 fallback webview。
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, ActivityIndicator, Pressable, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { theme } from '../ui/theme';
import { CourseChipEmpty, CourseChipHeader, courseChipScrollContentStyle } from '../ui/courseChipShell';

type RouteProps = {
  route?: {
    params?: {
      url?: string;
      title?: string;
      courseName?: string;
      materialId?: string;
      durationSeconds?: number;
    };
  };
};

let Video: any = null;
let ResizeMode: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const av = require('expo-av');
  Video = av?.Video;
  ResizeMode = av?.ResizeMode;
} catch {
  Video = null;
}

export default function VideoMaterialScreen(props: RouteProps) {
  const navigation = useNavigation<any>();
  const url = props.route?.params?.url ?? '';
  const title = props.route?.params?.title ?? '影片教材';
  const courseName = props.route?.params?.courseName;
  const materialId = props.route?.params?.materialId;
  const expectedDuration = props.route?.params?.durationSeconds ?? 0;

  const goLeave = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    const tabNav = navigation.getParent();
    if (tabNav) {
      (tabNav as { navigate: (a: string, b?: object) => void }).navigate('學習', {
        screen: 'LearnHome',
      });
    }
  }, [navigation]);

  const playerRef = useRef<any>(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [completedReported, setCompletedReported] = useState(false);

  // 觀看進度 ≥ 90% 視為完成
  useEffect(() => {
    if (!duration || completedReported) return;
    if (position / duration >= 0.9) {
      setCompletedReported(true);
      // 紀錄 companion signal
      (async () => {
        try {
          const { onMaterialRead } = await import('../services/companionHooks');
          onMaterialRead({
            materialId,
            minutes: Math.round(duration / 60),
          });
        } catch {
          /* swallow */
        }
      })();
    }
  }, [position, duration, completedReported, materialId]);

  if (!url) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.surfaceMuted }}
        contentContainerStyle={[
          courseChipScrollContentStyle(),
          { flexGrow: 1, paddingTop: theme.space.xl },
        ]}
      >
        <CourseChipHeader emoji="🎬" eyebrow="影片教材" title="尚無有效播放網址" meta={courseName} />
        <CourseChipEmpty
          title="無法解析影片連結"
          body="若從通知或外部連結進入，請回到課程教材清單重新開啟。教師端請確認教材是否已發布。"
          primaryLabel="離開此頁"
          onPrimary={goLeave}
        />
      </ScrollView>
    );
  }

  if (!Video) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Ionicons name="videocam-off-outline" size={48} color="#6b7280" />
        <Text style={{ marginTop: 12, color: '#374151', textAlign: 'center' }}>
          本機尚未安裝 expo-av。
        </Text>
        <Text style={{ marginTop: 8, color: '#6b7280', fontSize: 12, textAlign: 'center' }}>
          開發者：請 `npx expo install expo-av` 後重新打包。
        </Text>
        <Pressable
          onPress={() =>
            navigation.replace('CourseMaterialViewer', {
              url,
              title,
              kind: 'material',
              courseName,
            })
          }
          style={{ marginTop: 16, padding: 12, backgroundColor: '#1F4E78', borderRadius: 8 }}
        >
          <Text style={{ color: '#fff' }}>用一般檢視器開啟</Text>
        </Pressable>
      </View>
    );
  }

  const progressPct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {/* 影片區 */}
      <View style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' }}>
        <Video
          ref={playerRef}
          source={{ uri: url }}
          useNativeControls
          resizeMode={ResizeMode?.CONTAIN ?? 'contain'}
          shouldPlay
          onLoad={(s: { durationMillis?: number }) => {
            setDuration((s.durationMillis ?? expectedDuration * 1000) / 1000);
            setLoaded(true);
          }}
          onPlaybackStatusUpdate={(s: { positionMillis?: number; durationMillis?: number; isLoaded?: boolean }) => {
            if (s.isLoaded) {
              setPosition((s.positionMillis ?? 0) / 1000);
              if (s.durationMillis) setDuration(s.durationMillis / 1000);
            }
          }}
          style={{ flex: 1 }}
        />
        {!loaded && (
          <View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ActivityIndicator color="#fff" />
          </View>
        )}
      </View>

      {/* 進度與資訊 */}
      <View style={{ padding: 16, backgroundColor: '#1F4E78' }}>
        <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>{title}</Text>
        {courseName ? (
          <Text style={{ color: '#dbeafe', fontSize: 12, marginTop: 2 }}>{courseName}</Text>
        ) : null}
        <View
          style={{
            marginTop: 12,
            height: 6,
            backgroundColor: '#1e3a5f',
            borderRadius: 3,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              height: 6,
              width: `${progressPct}%`,
              backgroundColor: '#fbbf24',
              borderRadius: 3,
            }}
          />
        </View>
        <Text style={{ color: '#cbd5e1', fontSize: 11, marginTop: 4 }}>
          進度 {Math.round(progressPct)}%
          {completedReported ? ' ・ ✅ 已記錄完成' : ''}
        </Text>
      </View>
    </View>
  );
}
