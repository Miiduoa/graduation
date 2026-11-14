'use client';
import { ClubPortal } from './ClubPortal';
import { useState, type ReactNode } from 'react';
import styles from './groups.module.css';

export function ClubDirectory({
  children,
  uid,
  schoolId,
}: {
  children: ReactNode;
  uid?: string;
  schoolId?: string;
}) {
  const [revision, setRevision] = useState(0);
  const [segment, setSegment] = useState<'mine' | 'discover'>('mine');
  return (
    <div className={styles.page}>
      <div role="group" aria-label="社團分段" className={styles.actions}>
        <button
          className="btn"
          aria-pressed={segment === 'mine'}
          onClick={() => {
            setSegment('mine');
          }}
        >
          我的社團
        </button>
        <button
          className="btn"
          aria-pressed={segment === 'discover'}
          onClick={() => {
            setSegment('discover');
          }}
        >
          找社團
        </button>
      </div>
      <div key={revision} hidden={segment !== 'mine'}>
        {children}
      </div>
      {segment === 'discover' && (
        <>
          {uid && schoolId ? (
            <ClubPortal uid={uid} schoolId={schoolId} onChanged={() => setRevision((v) => v + 1)} />
          ) : (
            <p>請先登入本校帳號。</p>
          )}
        </>
      )}
      <p className={styles.availability}>
        「我的社團」列出已加入的群組，是否為正式社團仍以課外組名單為準。
      </p>
    </div>
  );
}
