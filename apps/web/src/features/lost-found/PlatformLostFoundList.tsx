'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { NuniLostFoundItem } from '@campus/shared/src/nuniLostFound';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { LostFoundItemTag } from '@/components/lost-found/LostFoundItemTag';
import { todayTaipeiCalendarDate } from '@/lib/lostFound';
import {
  errorMessage,
  isExpired,
  platformLostFoundHref,
  type Scope,
  type Client,
  type Filters,
} from './platformLostFoundUi';
import styles from '@/components/lost-found/LostFound.module.css';

export function PlatformLostFoundList({
  schoolId,
  schoolName,
  filters,
  client,
  expire,
}: Scope & { client: Client; expire: () => void }) {
  const router = useRouter();
  const formId = useId();
  const alive = useRef(false);
  const listBusy = useRef(false);
  const [items, setItems] = useState<NuniLostFoundItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState(filters);
  const [revision, setRevision] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const exportLock = useRef(false);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clear the visible page before refreshing this exact scope
    setLoaded(false);
    setError('');
    setItems([]);
    setCursor(null);
    void client.list({ schoolId, ...filters, limit: 30 }).then(
      (page) => {
        if (!current || !alive.current) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        setLoaded(true);
      },
      (reason) => {
        if (!current || !alive.current) return;
        if (isExpired(reason)) expire();
        else setError(errorMessage(reason, 'read'));
      },
    );
    return () => {
      current = false;
    };
    // Scope/filter changes remount this workspace; only explicit refresh repeats the read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, schoolId, revision]);
  async function more() {
    if (!cursor || listBusy.current) return;
    listBusy.current = true;
    setBusy(true);
    setError('');
    try {
      const page = await client.list({ schoolId, ...filters, limit: 30, cursor });
      if (!alive.current) return;
      setItems((previous) => {
        const ids = new Set(previous.map((item) => item.id));
        return [...previous, ...page.items.filter((item) => !ids.has(item.id))];
      });
      setCursor(page.nextCursor);
    } catch (reason) {
      if (alive.current) {
        if (isExpired(reason)) expire();
        else setError(errorMessage(reason, 'read'));
      }
    } finally {
      listBusy.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function download() {
    if (exportLock.current) return;
    exportLock.current = true;
    setExporting(true);
    setExportError('');
    try {
      const records: NuniLostFoundItem[] = [];
      const seen = new Set<string>();
      const cursors = new Set<string>();
      let next: string | undefined;
      do {
        const page = await client.export({
          schoolId,
          limit: 50,
          ...(next ? { cursor: next } : {}),
        });
        if (!alive.current) return;
        for (const item of page.items) {
          if (seen.has(item.id)) throw new Error('Export changed');
          seen.add(item.id);
          records.push(item);
        }
        next = page.nextCursor ?? undefined;
        if (next && (cursors.has(next) || cursors.size >= 100))
          throw new Error('Export cursor did not finish');
        if (next) cursors.add(next);
      } while (next);
      if (!alive.current) return;
      const objectUrls = URL;
      const url = objectUrls.createObjectURL(
        new Blob(
          [
            JSON.stringify(
              { schoolId, exportedAt: new Date().toISOString(), items: records },
              null,
              2,
            ),
          ],
          { type: 'application/json' },
        ),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = 'lost-found-' + schoolId + '-' + todayTaipeiCalendarDate() + '.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => objectUrls.revokeObjectURL(url), 1000);
    } catch (reason) {
      if (alive.current) {
        if (isExpired(reason)) expire();
        else setExportError('未能完整匯出，沒有下載部分資料。請稍後再試。');
      }
    } finally {
      exportLock.current = false;
      if (alive.current) setExporting(false);
    }
  }
  return (
    <>
      <section className={styles.panel}>
        <div className={styles.toolbar}>
          <div>
            <h2>{filters.mine ? '我的刊登' : '本校刊登'}</h2>
            <p className={styles.scopeNote}>
              範圍：{schoolName} ·{' '}
              {filters.status === 'all'
                ? '全部狀態'
                : filters.status === 'resolved'
                  ? '已結案'
                  : '尋找中'}
            </p>
          </div>
          <div className={styles.actions}>
            <Link
              className="btn primary"
              href={platformLostFoundHref(schoolId, 'create', undefined, filters)}
            >
              刊登物品
            </Link>
            <Button disabled={busy} onClick={() => setRevision((value) => value + 1)}>
              重新整理
            </Button>
            <Button disabled={exporting} onClick={() => void download()}>
              {exporting ? '正在匯出…' : '匯出本校我的刊登'}
            </Button>
          </div>
        </div>
        <form
          className={styles.filters}
          style={{ marginTop: 16 }}
          onSubmit={(event) => {
            event.preventDefault();
            router.replace(platformLostFoundHref(schoolId, 'list', undefined, draft), {
              scroll: false,
            });
          }}
        >
          <Input
            id={formId + '-q'}
            label="搜尋"
            type="search"
            maxLength={100}
            value={draft.q ?? ''}
            placeholder="標題、說明或地點"
            onChange={(event) => setDraft({ ...draft, q: event.target.value })}
          />
          <Select
            id={formId + '-type'}
            label="類型"
            value={draft.type ?? 'all'}
            options={[
              { value: 'all', label: '全部類型' },
              { value: 'lost', label: '遺失' },
              { value: 'found', label: '拾獲' },
            ]}
            onChange={(event) =>
              setDraft({
                ...draft,
                type:
                  event.target.value === 'all'
                    ? undefined
                    : (event.target.value as 'lost' | 'found'),
              })
            }
          />
          <Select
            id={formId + '-status'}
            label="狀態"
            value={draft.status ?? 'open'}
            options={[
              { value: 'open', label: '尋找中' },
              { value: 'resolved', label: '已結案' },
              { value: 'all', label: '全部狀態' },
            ]}
            onChange={(event) =>
              setDraft({ ...draft, status: event.target.value as Filters['status'] })
            }
          />
          <label>
            <input
              type="checkbox"
              checked={!!draft.mine}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  mine: event.target.checked,
                  status: event.target.checked ? 'all' : 'open',
                })
              }
            />
            只看我的刊登
          </label>
          <Button type="submit">套用篩選</Button>
        </form>
        {exportError && <p role="alert">{exportError}</p>}
      </section>
      {error ? (
        <section className={styles.panel}>
          <p role="alert">{error}</p>
          <Button
            disabled={busy}
            onClick={() => (loaded ? void more() : setRevision((value) => value + 1))}
          >
            再試一次
          </Button>
        </section>
      ) : null}
      {!loaded && !error ? (
        <p role="status">正在讀取失物招領…</p>
      ) : loaded && items.length === 0 ? (
        <p className={styles.notice}>目前沒有符合條件的刊登。</p>
      ) : null}
      <ul className={styles.list} aria-label="失物招領刊登">
        {items.map((item) => (
          <li key={item.id}>
            <LostFoundItemTag
              item={item}
              href={platformLostFoundHref(schoolId, 'detail', item.id, filters)}
            >
              <p>{item.description}</p>
              {item.isOwner && <p className={styles.scopeNote}>我的刊登</p>}
            </LostFoundItemTag>
          </li>
        ))}
      </ul>
      {cursor && (
        <Button disabled={busy} onClick={() => void more()}>
          {busy ? '正在載入…' : '載入更多'}
        </Button>
      )}
    </>
  );
}
