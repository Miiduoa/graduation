import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { STUDENT_CARD_TTL_MS } from '@campus/shared/src/studentCard';
import { StudentCardUnavailable, verifyStudentCardCode } from '../services/studentCard';
import {
  getStudentCardNfcCapabilities,
  readStudentCardNfc,
  StudentCardNfcError,
  type StudentCardNfcCapabilities,
} from '../services/studentCardNfc';
import { theme } from '../ui/theme';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';

type Receipt = Awaited<ReturnType<typeof verifyStudentCardCode>>;
type ReaderState =
  | { kind: 'reading' | 'ready' | 'checking' }
  | { kind: 'success'; receipt: Receipt }
  | { kind: 'error'; message: string; retry: 'read' | 'verify' };

export function StudentCardNfc({ onPresent }: { onPresent?: () => void }) {
  const s = useThemeStyleSheet(createStyles);
  const [capability, setCapability] = useState<StudentCardNfcCapabilities | null>(null);
  const [showReader, setShowReader] = useState(false);
  const [settingsError, setSettingsError] = useState(false);
  const [capabilityError, setCapabilityError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const close = useCallback(() => setShowReader(false), []);

  useEffect(() => {
    let mounted = true;
    const refresh = () => {
      void getStudentCardNfcCapabilities()
        .then((result) => {
          if (mounted) {
            setCapability(result);
            setCapabilityError(false);
          }
        })
        .catch(() => {
          if (mounted) {
            setCapability(null);
            setCapabilityError(true);
          }
        });
    };
    refresh();
    const state = AppState.addEventListener('change', (next) => {
      if (next === 'active') refresh();
      // Core NFC presents a system sheet while the iOS app may be inactive.
      if (next === 'background') close();
    });
    return () => {
      mounted = false;
      state.remove();
    };
  }, [close, refreshKey]);

  const ready = capability?.canRead && capability.enabled;
  let description = '正在確認裝置的 NFC 功能…';
  if (capabilityError) description = '暫時無法確認 NFC 狀態，請再試一次。';
  if (capability) {
    if (!capability.moduleAvailable) description = '安裝支援 NFC 的 App 版本，即可使用感應核對。';
    else if (!capability.canRead) description = '這台裝置未提供 NFC 感應功能。';
    else if (!capability.enabled) description = '開啟手機的 NFC，即可開始感應。';
    else if (capability.canPresent && onPresent)
      description = '出示或核對 nuni 學生證，讓兩支手機靠近即可傳送憑證。';
    else description = '可核對 Android 手機出示的 nuni 學生證。';
  }

  return (
    <View style={s.panel}>
      <View style={s.heading}>
        <View style={s.smallIcon}>
          <Ionicons accessible={false} name="radio-outline" size={23} color={theme.colors.text} />
        </View>
        <View style={s.headingText}>
          <Text accessibilityRole="header" style={s.title}>
            NFC 感應
          </Text>
          <Text style={s.caption}>短效憑證 · 單次核對</Text>
        </View>
        {ready && <Text style={s.status}>已就緒</Text>}
      </View>
      <Text style={s.body}>{description}</Text>
      {capabilityError && (
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [s.action, s.secondary, pressed && s.pressed]}
          onPress={() => {
            setCapabilityError(false);
            setRefreshKey((value) => value + 1);
          }}
        >
          <Text style={s.actionText}>重新確認 NFC</Text>
        </Pressable>
      )}
      {ready && (
        <View style={s.actions}>
          {capability.canPresent && onPresent && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="感應出示"
              onPress={onPresent}
              style={({ pressed }) => [s.action, s.actionInRow, s.primary, pressed && s.pressed]}
            >
              <Ionicons
                accessible={false}
                name="phone-portrait-outline"
                size={20}
                color="#FFFFFF"
              />
              <Text style={s.primaryText}>感應出示</Text>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="感應核對"
            onPress={() => setShowReader(true)}
            style={({ pressed }) => [s.action, s.actionInRow, s.secondary, pressed && s.pressed]}
          >
            <Ionicons accessible={false} name="scan-outline" size={20} color={theme.colors.text} />
            <Text style={s.actionText}>感應核對</Text>
          </Pressable>
        </View>
      )}
      {capability?.canRead && !capability.enabled && Platform.OS === 'android' && (
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [s.action, s.secondary, pressed && s.pressed]}
          onPress={() => {
            setSettingsError(false);
            void Linking.sendIntent('android.settings.NFC_SETTINGS').catch(() =>
              setSettingsError(true),
            );
          }}
        >
          <Text style={s.actionText}>開啟 NFC 設定</Text>
        </Pressable>
      )}
      {settingsError && (
        <Text accessibilityRole="alert" style={s.body}>
          請到手機設定開啟 NFC。
        </Text>
      )}
      {showReader && <NfcReader onClose={close} />}
    </View>
  );
}

function NfcReader({ onClose }: { onClose: () => void }) {
  const s = useThemeStyleSheet(createStyles);
  const [state, setState] = useState<ReaderState>({ kind: 'reading' });
  const [shown, setShown] = useState(false);
  const token = useRef('');
  const pending = useRef<AbortController | null>(null);

  const read = useCallback(async () => {
    pending.current?.abort();
    token.current = '';
    const request = new AbortController();
    pending.current = request;
    setState({ kind: 'reading' });
    try {
      const value = await readStudentCardNfc(request.signal);
      if (request.signal.aborted) return;
      token.current = value;
      setState({ kind: 'ready' });
    } catch (error) {
      if (request.signal.aborted) return;
      if (error instanceof StudentCardNfcError && error.code === 'CANCELLED') {
        onClose();
      } else {
        setState({
          kind: 'error',
          retry: 'read',
          message:
            error instanceof StudentCardNfcError ? error.message : '感應未完成，請重新靠近後再試。',
        });
      }
    } finally {
      if (pending.current === request) pending.current = null;
    }
  }, [onClose]);

  useEffect(() => {
    if (!shown) return;
    const frame = requestAnimationFrame(() => {
      void read();
    });
    return () => {
      cancelAnimationFrame(frame);
      pending.current?.abort();
      token.current = '';
    };
  }, [read, shown]);

  useEffect(() => {
    if (state.kind !== 'ready' && state.kind !== 'success' && state.kind !== 'error') return;
    const timer = setTimeout(onClose, STUDENT_CARD_TTL_MS);
    return () => clearTimeout(timer);
  }, [state.kind, onClose]);

  async function verify() {
    if (!token.current || pending.current) return;
    const request = new AbortController();
    pending.current = request;
    setState({ kind: 'checking' });
    const timeout = setTimeout(() => {
      request.abort();
      setState({ kind: 'error', retry: 'verify', message: '連線逾時，請再試一次。' });
    }, 15_000);
    const clearDeadline = () => clearTimeout(timeout);
    request.signal.addEventListener('abort', clearDeadline, { once: true });
    try {
      const receipt = await verifyStudentCardCode(token.current, request.signal);
      if (request.signal.aborted) return;
      token.current = '';
      setState({ kind: 'success', receipt });
    } catch (error) {
      if (!request.signal.aborted) {
        token.current = '';
        setState({
          kind: 'error',
          retry: 'read',
          message:
            error instanceof StudentCardUnavailable
              ? error.message
              : '暫時無法連線核對，請重新感應後再試。',
        });
      }
    } finally {
      clearTimeout(timeout);
      request.signal.removeEventListener('abort', clearDeadline);
      if (pending.current === request) pending.current = null;
    }
  }

  const success = state.kind === 'success';
  const reading = state.kind === 'reading';
  const checking = state.kind === 'checking';
  let title = '已讀取感應憑證';
  let description = '請確認要核對對方的校園學號。每張憑證限用一次。';
  if (reading) {
    title = '讓兩支手機靠近';
    description =
      Platform.OS === 'ios'
        ? '請對方開啟「感應出示」，再將你的 iPhone 頂端靠近對方手機背面。'
        : '請對方開啟「感應出示」，再將兩支手機的背面靠近並保持不動。';
  } else if (checking) {
    title = '正在核對學號';
    description = '正在確認憑證的有效期限與校園登入資料。';
  } else if (success) {
    title = '學號已核對';
    description = '請與對方卡面上的學校及學號末四碼比對。';
  } else if (state.kind === 'error') {
    title = state.retry === 'verify' ? '核對尚未完成' : '再靠近一次';
    description = state.message;
  }

  return (
    <Modal
      visible
      onRequestClose={onClose}
      onShow={() => setShown(true)}
      testID="student-card-nfc-reader"
      animationType="fade"
      presentationStyle="fullScreen"
    >
      <SafeAreaView style={s.reader} accessibilityViewIsModal>
        <ScrollView contentContainerStyle={s.readerContent}>
          <Text style={s.eyebrow}>CAMPUS ONE</Text>
          <Text style={s.readerLabel}>NFC 感應核對</Text>
          <View style={s.signalOuter} accessible={false}>
            <View style={[s.signalInner, success && s.signalSuccess]}>
              <Ionicons
                name={success ? 'checkmark' : reading ? 'radio-outline' : 'document-text-outline'}
                size={42}
                color={success ? '#FFFFFF' : '#183F36'}
              />
            </View>
          </View>
          <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={s.readerTitle}>
            {title}
          </Text>
          <Text
            accessibilityRole={state.kind === 'error' ? 'alert' : undefined}
            style={s.readerBody}
          >
            {description}
          </Text>
          {(reading || checking) && (
            <ActivityIndicator color="#183F36" accessibilityLabel={title} />
          )}
          {success && (
            <View style={s.receipt}>
              <Text style={s.receiptLabel}>學校</Text>
              <Text style={s.schoolName}>{state.receipt.schoolName}</Text>
              <View style={s.divider} />
              <Text style={s.receiptLabel}>學號末碼</Text>
              <Text style={s.maskedId}>{state.receipt.maskedId}</Text>
              <Text style={s.receiptNote}>憑證已使用 · 60 秒後收起</Text>
            </View>
          )}
          {state.kind === 'ready' && (
            <Pressable
              accessibilityRole="button"
              onPress={() => void verify()}
              style={({ pressed }) => [s.confirm, pressed && s.pressed]}
            >
              <Text style={s.primaryText}>核對這張卡</Text>
            </Pressable>
          )}
          {state.kind === 'error' && (
            <Pressable
              accessibilityRole="button"
              onPress={() => void (state.retry === 'verify' ? verify() : read())}
              style={({ pressed }) => [s.confirm, pressed && s.pressed]}
            >
              <Text style={s.primaryText}>
                {state.retry === 'verify' ? '再試一次' : '重新感應'}
              </Text>
            </Pressable>
          )}
          <Text style={s.readerFootnote}>門禁、借書與在學證明請依校方規定辦理。</Text>
        </ScrollView>
        <Pressable
          accessibilityRole="button"
          onPress={onClose}
          style={({ pressed }) => [s.dismiss, pressed && s.pressed]}
        >
          <Text style={s.dismissText}>{success ? '完成核對' : '取消核對'}</Text>
        </Pressable>
      </SafeAreaView>
    </Modal>
  );
}

const createStyles = () =>
  StyleSheet.create({
    panel: {
      gap: 16,
      padding: 20,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    heading: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
    smallIcon: {
      width: 44,
      height: 44,
      borderRadius: 14,
      backgroundColor: theme.colors.surface2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headingText: { flex: 1, minWidth: 110, gap: 4 },
    title: { fontSize: 18, fontWeight: '700', color: theme.colors.text },
    caption: { fontSize: 12, color: theme.colors.textSecondary },
    status: { fontSize: 12, color: theme.colors.success, fontWeight: '600' },
    body: { fontSize: 14, lineHeight: 22, color: theme.colors.textSecondary },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    action: {
      minHeight: 50,
      borderRadius: 13,
      padding: 12,
      gap: 8,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionInRow: { flexGrow: 1, flexBasis: 120 },
    primary: { backgroundColor: '#163D34' },
    primaryText: {
      color: '#FFFFFF',
      fontSize: 15,
      fontWeight: '600',
      flexShrink: 1,
      textAlign: 'center',
    },
    secondary: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.bg,
    },
    actionText: { color: theme.colors.text, fontSize: 15, fontWeight: '600', flexShrink: 1 },
    pressed: { opacity: 0.75 },
    reader: { flex: 1, backgroundColor: '#F8FAF5' },
    readerContent: {
      flexGrow: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 28,
      gap: 16,
      width: '100%',
      maxWidth: 520,
      alignSelf: 'center',
    },
    eyebrow: { color: '#416557', fontSize: 12, fontWeight: '700', letterSpacing: 2.5 },
    readerLabel: { color: '#40574D', fontSize: 14 },
    signalOuter: {
      width: 132,
      height: 132,
      marginVertical: 16,
      borderRadius: 66,
      borderWidth: 1,
      borderColor: '#CBDCCF',
      alignItems: 'center',
      justifyContent: 'center',
    },
    signalInner: {
      width: 96,
      height: 96,
      borderRadius: 48,
      backgroundColor: '#E3ECE2',
      alignItems: 'center',
      justifyContent: 'center',
    },
    signalSuccess: { backgroundColor: '#163D34' },
    readerTitle: { color: '#102D24', fontSize: 27, fontWeight: '700', textAlign: 'center' },
    readerBody: { color: '#40574D', fontSize: 16, lineHeight: 25, textAlign: 'center' },
    confirm: {
      backgroundColor: '#163D34',
      minHeight: 52,
      borderRadius: 14,
      padding: 15,
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      marginTop: 8,
    },
    receipt: {
      width: '100%',
      padding: 22,
      borderWidth: 1,
      borderColor: '#CDDCD0',
      borderRadius: 18,
      backgroundColor: '#FFFFFF',
      gap: 8,
    },
    receiptLabel: { color: '#587163', fontSize: 13 },
    schoolName: { color: '#102D24', fontSize: 21, fontWeight: '600' },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#CDDCD0', marginVertical: 6 },
    maskedId: {
      color: '#102D24',
      fontSize: 28,
      fontWeight: '700',
      letterSpacing: 2,
      fontVariant: ['tabular-nums'],
    },
    receiptNote: { color: '#40574D', fontSize: 13, marginTop: 6 },
    readerFootnote: {
      color: '#587163',
      fontSize: 12,
      lineHeight: 18,
      textAlign: 'center',
      marginTop: 12,
    },
    dismiss: {
      minHeight: 52,
      marginHorizontal: 24,
      marginVertical: 12,
      padding: 14,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: '#BACDBF',
      alignItems: 'center',
      justifyContent: 'center',
    },
    dismissText: { color: '#183F36', fontSize: 16, fontWeight: '600' },
  });
