'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { browserRequest } from '@/features/nuni/Session';
import {
  IDENTITY_LOOKUP_FAILED_COPY,
  IDENTITY_LOOKUP_FAILED_HINT,
  IDENTITY_NO_MERCHANT_COPY,
  IDENTITY_NO_TEACHING_COPY,
  IDENTITY_RETRY_COPY,
  loadAccountIdentity,
  type AccountIdentity as Identity,
  type IdentityPart,
  type TeachingIdentity,
} from '@/lib/accountIdentity';
import styles from './NuniAccountPanel.module.css';
import { AccountWorkspaces } from './AccountWorkspaces';

type Props = {
  context: string;
  accountId: string;
  variant?: 'account' | 'home';
  isPlatformOperator?: boolean;
  includeTeaching?: boolean;
  teaching?: IdentityPart<TeachingIdentity[]>;
};

export function AccountIdentity(props: Props) {
  return <IdentityReader key={JSON.stringify([props.context, props.accountId])} {...props} />;
}

function IdentityReader({
  context,
  accountId,
  variant = 'account',
  isPlatformOperator = false,
  includeTeaching = true,
  teaching: confirmedTeaching,
}: Props) {
  const [data, setData] = useState<Identity | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const readTeaching = confirmedTeaching === undefined;
  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    if (variant !== 'home') setData(null);
    try {
      const next = await loadAccountIdentity(
        (path, input) => browserRequest(path, context, input),
        accountId,
        { readTeaching },
      );
      if (request === generation.current) setData(next);
    } catch {
      if (request === generation.current)
        setData({
          teaching: { status: 'error' },
          stores: { status: 'error' },
          applications: { status: 'error' },
        });
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [accountId, context, variant, readTeaching]);
  useEffect(() => {
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load, attempt]);
  const failed =
    data?.teaching.status === 'error' ||
    data?.stores.status === 'error' ||
    data?.applications.status === 'error';
  const teaching = data?.teaching.status === 'ok' ? data.teaching.items : [];
  const stores = data?.stores.status === 'ok' ? data.stores.items : [];
  const applications = data?.applications.status === 'ok' ? data.applications.items : [];
  const merchantEmpty =
    data?.stores.status === 'ok' &&
    data.applications.status === 'ok' &&
    stores.length === 0 &&
    applications.length === 0;
  if (variant === 'home')
    return (
      <AccountWorkspaces
        data={
          confirmedTeaching
            ? {
                ...(data ?? { stores: { status: 'pending' }, applications: { status: 'pending' } }),
                teaching: confirmedTeaching,
              }
            : data
        }
        loading={loading && attempt > 0}
        isPlatformOperator={isPlatformOperator}
        includeTeaching={includeTeaching}
        attempted={attempt > 0}
        onRetry={() => setAttempt((value) => value + 1)}
      />
    );
  return (
    <section className={styles.memberships} aria-labelledby="my-identity-title">
      <div className={styles.membershipHeading}>
        <h3 id="my-identity-title">我的身分</h3>
      </div>
      {loading || !data ? (
        <p role="status">正在確認老師與店家身分…</p>
      ) : (
        <>
          {failed && (
            <div role="alert">
              <p>{IDENTITY_LOOKUP_FAILED_COPY}</p>
              <p>{IDENTITY_LOOKUP_FAILED_HINT}</p>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setAttempt((value) => value + 1);
                }}
              >
                {IDENTITY_RETRY_COPY}
              </button>
            </div>
          )}
          <ul className={styles.membershipList}>
            {data.teaching.status === 'ok' &&
              teaching.map((course) => (
                <li key={course.id}>
                  <Link href={course.href}>
                    {course.name} · {course.role}
                  </Link>
                </li>
              ))}
            {data.teaching.status === 'ok' && teaching.length === 0 && (
              <li>
                <span>{IDENTITY_NO_TEACHING_COPY}</span>
              </li>
            )}
            {stores.map((store) => (
              <li key={`${store.tenantId}:${store.locationId}`}>
                <Link href={store.href}>
                  {store.name}／{store.locationName} · {store.campus} · {store.status}
                </Link>
              </li>
            ))}
            {applications.map((item) => (
              <li key={`${item.brand}:${item.progress}`}>
                <Link href="/merchant/workspace">
                  {item.brand} · {item.progress}
                </Link>
              </li>
            ))}
            {merchantEmpty && (
              <li>
                <span>{IDENTITY_NO_MERCHANT_COPY}。</span>{' '}
                <Link href="/merchant/apply">申請店家進駐</Link>
              </li>
            )}
          </ul>
        </>
      )}
    </section>
  );
}
