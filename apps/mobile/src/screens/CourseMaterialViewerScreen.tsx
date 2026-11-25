/**
 * Course Material Viewer — 本地 in-app 開教材檔案／PDF／HTML 連結。
 *
 * 目標：把所有「請到 TronClass 查看」的跳出行為，改成在 APP 內直接看。
 * 使用 `PuWebView`（react-native-webview）載入；內含 LMS／玩課雲請求過濾。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, View, Text, ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  TRONCLASS_DATA_DISABLED_MESSAGE,
  isTronClassPuHostedUrl,
  isTronClassDataFetchEnabled,
} from '../services/tronClassDataEnabled';
import { materialFailureMessage } from '@campus/shared/src/materialAccess';
import { PuWebView } from '../ui/PuWebView';
import { theme } from '../ui/theme';
import { useThemeVersion } from '../ui/useThemeStyleSheet';

type RouteProps = {
  route?: {
    params?: {
      url?: string;
      title?: string;
      /** material / quiz / score / homework */
      kind?: 'material' | 'quiz' | 'score' | 'homework' | 'attempt';
      courseName?: string;
    };
  };
  /** 少用：測試或極簡宿主未掛 NavigationContainer 時，可傳 `{ goBack }` 備援。 */
  navigation?: { goBack: () => void };
};

export default function CourseMaterialViewerScreen(props: RouteProps) {
  useThemeVersion();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const url = props.route?.params?.url ?? '';
  const title = props.route?.params?.title ?? '教材';
  const kind = props.route?.params?.kind ?? 'material';
  const courseName = props.route?.params?.courseName;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const activeRevision = useRef(0);
  const loadFailed = useRef(false);
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => {
      setError('載入等得有點久。請確認網路後重試，或返回課程。');
      setLoading(false);
    }, 30000);
    return () => clearTimeout(timer);
  }, [loading, revision]);
  const tronClassNavBlockedAlerted = useRef(false);

  const kindIcon = useMemo(() => {
    switch (kind) {
      case 'quiz':
      case 'attempt':
        return 'help-circle-outline';
      case 'score':
        return 'stats-chart-outline';
      case 'homework':
        return 'document-text-outline';
      default:
        return 'albums-outline';
    }
  }, [kind]);

  const handleShare = async () => {
    Alert.alert('請從課程分享教材', '為了保護課程檔案，這裡不分享可能含有存取憑證的網址。請回教材清單分享教材入口；需要另存時，請使用校方系統的下載功能。');
  };

  const goLeave = useCallback(() => {
    if (typeof navigation.canGoBack === 'function' && navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    if (props.navigation?.goBack) {
      props.navigation.goBack();
      return;
    }
    const tabNav = typeof navigation.getParent === 'function' ? navigation.getParent() : undefined;
    if (tabNav) {
      tabNav.navigate('學習', { screen: 'LearnHome' });
    }
  }, [navigation, props.navigation]);

  if (!url) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.bg,
          padding: 24,
          paddingTop: Math.max(insets.top, 24),
        }}
      >
        <Text style={{ color: theme.colors.danger, fontSize: 16, fontWeight: '600' }}>
          沒有提供檔案連結。
        </Text>
        <Pressable
          onPress={goLeave}
          accessibilityRole="button"
          accessibilityLabel="返回上一頁"
          style={({ pressed }) => ({
            marginTop: 16,
            minHeight: 44,
            paddingHorizontal: 20,
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: theme.colors.accent,
            borderRadius: theme.radius.md,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text style={{ color: theme.colors.onAccent, fontWeight: '700', fontSize: 14 }}>返回</Text>
        </Pressable>
      </View>
    );
  }

  if (isTronClassPuHostedUrl(url) && !isTronClassDataFetchEnabled()) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.bg,
          padding: 24,
          paddingTop: Math.max(insets.top, 24),
        }}
      >
        <Text
          style={{ color: theme.colors.text, fontSize: 17, fontWeight: '700', textAlign: 'center' }}
        >
          LMS（TronClass）已關閉
        </Text>
        <Text
          style={{
            color: theme.colors.textSecondary,
            fontSize: 14,
            lineHeight: 21,
            marginTop: 12,
            textAlign: 'center',
          }}
        >
          {TRONCLASS_DATA_DISABLED_MESSAGE}
        </Text>
        <Pressable
          onPress={goLeave}
          accessibilityRole="button"
          accessibilityLabel="返回上一頁"
          style={({ pressed }) => ({
            marginTop: 20,
            minHeight: 44,
            paddingHorizontal: 20,
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: theme.colors.accent,
            borderRadius: theme.radius.md,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text style={{ color: theme.colors.onAccent, fontWeight: '700', fontSize: 14 }}>返回</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      {/* 頂部資訊條（此畫面 headerShown: false，需自帶返回與 Safe Area） */}
      <View
        style={{
          backgroundColor: theme.colors.surface,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.separator,
          paddingTop: Math.max(insets.top, 8),
          paddingBottom: 10,
          paddingHorizontal: 10,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <Pressable
          onPress={goLeave}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="返回上一頁"
          style={({ pressed }) => ({
            minWidth: 44,
            minHeight: 44,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Ionicons name="chevron-back" size={24} color={theme.colors.text} />
        </Pressable>
        <Ionicons name={kindIcon as never} size={20} color={theme.colors.accent} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>
            {title}
          </Text>
          {courseName ? (
            <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }} numberOfLines={1}>
              {courseName}
            </Text>
          ) : null}
        </View>
        <Pressable
          onPress={handleShare}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="分享此教材連結"
          style={({ pressed }) => ({
            minWidth: 44,
            minHeight: 44,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Ionicons name="share-outline" size={20} color={theme.colors.accent} />
        </Pressable>
      </View>

      <View
        style={{
          paddingHorizontal: 14,
          paddingVertical: 10,
          backgroundColor: theme.colors.surfaceMuted,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.separator,
        }}
      >
        <Text style={{ color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18 }}>
          校方教材預覽：這裡可以閱讀；作業繳交與正式紀錄請到校方系統完成。閱讀不算作業完成。
        </Text>
      </View>
      {/* 主內容（PuWebView 內建 LMS／玩課雲請求過濾） */}
      <View style={{ flex: 1 }}>
        {loading && (
          <View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              padding: 8,
              backgroundColor: theme.colors.accentSoft,
              zIndex: 2,
            }}
          >
            <ActivityIndicator color={theme.colors.accent} />
          </View>
        )}
        <PuWebView
          key={revision}
          source={{ uri: url }}
          originWhitelist={['*']}
          sharedCookiesEnabled
          onTronClassNavigationBlocked={() => {
            if (!tronClassNavBlockedAlerted.current) {
              tronClassNavBlockedAlerted.current = true;
              Alert.alert('LMS（TronClass）已關閉', TRONCLASS_DATA_DISABLED_MESSAGE);
            }
          }}
          onLoadStart={() => {
            if (revision !== activeRevision.current) return;
            loadFailed.current = false;
            setLoading(true);
          }}
          onLoad={() => {
            if (revision !== activeRevision.current || loadFailed.current) return;
            setError(null);
            setLoading(false);
          }}
          onLoadEnd={() => {
            if (revision !== activeRevision.current) return;
            setLoading(false);
          }}
          onError={(e: { nativeEvent?: { description?: string } }) => {
            if (revision !== activeRevision.current) return;
            loadFailed.current = true;
            setError(materialFailureMessage(new TypeError(e?.nativeEvent?.description)));
            setLoading(false);
          }}
          onHttpError={(event: { nativeEvent: { statusCode: number } }) => {
            if (revision !== activeRevision.current) return;
            loadFailed.current = true;
            setError(materialFailureMessage({ status: event.nativeEvent.statusCode }));
            setLoading(false);
          }}
          style={{ flex: 1 }}
        />
        {error && (
          <View
            style={{
              position: 'absolute',
              bottom: 24,
              left: 20,
              right: 20,
              padding: 14,
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.lg,
              borderWidth: 1,
              borderColor: theme.colors.danger,
              gap: 12,
            }}
          >
            <Text style={{ color: theme.colors.danger, fontSize: 13, lineHeight: 20, fontWeight: '600' }}>
              {error}
            </Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  activeRevision.current += 1;
                  loadFailed.current = false;
                  setError(null);
                  setLoading(true);
                  setRevision(activeRevision.current);
                }}
                style={({ pressed }) => ({
                  flex: 1,
                  minHeight: 44,
                  justifyContent: 'center',
                  alignItems: 'center',
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.accent,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <Text style={{ color: theme.colors.onAccent, fontWeight: '700', fontSize: 14 }}>
                  再試一次
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={goLeave}
                style={({ pressed }) => ({
                  flex: 1,
                  minHeight: 44,
                  justifyContent: 'center',
                  alignItems: 'center',
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.surface2,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 14 }}>
                  返回課程
                </Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}
