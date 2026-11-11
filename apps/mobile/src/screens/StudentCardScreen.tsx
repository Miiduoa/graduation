import React, { useEffect, useRef, useState } from 'react';
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
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import type { User } from 'firebase/auth';
import { toPublicSchoolId } from '@campus/shared/src/schoolIds';
import {
  getStudentCardService,
  maskStudentId,
  STUDENT_CARD_TTL_MS,
} from '@campus/shared/src/studentCard';
import { useAuth, type UserProfile } from '../state/auth';
import { useSchool } from '../state/school';
import {
  requestStudentCardCode,
  StudentCardUnavailable,
  type StudentCardCode,
} from '../services/studentCard';
import { isDemoUid } from '../services/demoSession';
import {
  beginStudentCardNfcPresentation,
  getStudentCardNfcCapabilities,
  StudentCardNfcError,
} from '../services/studentCardNfc';
import { StudentCardNfc } from '../components/StudentCardNfc';
import { theme } from '../ui/theme';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';
import { useTabBarContentBottomPadding } from '../ui/navigationTheme';

type Icon = React.ComponentProps<typeof Ionicons>['name'];

function Action({
  label,
  icon,
  onPress,
  secondary,
}: {
  label: string;
  icon: Icon;
  onPress: () => void;
  secondary?: boolean;
}) {
  const s = useThemeStyleSheet(createStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [s.button, secondary && s.secondary, pressed && s.pressed]}
    >
      <Ionicons name={icon} size={20} color={secondary ? theme.colors.text : '#FFFFFF'} />
      <Text style={[s.buttonText, secondary && s.secondaryText]}>{label}</Text>
    </Pressable>
  );
}

function Presentation({
  user,
  schoolId,
  schoolName,
  studentId,
  mode,
  onClose,
}: {
  user: User;
  schoolId: string;
  schoolName: string;
  studentId: string;
  mode: 'number' | 'code' | 'nfc';
  onClose: () => void;
}) {
  const { width } = useWindowDimensions();
  const [code, setCode] = useState<StudentCardCode | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now);
  const [transport, setTransport] = useState<'qr' | 'nfc'>(mode === 'nfc' ? 'nfc' : 'qr');
  const [canPresentNfc, setCanPresentNfc] = useState(mode === 'nfc');
  const [nfcReady, setNfcReady] = useState(false);
  const [nfcError, setNfcError] = useState('');
  const [shown, setShown] = useState(false);
  const [nfcAttempt, setNfcAttempt] = useState(0);
  const openedAt = useRef(now);
  const s = useThemeStyleSheet(createStyles);
  const requestCode = mode !== 'number';
  useEffect(() => {
    if (!requestCode) return;
    let mounted = true;
    void getStudentCardNfcCapabilities()
      .then((capability) => {
        if (mounted) setCanPresentNfc(capability.canPresent && capability.enabled);
      })
      .catch(() => {
        if (mounted) setCanPresentNfc(false);
      });
    return () => {
      mounted = false;
    };
  }, [requestCode]);
  useEffect(() => {
    if (!requestCode) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
      setError('連線逾時，請收起後再試。');
    }, 15_000);
    void requestStudentCardCode(user, schoolId, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setNow(Date.now());
          setCode(result);
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            reason instanceof StudentCardUnavailable ? reason.message : '無法連線，請收起後再試。',
          );
        }
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [requestCode, schoolId, user]);

  useEffect(() => {
    if (!shown || transport !== 'nfc' || !code) return;
    const controller = new AbortController();
    setNfcReady(false);
    setNfcError('');
    const frame = requestAnimationFrame(() => {
      void beginStudentCardNfcPresentation(code, controller.signal, () => {
        if (!controller.signal.aborted) {
          controller.abort();
          setNfcReady(false);
          setNfcError('感應已停止，請重新開啟或使用 QR Code。');
        }
      })
        .then(() => {
          if (!controller.signal.aborted) setNfcReady(true);
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted)
            setNfcError(
              reason instanceof StudentCardNfcError
                ? reason.message
                : '無法開啟感應，請改用 QR Code。',
            );
        });
    });
    return () => {
      cancelAnimationFrame(frame);
      controller.abort();
    };
  }, [code, transport, shown, nfcAttempt]);

  const endsAt = code?.expiresAt ?? openedAt.current + STUDENT_CARD_TTL_MS;
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    const deadline = setTimeout(onClose, Math.max(0, endsAt - Date.now()));
    return () => {
      clearInterval(timer);
      clearTimeout(deadline);
    };
  }, [endsAt, onClose]);
  const seconds = Math.max(0, Math.ceil((endsAt - now) / 1000));
  const visibleCode = requestCode && seconds > 0 ? code : null;
  return (
    <Modal
      visible
      onRequestClose={onClose}
      onShow={() => setShown(true)}
      testID="student-card-presentation"
      animationType="none"
      presentationStyle="fullScreen"
    >
      <SafeAreaView style={s.presentation} accessibilityViewIsModal onAccessibilityEscape={onClose}>
        <ScrollView contentContainerStyle={s.sheet}>
          <Text style={s.sheetBrand}>CAMPUS ONE</Text>
          <Text style={s.sheetSchool}>{schoolName}</Text>
          <Text accessibilityRole="header" style={s.sheetTitle}>
            {requestCode ? (transport === 'nfc' ? 'NFC 感應出示' : '學號驗證碼') : '出示學號'}
          </Text>
          {requestCode && !code && !error && (
            <ActivityIndicator accessibilityLabel="正在取得驗證碼" color="#183F36" />
          )}
          {error ? (
            <Text accessibilityRole="alert" style={s.sheetNote}>
              {error}
            </Text>
          ) : null}
          {visibleCode && transport === 'qr' ? (
            <View accessible accessibilityLabel="供對方掃描的限時學號驗證碼" style={s.qr}>
              <QRCode
                value={`https://nuni.tw/student-card/verify#${visibleCode.token}`}
                size={Math.max(120, Math.min(256, width - 88))}
                quietZone={16}
                color="#101A17"
                backgroundColor="#FFFFFF"
              />
            </View>
          ) : null}
          {visibleCode && transport === 'nfc' && (
            <View style={s.nfcPresentation}>
              <View style={s.nfcRing} accessible={false}>
                <Ionicons name="radio-outline" size={54} color="#183F36" />
              </View>
              <Text accessibilityLiveRegion="polite" style={s.nfcTitle}>
                {nfcError ? '感應尚未開啟' : nfcReady ? '靠近對方手機' : '正在開啟感應…'}
              </Text>
              <Text accessibilityRole={nfcError ? 'alert' : undefined} style={s.sheetNote}>
                {nfcError || '請對方在 nuni 開啟「感應核對」，再靠近這支手機背面。'}
              </Text>
              {!nfcReady && !nfcError && (
                <ActivityIndicator color="#183F36" accessibilityLabel="正在開啟感應" />
              )}
              {nfcReady && <Text style={s.nfcStatus}>感應出示已開啟</Text>}
              {nfcError && (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setNfcAttempt((value) => value + 1)}
                  style={s.retryNfc}
                >
                  <Text style={s.transportText}>重新開啟感應</Text>
                </Pressable>
              )}
            </View>
          )}
          {(!requestCode || visibleCode) && (
            <>
              <Text style={s.number}>{code?.studentId ?? studentId}</Text>
              <Text style={s.sheetNote}>
                {requestCode
                  ? transport === 'nfc'
                    ? '請以對方手機顯示的核對結果為準。'
                    : '請對方掃描並核對學號末碼。每組驗證碼限用一次。'
                  : '個人檔案學號 · 未經校方核驗'}
              </Text>
              <Text style={s.countdown}>{seconds} 秒後收起</Text>
              {requestCode && (
                <View style={s.expiryTrack} accessible={false}>
                  <View
                    style={[s.expiryProgress, { width: `${Math.min(100, (seconds / 60) * 100)}%` }]}
                  />
                </View>
              )}
            </>
          )}
          {visibleCode && (canPresentNfc || transport === 'nfc') && (
            <View style={s.transports} accessibilityRole="tablist">
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: transport === 'nfc' }}
                onPress={() => setTransport('nfc')}
                style={[s.transport, transport === 'nfc' && s.transportSelected]}
              >
                <Text style={s.transportText}>NFC 感應</Text>
              </Pressable>
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: transport === 'qr' }}
                onPress={() => setTransport('qr')}
                style={[s.transport, transport === 'qr' && s.transportSelected]}
              >
                <Text style={s.transportText}>QR Code</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
        <Pressable accessibilityRole="button" onPress={onClose} style={s.close}>
          <Text style={s.closeText}>收起學生證</Text>
        </Pressable>
      </SafeAreaView>
    </Modal>
  );
}

export default function StudentCardScreen() {
  const auth = useAuth();
  const { selectionReady, selection, school } = useSchool();
  const focused = useIsFocused();
  const s = useThemeStyleSheet(createStyles);
  const user = auth.user;
  const profile = auth.profile;
  const schoolId = toPublicSchoolId(selection.schoolId);
  const ready = selectionReady && !auth.loading && !auth.profileLoading;
  let issue: string | undefined;
  if (!ready) issue = '正在確認帳號與學校…';
  else if (!user || user.isAnonymous || auth.tokenExpired) issue = '請先登入學校帳號。';
  else if (profile?.uid !== user.uid) issue = '目前無法讀取這個帳號的個人檔案。';
  else if (profile.role !== 'student') issue = '數位學生證僅提供學生帳號使用。';
  else if (
    !schoolId ||
    toPublicSchoolId(profile.schoolId) !== schoolId ||
    toPublicSchoolId(school.id) !== schoolId
  )
    issue = '請切回帳號所屬的學校，再開啟學生證。';
  if (!focused) return null;
  if (issue || !user || !profile || !schoolId)
    return (
      <ScrollView style={s.page} contentContainerStyle={s.content}>
        <Text style={s.body}>{issue}</Text>
        {ready && <StudentCardNfc key={JSON.stringify([user?.uid, schoolId])} />}
        {ready && schoolId && <OfficialService key={schoolId} schoolId={schoolId} />}
      </ScrollView>
    );
  return (
    <Wallet
      key={JSON.stringify([user.uid, school.id, profile.studentId])}
      user={user}
      profile={profile}
      schoolId={schoolId}
      schoolName={school.name}
    />
  );
}

function Wallet({
  user,
  profile,
  schoolId,
  schoolName,
}: {
  user: User;
  profile: UserProfile;
  schoolId: string;
  schoolName: string;
}) {
  const s = useThemeStyleSheet(createStyles);
  const bottom = useTabBarContentBottomPadding();
  const [show, setShow] = useState<'number' | 'code' | 'nfc' | null>(null);
  const close = React.useCallback(() => setShow(null), []);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') close();
    });
    return () => {
      sub.remove();
    };
  }, [close]);
  const studentId = profile.studentId?.trim() ?? '';
  // School login may use "<student ID> 同學" when no name is returned.
  const name = profile.displayName?.trim();
  const safeName =
    name && !(studentId && name.toLowerCase().includes(studentId.toLowerCase()))
      ? name
      : '持卡學生';
  const demo = isDemoUid(user.uid) || user.uid.startsWith('test-');
  return (
    <ScrollView style={s.page} contentContainerStyle={[s.content, { paddingBottom: bottom }]}>
      <View style={s.card}>
        <View style={s.cardTop}>
          <Text style={s.wordmark}>CAMPUS ONE</Text>
          <Ionicons accessible={false} name="id-card-outline" size={27} color="#D2E8DC" />
        </View>
        <Text style={s.cardSchool}>{schoolName}</Text>
        <Text style={s.cardName}>{safeName}</Text>
        <View style={s.cardFoot}>
          <Text style={s.cardLabel}>{demo ? '示範卡面' : '個人檔案'}</Text>
          <Text style={s.masked} accessibilityLabel={studentId ? '學號已隱藏' : '未提供學號'}>
            {studentId ? maskStudentId(studentId) : '未提供學號'}
          </Text>
        </View>
      </View>
      <View style={s.section}>
        <Text accessibilityRole="header" style={s.title}>
          出示學生證
        </Text>
        <Text style={s.body}>
          學號平時會隱藏，切換 App 會自動收起。門禁、借書與付款請使用校方指定的證件。
        </Text>
        {studentId ? (
          <Action label="出示學號" icon="expand-outline" onPress={() => setShow('number')} />
        ) : null}
        {!demo ? (
          <Action
            label="取得驗證碼"
            icon="qr-code-outline"
            secondary={!!studentId}
            onPress={() => setShow('code')}
          />
        ) : null}
      </View>
      <StudentCardNfc onPresent={demo ? undefined : () => setShow('nfc')} />
      <OfficialService schoolId={schoolId} />
      {show && (
        <Presentation
          user={user}
          schoolId={schoolId}
          schoolName={schoolName}
          studentId={studentId}
          mode={show}
          onClose={close}
        />
      )}
    </ScrollView>
  );
}

function OfficialService({ schoolId }: { schoolId: string }) {
  const s = useThemeStyleSheet(createStyles);
  const [linkError, setLinkError] = useState(false);
  const service = getStudentCardService(
    schoolId,
    Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web',
  );
  if (!service) return null;
  return (
    <View style={s.section}>
      <Text accessibilityRole="header" style={s.title}>
        校方學生證服務
      </Text>
      <Text style={s.body}>{service.detail}</Text>
      <Action
        label={service.name}
        icon="open-outline"
        secondary
        onPress={() => {
          setLinkError(false);
          void Linking.openURL(service.url).catch(() => setLinkError(true));
        }}
      />
      {linkError && (
        <Text accessibilityRole="alert" style={s.body}>
          無法開啟校方網站，請稍後再試。
        </Text>
      )}
    </View>
  );
}

const createStyles = () =>
  StyleSheet.create({
    page: { backgroundColor: theme.colors.bg },
    content: { width: '100%', maxWidth: 560, alignSelf: 'center', padding: 20, gap: 28 },
    card: { backgroundColor: '#163D34', borderRadius: 20, padding: 22 },
    cardTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    wordmark: {
      color: '#D2E8DC',
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 2.5,
      flexShrink: 1,
    },
    cardSchool: { color: '#FFFDF7', fontSize: 24, fontWeight: '700', marginTop: 26 },
    cardName: { color: '#E1EBE4', fontSize: 17, marginTop: 5 },
    cardFoot: {
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
    cardLabel: { color: '#D2E8DC', fontSize: 13 },
    masked: { color: '#FFFDF7', fontSize: 16, fontVariant: ['tabular-nums'], letterSpacing: 1.8 },
    section: { gap: 12 },
    title: { color: theme.colors.text, fontSize: 19, fontWeight: '700' },
    body: { color: theme.colors.textSecondary, fontSize: 15, lineHeight: 23 },
    button: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      minHeight: 50,
      padding: 12,
      borderRadius: 14,
      backgroundColor: '#163D34',
    },
    buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600', flexShrink: 1 },
    secondary: {
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      borderWidth: 1,
    },
    secondaryText: { color: theme.colors.text },
    pressed: { opacity: 0.78 },
    presentation: { flex: 1, backgroundColor: '#F8FAF5' },
    sheet: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },
    sheetBrand: { color: '#416557', fontSize: 12, fontWeight: '700', letterSpacing: 2.5 },
    sheetSchool: { color: '#183F36', fontSize: 19, textAlign: 'center', fontWeight: '700' },
    sheetTitle: { color: '#354F43', fontSize: 15, textAlign: 'center' },
    qr: { borderRadius: 16, backgroundColor: '#FFFFFF', padding: 2, marginVertical: 4 },
    number: {
      color: '#102D24',
      maxWidth: '100%',
      fontSize: 32,
      fontWeight: '700',
      textAlign: 'center',
      fontVariant: ['tabular-nums'],
    },
    sheetNote: { color: '#40574D', fontSize: 15, textAlign: 'center' },
    countdown: { color: '#40574D', fontSize: 14, fontVariant: ['tabular-nums'] },
    expiryTrack: {
      width: 120,
      height: 3,
      backgroundColor: '#D8E3D8',
      borderRadius: 2,
      overflow: 'hidden',
    },
    expiryProgress: { height: '100%', backgroundColor: '#416557' },
    nfcPresentation: { alignItems: 'center', gap: 18, paddingVertical: 12 },
    nfcRing: {
      width: 128,
      height: 128,
      borderRadius: 64,
      borderWidth: 1,
      borderColor: '#CBDCCF',
      backgroundColor: '#E8EFE5',
      alignItems: 'center',
      justifyContent: 'center',
    },
    nfcTitle: { color: '#102D24', fontSize: 26, fontWeight: '700', textAlign: 'center' },
    nfcStatus: {
      color: '#183F36',
      fontSize: 13,
      fontWeight: '600',
      backgroundColor: '#DBE8DC',
      borderRadius: 20,
      paddingVertical: 7,
      paddingHorizontal: 14,
    },
    retryNfc: {
      minHeight: 44,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: '#BACDBF',
    },
    transports: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 4,
      padding: 4,
      borderRadius: 14,
      backgroundColor: '#E3EAE0',
      marginTop: 8,
    },
    transport: {
      minHeight: 44,
      minWidth: 108,
      paddingHorizontal: 16,
      paddingVertical: 12,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 11,
    },
    transportSelected: { backgroundColor: '#FFFFFF' },
    transportText: { color: '#183F36', fontWeight: '600', fontSize: 14 },
    close: {
      backgroundColor: '#163D34',
      minHeight: 50,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      marginHorizontal: 24,
      marginVertical: 12,
      padding: 12,
    },
    closeText: { color: '#FFFFFF', fontWeight: '600', fontSize: 16 },
  });
