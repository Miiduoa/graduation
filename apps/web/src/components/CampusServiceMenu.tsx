'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { CAMPUS_SERVICES, presentCampusService, SERVICE_CATEGORIES } from '@/lib/campusServices';
import { isWebOnlineOrderingEnabled, ONLINE_ORDERING_OFF_TEXT } from '@/lib/onlineOrdering';
import styles from '@/app/home.module.css';
import { campusServiceHref, useCampusNavigationSearch } from '@/lib/campusNavigation';

export function CampusServiceMenu() {
  const pathname = usePathname();
  const currentService = CAMPUS_SERVICES.filter(
    (service) => pathname === service.href || pathname?.startsWith(`${service.href}/`),
  ).sort((first, second) => second.href.length - first.href.length)[0]?.href;
  const params = useSearchParams();
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function dismiss(event: PointerEvent) {
      const element = menu.current;
      if (element?.open && event.target instanceof Node && !element.contains(event.target)) {
        element.open = false;
      }
    }
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);
  const context = useCampusNavigationSearch(params);
  const href = (path: string) => campusServiceHref(path, context);
  return (
    <details
      ref={menu}
      className={styles.menu}
      key={pathname}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && event.currentTarget.open) {
          event.preventDefault();
          event.currentTarget.open = false;
          event.currentTarget.querySelector('summary')?.focus();
        }
      }}
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          event.currentTarget.open = false;
        }
      }}
    >
      <summary>所有服務</summary>
      <div className={styles.menuPanel}>
        <Link
          href={href('/search')}
          className={styles.menuOverview}
          aria-current={pathname === '/search' ? 'page' : undefined}
          onClick={() => {
            if (menu.current) menu.current.open = false;
          }}
        >
          尋找校園服務 <span aria-hidden="true">→</span>
        </Link>
        {SERVICE_CATEGORIES.map((category) => (
          <section key={category.id} className={styles.menuGroup} aria-label={category.label}>
            <h2>{category.label}</h2>
            {CAMPUS_SERVICES.filter((service) => service.category === category.id).map(
              (service) => {
                const shown = presentCampusService(service);
                return (
                  <div key={shown.href}>
                    <Link
                      href={href(shown.href)}
                      aria-current={currentService === shown.href ? 'page' : undefined}
                      onClick={() => {
                        if (menu.current) menu.current.open = false;
                      }}
                    >
                      {shown.name}
                      <span aria-hidden="true">→</span>
                    </Link>
                    {shown.href === '/food' && !isWebOnlineOrderingEnabled() ? (
                      <p>{ONLINE_ORDERING_OFF_TEXT}</p>
                    ) : null}
                  </div>
                );
              },
            )}
          </section>
        ))}
      </div>
    </details>
  );
}
