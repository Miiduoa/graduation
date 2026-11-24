'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  ASSISTANT_EXPERIENCE_CATEGORIES,
  filterAssistantExperiences,
  type AssistantExperience,
  type AssistantExperienceCategory,
} from '@campus/shared/src/assistantExperiences';
import {
  ASSISTANT_ROLE_WORKFLOWS,
  assistantTaskProfileForWorkContext,
  getAssistantRoleWorkflow,
  type AssistantWorkContext,
} from '@campus/shared/src/assistantRoleWorkflows';
import { getAssistantService } from '@campus/shared/src/assistantServices';
import { CampusIcon, type CampusIconName } from './CampusIcon';
import { useSchoolLmsReadonlyEnabled } from './SchoolLmsReadonlyProvider';
import { campusServiceHref, useCampusNavigationSearch } from '@/lib/campusNavigation';
import { flattenCampusServices, presentCampusService, SERVICE_ACCESS } from '@/lib/campusServices';
import styles from './ExploreExperiences.module.css';

type Filters = {
  category: AssistantExperienceCategory | 'all';
  workContext: AssistantWorkContext | 'all';
  query: string;
};

const categoryIcons: Record<AssistantExperienceCategory, CampusIconName> = {
  plan: 'calendar',
  study: 'course',
  campus: 'map',
  connect: 'people',
  work: 'services',
};

function readFilters(search: URLSearchParams): Filters {
  const category = search.get('category');
  const workContext = search.get('workContext');
  return {
    category: ASSISTANT_EXPERIENCE_CATEGORIES.some((item) => item.id === category)
      ? (category as AssistantExperienceCategory)
      : 'all',
    workContext: ASSISTANT_ROLE_WORKFLOWS.some((item) => item.id === workContext)
      ? (workContext as AssistantWorkContext)
      : 'all',
    query: Array.from(search.get('q') ?? '')
      .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
      .join('')
      .slice(0, 100),
  };
}

function experienceHref(
  experience: AssistantExperience,
  scope: string,
  context: Filters['workContext'],
) {
  const workContext =
    experience.workContext === 'all'
      ? context === 'all'
        ? 'student'
        : context
      : experience.workContext;
  const search = new URLSearchParams({
    q: experience.prompt,
    taskProfile: assistantTaskProfileForWorkContext(workContext),
  });
  return campusServiceHref(`/ai-assistant?${search}`, scope);
}

export function ExploreExperiences() {
  const params = useSearchParams();
  const queryString = params?.toString() ?? '';
  const campusSearch = useCampusNavigationSearch(params);
  const schoolLmsEnabled = useSchoolLmsReadonlyEnabled();
  const id = useId();
  const searchInput = useRef<HTMLInputElement>(null);
  const [selection, setSelection] = useState(() => ({
    queryString,
    filters: readFilters(new URLSearchParams(queryString)),
    pendingUrls: [] as string[],
  }));
  const acknowledgedIndex = selection.pendingUrls.indexOf(queryString);
  const filters =
    selection.queryString === queryString || acknowledgedIndex >= 0
      ? selection.filters
      : readFilters(new URLSearchParams(queryString));
  if (selection.queryString !== queryString) {
    setSelection({
      queryString,
      filters,
      pendingUrls: acknowledgedIndex >= 0 ? selection.pendingUrls.slice(acknowledgedIndex + 1) : [],
    });
  }

  useEffect(() => {
    function restoreFilters() {
      const source = window.location.search.slice(1);
      setSelection((current) => ({
        ...current,
        filters: readFilters(new URLSearchParams(source)),
        pendingUrls: current.queryString === source ? [] : [source],
      }));
    }
    window.addEventListener('popstate', restoreFilters);
    return () => window.removeEventListener('popstate', restoreFilters);
  }, []);

  function updateFilters(next: Filters) {
    const search = new URLSearchParams(queryString);
    for (const key of ['school', 'schoolId', 'campus']) search.delete(key);
    new URLSearchParams(campusSearch).forEach((value, key) => search.set(key, value));
    if (next.category === 'all') search.delete('category');
    else search.set('category', next.category);
    if (next.workContext === 'all') search.delete('workContext');
    else search.set('workContext', next.workContext);
    if (next.query) search.set('q', next.query);
    else search.delete('q');
    const nextQuery = search.toString();
    setSelection((current) => ({
      queryString,
      filters: next,
      pendingUrls: [...current.pendingUrls, nextQuery].slice(-20),
    }));
    try {
      window.history.replaceState(
        window.history.state,
        '',
        `/explore${nextQuery ? `?${nextQuery}` : ''}`,
      );
    } catch {
      // Filtering remains usable when browser history is unavailable.
    }
  }

  const experiences = filterAssistantExperiences(filters);
  const services = flattenCampusServices(schoolLmsEnabled).map(presentCampusService);
  const filtering =
    filters.category !== 'all' || filters.workContext !== 'all' || Boolean(filters.query.trim());

  return (
    <div className={styles.explore}>
      <section className={styles.finder} aria-label="篩選探索內容">
        <div className={styles.finderRow}>
          <label className={styles.searchField}>
            <CampusIcon name="search" size={20} />
            <span className={styles.srOnly}>尋找想做的事</span>
            <input
              ref={searchInput}
              type="search"
              value={filters.query}
              placeholder="試試作業、午餐、活動…"
              maxLength={100}
              onChange={(event) => updateFilters({ ...filters, query: event.target.value })}
            />
          </label>
          <label className={styles.roleField}>
            <span>工作情境</span>
            <span className={styles.selectWrap}>
              <select
                value={filters.workContext}
                onChange={(event) =>
                  updateFilters({
                    ...filters,
                    workContext: event.target.value as Filters['workContext'],
                  })
                }
              >
                <option value="all">所有情境</option>
                {ASSISTANT_ROLE_WORKFLOWS.map((workflow) => (
                  <option key={workflow.id} value={workflow.id}>
                    {workflow.label}
                  </option>
                ))}
              </select>
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">
                <path
                  d="m4 6 4 4 4-4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </label>
        </div>
        <div className={styles.categories} role="group" aria-label="想做的事">
          <button
            type="button"
            aria-pressed={filters.category === 'all'}
            onClick={() => updateFilters({ ...filters, category: 'all' })}
          >
            全部
          </button>
          {ASSISTANT_EXPERIENCE_CATEGORIES.map((category) => (
            <button
              key={category.id}
              type="button"
              aria-pressed={filters.category === category.id}
              onClick={() => updateFilters({ ...filters, category: category.id })}
            >
              {category.label}
            </button>
          ))}
        </div>
        <div className={styles.resultsSummary}>
          <p role="status">{experiences.length} 個可以開始的起點</p>
          <Link className={styles.serviceLink} href={campusServiceHref('/search', campusSearch)}>
            查看所有服務
          </Link>
          {filtering && (
            <button
              type="button"
              onClick={() => {
                updateFilters({ category: 'all', workContext: 'all', query: '' });
                searchInput.current?.focus({ preventScroll: true });
              }}
            >
              清除篩選
            </button>
          )}
        </div>
      </section>

      {experiences.length === 0 ? (
        <section className={styles.empty} aria-labelledby={`${id}-empty`}>
          <h2 id={`${id}-empty`}>換個關鍵字試試看</h2>
          <p>可以試試「課表」「餐廳」或「社團」，也能直接到服務目錄尋找。</p>
          <Link href={campusServiceHref('/search', campusSearch)}>開啟服務目錄</Link>
        </section>
      ) : (
        ASSISTANT_EXPERIENCE_CATEGORIES.map((category) => {
          const items = experiences.filter((experience) => experience.category === category.id);
          if (!items.length) return null;
          return (
            <section
              key={category.id}
              className={styles.category}
              aria-labelledby={`${id}-${category.id}`}
            >
              <div className={styles.categoryHeading}>
                <h2 id={`${id}-${category.id}`}>{category.label}</h2>
                <p>{category.description}</p>
              </div>
              <div className={styles.grid}>
                {items.map((experience) => {
                  const service = getAssistantService(experience.serviceId);
                  const availableService = service
                    ? services.find((item) => item.href === service.href)
                    : undefined;
                  return (
                    <article
                      key={experience.id}
                      className={styles.card}
                      aria-labelledby={`${id}-${experience.id}`}
                    >
                      <div className={styles.cardMeta}>
                        <span className={styles.icon}>
                          <CampusIcon name={categoryIcons[category.id]} size={23} />
                        </span>
                        <span>
                          {experience.workContext === 'all'
                            ? '校園日常'
                            : getAssistantRoleWorkflow(experience.workContext).label}
                        </span>
                      </div>
                      <h3 id={`${id}-${experience.id}`}>{experience.title}</h3>
                      <p className={styles.description}>{experience.description}</p>
                      <div className={styles.cardActions}>
                        <Link
                          className={styles.tryLink}
                          href={experienceHref(experience, campusSearch, filters.workContext)}
                          aria-label={`試著問 nuni：${experience.title}`}
                        >
                          試著問 nuni
                        </Link>
                        {availableService && (
                          <Link
                            className={styles.directLink}
                            href={campusServiceHref(availableService.href, campusSearch)}
                            aria-label={`開啟相關服務：${availableService.name}`}
                          >
                            開啟相關服務
                          </Link>
                        )}
                      </div>
                      {availableService && (
                        <p className={styles.access}>{SERVICE_ACCESS[availableService.access]}</p>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })
      )}
      <p className={styles.footnote}>
        範例會先放進問題欄，送出前可以修改。需要的資料與權限，會在接續操作時確認。
      </p>
    </div>
  );
}
