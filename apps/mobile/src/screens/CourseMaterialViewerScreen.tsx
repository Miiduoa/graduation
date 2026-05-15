/**
 * Course Material Viewer — 本地 in-app 開教材檔案／PDF／HTML 連結。
 *
 * 目標：把所有「請到 TronClass 查看」的跳出行為，改成在 APP 內直接看。
 * 使用 react-native-webview 載入；無安裝時 fallback 內建 ScrollView + iframe-like 提示。
 */
import React, { useMemo, useState } from 'react';
import { View, Text, ActivityIndicator, Pressable, ScrollView, Share } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

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
  navigation?: { goBack: () => void };
};

let WebView: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  WebView = require('react-native-webview').WebView;
} catch {
  WebView = null;
}

export default function CourseMaterialViewerScreen(props: RouteProps) {
  const url = props.route?.params?.url ?? '';
  const title = props.route?.params?.title ?? '教材';
  const kind = props.route?.params?.kind ?? 'material';
  const courseName = props.route?.params?.courseName;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  if (!url) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ color: '#dc2626', fontSize: 16 }}>沒有提供檔案連結。</Text>
        <Pressable
          onPress={() => props.navigation?.goBack()}
          style={{ marginTop: 16, padding: 12, backgroundColor: '#1F4E78', borderRadius: 8 }}
        >
          <Text style={{ color: '#fff' }}>返回</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      {/* 頂部資訊條 */}
      <View
        style={{
          backgroundColor: '#1F4E78',
          padding: 12,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <Ionicons name={kindIcon as never} size={20} color="#fff" />
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }} numberOfLines={1}>
            {title}
          </Text>
          {courseName ? (
            <Text style={{ color: '#dbeafe', fontSize: 12 }} numberOfLines={1}>
              {courseName}
            </Text>
          ) : null}
        </View>
        <Pressable onPress={handleShare} hitSlop={12}>
          <Ionicons name="share-outline" size={20} color="#fff" />
        </Pressable>
      </View>

      {/* 主內容 */}
      {WebView ? (
        <View style={{ flex: 1 }}>
          {loading && (
            <View
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                padding: 8,
                backgroundColor: '#1F4E7820',
                zIndex: 2,
              }}
            >
              <ActivityIndicator color="#1F4E78" />
            </View>
          )}
          <WebView
            source={{ uri: url }}
            originWhitelist={['*']}
            sharedCookiesEnabled
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
                backgroundColor: '#dc2626',
                borderRadius: 12,
              }}
            >
              <Text style={{ color: '#fff', fontSize: 13 }}>{error}</Text>
            </View>
          )}
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 24, alignItems: 'center' }}>
          <Ionicons name="cloud-download-outline" size={48} color="#6b7280" />
          <Text style={{ marginTop: 12, color: '#374151', fontSize: 14, textAlign: 'center' }}>
            本機尚未安裝 in-app 瀏覽元件（react-native-webview）。
          </Text>
          <Text style={{ marginTop: 8, color: '#6b7280', fontSize: 12, textAlign: 'center' }}>
            開發者：請 `npx expo install react-native-webview` 後重新打包；上架版會自動內含。
          </Text>
          <Text
            selectable
            style={{
              marginTop: 16,
              padding: 12,
              backgroundColor: '#f3f4f6',
              borderRadius: 8,
              fontSize: 12,
              color: '#1F4E78',
            }}
          >
            {url}
          </Text>
        </ScrollView>
      )}
    </View>
  );
}
