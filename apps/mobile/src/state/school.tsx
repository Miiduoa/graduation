import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  PROVIDENCE_UNIVERSITY_SCHOOL_CODE,
  PROVIDENCE_UNIVERSITY_SCHOOL_ID,
  type School,
} from '@campus/shared/src';
import { findSchoolById, findSchoolsByCode, normalizeSchoolCode, resolveSchool } from '@campus/shared/src/schools';
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

const VALID_CAMPUS_ID = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

export function schoolFromSelection(selection: Partial<SchoolSelection>): School {
  const byId = selection.schoolId ? findSchoolById(selection.schoolId) : undefined;
  if (byId) return byId;
  // A directory tenant does not need to be hard-coded in the offline school
  // list to remain distinct. Never turn an unknown but valid ID into PU.
  if (selection.schoolId && VALID_CAMPUS_ID.test(selection.schoolId)) {
    return {
      id: selection.schoolId,
      code: normalizeSchoolCode(selection.code),
      name: selection.schoolName?.trim() || '所選校園尚未接入',
      ...(selection.shortName ? { shortName: selection.shortName } : {}),
      ...(selection.themeColor ? { themeColor: selection.themeColor } : {}),
      ...(selection.domains ? { domains: selection.domains } : {}),
    };
  }
  const matches = selection.code ? findSchoolsByCode(selection.code) : [];
  return matches.length === 1 ? matches[0] : getProvidenceSchool();
}

function normalizeSelection(selection: Partial<SchoolSelection>): SchoolSelection {
  return toSelection(schoolFromSelection(selection));
}

/** Code-only switches must not reuse the previous school's authoritative ID. */
export function mergeSchoolSelection(
  previous: SchoolSelection,
  next: Partial<SchoolSelection>,
): SchoolSelection {
  if (next.schoolId && !VALID_CAMPUS_ID.test(next.schoolId)) return previous;
  if (next.code !== undefined && next.schoolId === undefined) {
    if (findSchoolsByCode(next.code).length !== 1) return previous;
  }
  const schoolId =
    next.schoolId !== undefined
      ? next.schoolId
      : next.code !== undefined
        ? null
        : previous.schoolId;
  const code =
    next.code !== undefined
      ? normalizeSchoolCode(next.code)
      : next.schoolId !== undefined
        ? findSchoolById(next.schoolId)?.code ?? ''
        : previous.code;
  const identityChanged = next.schoolId !== undefined || next.code !== undefined;
  return normalizeSelection({
    code,
    schoolId,
    schoolName: next.schoolName ?? (identityChanged ? null : previous.schoolName),
    shortName: next.shortName ?? (identityChanged ? null : previous.shortName),
    themeColor: next.themeColor ?? (identityChanged ? null : previous.themeColor),
    domains: next.domains ?? (identityChanged ? null : previous.domains),
  });
}

export function SchoolProvider(props: {
  children: React.ReactNode;
  initial?: Partial<SchoolSelection>;
}) {
  const initialSelection = normalizeSelection({
    code: props.initial?.code ?? PROVIDENCE_UNIVERSITY_SCHOOL_CODE,
    schoolId: props.initial?.schoolId ?? PROVIDENCE_UNIVERSITY_SCHOOL_ID,
  });
  const [selection, setSelectionState] = useState<SchoolSelection>(initialSelection);
  const [loaded, setLoaded] = useState(false);

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
          }),
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
    setSelectionState((prev) => mergeSchoolSelection(prev, next));
  };

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
    [normalizedSelection, school],
  );

  return <SchoolContext.Provider value={value}>{props.children}</SchoolContext.Provider>;
}

export function useSchool() {
  const ctx = useContext(SchoolContext);
  if (!ctx) throw new Error('useSchool must be used within SchoolProvider');
  return ctx;
}
