'use client';
import { ClubPortal } from './ClubPortal';
import { clubEnabled } from './clubService';
import { useState, type ReactNode } from 'react';
import styles from './groups.module.css';

export function ClubDirectory({
  children,
  uid,
  schoolId,
}: {
  children: ReactNode;
  uid: string;
  schoolId: string;
}) {
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
      <div hidden={segment !== 'mine'}>{children}</div>
      {segment === 'discover' && (
        <>
          <ClubPortal key={`${uid}:${schoolId}`} uid={uid} schoolId={schoolId} />
        </>
      )}
      <p className={styles.availability}>
        「我的社團」列出已加入的群組，是否為正式社團仍以課外組名單為準。
      </p>
      {!clubEnabled() && <p>這所學校還沒開放社團管理。</p>}
    </div>
  );
}
