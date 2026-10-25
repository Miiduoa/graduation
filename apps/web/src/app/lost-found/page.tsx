'use client';

import { use, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { SchoolScopePlaceholder } from '@/components/SchoolScopePlaceholder';
import { useAuth } from '@/components/AuthGuard';
import { LoginRequiredLostFoundComments } from '@/components/LoginRequiredLostFoundComments';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { useBrowsingSchoolPageContext } from '@/lib/useBrowsingSchoolPageContext';
import {
  categoryLabel,
  formatLostFoundCalendarDate,
  listLostFoundItems,
  statusLabel,
  typeLabel,
  type LostFoundItem,
} from '@/lib/lostFound';
import {
  DEFAULT_LOST_FOUND_FILTERS,
  describeLostFoundFilterScope,
  filterLostFoundItems,
  type LostFoundListFilters,
} from '@/lib/lostFoundFilters';
import { isPermissionDeniedError } from '@campus/shared/src/signedInSocialReads';
import styles from '@/components/lost-found/LostFound.module.css';

/** Bound DOM rows; filters still run over the complete loaded collection. */
const VISIBLE_PAGE_SIZE = 50;

export default function LostFoundPage(props: {
  searchParams?: Promise<{ schoolId?: string; school?: string; campus?: string }>;
}) {
  const search = props.searchParams ? use(props.searchParams) : undefined;
  const context = useBrowsingSchoolPageContext(search);
  const { user } = useAuth();
  if (!context.ready) {
    return (
      <SiteShell title="失物招領">
        <SchoolScopePlaceholder />
      </SiteShell>
    );
  }
  return (
    <LostFoundPageContent
      key={`${user?.uid ?? 'signed-out'}:${context.schoolId}`}
      context={context}
    />
  );
}

function LostFoundPageContent({
  context,
}: {
  context: ReturnType<typeof useBrowsingSchoolPageContext>;
}) {
  const { user, loading: authLoading } = useAuth();
  const uid = user?.uid ?? null;
  const signedIn = Boolean(uid);
  const loginReturnUrl = `/lost-found?schoolId=${encodeURIComponent(context.schoolId)}`;
  const filterId = useId();
  const [items, setItems] = useState<LostFoundItem[] | undefined>(undefined);
  const [error, setError] = useState('');
  const [loginRequired, setLoginRequired] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [filters, setFilters] = useState<LostFoundListFilters>(DEFAULT_LOST_FOUND_FILTERS);
  const [visibleLimit, setVisibleLimit] = useState(VISIBLE_PAGE_SIZE);
  const scopeGeneration = useRef(0);

  useEffect(() => {
    let active = true;
    const generation = ++scopeGeneration.current;
    const schoolId = context.schoolId;
    const expectedUid = uid;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- identity fence before async list load
    setError('');
    if (authLoading) {
      return () => {
        active = false;
      };
    }
    if (!signedIn || !expectedUid) {
      setItems(undefined);
      setLoginRequired(true);
      return () => {
        active = false;
      };
    }
    setLoginRequired(false);
    setItems(undefined);
    void listLostFoundItems(schoolId).then(
      (next) => {
        if (!active || generation !== scopeGeneration.current) return;
        setItems(next);
      },
      (reason) => {
        if (!active || generation !== scopeGeneration.current) return;
        if (isPermissionDeniedError(reason)) {
          setLoginRequired(true);
          return;
        }
        setError('暫時無法讀取失物招領，請稍後再試。');
        setItems(undefined);
      },
    );
    return () => {
      active = false;
    };
  }, [authLoading, context.schoolId, reloadToken, signedIn, uid]);

  const filtered =
    items && signedIn ? filterLostFoundItems(items, filters, uid) : [];
  const visible = filtered.slice(0, visibleLimit);
  const hasMore = filtered.length > visible.length;
  const scopeText = describeLostFoundFilterScope(filters, context.schoolName);

  function patchFilters(patch: Partial<LostFoundListFilters>) {
    setFilters((current) => ({ ...current, ...patch }));
    setVisibleLimit(VISIBLE_PAGE_SIZE);
  }

  return (
    <SiteShell
      title="失物招領"
      subtitle="找回遺失的物品，或替拾獲物尋找主人。"
      schoolName={context.schoolName}
    >
      <div className={styles.stack}>
        {authLoading ? (
          <p role="status">正在確認登入狀態…</p>
        ) : loginRequired || !signedIn ? (
          <section className={styles.panel}>
            <LoginRequiredLostFoundComments returnUrl={loginReturnUrl} />
          </section>
        ) : (
          <>
            <section className={styles.panel}>
              <div className={styles.toolbar}>
                <div>
                  <h2>本校刊登</h2>
                  <p className={styles.scopeNote}>{scopeText}</p>
                </div>
                <div className={styles.actions} style={{ marginTop: 0 }}>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setReloadToken((value) => value + 1)}
                  >
                    重新整理
                  </Button>
                  <Link
                    className="btn"
                    href={`/lost-found/post?schoolId=${encodeURIComponent(context.schoolId)}`}
                  >
                    刊登物品
                  </Link>
                </div>
              </div>

              <div className={styles.filters} style={{ marginTop: 16 }}>
                <div className={styles.filtersWide}>
                  <Input
                    id={`${filterId}-query`}
                    label="搜尋"
                    value={filters.query}
                    placeholder="標題、說明或地點"
                    onChange={(event) => patchFilters({ query: event.target.value })}
                  />
                </div>
                <Select
                  id={`${filterId}-type`}
                  label="類型"
                  value={filters.type}
                  options={[
                    { value: 'all', label: '全部類型' },
                    { value: 'lost', label: '遺失' },
                    { value: 'found', label: '拾獲' },
                  ]}
                  onChange={(event) =>
                    patchFilters({ type: event.target.value as LostFoundListFilters['type'] })
                  }
                />
                <Select
                  id={`${filterId}-status`}
                  label="狀態"
                  value={filters.status}
                  options={[
                    { value: 'all', label: '全部狀態' },
                    { value: 'open', label: '尋找中' },
                    { value: 'resolved', label: '已結案／過期' },
                  ]}
                  onChange={(event) =>
                    patchFilters({
                      status: event.target.value as LostFoundListFilters['status'],
                    })
                  }
                />
                <label className={styles.muted} htmlFor={`${filterId}-mine`}>
                  <input
                    id={`${filterId}-mine`}
                    type="checkbox"
                    checked={filters.mine}
                    onChange={(event) => patchFilters({ mine: event.target.checked })}
                  />{' '}
                  只看我刊登的
                </label>
              </div>
            </section>

            {error ? (
              <section className={styles.panel}>
                <p className={styles.error} role="alert">
                  {error}
                </p>
                <div className={styles.actions}>
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => {
                      setError('');
                      setReloadToken((value) => value + 1);
                    }}
                  >
                    再試一次
                  </Button>
                </div>
              </section>
            ) : items === undefined ? (
              <p role="status">正在讀取失物招領…</p>
            ) : items.length === 0 ? (
              <section className={styles.panel}>
                <p>目前沒有本校刊登資訊</p>
                <div className={styles.actions}>
                  <Link
                    className="btn"
                    href={`/lost-found/post?schoolId=${encodeURIComponent(context.schoolId)}`}
                  >
                    刊登第一則
                  </Link>
                </div>
              </section>
            ) : filtered.length === 0 ? (
              <section className={styles.panel}>
                <p>沒有符合目前篩選條件的刊登</p>
                <p className={styles.scopeNote}>
                  {scopeText}（已在本校完整載入的 {items.length} 則中篩選）
                </p>
              </section>
            ) : (
              <>
                <p className={styles.scopeNote} role="status">
                  符合條件 {filtered.length} 則
                  {hasMore ? `，目前顯示前 ${visible.length} 則` : ''}
                  （自本校完整載入的 {items.length} 則篩選）
                </p>
                <ul className={styles.list}>
                  {visible.map((item) => (
                    <li key={item.id} className={styles.panel}>
                      <div className={styles.itemMeta}>
                        <span className={styles.badge}>{typeLabel(item.type)}</span>
                        <span className={styles.badge}>{categoryLabel(item.category)}</span>
                        <span className={styles.badge}>{statusLabel(item.status)}</span>
                        {!item.canonical ? (
                          <span className={styles.badge}>舊版紀錄</span>
                        ) : null}
                      </div>
                      <h2>
                        <Link
                          className={styles.link}
                          href={`/lost-found/${encodeURIComponent(item.id)}?schoolId=${encodeURIComponent(context.schoolId)}`}
                        >
                          {item.title}
                        </Link>
                      </h2>
                      <p className={styles.muted}>
                        {item.location}
                        {item.date ? ` · ${formatLostFoundCalendarDate(item.date)}` : ''}
                      </p>
                      <p>{item.description}</p>
                    </li>
                  ))}
                </ul>
                {hasMore ? (
                  <div className={styles.actions}>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        setVisibleLimit((current) => current + VISIBLE_PAGE_SIZE)
                      }
                    >
                      載入更多（尚有 {filtered.length - visible.length} 則）
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </>
        )}
      </div>
    </SiteShell>
  );
}
