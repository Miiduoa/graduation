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
import { browserRequest, browserUpload, useNuniSession } from './Session';
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
  return createNuniClasses(
    async (path, input, query) => {
      if (!session) return Promise.reject(new NuniError(401, 'SIGN_IN_REQUIRED'));
      const onAccessDenied = (beginRequest ?? inheritedRequest)?.();
      try {
        return await (query
          ? browserRequest(path, session.context, input, undefined, query)
          : browserRequest(path, session.context, input));
      } catch (error) {
        if (error instanceof NuniError && (error.status === 401 || error.code === 'SESSION_CHANGED'))
          void refresh();
        if (error instanceof NuniError && [403, 404].includes(error.status)) onAccessDenied?.();
        throw error;
      }
    },
    session?.platformAccountId,
    async (path, body, contentType) => {
      if (!session) return Promise.reject(new NuniError(401, 'SIGN_IN_REQUIRED'));
      const copy = new ArrayBuffer(body.byteLength);
      new Uint8Array(copy).set(body);
      return browserUpload(path, session.context, new Blob([copy]), contentType);
    },
  );
}

export type MutationFormIntent = 'primary' | 'secondary';

export function MutationForm({
  label,
  secondaryLabel,
  children,
  submit,
  success,
}: {
  label: string;
  /** Optional continuous-review action; only offered when not retrying an uncertain submit. */
  secondaryLabel?: string;
  children: ReactNode;
  submit: (data: FormData, key: string, intent: MutationFormIntent) => Promise<void>;
  success?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const attempt = useRef<{ data: FormData; key: string; intent: MutationFormIntent } | null>(null);
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
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const intent: MutationFormIntent =
      attempt.current?.intent ??
      (submitter?.value === 'secondary' ? 'secondary' : 'primary');
    if (!attempt.current)
      attempt.current = { data: new FormData(form), key: crypto.randomUUID(), intent };
    running.current = true;
    setBusy(true);
    setError('');
    setDone(false);
    try {
      await submit(attempt.current.data, attempt.current.key, attempt.current.intent);
      if (!mounted.current) return;
      attempt.current = null;
      setUncertain(false);
      setDone(true);
      form.reset();
    } catch (failure) {
      if (!mounted.current) return;
      const unknown =
        !(failure instanceof NuniError) ||
        failure.status >= 500 ||
        failure.code === 'SESSION_CHANGED';
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
      <div className={styles.actions}>
        <button className={styles.button} disabled={busy} type="submit" value="primary">
          {busy ? '處理中…' : uncertain ? '確認送出結果' : label}
        </button>
        {secondaryLabel && !uncertain ? (
          <button
            className={`${styles.button} ${styles.secondary}`}
            disabled={busy}
            type="submit"
            value="secondary"
          >
            {busy ? '處理中…' : secondaryLabel}
          </button>
        ) : null}
      </div>
    </form>
  );
}
