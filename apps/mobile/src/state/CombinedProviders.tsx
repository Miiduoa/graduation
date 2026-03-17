import React, { useMemo, memo, useCallback, useRef, useEffect } from "react";
import { SchoolProvider, useSchool } from "./school";
import { AuthProvider, useAuth } from "./auth";
import { ThemeProvider, useThemeMode } from "./theme";
import { NotificationsProvider } from "./notifications";
import { PreferencesProvider } from "./preferences";
import { SearchHistoryProvider } from "./searchHistory";
import { FavoritesProvider } from "./favorites";
import { ScheduleProvider } from "./schedule";
import { DemoProvider } from "./demo";
import { I18nProvider } from "../i18n";
import { ToastProvider } from "../ui/Toast";

type ProviderEntry = {
  Provider: React.ComponentType<{ children: React.ReactNode; [key: string]: any }>;
  props?: Record<string, any>;
  getDynamicProps?: () => Record<string, any>;
};

function composeProviders(
  providers: ProviderEntry[],
  children: React.ReactNode
): React.ReactNode {
  return providers.reduceRight((acc, { Provider, props = {}, getDynamicProps }) => {
    const finalProps = getDynamicProps ? { ...props, ...getDynamicProps() } : props;
    return <Provider {...finalProps}>{acc}</Provider>;
  }, children);
}

const AppCoreProvidersInner = memo(function AppCoreProvidersInner({
  children,
}: {
  children: React.ReactNode;
}) {
  const providers: ProviderEntry[] = useMemo(
    () => [
      { Provider: ThemeProvider },
      { Provider: PreferencesProvider },
      { Provider: I18nProvider },
    ],
    []
  );

  return <>{composeProviders(providers, children)}</>;
});

export function AppCoreProviders({ children }: { children: React.ReactNode }) {
  return <AppCoreProvidersInner>{children}</AppCoreProvidersInner>;
}

const AppAuthProvidersInner = memo(function AppAuthProvidersInner({
  children,
}: {
  children: React.ReactNode;
}) {
  const providers: ProviderEntry[] = useMemo(
    () => [
      { Provider: SchoolProvider },
      { Provider: AuthProvider },
      { Provider: NotificationsProvider },
      { Provider: ToastProvider },
    ],
    []
  );

  return <>{composeProviders(providers, children)}</>;
});

export function AppAuthProviders({ children }: { children: React.ReactNode }) {
  return <AppAuthProvidersInner>{children}</AppAuthProvidersInner>;
}

const AuthAwareProvidersContent = memo(function AuthAwareProvidersContent({
  children,
  userId,
  schoolId,
}: {
  children: React.ReactNode;
  userId: string | null;
  schoolId: string | null;
}) {
  const userIdRef = useRef(userId);
  const schoolIdRef = useRef(schoolId);
  userIdRef.current = userId;
  schoolIdRef.current = schoolId;

  const providers: ProviderEntry[] = useMemo(
    () => [
      {
        Provider: SearchHistoryProvider,
        getDynamicProps: () => ({ 
          userId: userIdRef.current,
          schoolId: schoolIdRef.current,
        }),
      },
      {
        Provider: FavoritesProvider,
        getDynamicProps: () => ({ 
          userId: userIdRef.current,
          schoolId: schoolIdRef.current,
        }),
      },
      { Provider: ScheduleProvider },
      { Provider: DemoProvider },
    ],
    []
  );

  return <>{composeProviders(providers, children)}</>;
});

export function AuthAwareProviders({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const { school } = useSchool();
  const userId = auth.user?.uid ?? null;
  const schoolId = school?.id ?? null;

  return (
    <AuthAwareProvidersContent userId={userId} schoolId={schoolId}>
      {children}
    </AuthAwareProvidersContent>
  );
}

export function AllAppProviders({ children }: { children: React.ReactNode }) {
  return (
    <AppCoreProviders>
      <AppAuthProviders>
        <AuthAwareProviders>
          {children}
        </AuthAwareProviders>
      </AppAuthProviders>
    </AppCoreProviders>
  );
}

export function useOptimizedRerender() {
  const renderCount = useRef(0);
  const lastRenderTime = useRef(Date.now());

  useEffect(() => {
    renderCount.current += 1;
    const now = Date.now();
    const timeSinceLastRender = now - lastRenderTime.current;
    
    if (__DEV__ && timeSinceLastRender < 16 && renderCount.current > 1) {
      console.warn(
        `[Performance] Rapid re-renders detected: ${renderCount.current} renders in ${timeSinceLastRender}ms`
      );
    }
    
    lastRenderTime.current = now;
  });

  return renderCount.current;
}

export function useStableCallback<T extends (...args: any[]) => any>(
  callback: T
): T {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  return useCallback(
    ((...args) => callbackRef.current(...args)) as T,
    []
  );
}

export function useMemoizedValue<T>(
  value: T,
  deps: React.DependencyList
): T {
  return useMemo(() => value, deps);
}

export function createContextSelector<T, S>(
  useContext: () => T,
  selector: (context: T) => S
): () => S {
  return () => {
    const context = useContext();
    return useMemo(() => selector(context), [context]);
  };
}

export const useUserId = createContextSelector(
  useAuth,
  (auth) => auth.user?.uid ?? null
);

export const useIsAuthenticated = createContextSelector(
  useAuth,
  (auth) => !!auth.user
);

export const useSchoolId = createContextSelector(
  useSchool,
  (school) => school.school?.id
);

export const useIsDarkMode = createContextSelector(
  useThemeMode,
  (themeState) => themeState.mode === "dark"
);
