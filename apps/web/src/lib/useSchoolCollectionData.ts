"use client";

import { useEffect, useState } from "react";
import { isFirebaseConfigured } from "./firebase";

export type SchoolCollectionSource = "demo" | "firebase";

export function useSchoolCollectionData<T>(
  schoolId: string,
  loadLive: (schoolId: string) => Promise<T[]>,
  demoData: readonly T[]
) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [sourceMode, setSourceMode] = useState<SchoolCollectionSource>(
    isFirebaseConfigured() ? "firebase" : "demo"
  );

  useEffect(() => {
    let active = true;

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
    };
  }, [demoData, loadLive, schoolId]);

  return {
    data,
    loading,
    sourceMode,
    usingDemo: sourceMode === "demo",
    firebaseEnabled: isFirebaseConfigured(),
  };
}
