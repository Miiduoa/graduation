'use client';
import { ClubPortal } from './ClubPortal';
import { useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import styles from './groups.module.css';

export function ClubDirectory({
  children,
  uid,
  schoolId,
  tab,
}: {
  children: ReactNode;
  uid: string;
  schoolId: string;
  tab?: 'mine' | 'discover';
}) {
  const [segment, setSegment] = useState<'mine' | 'discover'>(tab === 'discover' ? 'discover' : 'mine');
  const router = useRouter();
  const params = useSearchParams();
  const updateSegment = (next: 'mine' | 'discover') => {
    setSegment(next);
    const query = new URLSearchParams(params.toString());
    query.set('schoolId', schoolId);
    query.set('tab', next);
    router.replace(`/clubs?${query.toString()}`);
  };
  return (
    <div className={styles.page}>
      <div role="group" aria-label="社團分段" className={styles.actions}>
        <button
          className="btn"
          aria-pressed={segment === 'mine'}
          onClick={() => {
            updateSegment('mine');
          }}
        >
          我的社團
        </button>
        <button
          className="btn"
          aria-pressed={segment === 'discover'}
          onClick={() => {
            updateSegment('discover');
          }}
        >
          找社團
        </button>
      </div>
      <div hidden={segment !== 'mine'}>{children}</div>
      {segment === 'discover' && (
        <>
          <ClubPortal key={`${uid}:${schoolId}`} uid={uid} schoolId={schoolId} />
        </>
      )}
      <p className={styles.availability}>
        「我的社團」列出已加入的群組，是否為正式社團仍以課外組名單為準。
      </p>
    </div>
  );
}
