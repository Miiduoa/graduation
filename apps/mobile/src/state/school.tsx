import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { School } from "@campus/shared/src";
import { mockSchools, normalizeSchoolCode, resolveSchool } from "@campus/shared/src/schools";
import { clearCacheExceptSchool } from "../data/cachedSource";
import { isSchoolVisibleInDirectory } from "../services/release";
import { applySchoolTheme, registerSchoolTheme } from "../ui/theme";

export type SchoolSelection = {
  code: string;
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

function getDefaultVisibleSchool(): School {
  return (
    mockSchools.find((candidate) => isSchoolVisibleInDirectory(candidate.id, candidate.integrationStatus)) ??
    resolveSchool()
  );
}

function toSelection(school: School): SchoolSelection {
  return {
    code: normalizeSchoolCode(school.code),
    schoolId: school.id,
    schoolName: school.name,
    shortName: school.shortName ?? null,
    themeColor: school.themeColor ?? null,
    domains: school.domains ?? null,
  };
}

function normalizeSelection(selection: Partial<SchoolSelection>): SchoolSelection {
  const requested = resolveSchool({
    school: selection.code,
    schoolId: selection.schoolId ?? undefined,
  });

  if (!isSchoolVisibleInDirectory(requested.id, requested.integrationStatus)) {
    return toSelection(getDefaultVisibleSchool());
  }

  return {
    code: normalizeSchoolCode(selection.code ?? requested.code),
    schoolId: selection.schoolId ?? requested.id,
    schoolName: selection.schoolName ?? requested.name,
    shortName: selection.shortName ?? requested.shortName ?? null,
    themeColor: selection.themeColor ?? requested.themeColor ?? null,
    domains: selection.domains ?? requested.domains ?? null,
  };
}

export function SchoolProvider(props: {
  children: React.ReactNode;
  initial?: Partial<SchoolSelection>;
}) {
  const initialSelection = normalizeSelection({
    code: props.initial?.code ?? "PU",
    schoolId: props.initial?.schoolId ?? null,
    schoolName: props.initial?.schoolName ?? null,
    shortName: props.initial?.shortName ?? null,
    themeColor: props.initial?.themeColor ?? null,
    domains: props.initial?.domains ?? null,
  });
  const [loaded, setLoaded] = useState(false);
  const [selection, setSelectionState] = useState<SchoolSelection>(initialSelection);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as Partial<SchoolSelection>;
        if (cancelled) return;
        setSelectionState((prev) =>
          normalizeSelection({
            code: parsed.code ?? prev.code,
            schoolId: parsed.schoolId ?? prev.schoolId,
            schoolName: parsed.schoolName ?? prev.schoolName ?? null,
            shortName: parsed.shortName ?? prev.shortName ?? null,
            themeColor: parsed.themeColor ?? prev.themeColor ?? null,
            domains: parsed.domains ?? prev.domains ?? null,
          })
        );
      } catch {
        // ignore invalid persisted state
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
        next.schoolName === undefined
          ? identityChanged
            ? null
            : prev.schoolName ?? null
          : next.schoolName;
      const shortName =
        next.shortName === undefined
          ? identityChanged
            ? null
            : prev.shortName ?? null
          : next.shortName;
      const themeColor =
        next.themeColor === undefined
          ? identityChanged
            ? null
            : prev.themeColor ?? null
          : next.themeColor;
      const domains =
        next.domains === undefined ? (identityChanged ? null : prev.domains ?? null) : next.domains;

      return normalizeSelection({ code, schoolId, schoolName, shortName, themeColor, domains });
    });
  };

  useEffect(() => {
    if (!loaded) return;

    const currentSchoolKey = selection.schoolId || selection.code;
    const previousSchoolKey = previousSchoolRef.current;

    if (previousSchoolKey && previousSchoolKey !== currentSchoolKey) {
      clearCacheExceptSchool(currentSchoolKey).catch((error) => {
        console.warn("Failed to clear cache on school switch:", error);
      });
    }

    previousSchoolRef.current = currentSchoolKey;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(selection)).catch(() => void 0);
  }, [loaded, selection]);

  const school = useMemo(() => {
    const resolved = resolveSchool({ school: selection.code, schoolId: selection.schoolId ?? undefined });
    if (!isSchoolVisibleInDirectory(resolved.id, resolved.integrationStatus)) {
      return getDefaultVisibleSchool();
    }

    if (selection.schoolId && resolved.id !== selection.schoolId) {
      const fallbackSchool: School = {
        id: selection.schoolId,
        code: selection.code || normalizeSchoolCode(selection.schoolId),
        name: selection.schoolName ?? selection.shortName ?? selection.schoolId,
        shortName: selection.shortName ?? undefined,
        themeColor: selection.themeColor ?? undefined,
        domains: selection.domains ?? undefined,
      };

      return isSchoolVisibleInDirectory(fallbackSchool.id, fallbackSchool.integrationStatus)
        ? fallbackSchool
        : getDefaultVisibleSchool();
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

  useEffect(() => {
    if (!loaded || !school) return;

    if (school.themeColor) {
      registerSchoolTheme({
        schoolId: school.id,
        accent: school.themeColor,
      });
    }

    applySchoolTheme(school.id, school.themeColor);
  }, [loaded, school]);

  const normalizedSelection = useMemo(() => normalizeSelection(selection), [selection]);

  const value: SchoolContextValue = useMemo(
    () => ({
      selection: normalizedSelection,
      setSelection,
      school,
      schoolId: normalizedSelection.schoolId ?? school?.id ?? null,
    }),
    [normalizedSelection, school]
  );

  return <SchoolContext.Provider value={value}>{props.children}</SchoolContext.Provider>;
}

export function useSchool() {
  const ctx = useContext(SchoolContext);
  if (!ctx) throw new Error("useSchool must be used within SchoolProvider");
  return ctx;
}
