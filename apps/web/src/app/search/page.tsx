'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import styles from './search.module.css';
import { CAMPUS_SERVICES, SERVICE_CATEGORIES, type ServiceCategory } from '@/lib/campusServices';

export default function SearchPage(props: {
  searchParams?: Promise<{ school?: string; schoolId?: string }>;
}) {
  const searchParams = props.searchParams ? use(props.searchParams) : undefined;
  const { schoolName, schoolSearch } = resolveSchoolPageContext(searchParams);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ServiceCategory | 'all'>('all');
  const term = query.trim().toLocaleLowerCase();
  const matches = CAMPUS_SERVICES.filter(
    (service) =>
      (category === 'all' || service.category === category) &&
      `${service.name} ${service.text} ${service.keywords}`.toLocaleLowerCase().includes(term),
  );
  function resetFilters() {
    setQuery('');
    setCategory('all');
  }
  return (
    <SiteShell
      title="所有服務"
      subtitle="從今天要做的事，找到需要的校園服務。"
      schoolName={schoolName}
    >
      <div className={styles.directory}>
        <section className={styles.searchPanel} aria-label="尋找服務">
          <label htmlFor="service-search">想找什麼？</label>
          <input
            id="service-search"
            className={styles.searchInput}
            type="search"
            value={query}
            maxLength={100}
            placeholder="課表、借書、公車…"
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className={styles.filters} role="group" aria-label="服務分類">
            {[{ id: 'all', label: '全部' }, ...SERVICE_CATEGORIES].map((item) => (
              <button
                type="button"
                key={item.id}
                aria-pressed={category === item.id}
                onClick={() => setCategory(item.id as ServiceCategory | 'all')}
              >
                {item.label}
              </button>
            ))}
          </div>
        </section>
        <div className={styles.resultSummary}>
          <p role="status" aria-live="polite">
            找到 {matches.length} 項服務
          </p>
          {(term || category !== 'all') && (
            <button type="button" onClick={resetFilters}>
              清除篩選
            </button>
          )}
        </div>
        {matches.length ? (
          SERVICE_CATEGORIES.map((group) => {
            const services = matches.filter((service) => service.category === group.id);
            if (!services.length) return null;
            return (
              <section
                className={styles.category}
                key={group.id}
                aria-labelledby={`category-${group.id}`}
              >
                <div className={styles.categoryHeading}>
                  <h2 id={`category-${group.id}`}>{group.label}</h2>
                  <p>{group.description}</p>
                </div>
                <div className={styles.services}>
                  {services.map((service) => (
                    <Link
                      key={service.href}
                      className={styles.service}
                      href={`${service.href}${schoolSearch}`}
                    >
                      <div>
                        <h3>{service.name}</h3>
                        <p>{service.text}</p>
                      </div>
                      <span aria-hidden="true">↗</span>
                    </Link>
                  ))}
                </div>
              </section>
            );
          })
        ) : (
          <section className={styles.empty}>
            <h2>沒有符合的服務</h2>
            <p>試試「課表」或「公車」等關鍵字，也可以清除篩選，查看所有服務。</p>
            <button type="button" className="btn primary" onClick={resetFilters}>
              查看所有服務
            </button>
          </section>
        )}
      </div>
    </SiteShell>
  );
}
