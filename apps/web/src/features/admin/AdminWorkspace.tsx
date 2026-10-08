'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { SiteShell } from '@/components/SiteShell';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { useNuniSession } from '@/features/nuni/Session';
import {
  adminError,
  parseAudit,
  parseProxy,
  parseSchool,
  parseSchools,
  type AdminSchool,
  type SchoolModules,
} from './api';
import { useAdminMutation, useAdminResource } from './hooks';
import { AdminReports } from './AdminReports';
import { AdminBoards } from './AdminBoards';
import common from '@/app/servicePages.module.css';
import styles from './Admin.module.css';

const lifecycleLabels: Record<AdminSchool['lifecycle'], string> = {
  pending: '申請中',
  provisioned: '建檔未開放',
  open: '已開通',
  suspended: '已關閉',
  rejected: '已拒絕',
};
const moduleLabels: Record<keyof SchoolModules, string> = {
  leave: '請假',
  identity: '證件',
  food: '校園點餐',
};
const moduleIds = ['leave', 'identity', 'food'] as const;
function date(value: string) {
  return new Date(value).toLocaleString('zh-TW', { hour12: false });
}

export function AdminWorkspace() {
  const auth = useNuniSession();
  return (
    <SiteShell title="平台管理" subtitle="管理學校開通、服務設定與操作紀錄。">
      {auth.session?.isPlatformOperator ? (
        <Workspace
          key={`${auth.session.platformAccountId}:${auth.session.context}`}
          context={auth.session.context}
          suspended={auth.loading}
        />
      ) : auth.loading ? (
        <p role="status" className={common.loading}>
          正在確認管理權限…
        </p>
      ) : (
        <section className={common.stateCard}>
          <h2>{auth.session ? '沒有管理權限' : '請先登入管理員帳號'}</h2>
          <p>
            {auth.error ||
              (auth.session
                ? '目前帳號無法查看或修改平台管理資料。'
                : '登入後會確認你的平台管理權限。')}
          </p>
          <div className={common.actions}>
            <Link className={styles.link} href="/admin/login">
              前往管理員登入
            </Link>
            {auth.error && <Button onClick={() => void auth.refresh()}>重新確認</Button>}
          </div>
        </section>
      )}
    </SiteShell>
  );
}

function Workspace({ context, suspended }: { context: string; suspended: boolean }) {
  const [tab, setTab] = useState<'schools' | 'boards' | 'reports' | 'audit'>('schools');
  return (
    <>
      {suspended && (
        <p role="status" className={common.loading}>
          正在重新確認管理權限…
        </p>
      )}
      <div hidden={suspended}>
        <div className={styles.stack}>
          <div className={styles.toolbar}>
            <p className={styles.muted}>已使用平台管理員帳號登入</p>
            <div className={styles.actions}>
              <a className={styles.link} href="/auth/platform/school-review">
                審核學校申請
              </a>
              <a className={styles.link} href="/auth/platform/ops">
                開啟完整管理台
              </a>
              <Link className={styles.link} href="/lms-admin">
                課程系統管理
              </Link>
            </div>
          </div>
          <p className={styles.muted}>人員、店家與課班掛靠可在完整管理台繼續操作。</p>
          <nav className={styles.tabs} aria-label="管理項目">
            <Button
              variant={tab === 'schools' ? 'primary' : 'default'}
              aria-pressed={tab === 'schools'}
              onClick={() => setTab('schools')}
            >
              學校管理
            </Button>
            <Button
              variant={tab === 'boards' ? 'primary' : 'default'}
              aria-pressed={tab === 'boards'}
              onClick={() => setTab('boards')}
            >
              公開看板
            </Button>
            <Button
              variant={tab === 'reports' ? 'primary' : 'default'}
              aria-pressed={tab === 'reports'}
              onClick={() => setTab('reports')}
            >
              社群檢舉
            </Button>
            <Button
              variant={tab === 'audit' ? 'primary' : 'default'}
              aria-pressed={tab === 'audit'}
              onClick={() => setTab('audit')}
            >
              操作紀錄
            </Button>
          </nav>
          {tab === 'schools' ? (
            <Schools context={context} suspended={suspended} />
          ) : tab === 'boards' ? (
            <AdminBoards context={context} suspended={suspended} />
          ) : tab === 'reports' ? (
            <AdminReports context={context} suspended={suspended} />
          ) : (
            <Audit context={context} suspended={suspended} />
          )}
        </div>
      </div>
    </>
  );
}

function Schools({ context, suspended }: { context: string; suspended: boolean }) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const resource = useAdminResource(
    `schools${search ? `?q=${encodeURIComponent(search)}` : ''}`,
    context,
    parseSchools,
    !suspended,
  );
  const school = resource.value?.find((row) => row.tenantId === selected);
  return (
    <div className={styles.stack}>
      <section className={styles.panel} aria-labelledby="schools-heading">
        <div className={styles.stack}>
          <h2 id="schools-heading">學校與接入申請</h2>
          <form
            className={styles.search}
            onSubmit={(event) => {
              event.preventDefault();
              setSelected(null);
              setSearch(query.trim());
              resource.reload();
            }}
          >
            <Input
              label="搜尋學校"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              maxLength={80}
              placeholder="學校名稱或代號"
            />
            <Button type="submit" disabled={resource.loading}>
              搜尋
            </Button>
          </form>
          {resource.loading && (
            <p role="status" className={styles.muted}>
              正在讀取學校…
            </p>
          )}
          {resource.error && (
            <div className={styles.stack}>
              <p role="alert" className={styles.error}>
                {resource.error}
              </p>
              <Button onClick={resource.reload}>重新讀取學校</Button>
            </div>
          )}
          {resource.value?.length === 0 && (
            <p className={styles.muted}>目前沒有符合的學校或申請。可以換個名稱搜尋。</p>
          )}
          {!!resource.value?.length && (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">學校</th>
                    <th scope="col">狀態</th>
                    <th scope="col">人員／店家</th>
                    <th scope="col">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {resource.value.map((row) => (
                    <tr key={row.tenantId || row.applicationId}>
                      <td>
                        {row.displayName}
                        <small>{row.emailDomain || row.tenantId || '待審核申請'}</small>
                      </td>
                      <td>
                        <span className={styles.badge}>{lifecycleLabels[row.lifecycle]}</span>
                      </td>
                      <td>
                        {row.peopleCount} 位／{row.merchantCount} 家
                      </td>
                      <td>
                        {row.tenantId ? (
                          <Button
                            size="sm"
                            aria-label={`管理${row.displayName}`}
                            onClick={() => setSelected(row.tenantId)}
                          >
                            管理
                          </Button>
                        ) : (
                          <a className={styles.link} href="/auth/platform/school-review">
                            查看申請
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
      {school && (
        <SchoolDetail
          key={school.tenantId}
          school={school}
          context={context}
          suspended={suspended || resource.loading || !!resource.error}
          onChanged={resource.reload}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function SchoolDetail({
  school,
  context,
  suspended,
  onChanged,
  onClose,
}: {
  school: AdminSchool;
  context: string;
  suspended: boolean;
  onChanged: () => void;
  onClose: () => void;
}) {
  const tenantId = school.tenantId!;
  const base = `schools/${encodeURIComponent(tenantId)}`;
  const parse = useCallback((value: unknown) => parseProxy(value, tenantId), [tenantId]);
  const proxy = useAdminResource(`${base}/proxy`, context, parse, !suspended);
  const mutation = useAdminMutation(context, !suspended);
  const [now, setNow] = useState(() => Date.now());
  const [displayName, setDisplayName] = useState(school.displayName);
  const [description, setDescription] = useState(school.description);
  const [modules, setModules] = useState(school.modules);
  const [action, setAction] = useState<'open' | 'suspend' | null>(null);
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState('');
  const [responseError, setResponseError] = useState('');
  useEffect(() => {
    if (!proxy.value || proxy.value.ended) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [proxy.value]);
  const active =
    !proxy.loading &&
    !!proxy.value &&
    !proxy.value.ended &&
    Date.parse(proxy.value.expiresAt) > now;
  const canEdit = school.lifecycle !== 'open' || active;
  const stillCanEdit = () =>
    school.lifecycle !== 'open' ||
    (!!proxy.value && !proxy.value.ended && Date.parse(proxy.value.expiresAt) > Date.now());
  async function proxyAction(action: 'start' | 'extend' | 'end') {
    setNotice('');
    setResponseError('');
    const result = await mutation.run(`${base}/proxy/${action}`, {}, false);
    if (result === undefined) return;
    try {
      parseProxy(result, tenantId);
      proxy.reload();
      setNotice(action === 'end' ? '代操作已結束。' : '代操作時段已更新。');
    } catch (error) {
      setResponseError(adminError(error));
    }
  }
  async function save(kind: 'profile' | 'modules') {
    if (!stillCanEdit()) return;
    setNotice('');
    setResponseError('');
    const result = await mutation.run(
      `${base}/${kind}`,
      kind === 'profile'
        ? { displayName: displayName.trim(), description: description.trim() }
        : modules,
    );
    if (result === undefined) return;
    try {
      const updated = parseSchool(result);
      if (updated.tenantId !== tenantId) throw new Error('Unexpected school response');
      setNotice(kind === 'profile' ? '學校資料已儲存。' : '學校服務設定已儲存。');
      onChanged();
    } catch (error) {
      setResponseError(adminError(error));
    }
  }
  async function changeLifecycle() {
    if (!action || reason.trim().length < 5) return;
    setNotice('');
    setResponseError('');
    const result = await mutation.run(`${base}/${action}`, { reason: reason.trim() });
    if (result === undefined) return;
    if (
      !result ||
      typeof result !== 'object' ||
      !('tenantId' in result) ||
      result.tenantId !== tenantId ||
      !('tenantState' in result) ||
      result.tenantState !== (action === 'open' ? 'open' : 'suspended')
    ) {
      setResponseError('操作回應無法確認，請重新讀取學校狀態。');
      return;
    }
    setNotice(action === 'open' ? '學校已開通。' : '學校已關閉。');
    setAction(null);
    setReason('');
    onChanged();
    proxy.reload();
  }
  return (
    <section className={styles.panel} aria-labelledby="school-detail-heading">
      <fieldset className={styles.fieldset} disabled={suspended}>
        <div className={styles.stack}>
          <div className={styles.toolbar}>
            <h2 id="school-detail-heading">{school.displayName}</h2>
            <Button onClick={onClose} disabled={mutation.busy}>
              收起學校設定
            </Button>
          </div>
          <p className={styles.muted}>
            目前狀態：{lifecycleLabels[school.lifecycle]}。
            {school.lifecycle === 'provisioned' ? '已列入校園目錄；開通後才能使用校方服務。' : ''}
          </p>
          {mutation.error || responseError ? (
            <p role="alert" className={styles.error}>
              {mutation.error || responseError}
            </p>
          ) : null}
          {notice && (
            <p role="status" className={styles.success}>
              {notice}
            </p>
          )}
          {school.lifecycle === 'open' && (
            <div className={styles.stack}>
              <p className={styles.notice}>
                {active
                  ? `正在代操作；將於 ${date(proxy.value!.expiresAt)} 結束。修改會記入操作紀錄。`
                  : '已開通學校預設唯讀。需要協助學校修改設定時，先開始 15 分鐘的代操作。'}
              </p>
              {proxy.error && (
                <p role="alert" className={styles.error}>
                  {proxy.error}
                </p>
              )}
              <div className={styles.actions}>
                {proxy.loading ? (
                  <p role="status">正在確認代操作狀態…</p>
                ) : proxy.error ? (
                  <Button onClick={proxy.reload}>重新確認代操作</Button>
                ) : active ? (
                  <>
                    <Button
                      disabled={mutation.busy || proxy.value!.extended}
                      onClick={() => void proxyAction('extend')}
                    >
                      {proxy.value!.extended ? '本次已延長' : '延長 15 分鐘'}
                    </Button>
                    <Button disabled={mutation.busy} onClick={() => void proxyAction('end')}>
                      結束代操作
                    </Button>
                  </>
                ) : (
                  <Button disabled={mutation.busy} onClick={() => void proxyAction('start')}>
                    開始代操作
                  </Button>
                )}
              </div>
            </div>
          )}
          <div className={styles.split}>
            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault();
                void save('profile');
              }}
            >
              <h3>學校資料</h3>
              <fieldset disabled={!canEdit || mutation.busy || suspended}>
                <Input
                  label="學校名稱"
                  required
                  maxLength={100}
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
                <Textarea
                  label="學校說明"
                  maxLength={400}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
                <Button type="submit" disabled={!displayName.trim()}>
                  儲存學校資料
                </Button>
              </fieldset>
            </form>
            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault();
                void save('modules');
              }}
            >
              <h3>學校服務</h3>
              <fieldset disabled={!canEdit || mutation.busy || suspended}>
                {moduleIds.map((id) => (
                  <label key={id} className={styles.checkbox}>
                    <input
                      type="checkbox"
                      checked={modules[id]}
                      onChange={(event) => setModules({ ...modules, [id]: event.target.checked })}
                    />
                    {moduleLabels[id]}
                  </label>
                ))}
                <Button type="submit">儲存服務設定</Button>
              </fieldset>
            </form>
          </div>
          {action ? (
            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault();
                void changeLifecycle();
              }}
            >
              <h3>{action === 'suspend' ? '確認關閉學校' : '確認開通學校'}</h3>
              <p className={styles.notice}>
                {action === 'suspend'
                  ? '關閉後，學生將無法在選校目錄找到這所學校，請假、證件與點餐也會一併停止。'
                  : '開通後，具校方身分的使用者即可使用已啟用的校務服務。請先確認學校資料與服務設定。'}
              </p>
              <Textarea
                label="操作原因"
                required
                minLength={5}
                maxLength={1000}
                hint="至少 5 字，將記入操作紀錄。"
                value={reason}
                disabled={mutation.busy}
                onChange={(event) => setReason(event.target.value)}
              />
              <div className={styles.actions}>
                <Button
                  variant={action === 'suspend' ? 'danger' : 'primary'}
                  type="submit"
                  disabled={mutation.busy || reason.trim().length < 5}
                >
                  {action === 'suspend' ? '確定關閉學校' : '確定開通學校'}
                </Button>
                <Button
                  disabled={mutation.busy}
                  onClick={() => {
                    setAction(null);
                    setReason('');
                  }}
                >
                  取消
                </Button>
              </div>
            </form>
          ) : (
            <div className={styles.actions}>
              {school.lifecycle === 'open' ? (
                <Button
                  variant="danger"
                  disabled={mutation.busy}
                  onClick={() => setAction('suspend')}
                >
                  關閉學校
                </Button>
              ) : (
                <Button
                  variant="primary"
                  disabled={mutation.busy}
                  onClick={() => setAction('open')}
                >
                  開通學校
                </Button>
              )}
            </div>
          )}
        </div>
      </fieldset>
    </section>
  );
}

function Audit({ context, suspended }: { context: string; suspended: boolean }) {
  const resource = useAdminResource('audit', context, parseAudit, !suspended);
  return (
    <section className={styles.panel}>
      <div className={styles.stack}>
        <div className={styles.toolbar}>
          <h2>操作紀錄</h2>
          <Button disabled={resource.loading} onClick={resource.reload}>
            重新讀取紀錄
          </Button>
        </div>
        {resource.loading && <p role="status">正在讀取操作紀錄…</p>}
        {resource.error && (
          <p role="alert" className={styles.error}>
            {resource.error}
          </p>
        )}
        {resource.value?.length === 0 && <p className={styles.muted}>目前沒有操作紀錄。</p>}
        <ol className={styles.audit}>
          {resource.value?.map((row) => (
            <li key={row.id}>
              <div className={styles.toolbar}>
                <strong>{row.actionLabel}</strong>
                <time className={styles.muted} dateTime={row.createdAt}>
                  {date(row.createdAt)}
                </time>
              </div>
              <p>
                {row.actorName} · {row.targetSchoolName || '平台'} ·{' '}
                {{ proxy: '代為操作', school_admin: '學校管理員', operator: '平台營運' }[row.via]}
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
