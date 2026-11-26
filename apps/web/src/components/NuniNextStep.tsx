'use client';

import { useId, type ReactNode } from 'react';
import styles from './NuniNextStep.module.css';

export function NuniNextStep({ reason, children }: { reason: string; children: ReactNode }) {
  const heading = useId();
  return (
    <section className={styles.panel} aria-labelledby={heading}>
      <h3 className={styles.heading} id={heading}>
        nuni 建議
      </h3>
      <p className={styles.reason}>{reason}</p>
      <div className={styles.action}>{children}</div>
    </section>
  );
}
