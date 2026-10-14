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

export function schoolFromSelection(selection: Partial<SchoolSelection>): School {
  const id = typeof selection.schoolId === 'string' ? selection.schoolId.trim() : '';
  const bundled = id ? findSchoolById(id) : undefined;
  if (bundled) return bundled;

  // The public school directory is larger than the bundled offline catalogue.
  // Retain the exact selected ID instead of resolving an unknown ID to a demo campus.
  if (/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(id)) {
    const suppliedCode = normalizeSchoolCode(selection.code);
    const knownCodeSchools = findSchoolsByCode(suppliedCode);
    const code =
      knownCodeSchools.length === 1 && knownCodeSchools[0].id !== id
        ? id.toUpperCase()
        : suppliedCode || id.toUpperCase();
    const label = typeof selection.schoolName === 'string' ? selection.schoolName.trim() : '';
    const shortName = typeof selection.shortName === 'string' ? selection.shortName.trim() : '';
    const color = typeof selection.themeColor === 'string' ? selection.themeColor : '';
    return {
      id,
      code,
      name: label.slice(0, 160) || `校園（${id}）`,
      shortName: shortName.slice(0, 80) || undefined,
      themeColor: /^#[0-9a-fA-F]{6}$/.test(color) ? color : undefined,
      // Unrecognized school metadata cannot establish trusted email domains.
    };
  }

  const matches = findSchoolsByCode(selection.code);
  if (matches.length === 1) return matches[0];
  return getProvidenceSchool();
}

function normalizeSelection(selection: Partial<SchoolSelection>): SchoolSelection {
  return toSelection(schoolFromSelection(selection));
}

export function SchoolProvider(props: {
  children: React.ReactNode;
  initial?: Partial<SchoolSelection>;
}) {
  const initialSelection = normalizeSelection({
    ...props.initial,
    code: props.initial?.code ?? (props.initial?.schoolId ? '' : PROVIDENCE_UNIVERSITY_SCHOOL_CODE),
    schoolId:
      props.initial?.schoolId ??
      (props.initial?.code ? null : PROVIDENCE_UNIVERSITY_SCHOOL_ID),
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
    setSelectionState((prev) => {
      const identityChanged = next.code !== undefined || next.schoolId !== undefined;
      const code =
        next.code != null
          ? normalizeSchoolCode(next.code)
          : next.schoolId !== undefined && next.schoolId !== prev.schoolId
            ? ''
            : prev.code;
      const schoolId = next.schoolId === undefined ? prev.schoolId : next.schoolId;
      const schoolName =
        next.schoolName === undefined
          ? identityChanged
            ? null
            : (prev.schoolName ?? null)
          : next.schoolName;
      const shortName =
        next.shortName === undefined
          ? identityChanged
            ? null
            : (prev.shortName ?? null)
          : next.shortName;
      const themeColor =
        next.themeColor === undefined
          ? identityChanged
            ? null
            : (prev.themeColor ?? null)
          : next.themeColor;
      const domains =
        next.domains === undefined
          ? identityChanged
            ? null
            : (prev.domains ?? null)
          : next.domains;

      return normalizeSelection({ code, schoolId, schoolName, shortName, themeColor, domains });
    });
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
