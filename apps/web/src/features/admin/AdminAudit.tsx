'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { parseAudit } from './api';
import { useAdminResource } from './hooks';
import styles from './Admin.module.css';

const viaLabels = {
  proxy: '代為操作',
  school_admin: '學校管理員',
  operator: '平台營運',
} as const;

function date(value: string) {
  return new Date(value).toLocaleString('zh-TW', { hour12: false });
}

export function AdminAudit({
  context,
  suspended,
  query,
  onQuery,
}: {
  context: string;
  suspended: boolean;
  query: string;
  onQuery: (value: string) => void;
}) {
  const [input, setInput] = useState({ applied: query, draft: query });
  if (input.applied !== query) setInput({ applied: query, draft: query });
  const draft = input.applied === query ? input.draft : query;
  const resource = useAdminResource('audit', context, parseAudit, !suspended);
  const filtered = useMemo(() => {
    const rows = resource.value ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      [row.actionLabel, row.actorName, row.targetSchoolName || '', row.detail]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [resource.value, query]);

  return (
    <section className={styles.panel} aria-labelledby="audit-heading">
      <div className={styles.stack}>
        <div className={styles.toolbar}>
          <div className={styles.sectionIntro}>
            <h2 id="audit-heading">操作紀錄</h2>
            <p className={styles.muted}>
              搜尋僅套用本次已載入紀錄
              {resource.value ? `（目前 ${resource.value.length} 筆）` : ''}，未包含完整歷史。
            </p>
          </div>
          <Button disabled={resource.loading} onClick={resource.reload}>
            重新讀取紀錄
          </Button>
        </div>
        <form
          className={styles.filterRow}
          onSubmit={(event) => {
            event.preventDefault();
            onQuery(draft.trim());
          }}
        >
          <Input
            label="在已載入紀錄中搜尋"
            value={draft}
            onChange={(event) => setInput({ applied: query, draft: event.target.value })}
            maxLength={80}
            placeholder="操作者、學校或動作"
          />
          <Button type="submit" disabled={resource.loading}>
            篩選
          </Button>
        </form>
        {resource.loading && <p role="status">正在讀取操作紀錄…</p>}
        {resource.error && (
          <p role="alert" className={styles.error}>
            {resource.error}
          </p>
        )}
        {resource.value?.length === 0 && <p className={styles.muted}>目前沒有操作紀錄。</p>}
        {!!resource.value?.length && filtered.length === 0 && (
          <p className={styles.muted}>本次載入紀錄中沒有符合「{query}」的項目。</p>
        )}
        <ol className={styles.audit}>
          {filtered.map((row) => (
            <li key={row.id}>
              <div className={styles.toolbar}>
                <strong>{row.actionLabel}</strong>
                <time className={styles.muted} dateTime={row.createdAt}>
                  {date(row.createdAt)}
                </time>
              </div>
              <p>
                {row.actorName} · {row.targetSchoolName || '平台'} · {viaLabels[row.via]}
              </p>
              {row.detail && <p className={styles.muted}>{row.detail}</p>}
              {(row.before || row.after) && (
                <details>
                  <summary>查看變更內容</summary>
                  <pre>{JSON.stringify({ 修改前: row.before, 修改後: row.after }, null, 2)}</pre>
                </details>
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
