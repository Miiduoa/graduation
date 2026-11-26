import React, { useEffect, useState } from 'react';
import { Linking, Modal, Pressable, Text, TextInput, View } from 'react-native';
import Constants from 'expo-constants';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getAuthInstance } from '../src/firebase';
import {
  assertMaestroEmulatorConfig,
  MAESTRO_LOGIN_LINK,
  MAESTRO_STUDENT_EMAIL,
  MAESTRO_STUDENT_UID,
} from './emulatorConfig';

const extra = Constants.expoConfig?.extra ?? {};
assertMaestroEmulatorConfig({
  appEnv: extra.appEnv,
  maestro: process.env.EXPO_PUBLIC_MAESTRO,
  useEmulator: process.env.EXPO_PUBLIC_USE_FIREBASE_EMULATOR,
  projectId: extra.firebase?.projectId,
  host: process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST,
  authPort: process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_AUTH_PORT,
  firestorePort: process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_FIRESTORE_PORT,
  allowMockAuth: extra.allowLocalMockAuth,
  universalDevAccounts: extra.enableUniversalDevAccounts,
});

// Load the real application only after the test entrypoint has failed closed on
// anything except the isolated emulator configuration. No auth/profile mocks.
const App = require('../App').default as React.ComponentType;

export function MaestroApp() {
  const [visible, setVisible] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const open = (url: string | null) => {
      if (active && url === MAESTRO_LOGIN_LINK) {
        setError('');
        setEmail('');
        setPassword('');
        setVisible(true);
      }
    };
    const listener = Linking.addEventListener('url', ({ url }) => open(url));
    void Linking.getInitialURL().then(open);
    return () => { active = false; listener.remove(); };
  }, []);

  const login = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (email !== MAESTRO_STUDENT_EMAIL) throw new Error('Not the seeded fixture');
      const auth = getAuthInstance();
      if (auth.app.options.projectId !== 'demo-campus-one' ||
          auth.emulatorConfig?.host !== '127.0.0.1' || auth.emulatorConfig.port !== 19291) {
        throw new Error('Auth is not connected to the configured local emulator');
      }
      const result = await signInWithEmailAndPassword(auth, email, password);
      if (result.user.uid !== MAESTRO_STUDENT_UID) {
        await signOut(auth);
        throw new Error('Unexpected fixture identity');
      }
      await result.user.getIdToken(true);
      setPassword('');
      setVisible(false);
    } catch {
      // Do not include credentials, tokens, or backend responses in screenshots.
      setError('模擬器登入失敗，請確認測試帳號與密碼');
    } finally { setBusy(false); }
  };

  return <>
    <App />
    <Modal visible={visible} animationType="none" onRequestClose={() => setVisible(false)}>
      <View testID="maestro-emulator-login" style={{ flex: 1, padding: 24, paddingTop: 80, gap: 20, backgroundColor: '#fff' }}>
        <Text style={{ color: '#111', fontSize: 22 }}>Firebase 模擬器測試登入</Text>
        <Text style={{ color: '#333' }}>僅連線本機 demo-campus-one；登入與權限由 Firebase 驗證。</Text>
        <TextInput testID="maestro-email" accessibilityLabel="測試帳號" value={email} onChangeText={setEmail}
          autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
          style={{ color: '#111', borderWidth: 1, padding: 12, minHeight: 48 }} />
        <TextInput testID="maestro-password" accessibilityLabel="測試密碼" value={password} onChangeText={setPassword}
          secureTextEntry autoCapitalize="none" autoCorrect={false}
          style={{ color: '#111', borderWidth: 1, padding: 12, minHeight: 48 }} />
        <Pressable testID="maestro-sign-in" accessibilityRole="button" disabled={busy}
          onPress={() => void login()} style={{ padding: 16, backgroundColor: '#14213d' }}>
          <Text style={{ color: '#fff' }}>{busy ? '登入中' : '登入測試學生'}</Text>
        </Pressable>
        {error ? <Text testID="maestro-login-error" accessibilityRole="alert" style={{ color: '#a00' }}>{error}</Text> : null}
      </View>
    </Modal>
  </>;
}
