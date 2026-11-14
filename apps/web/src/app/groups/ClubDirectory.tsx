'use client';
import { useState, type ReactNode } from 'react';
import styles from './groups.module.css';

export function ClubDirectory({ children }: { children: ReactNode }) {
  const [segment, setSegment] = useState<'mine' | 'discover'>('mine');
  const [search, setSearch] = useState('');
  return (
    <div className={styles.page}>
      <div role="group" aria-label="社團分段" className={styles.actions}>
        <button
          className="btn"
          aria-pressed={segment === 'mine'}
          onClick={() => {
            setSegment('mine');
            setSearch('');
          }}
        >
          我的社團
        </button>
        <button
          className="btn"
          aria-pressed={segment === 'discover'}
          onClick={() => {
            setSegment('discover');
            setSearch('');
          }}
        >
          找社團
        </button>
      </div>
      <div hidden={segment !== 'mine'}>{children}</div>
      {segment === 'discover' && (
        <>
          <label className={styles.field}>
            搜尋學校社團
            <input
              type="search"
              placeholder="名稱或介紹"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <section className={styles.status}>
            <h2>學校還沒提供社團名單。</h2>
            <p>尚未串接課外組核可名單，因此這裡不列出一般群組，也不提供入社或申請。</p>
          </section>
        </>
      )}
      <p className={styles.availability}>
        「我的社團」列出已加入的群組，是否為正式社團仍以課外組名單為準。
      </p>
      <p>這所學校還沒開放社團管理。</p>
    </div>
  );
}
