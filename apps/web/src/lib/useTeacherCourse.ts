'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/AuthGuard';
import {
  loadTeacherWorkspace,
  loadTeacherGradebook,
  watchTeacherAccess,
  TeacherCourseError,
  type TeacherGradebook,
  type TeacherWorkspace,
  type TeacherView,
} from './teacherCourse';

type State = {
  scope: string;
  status: 'loading' | 'ready' | 'error';
  data?: TeacherWorkspace | TeacherGradebook;
  error?: string;
};
export function useTeacherCourse(schoolId: string, courseId: string, view: TeacherView) {
  const { user, loading: authLoading } = useAuth();
  const uid = user?.uid ?? '';
  const scopeKey = JSON.stringify([uid, schoolId, courseId, view]);
  const activeScope = useRef(scopeKey);
  const generation = useRef(0);
  useLayoutEffect(() => {
    activeScope.current = scopeKey;
    generation.current += 1;
  }, [scopeKey, authLoading]);
  const [state, setState] = useState<State | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const load = useCallback(async () => {
    const request = ++generation.current;
    if (!uid || authLoading) return;
    const isCurrent = () => activeScope.current === scopeKey && generation.current === request;
    setState({ scope: scopeKey, status: 'loading' });
    try {
      const scope = { uid, schoolId, courseId };
      const data = await (view === 'workspace'
        ? loadTeacherWorkspace(scope, isCurrent)
        : loadTeacherGradebook(scope, isCurrent));
      if (isCurrent()) setState({ scope: scopeKey, status: 'ready', data });
    } catch (error) {
      if (isCurrent())
        setState({
          scope: scopeKey,
          status: 'error',
          error:
            error instanceof TeacherCourseError
              ? error.message
              : '無法讀取課程資料。請確認連線與教師權限後重試。',
        });
    }
  }, [uid, authLoading, schoolId, courseId, scopeKey, view]);
  useEffect(() => {
    let mounted = true;
    const invalidate = () => {
      if (!mounted || activeScope.current !== scopeKey) return;
      generation.current += 1;
      setState({
        scope: scopeKey,
        status: 'error',
        error: '課程權限已變更或無法確認，請重新整理後再試。',
      });
    };
    // Clear the previous snapshot before synchronizing with the permission-checked reader.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    let stop: (() => void) | undefined;
    if (uid && !authLoading) {
      try {
        stop = watchTeacherAccess({ uid, schoolId, courseId }, invalidate);
      } catch {
        invalidate();
      }
    }
    return () => {
      mounted = false;
      generation.current += 1;
      stop?.();
    };
  }, [uid, schoolId, courseId, authLoading, scopeKey, load, revision]);
  const visible = !authLoading && uid && state?.scope === scopeKey ? state : null;
  return { state: visible, refresh, authLoading, signedIn: Boolean(uid) };
}
