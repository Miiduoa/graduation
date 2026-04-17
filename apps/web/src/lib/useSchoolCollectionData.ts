"use client";

import { useEffect, useState } from "react";
import { isFirebaseConfigured } from "./firebase";

export type SchoolCollectionSource = "demo" | "firebase";

type SubscribeLiveCollection<T> = (
  schoolId: string,
  onData: (data: T[]) => void,
  onError: (error: unknown) => void
) => () => void;

export function useSchoolCollectionData<T>(
  schoolId: string,
  loadLive: ((schoolId: string) => Promise<T[]>) | undefined,
  demoData: readonly T[],
  options?: {
    subscribeLive?: SubscribeLiveCollection<T>;
  }
) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [sourceMode, setSourceMode] = useState<SchoolCollectionSource>(
    isFirebaseConfigured() ? "firebase" : "demo"
  );
  const subscribeLive = options?.subscribeLive;

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    async function load() {
      setLoading(true);

      if (!isFirebaseConfigured()) {
        if (active) {
          setData([...demoData]);
          setSourceMode("demo");
          setLoading(false);
        }
        return;
      }

      if (subscribeLive) {
        try {
          unsubscribe = subscribeLive(
            schoolId,
            (liveData) => {
              if (!active) return;

              setData(liveData);
              setSourceMode("firebase");
              setLoading(false);
            },
            (error) => {
              console.error("[SchoolCollectionData] Failed to subscribe to live data:", error);
              if (!active) return;

              setData([...demoData]);
              setSourceMode("demo");
              setLoading(false);
            }
          );
        } catch (error) {
          console.error("[SchoolCollectionData] Failed to initialize live subscription:", error);
          if (!active) return;

          setData([...demoData]);
          setSourceMode("demo");
          setLoading(false);
        }
        return;
      }

      if (!loadLive) {
        if (active) {
          setData([...demoData]);
          setSourceMode("demo");
          setLoading(false);
        }
        return;
      }

      try {
        const liveData = await loadLive(schoolId);
        if (!active) return;

        setData(liveData);
        setSourceMode("firebase");
      } catch (error) {
        console.error("[SchoolCollectionData] Failed to load live data:", error);
        if (!active) return;

        setData([...demoData]);
        setSourceMode("demo");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [demoData, loadLive, schoolId, subscribeLive]);

  return {
    data,
    loading,
    sourceMode,
    usingDemo: sourceMode === "demo",
    firebaseEnabled: isFirebaseConfigured(),
  };
}
