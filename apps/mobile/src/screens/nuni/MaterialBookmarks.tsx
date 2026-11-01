import React, { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import {
  materialBookmarkId,
  resolveMaterialBookmark,
  type MaterialBookmark,
} from '@campus/shared/src/materialBookmarks';
import { formatTaipeiDateTime } from '@campus/shared/src/taipeiTime';
import type { useMaterialBookmarks } from '../../state/materialBookmarks';
import { useTheme } from '../../state/theme';

type BookmarkStore = ReturnType<typeof useMaterialBookmarks>;
type Resolution = Awaited<ReturnType<typeof resolveMaterialBookmark>>;
type Classes = Parameters<typeof resolveMaterialBookmark>[0];

function BookmarkAction({
  label,
  accessibilityLabel = label,
  onPress,
  disabled = false,
  busy = false,
  selected,
}: {
  label: string;
  accessibilityLabel?: string;
  onPress(): void;
  disabled?: boolean;
  busy?: boolean;
  selected?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, busy, ...(selected === undefined ? {} : { selected }) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 48,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderWidth: 1,
        borderRadius: 10,
        borderColor: selected ? theme.colors.accent : theme.colors.border,
        backgroundColor: pressed || selected ? theme.colors.surface2 : theme.colors.surface,
        opacity: disabled ? 0.5 : 1,
      })}
    >
      <Text style={{ color: theme.colors.accent, fontSize: 15, fontWeight: '600', flexShrink: 1 }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function MaterialBookmarkButton({
  courseId,
  materialId,
  title,
  store,
  scopeKey,
  active = true,
}: {
  courseId: string;
  materialId: string;
  title: string;
  store: BookmarkStore;
  scopeKey: string;
  active?: boolean;
}) {
  const theme = useTheme();
  const id = materialBookmarkId({ courseId, materialId });
  const scope = `${scopeKey}:${id}`;
  const current = useRef(scope);
  current.current = scope;
  const mounted = useRef(true);
  const locked = useRef(false);
  const [feedback, setFeedback] = useState<{
    scope: string;
    message: string;
    failed: boolean;
  } | null>(null);
  const saved = store.items.some((item) => materialBookmarkId(item) === id);
  const busy = store.pending.includes(id);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function toggle() {
    if (!active || locked.current || busy || !store.ready) return;
    locked.current = true;
    setFeedback(null);
    try {
      const confirmed = await store.setBookmark(courseId, materialId, !saved);
      if (mounted.current && current.current === scope) {
        setFeedback({
          scope,
          failed: !confirmed,
          message: confirmed
            ? saved
              ? '已從此裝置收藏移除。'
              : '已收藏在此裝置。'
            : '收藏尚未儲存，請再試一次。',
        });
      }
    } finally {
      locked.current = false;
    }
  }
  const notice = feedback?.scope === scope ? feedback : null;
  return (
    <View style={{ gap: 8, minWidth: 0 }}>
      <BookmarkAction
        label={
          busy
            ? '正在儲存收藏…'
            : store.loading
              ? '正在讀取收藏…'
              : saved
                ? '移除此裝置收藏'
                : '收藏到此裝置'
        }
        accessibilityLabel={
          busy
            ? `正在儲存收藏：${title}`
            : store.loading
              ? `正在讀取收藏：${title}`
              : saved
                ? `移除此裝置收藏：${title}`
                : `收藏到此裝置：${title}`
        }
        selected={saved}
        disabled={!active || busy || !store.ready}
        busy={busy || store.loading}
        onPress={() => void toggle()}
      />
      {notice ? (
        <Text
          accessibilityRole={notice.failed ? 'alert' : undefined}
          accessibilityLiveRegion="polite"
          style={{ color: notice.failed ? theme.colors.danger : theme.colors.muted, fontSize: 15 }}
        >
          {notice.failed ? (store.error ?? notice.message) : notice.message}
        </Text>
      ) : null}
      {!store.ready && !store.loading && store.error ? (
        <>
          <Text accessibilityRole="alert" style={{ color: theme.colors.danger, fontSize: 15 }}>
            {store.error}
          </Text>
          <BookmarkAction label="重試讀取收藏" onPress={() => void store.reload()} />
        </>
      ) : null}
    </View>
  );
}

export function MaterialBookmarks({
  classes,
  store,
  scopeKey,
  active = true,
  open,
  onBrowse,
}: {
  classes: Classes;
  store: BookmarkStore;
  scopeKey: string;
  active?: boolean;
  open(courseId: string, materialId: string): void;
  onBrowse(): void;
}) {
  const theme = useTheme();
  const [foreground, setForeground] = useState(
    () => AppState.currentState !== 'background' && AppState.currentState !== 'inactive',
  );
  const foregroundRef = useRef(foreground);
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  const opening = useRef(false);
  const entriesKey = JSON.stringify(store.items);
  const viewKey = JSON.stringify([scopeKey, entriesKey, active, foreground, refresh, store.ready]);
  const current = useRef(viewKey);
  current.current = viewKey;
  const [snapshot, setSnapshot] = useState<{
    key: string;
    rows: Record<string, Resolution>;
    openingId: string | null;
  }>({ key: '', rows: {}, openingId: null });

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      const next = state === 'active';
      if (foregroundRef.current === next) return;
      foregroundRef.current = next;
      generation.current += 1;
      opening.current = false;
      setForeground(next);
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const run = ++generation.current;
    opening.current = false;
    const cancelled = () => run !== generation.current || current.current !== viewKey;
    setSnapshot({ key: viewKey, rows: {}, openingId: null });
    if (!active || !foreground || !store.ready) return;
    const entries: MaterialBookmark[] = JSON.parse(entriesKey);
    let index = 0;
    async function readNext() {
      while (index < entries.length && !cancelled()) {
        const entry = entries[index++];
        const result = await resolveMaterialBookmark(classes, entry, cancelled);
        if (cancelled() || result.status === 'cancelled') return;
        setSnapshot((previous) => ({
          ...previous,
          rows: { ...previous.rows, [materialBookmarkId(entry)]: result },
        }));
      }
    }
    void Promise.all([readNext(), readNext()]);
    return () => {
      generation.current += 1;
    };
  }, [active, classes, entriesKey, foreground, store.ready, viewKey]);

  const visible = active && foreground && snapshot.key === viewKey;
  const rows = visible ? snapshot.rows : {};
  async function openBookmark(entry: MaterialBookmark) {
    if (!visible || opening.current || store.pending.includes(materialBookmarkId(entry))) return;
    opening.current = true;
    const id = materialBookmarkId(entry);
    const run = generation.current;
    const cancelled = () => run !== generation.current || current.current !== viewKey;
    setSnapshot((previous) => {
      const next = { ...previous.rows };
      delete next[id];
      return { ...previous, rows: next, openingId: id };
    });
    const result = await resolveMaterialBookmark(classes, entry, cancelled);
    if (cancelled() || result.status === 'cancelled') return;
    opening.current = false;
    setSnapshot((previous) => ({
      ...previous,
      rows: { ...previous.rows, [id]: result },
      openingId: null,
    }));
    if (result.status === 'available') open(entry.courseId, entry.materialId);
  }
  const copy = { color: theme.colors.text, fontSize: 15, lineHeight: 24 };
  return (
    <View style={{ gap: 16, minWidth: 0 }}>
      <Text
        accessibilityRole="header"
        style={{ ...copy, fontSize: 24, lineHeight: 34, fontWeight: '600' }}
      >
        此裝置收藏
      </Text>
      <Text style={copy}>
        只保留這個帳號在這台裝置的教材入口，不會同步到其他裝置。開啟教材仍需要網路與課程權限。
      </Text>
      <BookmarkAction
        label={store.items.length ? '返回我的課程' : '回我的課程找教材'}
        onPress={onBrowse}
      />
      {store.loading ? (
        <Text accessibilityLiveRegion="polite" style={copy}>
          正在讀取此裝置收藏…
        </Text>
      ) : null}
      {store.error ? (
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="alert" style={{ ...copy, color: theme.colors.danger }}>
            {store.error}
          </Text>
          <BookmarkAction
            label="重試讀取收藏"
            onPress={() => void store.reload()}
            disabled={store.loading}
          />
        </View>
      ) : null}
      {store.ready && !store.items.length ? (
        <Text style={copy}>
          還沒有收藏教材。回到課程，在教材卡按「收藏到此裝置」，下次就能從這裡找回。
        </Text>
      ) : null}
      {store.ready && store.items.length ? (
        <>
          <Text style={copy}>{store.items.length} 份教材，最近收藏的排在前面。</Text>
          <BookmarkAction label="重新確認教材" onPress={() => setRefresh((value) => value + 1)} />
          {store.items.map((entry) => {
            const id = materialBookmarkId(entry);
            const result = rows[id];
            const material = result?.status === 'available' ? result.material : null;
            const checking = !result || result.status === 'cancelled';
            const openingThis = visible && snapshot.openingId === id;
            return (
              <View
                key={id}
                style={{
                  gap: 10,
                  padding: 14,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  borderRadius: 10,
                  minWidth: 0,
                }}
              >
                <Text
                  accessibilityRole="header"
                  style={{ ...copy, fontSize: 18, fontWeight: '600' }}
                >
                  {material?.title ?? (checking ? '正在確認教材…' : '目前無法開啟的教材')}
                </Text>
                {material?.unitTitle ? <Text style={copy}>{material.unitTitle}</Text> : null}
                <Text style={{ ...copy, color: theme.colors.muted }}>
                  收藏時間：{formatTaipeiDateTime(entry.savedAt)}
                </Text>
                {result?.status === 'error' || result?.status === 'unavailable' ? (
                  <Text accessibilityRole="alert" style={{ ...copy, color: theme.colors.danger }}>
                    {result.message}
                  </Text>
                ) : null}
                {checking ? (
                  <Text accessibilityLiveRegion="polite" style={copy}>
                    {openingThis ? '開啟前再次確認課程權限…' : '正在確認課程權限與教材內容…'}
                  </Text>
                ) : null}
                {material ? (
                  <BookmarkAction
                    label={`回到原教材：${material.title}`}
                    onPress={() => void openBookmark(entry)}
                    disabled={!!snapshot.openingId || store.pending.includes(id)}
                  />
                ) : null}
                {result?.status === 'error' || result?.status === 'unavailable' ? (
                  <BookmarkAction
                    label="重試確認這份教材"
                    onPress={() => void openBookmark(entry)}
                    disabled={!!snapshot.openingId || store.pending.includes(id)}
                  />
                ) : null}
                <MaterialBookmarkButton
                  courseId={entry.courseId}
                  materialId={entry.materialId}
                  title={material?.title ?? `收藏於 ${formatTaipeiDateTime(entry.savedAt)} 的教材`}
                  store={store}
                  scopeKey={scopeKey}
                  active={active && foreground && !snapshot.openingId}
                />
              </View>
            );
          })}
        </>
      ) : null}
    </View>
  );
}
