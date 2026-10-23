'use client';

import Link from 'next/link';
import { CampusIcon } from './CampusIcon';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useId, useRef } from 'react';
import { CAMPUS_SERVICES, SERVICE_CATEGORIES } from '@/lib/campusServices';
import styles from './CampusServiceMenu.module.css';
import { campusServiceHref, useCampusNavigationSearch } from '@/lib/campusNavigation';

export function CampusServiceMenu() {
  const pathname = usePathname();
  const currentService = CAMPUS_SERVICES.filter(
    (service) => pathname === service.href || pathname?.startsWith(`${service.href}/`),
  ).sort((first, second) => second.href.length - first.href.length)[0]?.href;
  const params = useSearchParams();
  const menu = useRef<HTMLDetailsElement>(null);
  const id = useId();
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
  function closeMenu() {
    if (!menu.current?.open) return;
    menu.current.open = false;
    menu.current.querySelector('summary')?.focus({ preventScroll: true });
  }
  return (
    <details
      ref={menu}
      name="campus-navigation-popover"
      className={styles.menu}
      key={pathname}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.nativeEvent.isComposing && event.currentTarget.open) {
          event.preventDefault();
          event.stopPropagation();
          closeMenu();
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
      <summary aria-label="所有服務" aria-controls={`${id}-services`}>
        <CampusIcon name="services" size={17} />
        <span className={styles.desktopLabel} aria-hidden="true">
          所有服務
        </span>
        <span className={styles.mobileLabel} aria-hidden="true">
          更多
        </span>
      </summary>
      <div className={styles.menuPanel} id={`${id}-services`}>
        <div className={styles.menuHead}>
          <h2>校園服務</h2>
          <button
            type="button"
            className={styles.closeButton}
            aria-label="關閉所有服務"
            onClick={closeMenu}
          >
            <svg
              viewBox="0 0 24 24"
              width="19"
              height="19"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className={styles.menuContents}>
          <Link
            href={href('/search')}
            className={styles.menuOverview}
            aria-current={pathname === '/search' ? 'page' : undefined}
            onClick={closeMenu}
          >
            尋找校園服務 <span aria-hidden="true">→</span>
          </Link>
          {SERVICE_CATEGORIES.map((category) => (
            <section key={category.id} className={styles.menuGroup} aria-label={category.label}>
              <h2>{category.label}</h2>
              {CAMPUS_SERVICES.filter((service) => service.category === category.id).map(
                (service) => (
                  <Link
                    href={href(service.href)}
                    key={service.href}
                    aria-current={currentService === service.href ? 'page' : undefined}
                    onClick={closeMenu}
                  >
                    {service.name}
                    <span aria-hidden="true">→</span>
                  </Link>
                ),
              )}
            </section>
          ))}
        </div>
      </div>
    </details>
  );
}
