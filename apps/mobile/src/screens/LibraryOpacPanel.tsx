/**
 * 官方館藏（WebPac）— 原生查詢面板
 *
 * 對齊課綱查詢體驗：篩選欄位 + 關鍵字 + 結果列表；資料來自 GraphQL，細節／登入以瀏覽器開啟 bookDetail。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { WebView } from 'react-native-webview';

import { Button } from '../ui/components';
import { theme } from '../ui/theme';
import {
  OPAC_SEARCH_FIELDS,
  type OpacSearchFieldKey,
  type OpacSearchHit,
  searchOpacBiblios,
  buildExternalFallbackUrl,
  buildLibraryBookDetailUrl,
} from '../services/libraryOpacSearchClient';
import { validateLibraryOpacReachable, buildLibraryOpacHomeUrl } from '../services/libraryOpacClient';

function HitRow(props: { item: OpacSearchHit; onOpen: () => void }) {
  const { item, onOpen } = props;
  return (
    <Pressable
      onPress={onOpen}
      style={({ pressed }) => ({
        padding: 14,
        borderRadius: 14,
        backgroundColor: pressed ? theme.colors.surface3 : theme.colors.surface2,
        borderWidth: 1,
        borderColor: theme.colors.border,
      })}
    >
      <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 15 }} numberOfLines={3}>
        {item.title}
      </Text>
      <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 6 }} numberOfLines={2}>
        {[item.author, item.publisher, item.year].filter(Boolean).join(' · ') || '—'}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 4 }}>
        <Ionicons name="chevron-forward" size={16} color={theme.colors.accent} />
        <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: '600' }}>
          查看館藏／複本（官方頁）
        </Text>
      </View>
    </Pressable>
  );
}

export type LibraryOpacPanelProps = {
  variant: 'embedded' | 'fullscreen';
  /** 全螢幕進入時預填 */
  initialQuery?: string;
  /** 內嵌時可由父層控制輸入框文字 */
  query?: string;
  onQueryChange?: (q: string) => void;
  bottomInset?: number;
  /** 內嵌「放大」全螢幕查詢 */
  onRequestFullscreen?: (keyword: string) => void;
};

export function LibraryOpacPanel(props: LibraryOpacPanelProps) {
  const {
    variant,
    initialQuery = '',
    query: controlledQuery,
    onQueryChange,
    bottomInset = 0,
    onRequestFullscreen,
  } = props;

  const [internalQuery, setInternalQuery] = useState(initialQuery);
  useEffect(() => {
    if (variant === 'fullscreen' && initialQuery) setInternalQuery(initialQuery);
  }, [variant, initialQuery]);

  const keyword = controlledQuery !== undefined ? controlledQuery : internalQuery;
  const setKeyword = (t: string) => {
    if (onQueryChange) onQueryChange(t);
    else setInternalQuery(t);
  };

  const [field, setField] = useState<OpacSearchFieldKey>('FullText');
  const [loading, setLoading] = useState(false);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [hits, setHits] = useState<OpacSearchHit[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  /** GraphQL 受阻時改載入官方搜尋網頁（與 Safari WebView cookie／TLS 行為一致）。 */
  const [officialWebEmbed, setOfficialWebEmbed] = useState(false);

  const officialSearchUri = useMemo(
    () => buildExternalFallbackUrl(keyword.trim(), field),
    [keyword, field],
  );
  const canEmbedOfficial =
    Platform.OS !== 'web' && keyword.trim().length > 0 && reachable !== false;

  useEffect(() => {
    let cancelled = false;
    void validateLibraryOpacReachable().then((r) => {
      if (!cancelled) setReachable(r.ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const runSearch = useCallback(async () => {
    setLoading(true);
    setHint(null);
    setOfficialWebEmbed(false);
    try {
      const res = await searchOpacBiblios(keyword, field);
      setHits(res.hits);
      setHint(res.error ?? null);
    } finally {
      setLoading(false);
    }
  }, [keyword, field]);

  const fieldLabel = useMemo(
    () => OPAC_SEARCH_FIELDS.find((f) => f.key === field)?.label ?? field,
    [field],
  );

  const openDetail = (sid: string) => {
    void WebBrowser.openBrowserAsync(buildLibraryBookDetailUrl(sid));
  };

  const openFallbackSearch = () => {
    void WebBrowser.openBrowserAsync(buildExternalFallbackUrl(keyword, field));
  };

  const openHome = () => {
    void WebBrowser.openBrowserAsync(buildLibraryOpacHomeUrl());
  };

  return (
    <View style={{ flex: variant === 'fullscreen' ? 1 : undefined, gap: 12 }}>
      {reachable === false ? (
        <View
          style={{
            padding: 10,
            borderRadius: theme.radius.md,
            backgroundColor: '#F59E0B18',
            borderWidth: 1,
            borderColor: '#F59E0B55',
          }}
        >
          <Text style={{ color: theme.colors.text, fontSize: 12, lineHeight: 18 }}>
            目前無法連到圖書館站台（HEAD 檢查失敗）。仍可嘗試查詢，或直接改以瀏覽器開啟 WebPac。
          </Text>
        </View>
      ) : null}

      <View style={{ gap: 6 }}>
        <Text style={{ fontWeight: '700', fontSize: 13, color: theme.colors.text }}>搜尋欄位</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', gap: 8, paddingVertical: 2 }}>
            {OPAC_SEARCH_FIELDS.map((f) => {
              const active = field === f.key;
              return (
                <Pressable
                  key={f.key}
                  onPress={() => setField(f.key)}
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                    borderRadius: 18,
                    borderWidth: 1,
                    borderColor: active ? theme.colors.accent : theme.colors.border,
                    backgroundColor: active ? theme.colors.accent + '22' : theme.colors.surface,
                  }}
                >
                  <Text style={{ color: theme.colors.text, fontSize: 13 }}>{f.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </View>

      <View style={{ gap: 6 }}>
        <Text style={{ fontWeight: '700', fontSize: 13, color: theme.colors.text }}>關鍵字</Text>
        <TextInput
          value={keyword}
          onChangeText={setKeyword}
          placeholder={`於「${fieldLabel}」搜尋…`}
          placeholderTextColor={theme.colors.muted}
          returnKeyType="search"
          onSubmitEditing={() => void runSearch()}
          style={{
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: 12,
            paddingHorizontal: 14,
            paddingVertical: 12,
            color: theme.colors.text,
            backgroundColor: theme.colors.surface,
            fontSize: 15,
          }}
        />
      </View>

      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <View style={{ flex: 1, minWidth: 120 }}>
          <Button
            text="查詢館藏"
            kind="primary"
            loading={loading}
            onPress={() => void runSearch()}
          />
        </View>
        {variant === 'embedded' && onRequestFullscreen ? (
          <View style={{ flex: 1, minWidth: 120 }}>
            <Button
              text="全螢幕查詢"
              onPress={() => onRequestFullscreen(keyword.trim())}
            />
          </View>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Pressable
          onPress={() => {
            if (!canEmbedOfficial) return;
            setOfficialWebEmbed((v) => !v);
          }}
          disabled={!canEmbedOfficial}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingVertical: 8,
            paddingHorizontal: 10,
            opacity: canEmbedOfficial ? 1 : 0.45,
          }}
        >
          <Ionicons name="globe-outline" size={18} color={theme.colors.accent} />
          <Text style={{ color: theme.colors.accent, fontWeight: '600', fontSize: 13 }}>
            {officialWebEmbed ? '關閉 App 內網頁' : 'App 內官方搜尋頁'}
          </Text>
        </Pressable>
        <Pressable
          onPress={openFallbackSearch}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingVertical: 8,
            paddingHorizontal: 10,
          }}
        >
          <Ionicons name="open-outline" size={18} color={theme.colors.accent} />
          <Text style={{ color: theme.colors.accent, fontWeight: '600', fontSize: 13 }}>
            瀏覽器開啟（同條件）
          </Text>
        </Pressable>
        <Pressable
          onPress={openHome}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingVertical: 8,
            paddingHorizontal: 10,
          }}
        >
          <Ionicons name="home-outline" size={18} color={theme.colors.muted} />
          <Text style={{ color: theme.colors.muted, fontWeight: '600', fontSize: 13 }}>WebPac 首頁</Text>
        </Pressable>
      </View>

      {Platform.OS === 'web' ? (
        <Text style={{ color: theme.colors.muted, fontSize: 11, lineHeight: 16 }}>
          網頁版請使用上方「瀏覽器開啟」連至官方館藏。
        </Text>
      ) : null}

      {hint ? (
        <View
          style={{
            padding: 12,
            borderRadius: theme.radius.md,
            backgroundColor: theme.colors.surface2,
            borderWidth: 1,
            borderColor: theme.colors.border,
          }}
        >
          <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 18 }}>{hint}</Text>
        </View>
      ) : null}

      {officialWebEmbed && canEmbedOfficial ? (
        <View
          style={{
            flex: variant === 'fullscreen' ? 1 : undefined,
            minHeight: variant === 'embedded' ? 440 : undefined,
            borderRadius: theme.radius.md,
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surface,
          }}
        >
          <WebView
            key={`${field}:${keyword.trim()}`}
            source={{ uri: officialSearchUri }}
            style={{ flex: variant === 'fullscreen' ? 1 : undefined, height: variant === 'embedded' ? 440 : undefined }}
            nestedScrollEnabled
            startInLoadingState
            allowsBackForwardNavigationGestures
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
          />
        </View>
      ) : null}

      {!officialWebEmbed && !loading && hits.length > 0 ? (
        <View style={{ flex: variant === 'fullscreen' ? 1 : undefined, minHeight: variant === 'embedded' ? 120 : undefined }}>
          <Text style={{ fontWeight: '700', fontSize: 13, color: theme.colors.text, marginBottom: 8 }}>
            結果（{hits.length} 筆，點選開啟官方書目）
          </Text>
          {variant === 'fullscreen' ? (
            <FlatList
              data={hits}
              keyExtractor={(item) => item.sid}
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingBottom: bottomInset + 8, gap: 10 }}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <HitRow item={item} onOpen={() => openDetail(item.sid)} />
              )}
            />
          ) : (
            <View style={{ gap: 10, paddingBottom: 8 }}>
              {hits.map((item) => (
                <HitRow key={item.sid} item={item} onOpen={() => openDetail(item.sid)} />
              ))}
            </View>
          )}
        </View>
      ) : null}
    </View>
  );
}
