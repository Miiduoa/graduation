import React, { useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getAuthInstance } from '../src/firebase';
import { waitForSchoolSessionReady } from '../src/app/SchoolSessionBoundary';
import {
  assertMaestroEmulatorConfig,
  MAESTRO_STUDENT_EMAIL,
  MAESTRO_STUDENT_UID,
} from './emulatorConfig';

const SCHOOL_SESSION_READY_TIMEOUT_MS = 25_000;

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
  const passwordInputRef = useRef<TextInput>(null);
  const emailValue = useRef('');
  const passwordValue = useRef('');
  const [visible, setVisible] = useState(false);
  const [offerTrigger, setOfferTrigger] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordGeneration, setPasswordGeneration] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // This component is registered only by index.maestro.ts. Keep the control
  // off the navigation header so iOS BackButton stays tappable. Production
  // index.ts never imports this file, and campus://maestro/sign-in cannot open it.

  const setEmailField = (text: string) => {
    emailValue.current = text;
    setEmail(text);
  };
  const setPasswordField = (text: string) => {
    passwordValue.current = text;
    setPassword(text);
  };

  const openHarness = () => {
    setError('');
    setEmailField('');
    setPasswordField('');
    setOfferTrigger(false);
    setVisible(true);
  };

  const login = async () => {
    Keyboard.dismiss();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      // iOS XCTest typeText can fill a secure field without onChangeText.
      // Read the native event value so login does not submit an empty password.
      if (emailValue.current !== MAESTRO_STUDENT_EMAIL) throw new Error('Not the seeded fixture');
      const auth = getAuthInstance();
      if (auth.app.options.projectId !== 'demo-campus-one' ||
          auth.emulatorConfig?.host !== '127.0.0.1' || auth.emulatorConfig.port !== 19291) {
        throw new Error('Auth is not connected to the configured local emulator');
      }
      const result = await signInWithEmailAndPassword(auth, emailValue.current, passwordValue.current);
      if (result.user.uid !== MAESTRO_STUDENT_UID) {
        await signOut(auth);
        throw new Error('Unexpected fixture identity');
      }
      await result.user.getIdToken(true);
      // Closing the overlay before the school session is mounted leaves the
      // guest landing on screen. Maestro then waits for tab-Today on the
      // public shell even though Firebase Auth already succeeded.
      if (!(await waitForSchoolSessionReady(SCHOOL_SESSION_READY_TIMEOUT_MS))) {
        throw new Error('School session did not become ready');
      }
      setPasswordField('');
      setVisible(false);
    } catch {
      // Do not include credentials, tokens, or backend responses in screenshots.
      // Remount an empty field so a retry cannot submit leftover native text.
      // iOS places the caret on a hyphen boundary, so backspace-only erase
      // left "-password" after the next typed fixture.
      setPasswordField('');
      setPasswordGeneration((generation) => generation + 1);
      setError('模擬器登入失敗，請確認測試帳號與密碼');
    } finally { setBusy(false); }
  };

  return <>
    <App />
    {offerTrigger && !visible ? (
      <Pressable
        testID="maestro-open-emulator-login"
        accessibilityRole="button"
        accessibilityLabel="開啟模擬器測試登入"
        collapsable={false}
        onPress={openHarness}
        style={[styles.trigger, { top: Math.max(insets.top, 8) + 52 }]}
      >
        <Text style={styles.triggerLabel}>測試登入</Text>
      </Pressable>
    ) : null}
    {visible ? (
      <KeyboardAvoidingView
        testID="maestro-emulator-login"
        accessibilityViewIsModal
        collapsable={false}
        pointerEvents="auto"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          contentContainerStyle={styles.form}
        >
          <Pressable onPress={Keyboard.dismiss} accessible={false}>
            <Text style={styles.title}>Firebase 模擬器測試登入</Text>
            <Text style={styles.copy}>僅連線本機 demo-campus-one；登入與權限由 Firebase 驗證。</Text>
          </Pressable>
          <TextInput
            testID="maestro-email"
            accessibilityLabel="測試帳號"
            value={email}
            onChangeText={setEmailField}
            onChange={(event) => setEmailField(event.nativeEvent.text)}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            returnKeyType="next"
            blurOnSubmit={false}
            onSubmitEditing={() => passwordInputRef.current?.focus()}
            style={styles.field}
          />
          <TextInput
            key={`maestro-password-${passwordGeneration}`}
            ref={passwordInputRef}
            testID="maestro-password"
            accessibilityLabel="測試密碼"
            value={password}
            onChangeText={setPasswordField}
            onChange={(event) => setPasswordField(event.nativeEvent.text)}
            // XCTest typeText does not deliver characters to iOS secureTextEntry;
            // this overlay exists only in index.maestro.ts.
            secureTextEntry={false}
            selectTextOnFocus
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            textContentType="none"
            returnKeyType="go"
            blurOnSubmit
            enablesReturnKeyAutomatically
            onSubmitEditing={() => void login()}
            style={styles.field}
          />
          <Pressable
            testID="maestro-sign-in"
            accessibilityRole="button"
            accessibilityLabel="登入測試學生"
            disabled={busy}
            onPress={() => void login()}
            style={styles.submit}
          >
            <Text style={styles.submitLabel}>{busy ? '登入中' : '登入測試學生'}</Text>
          </Pressable>
          {error ? <Text testID="maestro-login-error" accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        </ScrollView>
      </KeyboardAvoidingView>
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
    backgroundColor: '#fff',
  },
  form: {
    flexGrow: 1,
    padding: 24,
    paddingTop: 80,
    gap: 20,
  },
  title: { color: '#111', fontSize: 22 },
  copy: { color: '#333' },
  field: { color: '#111', borderWidth: 1, padding: 12, minHeight: 48 },
  submit: { padding: 16, backgroundColor: '#14213d' },
  submitLabel: { color: '#fff' },
  error: { color: '#a00' },
});
