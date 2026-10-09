import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { nuniPlatformRequest } from '../services/nuniClient';
import { requestGoogleCredential, clearGoogleCredentialState } from '../services/nuniGoogle';
import { NuniSessionController, type NativeNuniState } from '../services/nuniSessionController';

const KEY = 'campus-one.nuni.native-session.v1';
type Auth = NativeNuniState &
  Pick<NuniSessionController, 'refresh' | 'signIn' | 'logout' | 'request'>;
const Context = createContext<Auth | null>(null);

function createController() {
  return new NuniSessionController({
    storage: {
      async read() {
        if (!(await SecureStore.isAvailableAsync())) throw new Error('Secure storage unavailable');
        return SecureStore.getItemAsync(KEY);
      },
      write: (value) =>
        SecureStore.setItemAsync(KEY, value, {
          keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
        }),
      clear: () => SecureStore.deleteItemAsync(KEY),
    },
    // This key contains only a logout intent flag, never credentials or an account ID.
    logoutFence: {
      read: async () => (await AsyncStorage.getItem(`${KEY}.logout-pending`)) !== null,
      mark: () => AsyncStorage.setItem(`${KEY}.logout-pending`, '1'),
      clear: () => AsyncStorage.removeItem(`${KEY}.logout-pending`),
    },
    request: nuniPlatformRequest,
    credential: requestGoogleCredential,
    clearCredential: clearGoogleCredentialState,
  });
}

export function NuniSessionProvider({ children }: { children: ReactNode }) {
  const reference = useRef<NuniSessionController | null>(null);
  if (!reference.current) reference.current = createController();
  const controller = reference.current;
  const [state, setState] = useState(controller.state);
  useEffect(() => {
    controller.activate();
    const unsubscribe = controller.subscribe(setState);
    void controller.refresh();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void controller.refresh();
    });
    return () => {
      unsubscribe();
      subscription.remove();
      controller.dispose();
    };
  }, [controller]);
  return (
    <Context.Provider
      value={{
        ...state,
        refresh: controller.refresh,
        signIn: controller.signIn,
        logout: controller.logout,
        request: controller.request,
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function useNuniSession(): Auth {
  const value = useContext(Context);
  if (!value) throw new Error('NuniSessionProvider is required');
  return value;
}
