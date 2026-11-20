import Link from 'next/link';
import {
  LEAVE_COPY,
  leaveFailureCopy,
  leaveLoadingCopy,
  shouldRetryLeaveFailure,
  type LeavePageFailure,
  type LeavePageKind,
  type LeavePageView,
} from '@/lib/leavePageState';
import styles from './leave.module.css';

export function LeaveStatusPanel<D>({
  kind,
  view,
  loginHref,
  onRetry,
}: {
  kind: LeavePageKind;
  view: LeavePageView<D>;
  loginHref: string;
  onRetry: () => void;
}) {
  if (view.status === 'loading') {
    return (
      <div className={styles.empty} role="status">
        {leaveLoadingCopy(kind)}
      </div>
    );
  }
  if (view.status === 'empty' || view.status === 'ready') return null;
  return <LeaveFailurePanel kind={kind} failure={view} loginHref={loginHref} onRetry={onRetry} />;
}

export function LeaveFailurePanel({
  kind,
  failure,
  loginHref,
  onRetry,
}: {
  kind: LeavePageKind;
  failure: LeavePageFailure;
  loginHref: string;
  onRetry: () => void;
}) {
  const message = leaveFailureCopy(kind, failure);
  if (failure.status === 'unauthorized') {
    return (
      <section className={styles.alert} role="alert">
        <p>{message}</p>
        <Link href={loginHref} className={styles.textLink}>
          {LEAVE_COPY.login}
        </Link>
      </section>
    );
  }
  if (failure.status === 'unavailable' || failure.status === 'forbidden') {
    return (
      <section className={styles.empty} role="status">
        <strong>{message}</strong>
      </section>
    );
  }
  return (
    <section className={styles.alert} role="alert">
      <p>{message}</p>
      {shouldRetryLeaveFailure(failure) ? (
        <button type="button" onClick={onRetry}>
          {LEAVE_COPY.retry}
        </button>
      ) : null}
    </section>
  );
}
