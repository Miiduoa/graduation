import React, { useEffect, useState, type ReactNode } from 'react';
import {
  AppState,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import { parseAccountDemoSnapshot, type AccountDemoSnapshot } from '@campus/shared/src/accountDemo';
import { toPublicSchoolId } from '@campus/shared/src/schoolIds';
import { maskStudentId, STUDENT_CARD_TTL_MS } from '@campus/shared/src/studentCard';
import { theme } from '../ui/theme';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';
import { useTabBarContentBottomPadding } from '../ui/navigationTheme';

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; demo: AccountDemoSnapshot | null };
type Request = (path: string, context: string) => Promise<unknown>;

/** Uses the native platform session; no Firebase profile or client-side role unlock is needed. */
export function AccountDemoStudentCard({
  accountId,
  context,
  schoolId,
  sessionExpiresAt,
  request,
  fallback,
  footer,
}: {
  accountId: string;
  context: string;
  schoolId: string;
  sessionExpiresAt: number;
  request: Request;
  fallback: ReactNode;
  footer: ReactNode;
}) {
  const s = useThemeStyleSheet(createStyles);
  const bottom = useTabBarContentBottomPadding();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(Date.now);
  const [linkError, setLinkError] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const result = await request('account-demo', context);
        if (!result || typeof result !== 'object' || !('demo' in result))
          throw new Error('Invalid demo');
        const demo = result.demo === null ? null : parseAccountDemoSnapshot(result.demo);
        if (demo && demo.accountId !== accountId) throw new Error('Account changed');
        if (active) {
          setNow(Date.now());
          setState({ status: 'ready', demo });
        }
      } catch {
        if (active) setState({ status: 'error' });
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [accountId, context, request, attempt]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const subscription = AppState.addEventListener('change', (value) => {
      if (value === 'active') {
        setState({ status: 'loading' });
        setAttempt((previous) => previous + 1);
      }
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, []);

  const demo = state.status === 'ready' ? state.demo : null;
  if (state.status === 'ready' && !demo) return <>{fallback}</>;
  const expired = sessionExpiresAt <= now || (!!demo && Date.parse(demo.expiresAt) <= now);
  const sameSchool = !!demo && toPublicSchoolId(demo.profile.schoolId) === schoolId;
  const enabled = !!demo && demo.permissions.studentCard && sameSchool && !expired;
  return (
    <ScrollView style={s.page} contentContainerStyle={[s.content, { paddingBottom: bottom }]}>
      {state.status === 'loading' ? (
        <Text accessibilityLiveRegion="polite" style={s.body}>
          正在讀取帳號學生證…
        </Text>
      ) : state.status === 'error' ? (
        <View style={s.section}>
          <Text accessibilityRole="alert" style={s.title}>
            暫時無法讀取展示學生證
          </Text>
          <Pressable
            accessibilityRole="button"
            style={s.button}
            onPress={() => {
              setState({ status: 'loading' });
              setAttempt((value) => value + 1);
            }}
          >
            <Text style={s.buttonText}>重新讀取</Text>
          </Pressable>
        </View>
      ) : enabled && demo ? (
        <DemoWallet key={demo.revision} demo={demo} sessionExpiresAt={sessionExpiresAt} />
      ) : (
        <View style={s.section}>
          <Text accessibilityRole="header" style={s.title}>
            {expired
              ? '展示資料已到期'
              : !sameSchool
                ? '請切回展示帳號的學校'
                : '學生證展示尚未開啟'}
          </Text>
          <Text style={s.body}>
            {!sameSchool && !expired && demo
              ? `這張展示學生證屬於${demo.profile.schoolName}。`
              : '到帳號展示頁確認學生證的開啟狀態。'}
          </Text>
        </View>
      )}
      {state.status !== 'loading' && (
        <Pressable
          accessibilityRole="link"
          style={s.secondary}
          onPress={() => {
            setLinkError(false);
            void Linking.openURL('https://nuni.tw/demo/account').catch(() => setLinkError(true));
          }}
        >
          <Text style={s.secondaryText}>展示資料與權限</Text>
        </Pressable>
      )}
      {linkError && (
        <Text accessibilityRole="alert" style={s.body}>
          無法開啟展示頁，請稍後再試。
        </Text>
      )}
      {footer}
    </ScrollView>
  );
}

function DemoWallet({
  demo,
  sessionExpiresAt,
}: {
  demo: AccountDemoSnapshot;
  sessionExpiresAt: number;
}) {
  const s = useThemeStyleSheet(createStyles);
  const [presentation, setPresentation] = useState<'number' | 'code' | null>(null);
  const { profile } = demo;
  const hideNumber = (text: string) =>
    text.replaceAll(profile.studentId, maskStudentId(profile.studentId));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (value) => {
      if (value !== 'active') setPresentation(null);
    });
    return () => subscription.remove();
  }, []);
  return (
    <>
      <View style={s.card} accessibilityLabel="展示學生證">
        <View style={s.cardHeader}>
          <Text style={s.brand}>nuni</Text>
          <Text style={s.cardLabel}>展示學生證</Text>
        </View>
        <Text style={s.school}>{profile.schoolName}</Text>
        <Text style={s.name}>{hideNumber(profile.displayName)}</Text>
        <Text style={s.department}>{hideNumber(profile.department)}</Text>
        <View style={s.cardFooter}>
          <Text style={s.cardLabel}>DEMO</Text>
          <Text style={s.masked}>{maskStudentId(profile.studentId)}</Text>
        </View>
      </View>
      <View style={s.section}>
        <Text style={s.body}>這張卡使用你的帳號展示資料，出示後會在 60 秒內自動收起。</Text>
        <Pressable
          accessibilityRole="button"
          style={s.button}
          onPress={() => setPresentation('code')}
        >
          <Text style={s.buttonText}>出示展示 QR Code</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={s.secondary}
          onPress={() => setPresentation('number')}
        >
          <Text style={s.secondaryText}>出示學號</Text>
        </Pressable>
      </View>
      {presentation && (
        <DemoPresentation
          key={presentation}
          demo={demo}
          sessionExpiresAt={sessionExpiresAt}
          mode={presentation}
          onClose={() => setPresentation(null)}
        />
      )}
    </>
  );
}

function DemoPresentation({
  demo,
  mode,
  sessionExpiresAt,
  onClose,
}: {
  demo: AccountDemoSnapshot;
  mode: 'number' | 'code';
  sessionExpiresAt: number;
  onClose: () => void;
}) {
  const s = useThemeStyleSheet(createStyles);
  const [expiresAt] = useState(() =>
    Math.min(sessionExpiresAt, Date.parse(demo.expiresAt), Date.now() + STUDENT_CARD_TTL_MS),
  );
  const [now, setNow] = useState(Date.now);
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    const deadline = setTimeout(onClose, Math.max(0, expiresAt - Date.now()));
    return () => {
      clearInterval(timer);
      clearTimeout(deadline);
    };
  }, [expiresAt, onClose]);
  useEffect(() => {
    if (seconds === 0) onClose();
  }, [onClose, seconds]);
  const payload = `nuni-demo-card:v1:${demo.profile.schoolId}:${demo.profile.studentId}:${expiresAt}`;
  return (
    <Modal
      visible
      onRequestClose={onClose}
      testID="demo-student-card-presentation"
      presentationStyle="fullScreen"
    >
      <SafeAreaView style={s.presentation} accessibilityViewIsModal onAccessibilityEscape={onClose}>
        <ScrollView contentContainerStyle={s.sheet}>
          <Text style={s.sheetBrand}>nuni</Text>
          <Text style={s.sheetSchool}>{demo.profile.schoolName}</Text>
          <Text accessibilityRole="header" style={s.sheetNote}>
            展示學生證 · {mode === 'code' ? 'QR Code' : '出示學號'}
          </Text>
          {seconds > 0 && (
            <>
              {mode === 'code' && (
                <View accessible accessibilityLabel="DEMO 展示學生證 QR Code" style={s.qr}>
                  <QRCode
                    value={payload}
                    size={220}
                    quietZone={16}
                    color="#102D24"
                    backgroundColor="#FFFFFF"
                  />
                </View>
              )}
              <Text style={s.number}>{demo.profile.studentId}</Text>
              <Text style={s.sheetNote}>展示資料 · DEMO</Text>
              <Text style={s.sheetNote}>{seconds} 秒後自動收起</Text>
            </>
          )}
        </ScrollView>
        <Pressable accessibilityRole="button" style={s.close} onPress={onClose}>
          <Text style={s.buttonText}>收起學生證</Text>
        </Pressable>
      </SafeAreaView>
    </Modal>
  );
}

const createStyles = () =>
  StyleSheet.create({
    page: { backgroundColor: theme.colors.bg },
    content: { width: '100%', maxWidth: 560, alignSelf: 'center', padding: 20, gap: 24 },
    section: { gap: 12 },
    title: { color: theme.colors.text, fontSize: 19, fontWeight: '700' },
    body: { color: theme.colors.textSecondary, fontSize: 15, lineHeight: 23 },
    card: { backgroundColor: '#163D34', borderRadius: 20, padding: 22 },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    brand: { color: '#FFFDF7', fontSize: 26, fontWeight: '700', letterSpacing: -1 },
    cardLabel: { color: '#D2E8DC', fontSize: 13 },
    school: { color: '#FFFDF7', fontSize: 24, fontWeight: '700', marginTop: 24 },
    name: { color: '#E1EBE4', fontSize: 19, marginTop: 8 },
    department: { color: '#D2E8DC', fontSize: 14, marginTop: 6 },
    cardFooter: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: '#74978A',
      marginTop: 24,
      paddingTop: 14,
    },
    masked: { color: '#FFFDF7', fontSize: 16, fontVariant: ['tabular-nums'], letterSpacing: 1.8 },
    button: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 50,
      padding: 12,
      borderRadius: 14,
      backgroundColor: '#163D34',
    },
    buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600', flexShrink: 1 },
    secondary: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 50,
      padding: 12,
      borderRadius: 14,
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      borderWidth: 1,
    },
    secondaryText: { color: theme.colors.text, fontSize: 16, fontWeight: '600' },
    presentation: { flex: 1, backgroundColor: '#F8FAF5' },
    sheet: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },
    sheetBrand: { color: '#416557', fontSize: 26, fontWeight: '700', letterSpacing: -1 },
    sheetSchool: { color: '#183F36', fontSize: 19, fontWeight: '700', textAlign: 'center' },
    sheetNote: { color: '#40574D', fontSize: 15, textAlign: 'center' },
    number: {
      color: '#102D24',
      maxWidth: '100%',
      fontSize: 30,
      fontWeight: '700',
      textAlign: 'center',
      fontVariant: ['tabular-nums'],
    },
    qr: { borderRadius: 16, backgroundColor: '#FFFFFF', padding: 2, marginVertical: 4 },
    close: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 50,
      padding: 12,
      borderRadius: 14,
      backgroundColor: '#163D34',
      marginHorizontal: 24,
      marginVertical: 12,
    },
  });
