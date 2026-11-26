/**
 * Video Material Screen — 本地播放教材影片
 *
 * 取代 webview 看影片的體驗。記錄播放進度 → 寫回 TronClass。
 * 用 expo-av Video（已隨 Expo SDK 包含）；若不可用 fallback webview。
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, ActivityIndicator, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { theme } from '../ui/theme';
import { useThemeVersion } from '../ui/useThemeStyleSheet';
import { CourseChipEmpty, CourseChipHeader, courseChipScrollContentStyle } from '../ui/courseChipShell';
import {
  TRONCLASS_DATA_DISABLED_MESSAGE,
  isTronClassDataFetchEnabled,
  isTronClassPuHostedUrl,
} from '../services/tronClassDataEnabled';

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
  useThemeVersion();
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
        style={{ flex: 1, backgroundColor: theme.colors.bg }}
        contentContainerStyle={[
          courseChipScrollContentStyle(),
          { flexGrow: 1, paddingTop: theme.space.xl },
        ]}
      >
        <CourseChipHeader emoji="" eyebrow="影片教材" title="尚無有效播放網址" meta={courseName} />
        <CourseChipEmpty
          title="無法解析影片連結"
          body="若從通知或外部連結進入，請回到課程教材清單重新開啟。教師端請確認教材是否已發布。"
          primaryLabel="離開此頁"
          onPrimary={goLeave}
        />
      </ScrollView>
    );
  }

  if (isTronClassPuHostedUrl(url) && !isTronClassDataFetchEnabled()) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.bg }}
        contentContainerStyle={[
          courseChipScrollContentStyle(),
          { flexGrow: 1, paddingTop: theme.space.xl },
        ]}
      >
        <CourseChipHeader emoji="" eyebrow="LMS" title="連線已關閉" meta={courseName} />
        <CourseChipEmpty
          title={TRONCLASS_DATA_DISABLED_MESSAGE}
          body="已停用對 TronClass 站台的連線；無法由此播放託管於玩課雲的影片。請使用本機／demo 教材，或於建置設定重新啟用 EXPO_PUBLIC_TRONCLASS_DATA_ENABLED。"
          primaryLabel="離開此頁"
          onPrimary={goLeave}
        />
      </ScrollView>
    );
  }

  if (!Video) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          backgroundColor: theme.colors.bg,
        }}
      >
        <Ionicons name="videocam-off-outline" size={48} color={theme.colors.muted} />
        <Text style={{ marginTop: 12, color: theme.colors.text, fontSize: 15, fontWeight: '600', textAlign: 'center' }}>
          本機尚未安裝 expo-av。
        </Text>
        <Text style={{ marginTop: 8, color: theme.colors.muted, fontSize: 12, textAlign: 'center', lineHeight: 18 }}>
          開發者：請 `npx expo install expo-av` 後重新打包。
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="用一般檢視器開啟"
          onPress={() =>
            navigation.replace('CourseMaterialViewer', {
              url,
              title,
              kind: 'material',
              courseName,
            })
          }
          style={({ pressed }) => ({
            marginTop: 16,
            minHeight: 44,
            paddingHorizontal: 18,
            paddingVertical: 11,
            backgroundColor: theme.colors.accent,
            borderRadius: theme.radius.md,
            justifyContent: 'center',
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text style={{ color: theme.colors.onAccent, fontSize: 14, fontWeight: '600' }}>
            用一般檢視器開啟
          </Text>
        </Pressable>
      </View>
    );
  }

  const progressPct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      {/* 影片區：維持純黑高對比媒體畫布 */}
      <View style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000000' }}>
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
              backgroundColor: 'rgba(0,0,0,0.45)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ActivityIndicator color="#FFFFFF" />
          </View>
        )}
      </View>

      {/* 進度與資訊 */}
      <View
        style={{
          paddingHorizontal: theme.layout.screenHorizontalPadding,
          paddingVertical: theme.space.md,
          backgroundColor: theme.colors.surface,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.separator,
        }}
      >
        <Text
          accessibilityRole="header"
          style={{ color: theme.colors.text, fontSize: 17, fontWeight: '700', lineHeight: 23 }}
        >
          {title}
        </Text>
        {courseName ? (
          <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginTop: 3 }}>
            {courseName}
          </Text>
        ) : null}
        <View
          style={{
            marginTop: 12,
            height: 6,
            backgroundColor: theme.colors.surface2,
            borderRadius: 3,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              height: 6,
              width: `${progressPct}%`,
              backgroundColor: completedReported ? theme.colors.success : theme.colors.accent,
              borderRadius: 3,
            }}
          />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
          <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
            進度 {Math.round(progressPct)}%
          </Text>
          {completedReported ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Ionicons name="checkmark-circle" size={14} color={theme.colors.success} />
              <Text style={{ color: theme.colors.success, fontSize: 12, fontWeight: '600' }}>
                已記錄完成
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}
