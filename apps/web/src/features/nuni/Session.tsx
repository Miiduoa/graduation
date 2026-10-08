'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  NuniError,
  nuniRecord,
  parseNuniPrincipal,
  type NuniPrincipal,
} from '@campus/shared/src/nuni';

type Session = NuniPrincipal & { context: string };
type SessionState = {
  session: Session | null;
  loading: boolean;
  error: string;
  pendingLogout: boolean;
};
type Auth = SessionState & { refresh: () => Promise<void>; logout: () => Promise<void> };
const Context = createContext<Auth | null>(null);
const LOGOUT_KEY = 'campus-one.nuni.logout-pending';
const CHANGE_KEY = 'campus-one.nuni.session-change';

export async function browserRequest(
  path: string,
  context?: string,
  input?: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(`/api/nuni/${path}`, {
    method: input ? 'POST' : 'GET',
    cache: 'no-store',
    credentials: 'same-origin',
    redirect: 'error',
    signal: AbortSignal.timeout(12000),
    headers: {
      ...(context ? { 'X-Campus-Session': context } : {}),
      ...(input ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(input ? { body: JSON.stringify(input) } : {}),
  });
  if (!response.ok) {
    let code = 'REQUEST_FAILED';
    try {
      const value = nuniRecord(await response.json());
      if (typeof value.error === 'string') code = value.error;
    } catch {}
    throw new NuniError(response.status, code);
  }
  return response.json() as Promise<unknown>;
}

function pendingContext(): string | null {
  try {
    return localStorage.getItem(LOGOUT_KEY);
  } catch {
    return null;
  }
}

function announce(context: string | null): void {
  try {
    if (context) localStorage.setItem(LOGOUT_KEY, context);
    else localStorage.removeItem(LOGOUT_KEY);
    localStorage.setItem(CHANGE_KEY, crypto.randomUUID());
  } catch {}
}

export function NuniSessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({
    session: null,
    loading: true,
    error: '',
    pendingLogout: false,
  });
  const generation = useRef(0);
  const logoutActive = useRef(false);
  const currentContext = useRef<string | null>(null);
  const refresh = useCallback(async () => {
    if (logoutActive.current) return;
    const run = ++generation.current;
    setState((previous) => ({
      session: pendingContext() ? null : previous.session,
      loading: true,
      error: '',
      pendingLogout: !!pendingContext(),
    }));
    try {
      const result = nuniRecord(await browserRequest('session'));
      if (run !== generation.current) return;
      const context =
        typeof result.context === 'string' && /^[A-Za-z0-9_-]{43}$/.test(result.context)
          ? result.context
          : null;
      currentContext.current = context;
      const storedContext = pendingContext();
      if (storedContext && context && storedContext !== context) announce(null);
      const pending =
        result.pendingLogout === true || (!!storedContext && storedContext === context);
      if (pending && result.authenticated === false && result.pendingLogout !== true) {
        announce(null);
        setState({ session: null, loading: false, error: '', pendingLogout: false });
      } else if (pending) {
        setState({
          session: null,
          loading: false,
          error: '登出尚未完成，請重試以結束這次登入。',
          pendingLogout: true,
        });
      } else if (result.authenticated === false) {
        if (storedContext) announce(null);
        setState({ session: null, loading: false, error: '', pendingLogout: false });
      } else {
        if (typeof result.context !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(result.context))
          throw new NuniError(502, 'INVALID_RESPONSE');
        setState({
          session: { ...parseNuniPrincipal(result), context: result.context },
          loading: false,
          error: '',
          pendingLogout: false,
        });
      }
    } catch {
      if (run === generation.current)
        setState({
          session: null,
          loading: false,
          error: '無法確認登入狀態，請重新連線後再試。',
          pendingLogout: !!pendingContext(),
        });
    }
  }, []);
  const logout = useCallback(async () => {
    if (logoutActive.current) return;
    const expectedContext = currentContext.current || pendingContext();
    if (!expectedContext) return;
    logoutActive.current = true;
    ++generation.current;
    announce(expectedContext);
    setState({ session: null, loading: true, error: '', pendingLogout: true });
    try {
      const result = nuniRecord(await browserRequest('session'));
      if (result.authenticated === true || result.pendingLogout === true) {
        if (typeof result.context !== 'string') throw new NuniError(502, 'INVALID_RESPONSE');
        if (result.context !== expectedContext) throw new NuniError(409, 'SESSION_CHANGED');
        await browserRequest('logout', expectedContext, {});
      }
      announce(null);
      currentContext.current = null;
      setState({ session: null, loading: false, error: '', pendingLogout: false });
    } catch (failure) {
      if (failure instanceof NuniError && failure.code === 'SESSION_CHANGED') {
        announce(null);
        currentContext.current = null;
        setState({
          session: null,
          loading: false,
          error: '帳號已變更，請重新確認登入狀態。',
          pendingLogout: false,
        });
        return;
      }
      setState({
        session: null,
        loading: false,
        error: '登出尚未完成，請重試以結束這次登入。',
        pendingLogout: true,
      });
    } finally {
      logoutActive.current = false;
    }
  }, []);
  useEffect(() => {
    void refresh();
    const onStorage = (event: StorageEvent) => {
      if (event.key === CHANGE_KEY || event.key === LOGOUT_KEY) void refresh();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('pageshow', refresh);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      ++generation.current;
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pageshow', refresh);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);
  return <Context.Provider value={{ ...state, refresh, logout }}>{children}</Context.Provider>;
}

export function useNuniSession() {
  const value = useContext(Context);
  if (!value) throw new Error('NuniSessionProvider is required');
  return value;
}
