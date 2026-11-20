import { useEffect } from 'react';
import type { useOptionalNuniSession } from './nuniSession';

/** A foreground conversation can outlive its verified session without receiving an app-state event. */
export function useAssistantSessionExpiry(platform: ReturnType<typeof useOptionalNuniSession>) {
  const expiresAt = platform?.session?.expiresAt;
  const context = platform?.session?.context;
  const refresh = platform?.refresh;
  useEffect(() => {
    if (!context || !expiresAt || !refresh) return;
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) void refresh();
      else timer = setTimeout(check, Math.min(remaining, 2_147_483_647));
    };
    check();
    return () => clearTimeout(timer);
  }, [context, expiresAt, refresh]);
}
