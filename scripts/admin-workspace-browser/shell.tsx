import React from 'react';
import styles from '@/app/home.module.css';

/** Preserve the real page geometry; peripheral school/student chrome is out of scope. */
export function SiteShell({
  header,
  title,
  children,
}: {
  header?: React.ReactNode;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.page}>
      <a className={styles.skip} href="#page-content">跳到主要內容</a>
      {header}
      <main id="page-content" className={styles.main} tabIndex={-1}>
        {title ? <h1>{title}</h1> : null}
        {children}
      </main>
    </div>
  );
}
