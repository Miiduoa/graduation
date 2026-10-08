import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Text, TextInput, View } from 'react-native';
import { reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth';
import { AIDetailScreen, AICard, AIButton, aiTokens } from '../ui/aiFirst';
import { getThemeVersion, subscribeToTheme } from '../ui/theme';
import { useSchool } from '../state/school';
import { useAuth } from '../state/auth';
import { getAuthInstance } from '../firebase';
import { deleteUserAccount } from '../services/privacy';

type Props = { navigation?: { goBack?: () => void; navigate?: (screen: string) => void } };
const confirmation = '刪除我的帳號';

export function AccountDeletionScreen({ navigation }: Props) {
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
  const auth = useAuth();
  const { school } = useSchool();
  const scope = JSON.stringify([auth.user?.uid, school.id]);
  const active = useRef(scope);
  active.current = scope;
  const [completed, setCompleted] = useState<{ uid: string; logoutError: boolean } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const finish = async (uid: string) => {
    if (!mounted.current || active.current !== scope || getAuthInstance().currentUser?.uid !== uid)
      return;
    setCompleted({ uid, logoutError: false });
    try {
      await auth.signOut(uid);
    } catch {
      if (mounted.current && active.current === scope) setCompleted({ uid, logoutError: true });
    }
  };

  if (completed && (!auth.user || auth.user.uid === completed.uid)) {
    return (
      <AIDetailScreen title="刪除帳號">
        <AICard title="Campus One 帳號已刪除">
          <View style={{ gap: 16 }}>
            <Text style={{ color: aiTokens.muted, lineHeight: 23 }}>
              伺服器已確認 Campus One 帳號刪除。學校與 Nuni 帳號不受影響。
            </Text>
            {completed.logoutError ? (
              <>
                <Text accessibilityRole="alert" style={{ color: aiTokens.danger, lineHeight: 22 }}>
                  帳號已刪除，但這台裝置尚未完成登出。請重試。
                </Text>
                <AIButton label="完成登出" onPress={() => void finish(completed.uid)} />
              </>
            ) : (
              <Text style={{ color: aiTokens.muted }}>正在返回登入畫面…</Text>
            )}
          </View>
        </AICard>
      </AIDetailScreen>
    );
  }
  if (!auth.user) {
    return (
      <AIDetailScreen title="刪除帳號" onBack={() => navigation?.goBack?.()}>
        <AICard title="請先登入">
          <View style={{ gap: 16 }}>
            <Text style={{ color: aiTokens.muted }}>登入後才能確認要刪除的帳號。</Text>
            <AIButton label="學校登入" onPress={() => navigation?.navigate?.('SSOLogin')} />
          </View>
        </AICard>
      </AIDetailScreen>
    );
  }
  return (
    <DeletionEditor
      key={scope}
      uid={auth.user.uid}
      email={auth.user.email}
      schoolId={school.id}
      passwordProvider={auth.user.providerData.some(
        (provider) => provider.providerId === 'password',
      )}
      navigation={navigation}
      isScopeCurrent={() => active.current === scope}
      onComplete={() => finish(auth.user!.uid)}
    />
  );
}

function DeletionEditor({
  uid,
  email,
  schoolId,
  passwordProvider,
  navigation,
  isScopeCurrent,
  onComplete,
}: Props & {
  uid: string;
  email: string | null;
  schoolId: string;
  passwordProvider: boolean;
  isScopeCurrent: () => boolean;
  onComplete: () => Promise<void>;
}) {
  const [step, setStep] = useState<'details' | 'confirm'>('details');
  const [confirmText, setConfirmText] = useState('');
  const [password, setPassword] = useState('');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [needsLogin, setNeedsLogin] = useState(false);
  const locked = useRef(false);
  const mounted = useRef(true);
  const current = () =>
    mounted.current && isScopeCurrent() && getAuthInstance().currentUser?.uid === uid;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const removeAccount = async () => {
    if (locked.current || confirmText !== confirmation || (passwordProvider && !password)) return;
    setError('');
    setNeedsLogin(false);
    if (!current()) {
      setError('登入狀態已變更，請重新登入後再操作。');
      setNeedsLogin(true);
      return;
    }
    locked.current = true;
    setProgress('正在確認身分…');
    try {
      const user = getAuthInstance().currentUser!;
      if (passwordProvider) {
        if (
          !user.email ||
          !user.providerData.some((provider) => provider.providerId === 'password')
        )
          throw new Error('Provider changed');
        await reauthenticateWithCredential(
          user,
          EmailAuthProvider.credential(user.email, password),
        );
        if (!current()) return;
        setPassword('');
      }
      await user.getIdToken(true);
      if (!current()) return;
      setProgress('正在刪除 Campus One 帳號…');
      const response = await deleteUserAccount({
        expectedUserId: uid,
        confirmation: 'DELETE_MY_ACCOUNT',
        schoolId,
      });
      if (!current()) return;
      if (response.success !== true || response.userId !== uid)
        throw new Error('Deletion not confirmed');
      await onComplete();
    } catch (cause) {
      if (!current()) return;
      const failure = cause as { code?: string; details?: { reason?: string } };
      const code = failure?.code;
      if (failure?.details?.reason === 'group-ownership') {
        setError('你仍是群組擁有者。請先在訊息中的群組頁面轉移擁有權，再回來刪除帳號。');
      } else if (failure?.details?.reason === 'merchant-ownership') {
        setError('你仍持有店家管理權。請先完成管理權轉移，再回來刪除帳號。');
      } else if (failure?.details?.reason === 'financial-records') {
        setError(
          '帳號仍有餘額、未結束的訂單或待確認款項。請先完成訂單、退款與餘額處理，再回來刪除帳號。',
        );
      } else if (failure?.details?.reason === 'event-registration') {
        setError('目前無法完成活動報名紀錄的處理。請聯絡活動主辦人或管理員協助，再回來刪除帳號。');
      } else if (failure?.details?.reason === 'group-membership') {
        setError('目前無法完成群組成員資料的處理。請聯絡群組管理員協助，再回來刪除帳號。');
      } else if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        setError('密碼不正確，請重新輸入。');
      } else if (
        code === 'auth/requires-recent-login' ||
        failure?.details?.reason === 'recent-login' ||
        code === 'functions/unauthenticated'
      ) {
        setError('需要重新登入確認身分。登入後請回到此頁，再次確認刪除。');
        setNeedsLogin(true);
        setConfirmText('');
      } else {
        setError('尚未確認刪除完成，請稍後重試。若持續無法操作，請透過設定中的意見回饋聯絡我們。');
      }
      setPassword('');
    } finally {
      locked.current = false;
      if (mounted.current && isScopeCurrent()) setProgress('');
    }
  };
  const busy = Boolean(progress);
  const inputStyle = {
    borderWidth: 1,
    borderColor: aiTokens.border,
    borderRadius: aiTokens.radius.md,
    backgroundColor: aiTokens.panel,
    color: aiTokens.text,
    padding: 14,
    fontSize: 16,
  };
  return (
    <AIDetailScreen
      title="刪除帳號"
      subtitle="先了解影響，再決定是否繼續。"
      onBack={busy ? undefined : () => navigation?.goBack?.()}
    >
      <AICard title="刪除 Campus One 帳號">
        <View style={{ gap: 12 }}>
          <Text style={{ color: aiTokens.text, fontSize: 16, fontWeight: '600' }}>
            {email || '目前登入的帳號'}
          </Text>
          <Text style={{ color: aiTokens.muted, lineHeight: 23 }}>
            刪除後，將無法再使用這個 Campus One
            帳號，相關個人資料將依隱私政策處理。這項操作無法復原。
          </Text>
          <Text style={{ color: aiTokens.muted, lineHeight: 23 }}>
            學校與 Nuni 帳號不會因此刪除。校方課務與學籍資料不受影響。
          </Text>
          <Text style={{ color: aiTokens.muted, lineHeight: 23 }}>
            作業與評閱、訊息與公開貼文、訂單與稽核紀錄、上傳檔案與舊版活動報名紀錄仍會保留；帳號中的私人資料副本與存取權限會移除。
          </Text>
        </View>
      </AICard>
      {step === 'details' ? (
        <>
          <AICard title="先保留需要的資料">
            <View style={{ gap: 16 }}>
              <Text style={{ color: aiTokens.muted, lineHeight: 23 }}>
                需要保存個人資料時，可以先匯出，再回來完成刪除。
              </Text>
              <AIButton
                label="匯出我的資料"
                variant="ghost"
                onPress={() => navigation?.navigate?.('DataExport')}
              />
            </View>
          </AICard>
          <AICard>
            <View style={{ gap: 12 }}>
              <AIButton label="繼續刪除帳號" variant="danger" onPress={() => setStep('confirm')} />
              <AIButton label="保留帳號" variant="ghost" onPress={() => navigation?.goBack?.()} />
            </View>
          </AICard>
        </>
      ) : (
        <AICard title="最後確認">
          <View style={{ gap: 16 }}>
            <Text style={{ color: aiTokens.muted, lineHeight: 23 }}>
              請輸入「{confirmation}」以確認這項操作。
            </Text>
            <TextInput
              accessibilityLabel="刪除確認文字"
              value={confirmText}
              onChangeText={setConfirmText}
              editable={!busy}
              placeholder={confirmation}
              placeholderTextColor={aiTokens.muted}
              autoCorrect={false}
              style={inputStyle}
            />
            {passwordProvider ? (
              <>
                <Text style={{ color: aiTokens.muted }}>輸入此帳號的密碼，確認由本人操作。</Text>
                <TextInput
                  accessibilityLabel="帳號密碼"
                  value={password}
                  onChangeText={setPassword}
                  editable={!busy}
                  placeholder="帳號密碼"
                  placeholderTextColor={aiTokens.muted}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={inputStyle}
                />
              </>
            ) : (
              <Text style={{ color: aiTokens.muted, lineHeight: 23 }}>
                系統會確認最近的登入紀錄；若登入時間已超過安全期限，需要先重新登入。
              </Text>
            )}
            {busy ? (
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                <ActivityIndicator color={aiTokens.ai} />
                <Text accessibilityLiveRegion="polite" style={{ color: aiTokens.muted, flex: 1 }}>
                  {progress}
                </Text>
              </View>
            ) : null}
            {error ? (
              <Text accessibilityRole="alert" style={{ color: aiTokens.danger, lineHeight: 22 }}>
                {error}
              </Text>
            ) : null}
            {needsLogin ? (
              <AIButton
                label="重新登入"
                disabled={busy}
                onPress={() => {
                  setConfirmText('');
                  setPassword('');
                  navigation?.navigate?.('SSOLogin');
                }}
              />
            ) : null}
            <AIButton
              label={busy ? '正在處理…' : '確認刪除帳號'}
              variant="danger"
              disabled={busy || confirmText !== confirmation || (passwordProvider && !password)}
              onPress={() => void removeAccount()}
            />
            <AIButton
              label="返回說明"
              variant="ghost"
              disabled={busy}
              onPress={() => {
                setStep('details');
                setPassword('');
                setConfirmText('');
                setError('');
                setNeedsLogin(false);
              }}
            />
          </View>
        </AICard>
      )}
    </AIDetailScreen>
  );
}
