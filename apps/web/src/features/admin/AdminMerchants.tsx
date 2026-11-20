'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAdminResource } from './hooks';
import {
  applicationStateLabel,
  interestStateLabel,
  isMerchantApplicationReviewable,
  locationStatusLabel,
  merchantModeOrderableCopy,
  parseOversightMerchants,
  type OversightMerchantApplication,
  type OversightMerchantCatalogRow,
  type OversightMerchantInterest,
  type OversightMerchants,
} from './oversightApi';
import styles from './Admin.module.css';

function date(value: string) {
  return new Date(value).toLocaleString('zh-TW', { hour12: false });
}

function matchesNeedle(parts: string[], needle: string) {
  if (!needle) return true;
  return parts.join(' ').toLowerCase().includes(needle);
}

export function AdminMerchants({
  context,
  suspended,
  data,
  embedded = false,
  hidePending = false,
  onRefresh,
  refreshDisabled = false,
}: {
  context: string;
  suspended: boolean;
  data?: OversightMerchants;
  embedded?: boolean;
  hidePending?: boolean;
  onRefresh?: () => void;
  refreshDisabled?: boolean;
}) {
  const resource = useAdminResource(
    'merchants',
    context,
    parseOversightMerchants,
    !suspended && !data,
  );
  const value = data ?? resource.value;
  const loading = data ? false : resource.loading;
  const error = data ? undefined : resource.error;
  const reload = onRefresh ?? resource.reload;
  const [draft, setDraft] = useState('');
  const [filter, setFilter] = useState('');
  const needle = filter.trim().toLowerCase();

  const interest = useMemo(
    () =>
      (value?.interest ?? []).filter(
        (row) =>
          (!hidePending || row.state !== 'submitted') &&
          matchesNeedle(
            [row.brandName, row.schoolName, row.state, interestStateLabel(row.state)],
            needle,
          ),
      ),
    [value, needle, hidePending],
  );
  const applications = useMemo(
    () =>
      (value?.applications ?? []).filter(
        (row) =>
          (!hidePending || !isMerchantApplicationReviewable(row.state)) &&
          matchesNeedle(
            [
              row.brandName,
              row.tenantName,
              row.locationName,
              row.state,
              applicationStateLabel(row.state).label,
            ],
            needle,
          ),
      ),
    [value, needle, hidePending],
  );
  const catalog = useMemo(
    () =>
      (value?.catalog ?? []).filter((row) =>
        matchesNeedle(
          [
            row.tenantName,
            row.locationName,
            row.merchantModeLabel,
            row.sourceLabel,
            locationStatusLabel(row.locationStatus),
            row.published ? '已公開' : '未公開',
            row.publicAccess ? '可公開造訪' : '',
          ],
          needle,
        ),
      ),
    [value, needle, hidePending],
  );

  return (
    <div className={styles.stack}>
      <section className={styles.panel} aria-labelledby="merchants-oversight-heading">
        <div className={styles.stack}>
          <div className={styles.toolbar}>
            <div>
              <h2 id="merchants-oversight-heading">
                {embedded ? '店家目錄與申請紀錄' : '跨校店家監督'}
              </h2>
              <p className={styles.muted}>
                {embedded
                  ? '查看店家公開與營運狀態，待審申請集中在上方處理。'
                  : '查看各校店家、接入申請與營運狀態，從管理台進行審核與設定。'}
              </p>
            </div>
            <div className={styles.actions}>
              <Button disabled={loading || refreshDisabled} onClick={reload}>
                重新讀取店家
              </Button>
              {!embedded && (
                <a className={styles.link} href="/admin/ops?tab=merchants">
                  前往完整管理台審核
                </a>
              )}
            </div>
          </div>

          {loading && <p role="status">正在讀取店家資料…</p>}
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}

          {value && !error && (
            <>
              <p className={styles.notice}>{value.honesty}</p>
              <p className={styles.muted}>
                目錄本次載入 {value.catalog.length} 筆（最多顯示 400 筆），意向{' '}
                {value.interest.length} 筆、接入申請 {value.applications.length} 筆。
              </p>
              <form
                className={styles.filterRow}
                onSubmit={(event) => {
                  event.preventDefault();
                  setFilter(draft.trim());
                }}
              >
                <Input
                  label="在已載入結果中篩選"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  maxLength={80}
                  placeholder="學校、品牌或狀態"
                />
                <Button type="submit">套用篩選</Button>
              </form>

              <CatalogSection rows={catalog} totalLoaded={value.catalog.length} />
              <ApplicationsSection
                rows={applications}
                totalLoaded={
                  value.applications.filter(
                    (row) => !hidePending || !isMerchantApplicationReviewable(row.state),
                  ).length
                }
              />
              <InterestSection
                rows={interest}
                totalLoaded={
                  value.interest.filter((row) => !hidePending || row.state !== 'submitted').length
                }
              />
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function CatalogSection({
  rows,
  totalLoaded,
}: {
  rows: OversightMerchantCatalogRow[];
  totalLoaded: number;
}) {
  return (
    <section className={styles.stack} aria-labelledby="merchant-catalog-heading">
      <h3 id="merchant-catalog-heading">已登錄店家目錄</h3>
      {totalLoaded === 0 ? (
        <p className={styles.muted}>本次載入沒有目錄列。</p>
      ) : rows.length === 0 ? (
        <p className={styles.muted}>已載入 {totalLoaded} 筆目錄，沒有符合目前篩選的項目。</p>
      ) : (
        <ul className={styles.resultList}>
          {rows.map((row) => (
            <li key={`${row.tenantId}:${row.locationId}`}>
              <div className={styles.toolbar}>
                <div>
                  <strong>
                    {row.locationName} · {row.tenantName}
                  </strong>
                  <p className={styles.muted}>
                    {row.merchantModeLabel} — {merchantModeOrderableCopy(row.merchantMode)}
                  </p>
                  <p className={styles.muted}>
                    來源：{row.sourceLabel}
                    {row.sourceUpdatedAt ? ` · 更新於 ${date(row.sourceUpdatedAt)}` : ''}
                  </p>
                </div>
                <div className={styles.actions}>
                  <span className={styles.badge}>{locationStatusLabel(row.locationStatus)}</span>
                  <span className={styles.badge}>
                    {row.published ? '已公開' : '未公開'}
                    {row.publicAccess ? ' · 可公開造訪' : ''}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ApplicationsSection({
  rows,
  totalLoaded,
}: {
  rows: OversightMerchantApplication[];
  totalLoaded: number;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <section className={styles.stack} aria-labelledby="merchant-applications-heading">
      <h3 id="merchant-applications-heading">店家進件</h3>
      {totalLoaded === 0 ? (
        <p className={styles.muted}>本次載入沒有進件。</p>
      ) : rows.length === 0 ? (
        <p className={styles.muted}>已載入 {totalLoaded} 筆進件，沒有符合目前篩選的項目。</p>
      ) : (
        <ul className={styles.resultList}>
          {rows.map((row) => {
            const state = applicationStateLabel(row.state);
            const open = expanded === row.applicationId;
            return (
              <li key={`${row.tenantId}:${row.applicationId}`}>
                <div className={styles.toolbar}>
                  <div>
                    <strong>
                      {row.brandName}／{row.locationName}
                    </strong>
                    <p className={styles.muted}>
                      {row.tenantName} · 送出於 {date(row.submittedAt)} · 版本 {row.version}
                    </p>
                    <p className={styles.muted}>
                      {state.label}
                      {state.unknown ? `（原始狀態：${row.state}）` : ''}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    aria-expanded={open}
                    onClick={() => setExpanded(open ? null : row.applicationId)}
                  >
                    {open ? '收合聯絡' : '查看聯絡'}
                  </Button>
                </div>
                {open && (
                  <p className={styles.muted}>
                    聯絡人：{row.contactName} · {row.contactEmail}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function InterestSection({
  rows,
  totalLoaded,
}: {
  rows: OversightMerchantInterest[];
  totalLoaded: number;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <section className={styles.stack} aria-labelledby="merchant-interest-heading">
      <h3 id="merchant-interest-heading">公開意向</h3>
      {totalLoaded === 0 ? (
        <p className={styles.muted}>本次載入沒有意向。</p>
      ) : rows.length === 0 ? (
        <p className={styles.muted}>已載入 {totalLoaded} 筆意向，沒有符合目前篩選的項目。</p>
      ) : (
        <ul className={styles.resultList}>
          {rows.map((row) => {
            const open = expanded === row.id;
            return (
              <li key={row.id}>
                <div className={styles.toolbar}>
                  <div>
                    <strong>
                      {row.brandName} · {row.schoolName}
                    </strong>
                    <p className={styles.muted}>
                      {interestStateLabel(row.state)} · 建立於 {date(row.createdAt)}
                      {row.decidedAt ? ` · 決定於 ${date(row.decidedAt)}` : ''}
                    </p>
                    {row.note && <p className={styles.muted}>備註：{row.note}</p>}
                  </div>
                  <Button
                    size="sm"
                    aria-expanded={open}
                    onClick={() => setExpanded(open ? null : row.id)}
                  >
                    {open ? '收合聯絡' : '查看聯絡'}
                  </Button>
                </div>
                {open && (
                  <p className={styles.muted}>
                    聯絡人：{row.contactName} · {row.contactEmail}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
