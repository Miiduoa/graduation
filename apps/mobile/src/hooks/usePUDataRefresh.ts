/**
 * Hook：靜宜大學資料自動刷新
 *
 * 放在 app 的根層級（如 AppRoot 或 MainNavigator），
 * 會在以下時機自動刷新過期的 PU 資料：
 *   - app 從背景回到前景（超過 5 分鐘）
 *   - 每 30 分鐘一次自動刷新（公告）
 */
import { useEffect, useRef } from "react";
import { useAuth } from "../state/auth";
import { getPUSession } from "../services/studentIdAuth";
import { refreshStaleData } from "../services/puDataCache";
import { useAppState } from "./useAppState";

const MIN_BACKGROUND_MS = 5 * 60 * 1000;       // 背景超過 5 分鐘才刷新
const PERIODIC_REFRESH_MS = 30 * 60 * 1000;     // 30 分鐘定期刷新

export function usePUDataRefresh(): void {
  const { user } = useAuth();
  const backgroundStartRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 監聽前後台切換
  useAppState({
    onBackground: () => {
      backgroundStartRef.current = Date.now();
    },
    onForeground: () => {
      const session = getPUSession();
      if (!session || !user) return;

      const bgStart = backgroundStartRef.current;
      backgroundStartRef.current = null;

      if (bgStart && Date.now() - bgStart >= MIN_BACKGROUND_MS) {
        refreshStaleData(session).catch((err) =>
          console.warn("[usePUDataRefresh] foreground refresh failed:", err)
        );
      }
    },
  });

  // 定期刷新（公告 TTL 只有 30 分鐘）
  useEffect(() => {
    if (!user) return;

    intervalRef.current = setInterval(() => {
      const session = getPUSession();
      if (!session) return;

      refreshStaleData(session).catch((err) =>
        console.warn("[usePUDataRefresh] periodic refresh failed:", err)
      );
    }, PERIODIC_REFRESH_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [user]);
}
