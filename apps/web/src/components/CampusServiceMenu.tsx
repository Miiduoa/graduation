'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { CAMPUS_SERVICES, SERVICE_CATEGORIES } from '@/lib/campusServices';
import styles from '@/app/home.module.css';

export function CampusServiceMenu() {
  const pathname = usePathname();
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
  const context = new URLSearchParams();
  for (const key of ['school', 'schoolId']) {
    const value = params?.get(key);
    if (value) context.set(key, value);
  }
  const href = (path: string) => `${path}${context.size ? `?${context}` : ''}`;
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
                  aria-current={
                    pathname === service.href || pathname?.startsWith(`${service.href}/`)
                      ? 'page'
                      : undefined
                  }
                  onClick={() => {
                    if (menu.current) menu.current.open = false;
                  }}
                >
                  {service.name}
                  <span aria-hidden="true">↗</span>
                </Link>
              ),
            )}
          </section>
        ))}
      </div>
    </details>
  );
}
