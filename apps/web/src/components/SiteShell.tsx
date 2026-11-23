'use client';

import { Suspense } from 'react';
import { AppFrame } from './AppFrame';
import { SiteFooter } from './SiteFooter';
import styles from '@/app/home.module.css';
import { SchoolDataScope } from './SchoolDataScope';
import { AccountDemoFeature } from './AccountDemoFeature';
import { AcademicNavigation } from './academic/AcademicNavigation';
import { ServiceBreadcrumbs } from './ServiceBreadcrumbs';

export function SiteShell(props: {
  header?: React.ReactNode;
  title?: string;
  subtitle?: string;
  schoolName?: string;
  schoolCode?: string;
  compactHeading?: boolean;
  children: React.ReactNode;
}) {
  return (
    <AppFrame
      header={props.header}
      mainClassName={props.compactHeading ? `${styles.main} ${styles.mainMap}` : styles.main}
    >
      <Suspense fallback={null}>
        <ServiceBreadcrumbs title={props.title} />
      </Suspense>
      {props.title && (
        <div
          className={
            props.compactHeading ? `${styles.heading} ${styles.headingMap}` : styles.heading
          }
        >
          <div>
            {props.schoolName && <p className={styles.eyebrow}>{props.schoolName}</p>}
            <h1>{props.title}</h1>
            {props.subtitle && <p className={styles.intro}>{props.subtitle}</p>}
          </div>
        </div>
      )}
      {props.schoolName && <SchoolDataScope schoolName={props.schoolName} />}
      <Suspense fallback={null}>
        <AcademicNavigation />
        <AccountDemoFeature />
      </Suspense>
      <Suspense fallback={<p role="status">載入中…</p>}>{props.children}</Suspense>
      <SiteFooter />
    </AppFrame>
  );
}
