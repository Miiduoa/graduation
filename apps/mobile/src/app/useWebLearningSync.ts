import { useCallback, useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import Constants from "expo-constants";

import { getAIStatus } from "../services/ai";
import { syncWebLearningKnowledgeBase } from "../services/webLearning";

const MIN_RUN_INTERVAL_MS = 30 * 60 * 1000;
const ACTIVE_INTERVAL_MS = 45 * 60 * 1000;

function isWebLearningEnabled(): boolean {
  const extra = (Constants.expoConfig as any)?.extra ?? (Constants as any)?.manifest?.extra ?? {};
  const raw = extra.aiWebLearningEnabled ?? process.env.EXPO_PUBLIC_AI_WEB_LEARNING_ENABLED;
  if (raw == null) return true;
  return raw === true || String(raw).toLowerCase() === "true";
}

export function useWebLearningSync() {
  const appStateRef = useRef(AppState.currentState);
  const lastRunAtRef = useRef(0);
  const runningRef = useRef(false);

  const runSync = useCallback(async (reason: string, force = false) => {
    const aiStatus = getAIStatus();
    if (!aiStatus.webSearchEnabled || !isWebLearningEnabled() || runningRef.current) return;

    const now = Date.now();
    if (!force && now - lastRunAtRef.current < MIN_RUN_INTERVAL_MS) return;

    runningRef.current = true;
    lastRunAtRef.current = now;
    try {
      const report = await syncWebLearningKnowledgeBase(undefined, {
        force,
        maxQueries: force ? 3 : 2,
      });
      if (report.attempted > 0) {
        console.log(`[WebLearning] sync ${reason}:`, report);
      }
    } catch (error) {
      console.warn(`[WebLearning] sync failed (${reason}):`, error);
    } finally {
      runningRef.current = false;
    }
  }, []);

  useEffect(() => {
    const startup = setTimeout(() => {
      void runSync("startup", false);
    }, 5000);

    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (appStateRef.current.match(/inactive|background/) && nextAppState === "active") {
        void runSync("foreground", false);
      }
      appStateRef.current = nextAppState;
    };

    const appStateSubscription = AppState.addEventListener("change", handleAppStateChange);
    const interval = setInterval(() => {
      if (AppState.currentState === "active") {
        void runSync("active-interval", false);
      }
    }, ACTIVE_INTERVAL_MS);

    return () => {
      clearTimeout(startup);
      appStateSubscription.remove();
      clearInterval(interval);
    };
  }, [runSync]);
}
