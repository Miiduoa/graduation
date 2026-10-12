'use client';

import Link from 'next/link';
import { useOptionalNuniSession } from '@/features/nuni/Session';
import { useSignInOptions } from '@/lib/signInOptions';
import styles from '@/components/academic/academic.module.css';

export const SCHOOL_FEATURE_CLOSED_COPY = '這個功能還沒接通';
export const SCHOOL_ACCOUNT_REQUIRED_COPY = '這個功能要用學校帳號登入才能用';
// 學校帳號登入只換掉學校那一邊的身分，不會動到 Google 帳號；課表另外記在這台瀏覽器
export const SWITCH_TO_SCHOOL_COPY =
  '改用學校帳號登入不會登出你的 Google 帳號，這台瀏覽器上的課表也會留著。';

/** 申訴、找人、空堂邀約、老師工作台這些只認學校帳號的功能。學號未開通時不打開會失敗的表單。 */
export function SchoolAccountRequired({
  returnUrl,
  alternative,
  headingLevel = 2,
}: {
  returnUrl: string;
  alternative: string;
  headingLevel?: 2 | 3;
}) {
  const nuni = useOptionalNuniSession();
  const options = useSignInOptions();
  const google = !!nuni?.session;
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  if (options.loading) {
    return (
      <section className={styles.panel} aria-label="需要學校帳號">
        <p className={styles.notice} role="status">
          正在確認這項功能…
        </p>
      </section>
    );
  }
  if (!options.studentId) {
    return (
      <section className={styles.panel} aria-label="功能還沒接通">
        <Heading>{SCHOOL_FEATURE_CLOSED_COPY}</Heading>
        <p className={styles.notice}>{alternative}</p>
      </section>
    );
  }
  return (
    <section className={styles.panel} aria-label="需要學校帳號">
      <Heading>{SCHOOL_ACCOUNT_REQUIRED_COPY}</Heading>
      {google && <p className={styles.notice}>{SWITCH_TO_SCHOOL_COPY}</p>}
      <Link className="btn primary" href={`/login?returnUrl=${encodeURIComponent(returnUrl)}`}>
        {google ? '改用學校帳號登入' : '用學校帳號登入'}
      </Link>
    </section>
  );
}
