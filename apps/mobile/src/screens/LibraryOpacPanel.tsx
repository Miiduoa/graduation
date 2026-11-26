/**
 * 官方館藏（WebPac）— 原生查詢面板
 *
 * 對齊課綱查詢體驗：篩選欄位 + 關鍵字 + 結果列表；資料來自 GraphQL，細節／登入以瀏覽器開啟 bookDetail。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PuWebView } from '../ui/PuWebView';
import { useReducedMotion } from '../hooks/useReducedMotion';

import { webBrowserOpenWithPuTronClassGate } from '../services/tronClassWebUiGate';
import { Button } from '../ui/components';
import { theme } from '../ui/theme';
import {
  OPAC_SEARCH_FIELDS,
  type OpacSearchFieldKey,
  type OpacBookDetail,
  type OpacBookDetailField,
  type OpacSearchHit,
  searchOpacBiblios,
  fetchOpacBookDetail,
  buildExternalFallbackUrl,
  buildLibraryBookDetailUrl,
} from '../services/libraryOpacSearchClient';
import {
  validateLibraryOpacReachable,
  buildLibraryOpacHomeUrl,
} from '../services/libraryOpacClient';

function BookCoverPlaceholder(props: { width: number; height: number }) {
  const { width, height } = props;
  return (
    <View
      style={{
        width,
        height,
        borderRadius: 10,
        backgroundColor: theme.colors.surface3,
        borderWidth: 1,
        borderColor: theme.colors.border,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons
        name="book-outline"
        size={Math.min(width, height) * 0.34}
        color={theme.colors.muted}
      />
    </View>
  );
}

function BookCover(props: { uri?: string; width?: number; height?: number }) {
  const { uri, width = 74, height = 104 } = props;
  const [failedUri, setFailedUri] = useState<string | null>(null);
  useEffect(() => {
    setFailedUri(null);
  }, [uri]);

  if (!uri) {
    return <BookCoverPlaceholder width={width} height={height} />;
  }

  if (failedUri === uri) {
    return <BookCoverPlaceholder width={width} height={height} />;
  }

  return (
    <Image
      source={{ uri }}
      resizeMode="cover"
      onError={() => setFailedUri(uri)}
      style={{
        width,
        height,
        borderRadius: 10,
        backgroundColor: theme.colors.surface3,
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
    />
  );
}

function InfoPill(props: { text?: string; tone?: 'default' | 'success' | 'warning' }) {
  if (!props.text) return null;
  const toneColor =
    props.tone === 'success'
      ? '#34C759'
      : props.tone === 'warning'
        ? '#FF9500'
        : theme.colors.accent;
  return (
    <View
      style={{
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 4,
        backgroundColor: `${toneColor}18`,
        borderWidth: 1,
        borderColor: `${toneColor}44`,
      }}
    >
      <Text style={{ color: toneColor, fontSize: 11, fontWeight: '700' }} numberOfLines={1}>
        {props.text}
      </Text>
    </View>
  );
}

function HitRow(props: {
  item: OpacSearchHit;
  onOpen: () => void;
  onBorrow?: () => void;
  borrowed?: boolean;
  borrowDisabled?: boolean;
}) {
  const { item, onOpen, onBorrow, borrowed, borrowDisabled } = props;
  const availabilityTone = item.isAvailable ? 'success' : item.canReserve ? 'warning' : 'default';
  return (
    <View
      style={{
        padding: 14,
        borderRadius: 14,
        backgroundColor: theme.colors.surface2,
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
    >
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
        <BookCover uri={item.coverUrl} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            style={{ color: theme.colors.text, fontWeight: '700', fontSize: 15 }}
            numberOfLines={3}
          >
            {item.title}
          </Text>
          <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 6 }} numberOfLines={2}>
            {[item.author, item.publisher, item.year].filter(Boolean).join(' · ') || '—'}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            <InfoPill text={item.dataType} />
            <InfoPill text={item.availability} tone={availabilityTone} />
            {item.lendCount ? <InfoPill text={`借閱 ${item.lendCount} 次`} /> : null}
          </View>
          {item.sourceName ? (
            <Text
              style={{ color: theme.colors.muted, fontSize: 11, marginTop: 8 }}
              numberOfLines={1}
            >
              封面來源：{item.sourceName}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            {onBorrow ? (
              <Button
                text={borrowed ? '已加入借閱' : '借書'}
                icon={borrowed ? 'checkmark-outline' : 'add-outline'}
                kind={borrowed ? 'secondary' : 'primary'}
                size="small"
                disabled={borrowed || borrowDisabled}
                onPress={onBorrow}
              />
            ) : null}
            <Button
              text="更多資料"
              icon="reader-outline"
              kind="secondary"
              size="small"
              onPress={onOpen}
            />
          </View>
        </View>
      </View>
    </View>
  );
}

function DetailFieldRow(props: { field: OpacBookDetailField }) {
  const { field } = props;
  const content = (
    <View
      style={{
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        gap: 4,
      }}
    >
      <Text style={{ color: theme.colors.muted, fontSize: 12, fontWeight: '700' }}>
        {field.label}
      </Text>
      <Text
        style={{
          color: field.url ? theme.colors.accent : theme.colors.text,
          fontSize: 14,
          lineHeight: 20,
        }}
      >
        {field.value}
      </Text>
    </View>
  );

  if (!field.url) return content;
  return (
    <Pressable onPress={() => void webBrowserOpenWithPuTronClassGate(field.url!)}>
      {content}
    </Pressable>
  );
}

function DetailModal(props: {
  item: OpacSearchHit | null;
  detail: OpacBookDetail | null;
  loading: boolean;
  onClose: () => void;
  onOpenOfficial: (sid: string) => void;
  onBorrow?: (item: OpacSearchHit) => void;
  isBorrowed?: (item: OpacSearchHit) => boolean;
  borrowDisabled?: boolean;
}) {
  const { item, detail, loading, onClose, onOpenOfficial, onBorrow, isBorrowed, borrowDisabled } =
    props;
  const reducedMotion = useReducedMotion();
  const current = detail ?? item;
  const borrowed = item && isBorrowed ? isBorrowed(item) : false;
  return (
    <Modal
      visible={!!item}
      animationType={reducedMotion ? 'none' : 'slide'}
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
        <View
          style={{
            paddingHorizontal: 18,
            paddingTop: 18,
            paddingBottom: 12,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <Text style={{ flex: 1, color: theme.colors.text, fontSize: 18, fontWeight: '700' }}>
            館藏書目
          </Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="關閉館藏書目"
            style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="close" size={24} color={theme.colors.text} />
          </Pressable>
        </View>

        {current ? (
          <ScrollView contentContainerStyle={{ padding: 18, gap: 16 }}>
            <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start' }}>
              <BookCover uri={current.coverUrl} width={96} height={136} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  style={{
                    color: theme.colors.text,
                    fontSize: 18,
                    fontWeight: '700',
                    lineHeight: 24,
                  }}
                >
                  {current.title}
                </Text>
                <Text
                  style={{ color: theme.colors.muted, fontSize: 13, lineHeight: 19, marginTop: 8 }}
                >
                  {[current.author, current.publisher, current.year].filter(Boolean).join(' · ') ||
                    '—'}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                  <InfoPill text={current.dataType} />
                  <InfoPill
                    text={current.availability}
                    tone={
                      current.isAvailable ? 'success' : current.canReserve ? 'warning' : 'default'
                    }
                  />
                </View>
                {current.sourceName ? (
                  <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 10 }}>
                    封面來源：{current.sourceName}
                  </Text>
                ) : null}
              </View>
            </View>

            {loading ? (
              <View style={{ paddingVertical: 18, alignItems: 'center', gap: 8 }}>
                <ActivityIndicator color={theme.colors.accent} />
                <Text style={{ color: theme.colors.muted, fontSize: 12 }}>讀取館藏詳細資料…</Text>
              </View>
            ) : null}

            {detail?.error ? (
              <View
                style={{
                  padding: 12,
                  borderRadius: theme.radius.md,
                  borderWidth: 1,
                  borderColor: '#FF950055',
                  backgroundColor: '#FF950018',
                }}
              >
                <Text style={{ color: theme.colors.text, fontSize: 12, lineHeight: 18 }}>
                  {detail.error}
                </Text>
              </View>
            ) : null}

            {(detail?.fields ?? []).length > 0 ? (
              <View
                style={{
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  borderRadius: theme.radius.md,
                  paddingHorizontal: 12,
                  backgroundColor: theme.colors.surface,
                }}
              >
                {(detail?.fields ?? []).map((field) => (
                  <DetailFieldRow key={field.key} field={field} />
                ))}
              </View>
            ) : null}

            {detail?.marc ? (
              <View
                style={{
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  borderRadius: theme.radius.md,
                  padding: 12,
                  backgroundColor: theme.colors.surface2,
                  gap: 8,
                }}
              >
                <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 13 }}>
                  MARC 編目資料
                </Text>
                <Text
                  selectable
                  style={{ color: theme.colors.muted, fontSize: 11, lineHeight: 16 }}
                >
                  {detail.marc}
                </Text>
              </View>
            ) : null}

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {item && onBorrow ? (
                <Button
                  text={borrowed ? '已加入借閱' : '借書'}
                  icon={borrowed ? 'checkmark-outline' : 'add-outline'}
                  kind={borrowed ? 'secondary' : 'primary'}
                  disabled={borrowed || borrowDisabled}
                  onPress={() => onBorrow(item)}
                />
              ) : null}
              <Button
                text="官方頁面／複本與預約"
                kind={onBorrow ? 'secondary' : 'primary'}
                onPress={() => onOpenOfficial(current.sid)}
              />
            </View>
          </ScrollView>
        ) : null}
      </View>
    </Modal>
  );
}

export type LibraryOpacPanelProps = {
  variant: 'embedded' | 'fullscreen';
  /** 全螢幕進入時預填 */
  initialQuery?: string;
  autoSearch?: boolean;
  /** 內嵌時可由父層控制輸入框文字 */
  query?: string;
  onQueryChange?: (q: string) => void;
  bottomInset?: number;
  /** 內嵌「放大」全螢幕查詢 */
  onRequestFullscreen?: (keyword: string) => void;
  /** 將官方查詢結果加入本地借書流程 */
  onBorrowHit?: (item: OpacSearchHit) => void;
  borrowedSids?: Set<string> | string[];
  borrowDisabled?: boolean;
};

export function LibraryOpacPanel(props: LibraryOpacPanelProps) {
  const {
    variant,
    initialQuery = '',
    autoSearch = false,
    query: controlledQuery,
    onQueryChange,
    bottomInset = 0,
    onRequestFullscreen,
    onBorrowHit,
    borrowedSids,
    borrowDisabled,
  } = props;

  const [internalQuery, setInternalQuery] = useState(initialQuery);
  const [viewportHeight, setViewportHeight] = useState(0);

  const keyword = controlledQuery !== undefined ? controlledQuery : internalQuery;
  const setKeyword = (t: string) => {
    if (onQueryChange) onQueryChange(t);
    else setInternalQuery(t);
  };

  const [field, setField] = useState<OpacSearchFieldKey>('FullText');
  const activeSearch = React.useRef<{
    query: string;
    field: OpacSearchFieldKey;
    controller: AbortController;
  } | null>(null);
  const [submitted, setSubmitted] = useState<{ query: string; field: OpacSearchFieldKey } | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [hits, setHits] = useState<OpacSearchHit[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const [selectedHit, setSelectedHit] = useState<OpacSearchHit | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<OpacBookDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const detailRequestId = React.useRef(0);
  /** API 遭校方防火牆 403 時改載入官方搜尋頁（WebView 指紋等同瀏覽器） */
  const [webFallbackUri, setWebFallbackUri] = useState<string | null>(null);
  const borrowedSidSet = useMemo(() => {
    if (!borrowedSids) return new Set<string>();
    return borrowedSids instanceof Set ? borrowedSids : new Set(borrowedSids);
  }, [borrowedSids]);
  const isBorrowed = useCallback(
    (item: OpacSearchHit) => borrowedSidSet.has(item.sid),
    [borrowedSidSet],
  );

  useEffect(() => {
    let cancelled = false;
    void validateLibraryOpacReachable().then((r) => {
      if (!cancelled) setReachable(r.ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const runSearch = useCallback(async (value: string, searchField: OpacSearchFieldKey) => {
    const query = value.trim();
    if (!query) return;
    const previous = activeSearch.current;
    if (
      previous?.query === query &&
      previous.field === searchField &&
      !previous.controller.signal.aborted
    )
      return;
    previous?.controller.abort();
    const request = new AbortController();
    activeSearch.current = { query, field: searchField, controller: request };
    detailRequestId.current += 1;
    setSubmitted({ query, field: searchField });
    setHits([]);
    setLoading(true);
    setHint(null);
    setWebFallbackUri(null);
    setSelectedHit(null);
    setSelectedDetail(null);
    try {
      const res = await searchOpacBiblios(query, searchField, { signal: request.signal });
      if (request.signal.aborted) return;
      setHits(res.hits);
      const msg = res.error ?? null;
      const blocked =
        typeof msg === 'string' &&
        (msg.includes('403') ||
          msg.includes('HTTP 403') ||
          msg.includes('500') ||
          msg.includes('502') ||
          msg.includes('503') ||
          msg.includes('504'));
      if (blocked) {
        setWebFallbackUri(buildExternalFallbackUrl(query, searchField));
        setHint('暫時無法取得館藏資料，可在下方的圖書館官方頁面繼續查詢。');
      } else {
        setHint(msg);
      }
    } catch {
      if (!request.signal.aborted) setHint('館藏查詢暫時無法連線，請再試一次。');
    } finally {
      if (!request.signal.aborted) {
        activeSearch.current = null;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (variant === 'fullscreen' && autoSearch && initialQuery.trim()) {
      void runSearch(initialQuery, 'FullText');
    }
    return () => {
      activeSearch.current?.controller.abort();
      detailRequestId.current += 1;
    };
  }, [autoSearch, initialQuery, runSearch, variant]);

  const currentPending =
    loading && submitted?.query === keyword.trim() && submitted.field === field;
  const searchDisabled = !keyword.trim() || currentPending;
  const submit = () => {
    if (searchDisabled) return;
    Keyboard.dismiss();
    void runSearch(keyword, field);
  };
  const submittedLabel = OPAC_SEARCH_FIELDS.find((f) => f.key === submitted?.field)?.label;
  const resultTitle = submitted ? `${submittedLabel}「${submitted.query}」` : '';

  const fieldLabel = useMemo(
    () => OPAC_SEARCH_FIELDS.find((f) => f.key === field)?.label ?? field,
    [field],
  );

  const openOfficialDetail = (sid: string) => {
    void webBrowserOpenWithPuTronClassGate(buildLibraryBookDetailUrl(sid));
  };

  const openInAppDetail = useCallback(async (item: OpacSearchHit) => {
    const requestId = detailRequestId.current + 1;
    detailRequestId.current = requestId;
    setSelectedHit(item);
    setSelectedDetail(null);
    setDetailLoading(true);
    try {
      const detail = await fetchOpacBookDetail(item);
      if (detailRequestId.current === requestId) {
        setSelectedDetail(detail);
      }
    } finally {
      if (detailRequestId.current === requestId) {
        setDetailLoading(false);
      }
    }
  }, []);

  // Recovery actions belong to the displayed result while another query is being edited.
  const fallbackQuery = hint && submitted ? submitted.query : keyword.trim();
  const fallbackField = hint && submitted ? submitted.field : field;
  const fallbackUrl = () => buildExternalFallbackUrl(fallbackQuery, fallbackField);
  const openFallbackSearch = () => {
    void webBrowserOpenWithPuTronClassGate(fallbackUrl());
  };

  const openHome = () => {
    void webBrowserOpenWithPuTronClassGate(buildLibraryOpacHomeUrl());
  };

  const searchHeader = (
    <View style={{ gap: 8 }}>
      {reachable === false && !submitted ? (
        <View
          style={{
            padding: 10,
            borderRadius: theme.radius.md,
            backgroundColor: '#FF950018',
            borderWidth: 1,
            borderColor: '#FF950055',
          }}
        >
          <Text style={{ color: theme.colors.text, fontSize: 12, lineHeight: 18 }}>
            目前無法連到圖書館網站。你仍可以查詢館藏，或稍後再試。
          </Text>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <TextInput
          value={keyword}
          accessibilityLabel="館藏關鍵字"
          onChangeText={setKeyword}
          placeholder={`${fieldLabel}搜尋`}
          placeholderTextColor={theme.colors.muted}
          returnKeyType="search"
          onSubmitEditing={submit}
          style={{
            flex: 1,
            minHeight: 44,
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: 11,
            paddingHorizontal: 14,
            color: theme.colors.text,
            backgroundColor: theme.colors.surface,
            fontSize: 15,
          }}
        />
        <Pressable
          disabled={searchDisabled}
          accessibilityState={{ disabled: searchDisabled, busy: currentPending }}
          onPress={submit}
          accessibilityRole="button"
          accessibilityLabel="查詢館藏"
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            borderRadius: 11,
            backgroundColor: searchDisabled ? theme.colors.disabledBg : theme.colors.accent,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed && !searchDisabled ? 0.86 : 1,
          })}
        >
          {currentPending ? (
            <ActivityIndicator size="small" color={theme.colors.muted} />
          ) : (
            <Ionicons
              name="search"
              size={20}
              color={searchDisabled ? theme.colors.disabledText : theme.colors.onAccent}
            />
          )}
        </Pressable>
        {variant === 'embedded' && onRequestFullscreen ? (
          <Pressable
            onPress={() => onRequestFullscreen(keyword.trim())}
            accessibilityRole="button"
            accessibilityLabel="全螢幕查詢"
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              borderRadius: 11,
              backgroundColor: theme.colors.surface2,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.86 : 1,
            })}
          >
            <Ionicons name="expand-outline" size={19} color={theme.colors.accent} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        horizontal
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0, flexShrink: 0 }}
      >
        <View style={{ flexDirection: 'row', gap: 8, paddingVertical: 2 }}>
          {OPAC_SEARCH_FIELDS.map((f) => {
            const active = field === f.key;
            return (
              <Pressable
                key={f.key}
                onPress={() => setField(f.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={{
                  minHeight: 44,
                  justifyContent: 'center',
                  paddingHorizontal: 14,
                  paddingVertical: 6,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: active ? theme.colors.accent : theme.colors.border,
                  backgroundColor: active ? theme.colors.accentSoft : theme.colors.surface,
                }}
              >
                <Text
                  style={{
                    color: active ? theme.colors.accent : theme.colors.textSecondary,
                    fontSize: 12,
                    fontWeight: active ? '700' : '600',
                  }}
                >
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      {variant === 'embedded' || hint || webFallbackUri ? (
        <ScrollView
          horizontal
          keyboardShouldPersistTaps="handled"
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0, flexShrink: 0 }}
        >
          <View style={{ flexDirection: 'row', gap: 8, paddingVertical: 2 }}>
            <Pressable
              accessibilityRole="button"
              onPress={() => (fallbackQuery ? setWebFallbackUri(fallbackUrl()) : openHome())}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                minHeight: 44,
                paddingVertical: 8,
                paddingHorizontal: 10,
                borderRadius: theme.radius.full,
                backgroundColor: theme.colors.surface2,
              }}
            >
              <Ionicons name="phone-portrait-outline" size={16} color={theme.colors.accent} />
              <Text style={{ color: theme.colors.accent, fontWeight: '600', fontSize: 12 }}>
                站內 WebPac
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="link"
              onPress={openFallbackSearch}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                minHeight: 44,
                paddingVertical: 8,
                paddingHorizontal: 10,
                borderRadius: theme.radius.full,
                backgroundColor: theme.colors.surface2,
              }}
            >
              <Ionicons name="open-outline" size={16} color={theme.colors.accent} />
              <Text style={{ color: theme.colors.accent, fontWeight: '600', fontSize: 12 }}>
                在瀏覽器查看
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="link"
              onPress={openHome}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                minHeight: 44,
                paddingVertical: 8,
                paddingHorizontal: 10,
                borderRadius: theme.radius.full,
                backgroundColor: theme.colors.surface2,
              }}
            >
              <Ionicons name="home-outline" size={16} color={theme.colors.muted} />
              <Text style={{ color: theme.colors.muted, fontWeight: '600', fontSize: 12 }}>
                館藏首頁
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      ) : null}

      {loading ? (
        <Text
          accessibilityLiveRegion="polite"
          numberOfLines={2}
          style={{ color: theme.colors.muted }}
        >
          正在查詢{resultTitle}…
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
          <Text numberOfLines={2} style={{ color: theme.colors.text, fontWeight: '700' }}>
            {resultTitle}
          </Text>
          <Text
            accessibilityLiveRegion="polite"
            style={{ color: theme.colors.text, lineHeight: 21 }}
          >
            {hint}
          </Text>
        </View>
      ) : null}

      {webFallbackUri ? (
        <View
          style={{
            marginTop: 4,
            borderRadius: theme.radius.md,
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: theme.colors.border,
            height:
              variant === 'fullscreen' && viewportHeight > 0
                ? Math.round(viewportHeight * 0.75)
                : 400,
          }}
        >
          <PuWebView
            source={{ uri: webFallbackUri }}
            style={{ flex: 1, backgroundColor: theme.colors.surface }}
            sharedCookiesEnabled
            nestedScrollEnabled
            {...(Platform.OS === 'android' ? { thirdPartyCookiesEnabled: true } : {})}
          />
        </View>
      ) : null}

      {!loading && hits.length > 0 ? (
        <Text
          accessibilityRole="header"
          accessibilityLiveRegion="polite"
          numberOfLines={2}
          style={{ fontWeight: '700', fontSize: 15, color: theme.colors.text, marginBottom: 8 }}
        >
          {resultTitle} · 顯示 {hits.length} 筆
        </Text>
      ) : null}
    </View>
  );

  const renderHit = (item: OpacSearchHit) => (
    <HitRow
      key={item.sid}
      item={item}
      onOpen={() => void openInAppDetail(item)}
      onBorrow={onBorrowHit ? () => onBorrowHit(item) : undefined}
      borrowed={isBorrowed(item)}
      borrowDisabled={borrowDisabled}
    />
  );

  return (
    <View style={{ flex: variant === 'fullscreen' ? 1 : undefined, gap: 8 }}>
      <DetailModal
        item={selectedHit}
        detail={selectedDetail}
        loading={detailLoading}
        onClose={() => {
          detailRequestId.current += 1;
          setSelectedHit(null);
          setSelectedDetail(null);
          setDetailLoading(false);
        }}
        onOpenOfficial={openOfficialDetail}
        onBorrow={onBorrowHit}
        isBorrowed={isBorrowed}
        borrowDisabled={borrowDisabled}
      />
      {variant === 'fullscreen' ? (
        <FlatList
          data={hits}
          keyExtractor={(item) => item.sid}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: bottomInset + 8, gap: 10 }}
          onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          ListHeaderComponent={searchHeader}
          renderItem={({ item }) => renderHit(item)}
        />
      ) : (
        <>
          {searchHeader}
          {hits.length > 0 ? (
            <View style={{ gap: 10, minHeight: 120, paddingBottom: 8 }}>{hits.map(renderHit)}</View>
          ) : null}
        </>
      )}
    </View>
  );
}
