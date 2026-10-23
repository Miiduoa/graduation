'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useSelectedSchool } from './SelectedSchoolProvider';
import { filterSchools, normalizeSchoolQuery } from './SchoolSelector.search';
import { Button } from './ui/Button';
import { Input, Select } from './ui/Input';
import styles from './SchoolSelector.module.css';

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
  const results = filterSchools(selection.schools, query);
  const pinned =
    selection.selectedSchool && !results.some((school) => school.id === selection.selectedSchoolId)
      ? selection.selectedSchool
      : null;
  const visible = pinned ? [pinned, ...results] : results;

  function closeMenu() {
    if (menu.current?.open) {
      menu.current.open = false;
      menu.current.querySelector('summary')?.focus();
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
          <Select
            label="瀏覽校園"
            value={selection.selectedSchoolId ?? ''}
            onChange={(event) => {
              selection.selectSchool(event.target.value || null);
              closeMenu();
            }}
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
      <div className={styles.popover}>{content}</div>
    </details>
  ) : (
    <section className={styles.panel} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>選擇瀏覽校園</h2>
      {content}
    </section>
  );
}
