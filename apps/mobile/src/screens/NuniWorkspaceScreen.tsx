import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  membershipStateLabel,
  parseNuniMemberships,
  type NuniMembership,
  validateMembershipRequestInput,
  parseMembershipRequestReceipt,
  membershipReceiptMessage,
  type NuniMembershipRequest,
} from '@campus/shared/src/nuniAccount';
import { NuniError } from '@campus/shared/src/nuni';
import { useNuniSession } from '../state/nuniSession';
import { NuniDraftProvider, useNuniDraftState, type NuniDraftCache } from '../state/nuniDrafts';
import { getGoogleCredentialCapability } from '../services/nuniGoogle';
import { theme } from '../ui/theme';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';
import { NuniCourses } from './nuni/NuniCourses';
import { NuniMerchant } from './nuni/NuniMerchant';

type Tab = 'courses' | 'merchant' | 'account';

function Action({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const s = useThemeStyleSheet(createStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[s.button, disabled && s.disabled]}
    >
      <Text style={s.buttonText}>{label}</Text>
    </Pressable>
  );
}

function MembershipRequest({
  onConfirmed,
  disabled,
}: {
  onConfirmed: () => void;
  disabled: boolean;
}) {
  const auth = useNuniSession();
  const context = auth.session!.context;
  const s = useThemeStyleSheet(createStyles);
  const [email, setEmail] = useNuniDraftState('membership-request:email', '');
  const [savedPending, setSavedPending] = useNuniDraftState<NuniMembershipRequest | null>(
    'membership-request:pending',
    null,
  );
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(!!savedPending);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState('');
  const pending = useRef<NuniMembershipRequest | null>(savedPending);
  const sending = useRef(false);
  const mounted = useRef(true);
  const allowed = useRef(!disabled);
  allowed.current = !disabled;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const send = async () => {
    if (sending.current || !mounted.current || !allowed.current) return;
    let input = pending.current;
    if (!input) {
      try {
        input = validateMembershipRequestInput({ claimedEmail: email });
      } catch {
        setError('請輸入完整的學校配發信箱。');
        return;
      }
    }
    pending.current = input;
    setSavedPending(input);
    sending.current = true;
    setBusy(true);
    setError('');
    setReceipt('');
    try {
      const result = parseMembershipRequestReceipt(
        await auth.request('memberships', context, input),
      );
      if (!mounted.current) return;
      pending.current = null;
      setSavedPending(null);
      setRetry(false);
      setEmail('');
      setReceipt(membershipReceiptMessage(result));
      onConfirmed();
    } catch (failure) {
      if (!mounted.current) return;
      if (
        !retry &&
        failure instanceof NuniError &&
        failure.status >= 400 &&
        failure.status < 500 &&
        failure.status !== 408 &&
        failure.code !== 'SESSION_CHANGED'
      ) {
        pending.current = null;
        setSavedPending(null);
        setRetry(false);
        setError(
          failure.code === 'MEMBERSHIP_CLAIM_INVALID'
            ? '這個信箱無法對應目前合作的學校，請確認學校配發的信箱，或聯絡該校管理者。'
            : '這次申請未被接受，請確認信箱與登入狀態後重試。',
        );
      } else {
        setRetry(true);
        setError('尚未確認送出結果。已保留這次信箱，請重試確認；重試不會建立重複的學校資格。');
      }
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <View style={s.panel}>
      <Text accessibilityRole="header" style={s.title}>
        申請學校資格
      </Text>
      <Text style={s.body}>
        填入學校配發的信箱，送交學校驗證。這一步不會取得學生、教師或管理權限。
      </Text>
      <TextInput
        accessibilityLabel="學校配發信箱"
        placeholder="name@school.edu.tw"
        value={email}
        onChangeText={setEmail}
        editable={!busy && !retry && !disabled}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        autoComplete="email"
        style={s.input}
      />
      {error ? (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      ) : null}
      {receipt ? (
        <Text accessibilityLiveRegion="polite" style={s.body}>
          {receipt}
        </Text>
      ) : null}
      <Action
        label={busy ? '正在送出…' : retry ? '重試確認申請' : '申請學校資格'}
        disabled={disabled || busy || (!retry && !email.trim())}
        onPress={() => void send()}
      />
    </View>
  );
}

function Account({ onLogout }: { onLogout: () => void }) {
  const auth = useNuniSession();
  const context = auth.session!.context;
  const request = auth.request;
  const s = useThemeStyleSheet(createStyles);
  const [memberships, setMemberships] = useState<NuniMembership[] | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [linkError, setLinkError] = useState('');

  useEffect(() => {
    let current = true;
    setMemberships(null);
    setError('');
    void request('memberships', context)
      .then(parseNuniMemberships)
      .then((value) => {
        if (current) setMemberships(value);
      })
      .catch(() => {
        if (current) setError('目前無法確認學校資格，請重新讀取。');
      });
    return () => {
      current = false;
    };
  }, [context, request, revision]);

  const openWeb = async (path: '/classroom/account' | '/admin') => {
    setLinkError('');
    try {
      await Linking.openURL(`https://nuni.tw${path}`);
    } catch {
      setLinkError('無法開啟網頁，請稍後重試。');
    }
  };

  return (
    <ScrollView contentContainerStyle={s.content}>
      <Text accessibilityRole="header" style={s.heading}>
        我的 Campus One 帳號
      </Text>
      <Text style={s.body}>App 和網頁版使用同一個 Google 帳號，就會讀取相同的課程與資格。</Text>
      <View style={s.panel}>
        <Text accessibilityRole="header" style={s.title}>
          學校資格
        </Text>
        <Text style={s.body}>
          瀏覽哪所學校不會改變你的資格。教師、店家與管理權限依各服務實際授權。
        </Text>
        {error ? (
          <>
            <Text accessibilityRole="alert" style={s.error}>
              {error}
            </Text>
            <Action label="重新讀取學校資格" onPress={() => setRevision((value) => value + 1)} />
          </>
        ) : memberships === null ? (
          <View accessibilityRole="progressbar" accessibilityLabel="正在讀取學校資格">
            <ActivityIndicator color={theme.colors.accent} />
            <Text style={s.body}>正在讀取學校資格…</Text>
          </View>
        ) : memberships.length === 0 ? (
          <Text style={s.body}>目前沒有學校資格紀錄。你仍可加入獨立課程；學校服務需另外驗證。</Text>
        ) : (
          memberships.map((membership) => (
            <View key={membership.membershipId} style={s.membership}>
              <Text style={s.title}>{membership.campusName}</Text>
              <Text style={s.body}>{membershipStateLabel(membership.state)}</Text>
            </View>
          ))
        )}
        <Action label="在網頁查看學校資格" onPress={() => void openWeb('/classroom/account')} />
      </View>
      <MembershipRequest
        disabled={!!error || memberships === null}
        onConfirmed={() => setRevision((value) => value + 1)}
      />
      {auth.session!.isPlatformOperator ? (
        <View style={s.panel}>
          <Text accessibilityRole="header" style={s.title}>
            平台管理
          </Text>
          <Text style={s.body}>管理學校接入、服務狀態與檢舉。私人課程仍依課程成員資格授權。</Text>
          <Action label="開啟網頁管理工作台" onPress={() => void openWeb('/admin')} />
        </View>
      ) : null}
      {linkError ? (
        <Text accessibilityRole="alert" style={s.error}>
          {linkError}
        </Text>
      ) : null}
      <Text style={s.note}>
        網頁版會另外確認瀏覽器中的登入狀態。登出 Campus One 帳號不會登出已連線的學校帳號。
      </Text>
      <Action label="登出 Campus One 帳號" onPress={onLogout} />
    </ScrollView>
  );
}

function SignedInWorkspace({ onLogout }: { onLogout: () => void }) {
  const s = useThemeStyleSheet(createStyles);
  const [tab, setTab] = useNuniDraftState<Tab>('workspace:tab', 'courses');
  return (
    <View style={s.page}>
      <View accessibilityRole="tablist" style={s.tabs}>
        {(
          [
            ['courses', '課程'],
            ['merchant', '店家'],
            ['account', '帳號'],
          ] as const
        ).map(([key, label]) => (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected: tab === key }}
            onPress={() => setTab(key)}
            style={[s.tab, tab === key && s.selectedTab]}
          >
            <Text style={[s.tabText, tab === key && s.selectedTabText]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <View
        style={[s.page, tab !== 'courses' && s.hidden]}
        accessibilityElementsHidden={tab !== 'courses'}
        importantForAccessibility={tab === 'courses' ? 'auto' : 'no-hide-descendants'}
      >
        <NuniCourses />
      </View>
      <View
        style={[s.page, tab !== 'merchant' && s.hidden]}
        accessibilityElementsHidden={tab !== 'merchant'}
        importantForAccessibility={tab === 'merchant' ? 'auto' : 'no-hide-descendants'}
      >
        <NuniMerchant />
      </View>
      <View
        style={[s.page, tab !== 'account' && s.hidden]}
        accessibilityElementsHidden={tab !== 'account'}
        importantForAccessibility={tab === 'account' ? 'auto' : 'no-hide-descendants'}
      >
        <Account onLogout={onLogout} />
      </View>
    </View>
  );
}

export function NuniWorkspaceScreen() {
  const auth = useNuniSession();
  const s = useThemeStyleSheet(createStyles);
  const [action, setAction] = useState('');
  const [actionError, setActionError] = useState('');
  const active = useRef(false);
  const mounted = useRef(true);
  const drafts = useRef<{ accountId: string; cache: NuniDraftCache } | null>(null);
  // Revalidation keeps only user input in memory. The actual workspace still unmounts,
  // so all server data and permissions must be loaded again with the new request context.
  if (auth.pendingLogout || (!auth.session && !auth.loading && !auth.error)) drafts.current = null;
  if (auth.session && !auth.loading && !auth.pendingLogout && !auth.error) {
    if (drafts.current?.accountId !== auth.session.platformAccountId)
      drafts.current = { accountId: auth.session.platformAccountId, cache: new Map() };
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = async (label: string, operation: () => Promise<unknown>) => {
    if (active.current || !mounted.current) return;
    active.current = true;
    setAction(label);
    setActionError('');
    try {
      await operation();
    } catch {
      if (mounted.current) setActionError('操作未完成，請確認連線後重試。');
    } finally {
      active.current = false;
      if (mounted.current) setAction('');
    }
  };
  const logout = () => {
    drafts.current = null;
    void run('正在登出…', auth.logout);
  };
  const openWeb = () => void run('正在開啟網頁…', () => Linking.openURL('https://nuni.tw/login'));
  if (auth.loading || action)
    return (
      <View
        style={s.center}
        accessibilityRole="progressbar"
        accessibilityLabel={action || '正在確認 Campus One 帳號'}
      >
        <ActivityIndicator color={theme.colors.accent} />
        <Text style={s.body}>{action || '正在確認 Campus One 帳號…'}</Text>
      </View>
    );
  if (auth.pendingLogout || auth.error || actionError)
    return (
      <View style={s.center}>
        <Text accessibilityRole="header" style={s.heading}>
          {auth.pendingLogout ? '登出尚未完成' : '目前無法確認登入狀態'}
        </Text>
        <Text accessibilityRole="alert" style={s.error}>
          {auth.error || actionError || '請重試以結束這次登入。'}
        </Text>
        <Action
          label={auth.pendingLogout ? '重試登出' : '重新確認登入狀態'}
          onPress={auth.pendingLogout ? logout : () => void run('正在確認…', auth.refresh)}
        />
        <Text style={s.note}>也可以使用網頁版；網頁會另外確認瀏覽器的登入狀態。</Text>
        <Action label="開啟網頁版登入" onPress={openWeb} />
      </View>
    );
  if (auth.session)
    return (
      <NuniDraftProvider cache={drafts.current!.cache}>
        <SignedInWorkspace
          key={`${auth.session.platformAccountId}:${auth.session.context}`}
          onLogout={logout}
        />
      </NuniDraftProvider>
    );
  const capability = getGoogleCredentialCapability();
  return (
    <ScrollView contentContainerStyle={s.content}>
      <Text style={s.eyebrow}>CAMPUS ONE</Text>
      <Text accessibilityRole="header" style={s.heading}>
        登入或建立帳號
      </Text>
      <Text style={s.body}>
        App 和網頁版使用同一個 Campus One 帳號。首次使用 Google
        繼續時會建立帳號；再次登入會回到原本的帳號。
      </Text>
      <View style={s.panel}>
        <Text style={s.title}>從你的課程開始</Text>
        <Text style={s.body}>
          加入老師的課程、查看待辦與繳交作業。學校資格和店家權限會另外確認。
        </Text>
        {capability.available ? (
          <Action label="使用 Google 繼續" onPress={() => void run('正在登入…', auth.signIn)} />
        ) : (
          <>
            <Text style={s.body}>
              這個 App 版本目前無法使用 Google 登入，請更新 App 或使用網頁版。
            </Text>
            <Action label="開啟網頁版登入" onPress={openWeb} />
          </>
        )}
      </View>
      <Text style={s.note}>
        Google 登入不會自動取得學校教師或管理員權限，也不會連線你的校務資料。
      </Text>
    </ScrollView>
  );
}

const createStyles = () =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.colors.bg },
    content: { flexGrow: 1, padding: 24, gap: 18, paddingBottom: 48 },
    center: {
      flex: 1,
      backgroundColor: theme.colors.bg,
      justifyContent: 'center',
      padding: 28,
      gap: 18,
    },
    heading: { color: theme.colors.text, fontSize: 26, lineHeight: 36, fontWeight: '600' },
    title: { color: theme.colors.text, fontSize: 17, lineHeight: 25, fontWeight: '600' },
    eyebrow: { color: theme.colors.muted, fontSize: 12, letterSpacing: 2 },
    body: { color: theme.colors.textSecondary, fontSize: 15, lineHeight: 25 },
    note: { color: theme.colors.muted, fontSize: 13, lineHeight: 22 },
    error: { color: theme.colors.danger, fontSize: 15, lineHeight: 24 },
    input: {
      minHeight: 48,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 5,
      padding: 12,
      color: theme.colors.text,
      backgroundColor: theme.colors.bg,
      fontSize: 16,
    },
    panel: {
      padding: 20,
      gap: 16,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 8,
      backgroundColor: theme.colors.focusSurface,
    },
    membership: {
      gap: 4,
      paddingVertical: 12,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
    },
    button: {
      minHeight: 48,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: theme.colors.accent,
      borderRadius: 5,
      padding: 14,
    },
    buttonText: { color: theme.colors.onAccent, fontSize: 15, fontWeight: '600' },
    disabled: { opacity: 0.5 },
    tabs: {
      flexDirection: 'row',
      padding: 12,
      gap: 8,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    tab: {
      flex: 1,
      minHeight: 46,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: 5,
    },
    selectedTab: { backgroundColor: theme.colors.accent },
    tabText: { color: theme.colors.text, fontSize: 15 },
    selectedTabText: { color: theme.colors.onAccent, fontWeight: '600' },
    hidden: { display: 'none' },
  });
