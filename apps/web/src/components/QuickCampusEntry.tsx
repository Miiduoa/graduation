'use client';

import Link from 'next/link';
import { useState } from 'react';
import { buildCampusNavigationSearch, campusServiceHref } from '@/lib/campusNavigation';
import { useOptionalSelectedSchool } from './SelectedSchoolProvider';
import { VoiceDictationButton } from './VoiceDictationButton';
import { CampusIcon } from './CampusIcon';
import { getQuickCampusActions, QUICK_CAMPUS_EXAMPLES } from '@/lib/quickCampusActions';
import styles from './QuickCampusEntry.module.css';

export function QuickCampusEntry() {
  const selection = useOptionalSelectedSchool();
  const selected = selection?.selectedSchool;
  const campusSearch = buildCampusNavigationSearch(
    null,
    selected ? { id: selected.id, code: selected.code } : null,
    Boolean(selection && !selection.loading && selection.catalogStatus === 'ready'),
  );
  const [query, setQuery] = useState('');
  const phrase = query.trim();
  const actions = getQuickCampusActions(phrase);
  const route = (href: string) => campusServiceHref(href, campusSearch);
  const searchHref = route('/search' + (phrase ? '?q=' + encodeURIComponent(phrase.slice(0, 100)) : ''));
  const assistantHref = route('/ai-assistant?q=' + encodeURIComponent(phrase.slice(0, 4000)));

  return (
    <section className={styles.entry} aria-labelledby="quick-entry-title">
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>快速開始</p>
          <h2 id="quick-entry-title">說出想做的事，直接找到入口。</h2>
          <p className={styles.subtitle}>不必記住功能在哪。你可以打字，也可以用麥克風說話。</p>
        </div>
        <Link className={styles.allServices} href={route('/search')}>
          所有服務 <CampusIcon name="arrow" size={16} />
        </Link>
      </div>
      <div className={styles.inputRow}>
        <label className={styles.srOnly} htmlFor="quick-campus-input">想做什麼？</label>
        <CampusIcon name="search" size={20} />
        <input
          id="quick-campus-input"
          type="search"
          autoComplete="off"
          maxLength={160}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="例如：今天有哪些課？公車多久會到？"
        />
        <VoiceDictationButton onTranscript={setQuery} />
      </div>
      {!phrase ? (
        <div className={styles.examples} aria-label="常用需求">
          {QUICK_CAMPUS_EXAMPLES.map((example) => (
            <button key={example} type="button" onClick={() => setQuery(example)}>
              {example}
            </button>
          ))}
        </div>
      ) : (
        <div className={styles.results} aria-live="polite">
          {actions.length ? (
            <>
              <p className={styles.resultHeading}>建議下一步</p>
              <div className={styles.actionGrid}>
                {actions.map((action) => (
                  <Link key={action.href} href={route(action.href)} className={styles.action}>
                    <span>
                      <strong>{action.name}</strong>
                      <small>{action.text}</small>
                    </span>
                    <CampusIcon name="arrow" size={18} />
                  </Link>
                ))}
              </div>
            </>
          ) : (
            <p className={styles.noMatch}>還沒有找到直接對應的服務，可繼續搜尋或詢問助理。</p>
          )}
          <div className={styles.footerLinks}>
            <Link href={searchHref}>搜尋更多服務</Link>
            <Link href={assistantHref}>詢問校園助理</Link>
            <button type="button" onClick={() => setQuery('')}>重新輸入</button>
          </div>
        </div>
      )}
      <p className={styles.privacy}>語音只會先填入文字，確認後才前往服務；需要提交、付款或更改資料時仍須在服務頁面確認。語音辨識可能由瀏覽器供應商處理。</p>
    </section>
  );
}
