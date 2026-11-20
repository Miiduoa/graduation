import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useNuniSession } from '../state/nuniSession';
import { usePersonalImportScope } from '../state/personalImportScope';
import {
  loadPersonalImports,
  personalImportStorageKey,
  subscribePersonalImports,
} from '../services/personalImports';
import {
  canSyncPersonalImports,
  cancelPersonalImportSync,
  personalImportSyncStatus,
  syncPersonalImports,
} from '../services/personalImportSync';

/** Mount once inside account and school providers. Opt-in is persisted per account and school. */
export function PersonalImportSyncBridge() {
  const scope = usePersonalImportScope();
  const platform = useNuniSession();
  const latest = useRef({ scope, platform });
  latest.current = { scope, platform };
  const key = scope ? personalImportStorageKey(scope) : '';
  const context = platform.session?.context;
  useEffect(() => {
    if (!scope || !context || !canSyncPersonalImports(scope)) return;
    let alive = true,
      checking = false;
    const active = () =>
      alive &&
      AppState.currentState === 'active' &&
      latest.current.platform.session?.context === context &&
      !latest.current.platform.loading &&
      !latest.current.platform.pendingLogout &&
      latest.current.scope !== null &&
      personalImportStorageKey(latest.current.scope) === key;
    async function synchronize() {
      if (checking || !active() || personalImportSyncStatus(scope!).result?.conflicts.length)
        return;
      checking = true;
      try {
        const network = await NetInfo.fetch();
        if (!active() || network.isConnected === false || network.isInternetReachable === false)
          return;
        const ledger = await loadPersonalImports(scope!);
        if (!active() || !ledger.sync?.enabled) return;
        await syncPersonalImports(
          scope!,
          (path, input) => latest.current.platform.request(path, context!, input),
          active,
        );
      } catch {
        /* The scoped status reports failures; local data is never discarded. */
      } finally {
        checking = false;
      }
    }
    void synchronize();
    const timer = setInterval(() => void synchronize(), 30_000);
    const unsubscribe = subscribePersonalImports((change) => {
      if (change.source === 'local' && personalImportStorageKey(change.scope) === key)
        void synchronize();
    });
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') void synchronize();
    });
    const disconnect = NetInfo.addEventListener((network) => {
      if (network.isConnected && network.isInternetReachable !== false) void synchronize();
    });
    return () => {
      alive = false;
      clearInterval(timer);
      unsubscribe();
      appState.remove();
      disconnect();
      cancelPersonalImportSync(scope);
    };
  }, [key, context]);
  return null;
}
