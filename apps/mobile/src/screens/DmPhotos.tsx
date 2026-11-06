import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AppState,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { randomUUID } from 'expo-crypto';
import {
  confirmDmPhoto,
  localPhoto,
  openDmPhoto,
  photoFormatHint,
  uploadDmPhoto,
  type LocalPhoto,
  type PhotoScope,
  type PhotoThread,
} from '../services/dmPhotos';
import { theme } from '../ui/theme';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';

type Draft = { photo: LocalPhoto; messageId: string; uploadedPath?: string };

export function DmPhotoComposer({
  thread,
  barStyle,
  children,
}: {
  thread: PhotoThread | null;
  barStyle: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const s = useThemeStyleSheet(styles);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const request = useRef<AbortController | null>(null);
  useLayoutEffect(() => () => request.current?.abort(), []);

  async function pick() {
    if (!thread || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setSent(false);
    setError('');
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
      });
      if (controller.signal.aborted || picked.canceled || !picked.assets[0]) return;
      const asset = picked.assets[0];
      const photo = localPhoto(asset.uri, asset.mimeType);
      setDraft({ photo, messageId: randomUUID() });
    } catch {
      if (!controller.signal.aborted) setError(photoFormatHint);
    } finally {
      request.current = null;
    }
  }

  async function send() {
    if (!thread || !draft || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setError('');
    setPending(true);
    const scope = { ...thread, messageId: draft.messageId };
    try {
      const path =
        draft.uploadedPath ?? (await uploadDmPhoto(scope, draft.photo, controller.signal));
      if (controller.signal.aborted) return;
      if (!draft.uploadedPath) setDraft({ ...draft, uploadedPath: path });
      await confirmDmPhoto(scope, path, controller.signal);
      if (controller.signal.aborted) return;
      setDraft(null);
      setSent(true);
    } catch {
      if (!controller.signal.aborted) setError('尚未確認送達，照片已保留。');
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  }

  return (
    <>
      {thread && draft && (
        <View style={s.draft}>
          <Image
            source={{ uri: draft.photo.uri }}
            style={s.thumb}
            accessibilityLabel="待傳送照片預覽"
          />
          <View style={s.draftInfo}>
            <Text style={s.title}>待傳送照片</Text>
            <Text style={s.note}>
              {draft.photo.contentType.replace('image/', '').toUpperCase()} ·{' '}
              {(draft.photo.size / 1024 / 1024).toFixed(1)} MiB
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="移除照片"
            disabled={pending}
            style={s.icon}
            onPress={() => {
              setDraft(null);
              setError('');
            }}
          >
            <Ionicons name="close" size={22} color={theme.colors.muted} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: pending, busy: pending }}
            disabled={pending}
            style={[s.send, pending && s.disabled]}
            onPress={send}
          >
            <Text style={s.sendText}>
              {pending ? '照片傳送中…' : error ? '重新傳送照片' : '傳送照片'}
            </Text>
          </Pressable>
        </View>
      )}
      {thread && !!(error || sent) && (
        <Text accessibilityLiveRegion="polite" style={s.feedback}>
          {error || '照片已傳送'}
        </Text>
      )}
      <View style={barStyle}>
        {thread && !draft && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="加入照片"
            accessibilityHint="可選擇小於 10 MiB 的 JPG、PNG 或 WebP 照片"
            style={s.icon}
            onPress={pick}
          >
            <Ionicons name="image-outline" size={24} color={theme.colors.accent} />
          </Pressable>
        )}
        {children}
      </View>
    </>
  );
}

export function DmPhotoMessage({ scope, path }: { scope: PhotoScope; path: string }) {
  const s = useThemeStyleSheet(styles);
  const [open, setOpen] = useState<Awaited<ReturnType<typeof openDmPhoto>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const request = useRef<AbortController | null>(null);
  useLayoutEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') return;
      request.current?.abort();
      request.current = null;
      setBusy(false);
      setOpen(null);
      setNotice('');
    });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(
      () => {
        setOpen(null);
        setNotice('檢視時間已結束，可以再次開啟。');
      },
      Math.max(0, open.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [open]);

  async function toggle() {
    setNotice('');
    if (open) {
      setOpen(null);
      return;
    }
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    try {
      const resolved = await openDmPhoto(scope, path, controller.signal);
      if (!controller.signal.aborted) setOpen(resolved);
    } catch {
      if (!controller.signal.aborted) setNotice('照片暫時無法開啟，請再試一次。');
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <View style={s.message}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ busy, expanded: !!open, disabled: busy }}
        disabled={busy}
        style={s.openButton}
        onPress={toggle}
      >
        <Ionicons name="image-outline" size={20} color={theme.colors.text} />
        <Text style={s.title}>{open ? '收合照片' : busy ? '正在開啟…' : '查看照片'}</Text>
      </Pressable>
      {!!open && (
        <Image
          accessibilityLabel="對話中的照片"
          resizeMode="contain"
          source={{ uri: open.uri }}
          style={s.photo}
          onError={() => {
            setOpen(null);
            setNotice('照片暫時無法顯示，請再試一次。');
          }}
        />
      )}
      {!!notice && (
        <Text accessibilityLiveRegion="polite" style={s.messageNote}>
          {notice}
        </Text>
      )}
    </View>
  );
}

const styles = () =>
  StyleSheet.create({
    icon: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    draft: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      paddingHorizontal: 12,
      paddingVertical: 8,
      gap: 6,
      backgroundColor: theme.colors.surface2,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
    },
    thumb: { height: 48, width: 48, borderRadius: 8 },
    draftInfo: { flexGrow: 1, gap: 2 },
    title: { color: theme.colors.text, fontWeight: '600', fontSize: 15 },
    note: { color: theme.colors.muted, fontSize: 12 },
    feedback: {
      color: theme.colors.text,
      backgroundColor: theme.colors.surface,
      paddingHorizontal: 16,
      paddingVertical: 4,
    },
    send: {
      minHeight: 44,
      paddingHorizontal: 14,
      borderRadius: 22,
      justifyContent: 'center',
      backgroundColor: theme.colors.accent,
    },
    sendText: { color: theme.colors.onAccent, fontWeight: '700' },
    disabled: { opacity: 0.6 },
    message: { gap: 4, alignItems: 'flex-start' },
    openButton: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      backgroundColor: theme.colors.surface2,
      borderRadius: 14,
    },
    photo: {
      width: 190,
      height: 180,
      maxWidth: '100%',
      borderRadius: 12,
      backgroundColor: theme.colors.surface2,
    },
    messageNote: {
      maxWidth: 200,
      color: theme.colors.text,
      backgroundColor: theme.colors.surface2,
      padding: 5,
    },
  });
