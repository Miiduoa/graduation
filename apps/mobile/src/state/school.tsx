import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  PROVIDENCE_UNIVERSITY_SCHOOL_CODE,
  PROVIDENCE_UNIVERSITY_SCHOOL_ID,
  type School,
} from '@campus/shared/src';
import { findSchoolById, normalizeSchoolCode, resolveSchool } from '@campus/shared/src/schools';
import { clearCacheExceptSchool } from '../data/cachedSource';
import { setHybridSourceSchoolContext } from '../data/hybridSource';
import { applySchoolTheme, registerSchoolTheme } from '../ui/theme';

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

const STORAGE_KEY = 'campus.schoolSelection.v1';

function getProvidenceSchool(): School {
  return (
    findSchoolById(PROVIDENCE_UNIVERSITY_SCHOOL_ID) ??
    resolveSchool({
      schoolId: PROVIDENCE_UNIVERSITY_SCHOOL_ID,
      school: PROVIDENCE_UNIVERSITY_SCHOOL_CODE,
    })
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

export function schoolFromSelection(selection: Partial<SchoolSelection>): School {
  return (
    (selection.schoolId ? findSchoolById(selection.schoolId) : undefined) ??
    (selection.code
      ? resolveSchool({
          school: selection.code,
          schoolId: selection.schoolId ?? undefined,
        })
      : undefined) ??
    getProvidenceSchool()
  );
}

function normalizeSelection(selection: Partial<SchoolSelection>): SchoolSelection {
  return toSelection(schoolFromSelection(selection));
}

/** An ID and a school code are alternative selectors, not independent fields. */
export function mergeSchoolSelection(
  previous: SchoolSelection,
  patch: Partial<SchoolSelection>,
): SchoolSelection {
  const idChanged = patch.schoolId !== undefined;
  const codeChanged = patch.code !== undefined;
  const schoolId = idChanged ? patch.schoolId : codeChanged ? null : previous.schoolId;
  const code = idChanged && !codeChanged
    ? ''
    : codeChanged ? normalizeSchoolCode(patch.code) : previous.code;
  return normalizeSelection({ code, schoolId });
}

export function SchoolProvider(props: {
  children: React.ReactNode;
  initial?: Partial<SchoolSelection>;
}) {
  const initialSelection = mergeSchoolSelection(
    toSelection(getProvidenceSchool()),
    props.initial ?? {},
  );
  const [selection, setSelectionState] = useState<SchoolSelection>(initialSelection);
  const [loaded, setLoaded] = useState(false);
  const touched = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as Partial<SchoolSelection>;
        if (cancelled) return;
        setSelectionState((prev) => (touched.current ? prev : mergeSchoolSelection(prev, parsed)));
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

  const setSelection = useCallback((next: Partial<SchoolSelection>) => {
    touched.current = true;
    setSelectionState((previous) => mergeSchoolSelection(previous, next));
  }, []);

  useEffect(() => {
    if (!loaded) return;

    const currentSchoolKey = selection.schoolId || selection.code;
    const previousSchoolKey = previousSchoolRef.current;

    if (previousSchoolKey && previousSchoolKey !== currentSchoolKey) {
      clearCacheExceptSchool(currentSchoolKey).catch((error) => {
        console.warn('Failed to clear cache on school switch:', error);
      });
    }

    previousSchoolRef.current = currentSchoolKey;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(selection)).catch(() => void 0);
  }, [loaded, selection]);

  const normalizedSelection = useMemo(() => normalizeSelection(selection), [selection]);
  const school = useMemo(
    () => schoolFromSelection(normalizedSelection),
    [normalizedSelection],
  );

  useEffect(() => {
    if (!loaded || !school) return;

    if (school.themeColor) {
      registerSchoolTheme({
        schoolId: school.id,
        accent: school.themeColor,
      });
    }

    applySchoolTheme(school.id, school.themeColor);
    setHybridSourceSchoolContext(school.id);
  }, [loaded, school]);

  const value: SchoolContextValue = useMemo(
    () => ({
      selection: normalizedSelection,
      setSelection,
      school,
      schoolId: normalizedSelection.schoolId ?? school?.id ?? null,
    }),
    [normalizedSelection, school, setSelection],
  );

  return <SchoolContext.Provider value={value}>{props.children}</SchoolContext.Provider>;
}

export function useSchool() {
  const ctx = useContext(SchoolContext);
  if (!ctx) throw new Error('useSchool must be used within SchoolProvider');
  return ctx;
}
