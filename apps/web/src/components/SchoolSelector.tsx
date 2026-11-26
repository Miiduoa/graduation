'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useSelectedSchool, type BrowseSchool } from './SelectedSchoolProvider';
import { CampusIcon } from './CampusIcon';
import { filterSchools, normalizeSchoolQuery, schoolSearchEntry } from './SchoolSelector.search';
import { matchingSchoolEnglishName } from '@campus/shared/src/schools';
import { Button } from './ui/Button';
import { Input, Select } from './ui/Input';
import styles from './SchoolSelector.module.css';

const INITIAL_MATCHES = 5;

function SchoolResultList({
  schools,
  query,
  selectedId,
  onChoose,
}: {
  schools: readonly BrowseSchool[];
  query: string;
  selectedId: string | null;
  onChoose: (id: string) => void;
}) {
  return (
    <ul className={styles.resultList} aria-label="符合的校園">
      {schools.map((school) => {
        const current = school.id === selectedId;
        const englishName = matchingSchoolEnglishName(school, query);
        const detail = [school.code, school.status === 'not-open' && '校務尚未開通']
          .filter(Boolean)
          .join(' · ');
        return (
          <li key={school.id}>
            <button
              type="button"
              className={styles.result}
              onClick={() => onChoose(school.id)}
              aria-current={current || undefined}
            >
              <span className={styles.schoolText}>
                <strong>{school.name}</strong>
                {englishName && <small lang="en">{englishName}</small>}
                {detail && <small>{detail}</small>}
              </span>
              {current ? (
                <span className={styles.current}>目前選擇</span>
              ) : (
                <CampusIcon name="arrow" size={16} />
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function SchoolSelector({
  compact = false,
  variant = 'browse',
}: {
  compact?: boolean;
  variant?: 'browse' | 'name';
}) {
  const selection = useSelectedSchool();
  const [query, setQuery] = useState('');
  const menu = useRef<HTMLDetailsElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const matches = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!compact) return;
    const dismiss = (event: PointerEvent) => {
      if (
        menu.current?.open &&
        event.target instanceof Node &&
        !menu.current.contains(event.target)
      ) {
        menu.current.open = false;
      }
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [compact]);

  const needle = normalizeSchoolQuery(query);
  const directory = useMemo(() => selection.schools.map(schoolSearchEntry), [selection.schools]);
  const results = filterSchools(directory, query);
  const pinned =
    selection.selectedSchool && !results.some((school) => school.id === selection.selectedSchoolId)
      ? selection.selectedSchool
      : null;
  const visible = pinned ? [pinned, ...results] : results;
  const hasMatches = Boolean(needle && results.length);

  function chooseSchool(schoolId: string | null) {
    selection.selectSchool(schoolId);
    closeMenu();
  }

  function closeMenu() {
    if (menu.current?.open) {
      menu.current.open = false;
      menu.current.querySelector('summary')?.focus({ preventScroll: true });
    }
  }

  const content = (
    <div className={styles.content}>
      <p id={`${id}-description`} className={styles.description}>
        選擇想瀏覽的校園。切換校園不會更換帳號或取得校務資料權限。
      </p>
      {selection.loading || selection.catalogStatus === 'loading' ? (
        <p role="status" className={styles.state}>
          正在載入校園目錄…
        </p>
      ) : selection.catalogStatus === 'error' ? (
        <div className={styles.state}>
          <p role="alert">{selection.catalogError || '目前無法讀取校園目錄，請稍後重試。'}</p>
          {selection.onRetryCatalog && (
            <Button type="button" onClick={selection.onRetryCatalog}>
              重新讀取目錄
            </Button>
          )}
        </div>
      ) : selection.schools.length === 0 ? (
        <p role="status" className={styles.state}>
          目前沒有可選擇的校園，請稍後再查看。
        </p>
      ) : (
        <>
          <Input
            ref={search}
            label="搜尋校園"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-keyshortcuts={hasMatches ? 'ArrowDown' : undefined}
            onKeyDown={(event) => {
              if (
                event.key !== 'ArrowDown' ||
                event.nativeEvent.isComposing ||
                event.nativeEvent.keyCode === 229 ||
                event.altKey ||
                event.ctrlKey ||
                event.metaKey ||
                event.shiftKey
              )
                return;
              const firstResult = matches.current?.querySelector('button');
              if (firstResult) {
                event.preventDefault();
                firstResult.focus();
              }
            }}
            placeholder="學校名稱、簡稱或代碼"
            autoComplete="off"
            maxLength={100}
            aria-describedby={`${id}-results`}
          />
          <div className={styles.searchFeedback}>
            <p
              id={`${id}-results`}
              role={needle ? 'status' : undefined}
              aria-live="polite"
              aria-label="校園搜尋結果"
              aria-atomic="true"
              className={styles.state}
            >
              {needle
                ? results.length
                  ? `找到 ${results.length} 所校園`
                  : '找不到符合的校園，請試試其他名稱。'
                : `共 ${results.length} 所校園可供瀏覽`}
            </p>
            {query && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setQuery('');
                  search.current?.focus();
                }}
              >
                清除搜尋
              </Button>
            )}
          </div>
          {hasMatches ? (
            <div ref={matches} className={styles.matches}>
              <SchoolResultList
                schools={results.slice(0, INITIAL_MATCHES)}
                query={query}
                selectedId={selection.selectedSchoolId}
                onChoose={chooseSchool}
              />
              {results.length > INITIAL_MATCHES && (
                <details key={needle} className={styles.more}>
                  <summary>其餘 {results.length - INITIAL_MATCHES} 所校園</summary>
                  <SchoolResultList
                    schools={results.slice(INITIAL_MATCHES)}
                    query={query}
                    selectedId={selection.selectedSchoolId}
                    onChoose={chooseSchool}
                  />
                </details>
              )}
              <div className={styles.browseScope}>
                <span>目前瀏覽：{selection.selectedSchool?.name || '不限校園'}</span>
                {selection.selectedSchoolId && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (!compact) search.current?.focus({ preventScroll: true });
                      chooseSchool(null);
                    }}
                  >
                    不限校園
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <>
              <Select
                label="瀏覽校園"
                value={selection.selectedSchoolId ?? ''}
                onChange={(event) => chooseSchool(event.target.value || null)}
                aria-describedby={`${id}-description${pinned ? ` ${id}-pinned` : ''}`}
                options={[
                  { value: '', label: '不限校園' },
                  ...visible.map((school) => ({
                    value: school.id,
                    label: `${school.name}${school.id === pinned?.id ? '（目前選擇）' : ''}${school.status === 'not-open' ? '（校務尚未開通）' : ''}`,
                  })),
                ]}
              />
              {pinned && (
                <p id={`${id}-pinned`} className={styles.state}>
                  目前選擇的校園不符合搜尋，已保留原選擇；搜尋不會自動切換校園。
                </p>
              )}
            </>
          )}
          {selection.selectedSchool?.status === 'not-open' && (
            <p className={styles.state}>
              此校目前可瀏覽公開交流，校務服務尚未開通。選擇校園不會取得校務資料權限。
            </p>
          )}
          {selection.selectionError && (
            <p role="status" className={styles.state}>
              {selection.selectionError}
            </p>
          )}
        </>
      )}
    </div>
  );

  return compact ? (
    <details
      ref={menu}
      name="campus-navigation-popover"
      className={styles.compact}
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          event.currentTarget.open = false;
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.nativeEvent.isComposing && event.currentTarget.open) {
          event.preventDefault();
          event.stopPropagation();
          closeMenu();
        }
      }}
    >
      <summary
        className={variant === 'name' ? styles.compactName : undefined}
        aria-controls={`${id}-picker`}
        aria-label={
          variant === 'name'
            ? `切換校園：${selection.selectedSchool?.name || '不限校園'}`
            : undefined
        }
      >
        {variant === 'name'
          ? selection.selectedSchool?.name || '不限校園'
          : `瀏覽校園：${selection.selectedSchool?.shortName || selection.selectedSchool?.name || '不限校園'}`}
        {selection.selectedSchool?.status === 'not-open' ? '（校務尚未開通）' : ''}
      </summary>
      <div className={styles.popover} id={`${id}-picker`}>
        <div className={styles.popoverHead}>
          <h2>瀏覽校園</h2>
          <button
            type="button"
            className={styles.closeButton}
            aria-label="關閉校園選擇"
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
        {content}
      </div>
    </details>
  ) : (
    <section className={styles.panel} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>選擇瀏覽校園</h2>
      {content}
    </section>
  );
}
