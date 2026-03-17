import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type DemoMode = "normal" | "loading" | "empty" | "error";

type DemoContextValue = {
  mode: DemoMode;
  setMode: (m: DemoMode) => void;
};

const DemoContext = createContext<DemoContextValue | null>(null);

const STORAGE_KEY = "campus.demoMode.v1";

function isMode(x: unknown): x is DemoMode {
  return x === "normal" || x === "loading" || x === "empty" || x === "error";
}

export function DemoProvider(props: { children: React.ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [mode, setModeState] = useState<DemoMode>("normal");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        if (cancelled) return;
        if (isMode(raw)) setModeState(raw);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const setMode = (m: DemoMode) => setModeState(m);

  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(STORAGE_KEY, mode).catch(() => void 0);
  }, [loaded, mode]);

  const value = useMemo(() => ({ mode, setMode }), [mode]);
  return <DemoContext.Provider value={value}>{props.children}</DemoContext.Provider>;
}

export function useDemo() {
  const ctx = useContext(DemoContext);
  if (!ctx) throw new Error("useDemo must be used within DemoProvider");
  return ctx;
}
