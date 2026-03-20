import React, { createContext, useContext, useEffect, useMemo, useState, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { School } from "@campus/shared/src";
import { normalizeSchoolCode, resolveSchool } from "@campus/shared/src/schools";
import { clearCacheExceptSchool } from "../data/cachedSource";
import { applySchoolTheme, registerSchoolTheme } from "../ui/theme";

export type SchoolSelection = {
  code: string; // e.g. NCHU
  schoolId: string | null;
  schoolName?: string | null;
  shortName?: string | null;
  themeColor?: string | null;
  domains?: string[] | null;
};

export type SchoolContextValue = {
  selection: SchoolSelection;
  setSelection: (next: Partial<SchoolSelection>) => void;
  school: ReturnType<typeof resolveSchool>;
  schoolId: string | null;
};

const SchoolContext = createContext<SchoolContextValue | null>(null);

const STORAGE_KEY = "campus.schoolSelection.v1";

export function SchoolProvider(props: { children: React.ReactNode; initial?: Partial<SchoolSelection> }) {
  const [loaded, setLoaded] = useState(false);
  const [selection, setSelectionState] = useState<SchoolSelection>({
    code: normalizeSchoolCode(props.initial?.code ?? "PU"),
    schoolId: props.initial?.schoolId ?? null,
    schoolName: props.initial?.schoolName ?? null,
    shortName: props.initial?.shortName ?? null,
    themeColor: props.initial?.themeColor ?? null,
    domains: props.initial?.domains ?? null,
  });

  // Load persisted selection once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as Partial<SchoolSelection>;
        if (cancelled) return;
        setSelectionState((prev) => ({
          code: normalizeSchoolCode(parsed.code ?? prev.code),
          schoolId: parsed.schoolId ?? null,
          schoolName: parsed.schoolName ?? null,
          shortName: parsed.shortName ?? null,
          themeColor: parsed.themeColor ?? null,
          domains: parsed.domains ?? null,
        }));
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

  const previousSchoolRef = useRef<string | null>(null);

  const setSelection = (next: Partial<SchoolSelection>) => {
    setSelectionState((prev) => {
      const identityChanged = next.code !== undefined || next.schoolId !== undefined;
      const code = next.code != null ? normalizeSchoolCode(next.code) : prev.code;
      const schoolId = next.schoolId === undefined ? prev.schoolId : next.schoolId;
      const schoolName =
        next.schoolName === undefined ? (identityChanged ? null : prev.schoolName ?? null) : next.schoolName;
      const shortName =
        next.shortName === undefined ? (identityChanged ? null : prev.shortName ?? null) : next.shortName;
      const themeColor =
        next.themeColor === undefined ? (identityChanged ? null : prev.themeColor ?? null) : next.themeColor;
      const domains =
        next.domains === undefined ? (identityChanged ? null : prev.domains ?? null) : next.domains;

      return { code, schoolId, schoolName, shortName, themeColor, domains };
    });
  };

  // Persist on change (after initial load) and clear cache for other schools when switching.
  useEffect(() => {
    if (!loaded) return;
    
    const currentSchoolKey = selection.schoolId || selection.code;
    const previousSchoolKey = previousSchoolRef.current;
    
    if (previousSchoolKey && previousSchoolKey !== currentSchoolKey) {
      clearCacheExceptSchool(currentSchoolKey).catch((e) => {
        console.warn("Failed to clear cache on school switch:", e);
      });
    }
    
    previousSchoolRef.current = currentSchoolKey;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(selection)).catch(() => void 0);
  }, [loaded, selection]);

  const school = useMemo(() => {
    const resolved = resolveSchool({ school: selection.code, schoolId: selection.schoolId ?? undefined });

    if (selection.schoolId && resolved.id !== selection.schoolId) {
      const fallbackSchool: School = {
        id: selection.schoolId,
        code: selection.code || normalizeSchoolCode(selection.schoolId),
        name: selection.schoolName ?? selection.shortName ?? selection.schoolId,
        shortName: selection.shortName ?? undefined,
        themeColor: selection.themeColor ?? undefined,
        domains: selection.domains ?? undefined,
      };

      return fallbackSchool;
    }

    return resolved;
  }, [
    selection.code,
    selection.schoolId,
    selection.schoolName,
    selection.shortName,
    selection.themeColor,
    selection.domains,
  ]);

  // 當學校變更時，自動應用學校主題
  useEffect(() => {
    if (!loaded || !school) return;
    
    // 註冊學校主題配置（如果有 themeColor）
    if (school.themeColor) {
      registerSchoolTheme({
        schoolId: school.id,
        accent: school.themeColor,
      });
    }
    
    // 應用學校主題（保持當前的亮/暗模式）
    applySchoolTheme(school.id, school.themeColor);
  }, [loaded, school]);

  const value: SchoolContextValue = useMemo(
    () => ({
      selection,
      setSelection,
      school,
      schoolId: selection.schoolId ?? school?.id ?? null,
    }),
    [selection, school]
  );

  return <SchoolContext.Provider value={value}>{props.children}</SchoolContext.Provider>;
}

export function useSchool() {
  const ctx = useContext(SchoolContext);
  if (!ctx) throw new Error("useSchool must be used within SchoolProvider");
  return ctx;
}
