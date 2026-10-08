'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useSelectedSchool } from './SelectedSchoolProvider';
import { Button } from './ui/Button';
import { Input, Select } from './ui/Input';
import styles from './SchoolSelector.module.css';

export function SchoolSelector({ compact = false }: { compact?: boolean }) {
  const selection = useSelectedSchool();
  const [query, setQuery] = useState('');
  const menu = useRef<HTMLDetailsElement>(null);
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
  const needle = query.trim().toLocaleLowerCase('zh-TW');
  const results = selection.schools.filter((school) =>
    [school.name, school.shortName, school.code].some((value) =>
      value?.toLocaleLowerCase('zh-TW').includes(needle),
    ),
  );
  const visible =
    selection.selectedSchool && !results.some((school) => school.id === selection.selectedSchoolId)
      ? [selection.selectedSchool, ...results]
      : results;
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
            label="搜尋校園"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="學校名稱或簡稱"
          />
          <Select
            label="瀏覽校園"
            value={selection.selectedSchoolId ?? ''}
            onChange={(event) => selection.selectSchool(event.target.value || null)}
            aria-describedby={`${id}-description`}
            options={[
              { value: '', label: '不限校園' },
              ...visible.map((school) => ({
                value: school.id,
                label: `${school.name}${school.status === 'not-open' ? '（校務尚未開通）' : ''}`,
              })),
            ]}
          />
          {selection.selectedSchool?.status === 'not-open' && (
            <p className={styles.state}>
              此校目前可瀏覽公開交流，校務服務尚未開通。選擇校園不會取得校務資料權限。
            </p>
          )}
          {needle && results.length === 0 && (
            <p role="status" className={styles.state}>
              找不到符合的校園，請試試其他名稱。
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
      className={styles.compact}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.currentTarget.open = false;
          event.currentTarget.querySelector('summary')?.focus();
        }
      }}
    >
      <summary>
        瀏覽校園：
        {selection.selectedSchool?.shortName || selection.selectedSchool?.name || '不限校園'}
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
