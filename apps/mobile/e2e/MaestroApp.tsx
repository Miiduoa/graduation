import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getAuthInstance } from '../src/firebase';
import {
  assertMaestroEmulatorConfig,
  MAESTRO_STUDENT_EMAIL,
  MAESTRO_STUDENT_UID,
} from './emulatorConfig';
import { isMaestroEmulatorLoginLaunch } from './maestroLaunchFlag';

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
  return (
    <SafeAreaProvider>
      <MaestroHarness />
    </SafeAreaProvider>
  );
}

function MaestroHarness() {
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);
  const [offerTrigger, setOfferTrigger] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const harnessEnabled = isMaestroEmulatorLoginLaunch();

  const openHarness = () => {
    setError('');
    setEmail('');
    setPassword('');
    setOfferTrigger(false);
    setVisible(true);
  };

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
    {harnessEnabled && offerTrigger && !visible ? (
      <Pressable
        testID="maestro-open-emulator-login"
        accessibilityRole="button"
        accessibilityLabel="開啟模擬器測試登入"
        collapsable={false}
        onPress={openHarness}
        style={[styles.trigger, { top: Math.max(insets.top, 12) + 4 }]}
      >
        <Text style={styles.triggerLabel}>測試登入</Text>
      </Pressable>
    ) : null}
    {visible ? (
      <View
        testID="maestro-emulator-login"
        accessibilityViewIsModal
        collapsable={false}
        pointerEvents="auto"
        style={styles.overlay}
      >
        <Text style={styles.title}>Firebase 模擬器測試登入</Text>
        <Text style={styles.copy}>僅連線本機 demo-campus-one；登入與權限由 Firebase 驗證。</Text>
        <TextInput testID="maestro-email" accessibilityLabel="測試帳號" value={email} onChangeText={setEmail}
          autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
          style={styles.field} />
        <TextInput testID="maestro-password" accessibilityLabel="測試密碼" value={password} onChangeText={setPassword}
          secureTextEntry autoCapitalize="none" autoCorrect={false}
          style={styles.field} />
        <Pressable testID="maestro-sign-in" accessibilityRole="button" disabled={busy}
          onPress={() => void login()} style={styles.submit}>
          <Text style={styles.submitLabel}>{busy ? '登入中' : '登入測試學生'}</Text>
        </Pressable>
        {error ? <Text testID="maestro-login-error" accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      </View>
    ) : null}
  </>;
}

const styles = StyleSheet.create({
  trigger: {
    position: 'absolute',
    left: 8,
    zIndex: 20,
    elevation: 20,
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 10,
    justifyContent: 'center',
    backgroundColor: '#14213d',
  },
  triggerLabel: { color: '#fff', fontSize: 13, fontWeight: '600' },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
    padding: 24,
    paddingTop: 80,
    gap: 20,
    backgroundColor: '#fff',
  },
  title: { color: '#111', fontSize: 22 },
  copy: { color: '#333' },
  field: { color: '#111', borderWidth: 1, padding: 12, minHeight: 48 },
  submit: { padding: 16, backgroundColor: '#14213d' },
  submitLabel: { color: '#fff' },
  error: { color: '#a00' },
});
