'use client';

import { useId } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { campusServiceHref, useCampusNavigationSearch } from '@/lib/campusNavigation';
import { PRIMARY_DESTINATIONS, primaryNavigationSection } from '@/lib/primaryNavigation';
import { CampusIcon } from './CampusIcon';
import { Button } from './ui/Button';
import styles from './PageRecovery.module.css';

type Props = { kind: 'missing' } | { kind: 'error'; onRetry: () => void };

/** Recovery uses known destinations, never an arbitrary return URL or browser history. */
export function PageRecovery(props: Props) {
  const headingId = useId();
  const pathname = usePathname();
  const params = useSearchParams();
  const campusSearch = useCampusNavigationSearch(params);
  const section = PRIMARY_DESTINATIONS.find(
    (item) => item.id === primaryNavigationSection(pathname),
  );
  // Retrying a broken section root should remain an explicit action. Its
  // alternative must go somewhere else, not open the same failing route.
  const destination =
    section && section.href !== pathname
      ? section
      : pathname === '/'
        ? { href: '/search', label: '校園服務', icon: 'services' as const }
        : PRIMARY_DESTINATIONS[0];
  const missing = props.kind === 'missing';

  return (
    <section className={styles.recovery} aria-labelledby={headingId}>
      <div className={styles.symbol} aria-hidden="true">
        <CampusIcon name={missing ? 'search' : 'support'} size={26} />
      </div>
      <p className={styles.eyebrow}>{missing ? '連結無法使用' : '頁面載入中斷'}</p>
      <h1 id={headingId}>{missing ? '找不到這個頁面' : '這個頁面暫時打不開'}</h1>
      <p className={styles.description}>
        {missing
          ? '連結可能已變更，或內容已移除。從原本的服務繼續找找。'
          : '請重新載入，或先回到原本的服務繼續操作。'}
      </p>
      <div className={styles.actions}>
        {props.kind === 'error' && (
          <Button type="button" variant="primary" onClick={() => props.onRetry()}>
            重新載入
          </Button>
        )}
        <Link
          href={campusServiceHref(destination.href, campusSearch)}
          className={`${styles.returnLink} ${missing ? styles.primary : ''}`}
        >
          <CampusIcon name={destination.icon} size={18} />
          返回{destination.label}
        </Link>
      </div>
      {destination.href !== '/search' && pathname !== '/search' && (
        <div className={styles.alternative}>
          <Link href={campusServiceHref('/search', campusSearch)}>
            查看全部校園服務
            <CampusIcon name="arrow" size={16} />
          </Link>
        </div>
      )}
    </section>
  );
}
