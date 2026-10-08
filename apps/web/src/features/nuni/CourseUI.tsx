'use client';

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from 'react';
import { createNuniClasses, NuniError, nuniErrorMessage } from '@campus/shared/src/nuni';
import { browserRequest, useNuniSession } from './Session';
import styles from './NuniApp.module.css';

type BeginCourseRequest = () => () => void;
const CourseAccess = createContext<BeginCourseRequest | null>(null);
export function CourseAccessBoundary({
  children,
  beginRequest,
}: {
  children: ReactNode;
  beginRequest: BeginCourseRequest;
}) {
  return <CourseAccess.Provider value={beginRequest}>{children}</CourseAccess.Provider>;
}

export function useClasses(beginRequest?: BeginCourseRequest) {
  const { session, refresh } = useNuniSession();
  const inheritedRequest = useContext(CourseAccess);
  return createNuniClasses(async (path, input) => {
    if (!session) return Promise.reject(new NuniError(401, 'SIGN_IN_REQUIRED'));
    const onAccessDenied = (beginRequest ?? inheritedRequest)?.();
    try {
      return await browserRequest(path, session.context, input);
    } catch (error) {
      if (error instanceof NuniError && (error.status === 401 || error.code === 'SESSION_CHANGED'))
        void refresh();
      if (error instanceof NuniError && [403, 404].includes(error.status)) onAccessDenied?.();
      throw error;
    }
  }, session?.platformAccountId);
}

export function MutationForm({
  label,
  children,
  submit,
  success,
}: {
  label: string;
  children: ReactNode;
  submit: (data: FormData, key: string) => Promise<void>;
  success?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const attempt = useRef<{ data: FormData; key: string } | null>(null);
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (running.current) return;
    const form = event.currentTarget;
    if (!attempt.current) attempt.current = { data: new FormData(form), key: crypto.randomUUID() };
    running.current = true;
    setBusy(true);
    setError('');
    setDone(false);
    try {
      await submit(attempt.current.data, attempt.current.key);
      if (!mounted.current) return;
      attempt.current = null;
      setUncertain(false);
      setDone(true);
      form.reset();
    } catch (failure) {
      if (!mounted.current) return;
      const unknown = !(failure instanceof NuniError) || failure.status >= 500;
      setUncertain(unknown);
      if (!unknown) attempt.current = null;
      setError(nuniErrorMessage(failure));
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <fieldset disabled={busy || uncertain}>{children}</fieldset>
      {error && (
        <p role="alert">
          {error}
          {uncertain && ' 重試會確認同一筆送出結果，不會另建一筆。'}
        </p>
      )}
      {done && success && (
        <p role="status" className={styles.receipt}>
          {success}
        </p>
      )}
      <button className={styles.button} disabled={busy} type="submit">
        {busy ? '處理中…' : uncertain ? '確認送出結果' : label}
      </button>
    </form>
  );
}
