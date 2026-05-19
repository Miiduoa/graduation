/**
 * Course Material Viewer — 本地 in-app 開教材檔案／PDF／HTML 連結。
 *
 * 目標：把所有「請到 TronClass 查看」的跳出行為，改成在 APP 內直接看。
 * 使用 `PuWebView`（react-native-webview）載入；內含 LMS／玩課雲請求過濾。
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, View, Text, ActivityIndicator, Pressable, Share } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  TRONCLASS_DATA_DISABLED_MESSAGE,
  isTronClassPuHostedUrl,
  isTronClassDataFetchEnabled,
} from '../services/tronClassDataEnabled';
import { PuWebView } from '../ui/PuWebView';

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
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const url = props.route?.params?.url ?? '';
  const title = props.route?.params?.title ?? '教材';
  const kind = props.route?.params?.kind ?? 'material';
  const courseName = props.route?.params?.courseName;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
    if (!url) return;
    try {
      await Share.share({ message: `${title}\n${url}` });
    } catch {
      /* swallow */
    }
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
          padding: 24,
          paddingTop: Math.max(insets.top, 24),
        }}
      >
        <Text style={{ color: '#D70015', fontSize: 16 }}>沒有提供檔案連結。</Text>
        <Pressable
          onPress={goLeave}
          accessibilityRole="button"
          accessibilityLabel="返回上一頁"
          style={{ marginTop: 16, padding: 12, backgroundColor: '#003F8A', borderRadius: 8 }}
        >
          <Text style={{ color: '#fff' }}>返回</Text>
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
          padding: 24,
          paddingTop: Math.max(insets.top, 24),
        }}
      >
        <Text
          style={{ color: '#003F8A', fontSize: 17, fontWeight: '700', textAlign: 'center' }}
        >
          LMS（TronClass）已關閉
        </Text>
        <Text style={{ color: '#3C3C43', fontSize: 14, marginTop: 12, textAlign: 'center' }}>
          {TRONCLASS_DATA_DISABLED_MESSAGE}
        </Text>
        <Pressable
          onPress={goLeave}
          accessibilityRole="button"
          accessibilityLabel="返回上一頁"
          style={{ marginTop: 20, padding: 12, backgroundColor: '#003F8A', borderRadius: 8 }}
        >
          <Text style={{ color: '#fff' }}>返回</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      {/* 頂部資訊條（此畫面 headerShown: false，需自帶返回與 Safe Area） */}
      <View
        style={{
          backgroundColor: '#003F8A',
          paddingTop: Math.max(insets.top, 8),
          paddingBottom: 12,
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
          style={{ marginRight: 2 }}
        >
          <Ionicons name="chevron-back" size={26} color="#fff" />
        </Pressable>
        <Ionicons name={kindIcon as never} size={20} color="#fff" />
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }} numberOfLines={1}>
            {title}
          </Text>
          {courseName ? (
            <Text style={{ color: '#E5F2FF', fontSize: 12 }} numberOfLines={1}>
              {courseName}
            </Text>
          ) : null}
        </View>
        <Pressable
          onPress={handleShare}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="分享此教材連結"
        >
          <Ionicons name="share-outline" size={20} color="#fff" />
        </Pressable>
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
              backgroundColor: '#003F8A20',
              zIndex: 2,
            }}
          >
            <ActivityIndicator color="#003F8A" />
          </View>
        )}
        <PuWebView
          source={{ uri: url }}
          originWhitelist={['*']}
          sharedCookiesEnabled
          onTronClassNavigationBlocked={() => {
            if (!tronClassNavBlockedAlerted.current) {
              tronClassNavBlockedAlerted.current = true;
              Alert.alert('LMS（TronClass）已關閉', TRONCLASS_DATA_DISABLED_MESSAGE);
            }
          }}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          onError={(e: { nativeEvent?: { description?: string } }) => {
            setError(e?.nativeEvent?.description ?? '載入失敗');
            setLoading(false);
          }}
          style={{ flex: 1 }}
        />
        {error && (
          <View
            style={{
              position: 'absolute',
              bottom: 24,
              left: 24,
              right: 24,
              padding: 12,
              backgroundColor: '#D70015',
              borderRadius: 12,
            }}
          >
            <Text style={{ color: '#fff', fontSize: 13 }}>{error}</Text>
          </View>
        )}
      </View>
    </View>
  );
}
