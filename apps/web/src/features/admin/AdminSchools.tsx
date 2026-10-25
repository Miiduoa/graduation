'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import {
  adminError,
  parseProxy,
  parseSchool,
  parseSchools,
  type AdminSchool,
  type SchoolModules,
} from './api';
import { useAdminMutation, useAdminResource } from './hooks';
import type { SchoolLifecycleFilter } from './adminNav';
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

export function AdminSchools({
  context,
  suspended,
  selectedId,
  search,
  lifecycle,
  onSelect,
  onPeople,
  onDraftChange,
  onSearch,
  onLifecycle,
}: {
  context: string;
  suspended: boolean;
  selectedId: string | null;
  search: string;
  lifecycle: SchoolLifecycleFilter;
  onSelect: (tenantId: string | null) => void;
  onPeople?: (tenantId: string) => void;
  onDraftChange?: (tenantId: string, dirty: boolean) => void;
  onSearch: (query: string) => void;
  onLifecycle: (value: SchoolLifecycleFilter) => void;
}) {
  const [input, setInput] = useState({ applied: search, query: search });
  if (input.applied !== search) setInput({ applied: search, query: search });
  const query = input.applied === search ? input.query : search;
  const resource = useAdminResource(
    `schools${search ? `?q=${encodeURIComponent(search)}` : ''}`,
    context,
    parseSchools,
    !suspended,
  );
  const rows = useMemo(() => {
    const list = resource.value ?? [];
    if (lifecycle === 'all') return list;
    return list.filter((row) => row.lifecycle === lifecycle);
  }, [resource.value, lifecycle]);
  const school = resource.value?.find((row) => row.tenantId === selectedId) ?? null;
  const showingDetail = !!selectedId && !!school;

  return (
    <div className={styles.stack}>
      {showingDetail ? (
        <>
          {resource.error && (
            <section className={styles.panel}>
              <div className={styles.stack}>
                <p role="alert" className={styles.error}>
                  {resource.error}
                </p>
                <Button onClick={resource.reload}>重新讀取學校</Button>
              </div>
            </section>
          )}
          <SchoolDetail
            key={school.tenantId}
            school={school}
            context={context}
            suspended={suspended || resource.loading || !!resource.error}
            onChanged={resource.reload}
            onClose={() => onSelect(null)}
            onPeople={onPeople}
            onDraftChange={onDraftChange}
          />
        </>
      ) : (
        <section className={styles.panel} aria-labelledby="schools-heading">
          <div className={styles.stack}>
            <div className={styles.sectionIntro}>
              <h2 id="schools-heading">學校與接入申請</h2>
              <p className={styles.muted}>
                篩選與搜尋僅套用本次已載入結果
                {resource.value ? `（目前 ${resource.value.length} 筆）` : ''}
                ，不代表平台全數統計。
              </p>
            </div>
            {selectedId && !resource.loading && !school && (
              <div className={styles.stack}>
                <p role="alert" className={styles.error}>
                  找不到這所學校，可能已不在本次載入結果中。
                </p>
                <Button onClick={() => onSelect(null)}>返回學校列表</Button>
              </div>
            )}
            <form
              className={styles.filterRow}
              onSubmit={(event) => {
                event.preventDefault();
                onSelect(null);
                onSearch(query.trim());
                resource.reload();
              }}
            >
              <Input
                label="搜尋學校"
                value={query}
                onChange={(event) => setInput({ applied: search, query: event.target.value })}
                maxLength={80}
                placeholder="學校名稱或代號"
              />
              <Select
                label="學校狀態"
                value={lifecycle}
                onChange={(event) => onLifecycle(event.target.value as SchoolLifecycleFilter)}
                options={[
                  { value: 'all', label: '全部狀態' },
                  ...Object.entries(lifecycleLabels).map(([value, label]) => ({
                    value,
                    label,
                  })),
                ]}
              />
              <Button type="submit" disabled={resource.loading}>
                套用篩選
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
            {!!resource.value?.length && rows.length === 0 && (
              <p className={styles.muted}>
                本次載入有 {resource.value.length} 筆，但沒有符合目前學校狀態篩選的結果。
              </p>
            )}
            {!!rows.length && (
              <ul className={styles.resultList}>
                {rows.map((row) => (
                  <li key={row.tenantId || row.applicationId}>
                    <div className={styles.resultMain}>
                      <div>
                        <strong>{row.displayName}</strong>
                        <p className={styles.muted}>
                          {row.emailDomain || row.tenantId || '待審核申請'} · {row.peopleCount}{' '}
                          位人員／{row.merchantCount} 家店家
                        </p>
                      </div>
                      <span className={styles.badge}>{lifecycleLabels[row.lifecycle]}</span>
                    </div>
                    <div className={styles.actions}>
                      {row.tenantId ? (
                        <Button
                          size="sm"
                          aria-label={`管理${row.displayName}`}
                          aria-current={selectedId === row.tenantId ? 'true' : undefined}
                          onClick={() => onSelect(row.tenantId)}
                        >
                          管理
                        </Button>
                      ) : (
                        <a className={styles.link} href="/admin/school-review">
                          查看申請
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
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
  onPeople,
  onDraftChange,
}: {
  school: AdminSchool;
  context: string;
  suspended: boolean;
  onChanged: () => void;
  onClose: () => void;
  onPeople?: (tenantId: string) => void;
  onDraftChange?: (tenantId: string, dirty: boolean) => void;
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
  const [savedProfile, setSavedProfile] = useState({
    displayName: school.displayName,
    description: school.description,
  });
  const [savedModules, setSavedModules] = useState(school.modules);
  const profileDirty =
    displayName !== savedProfile.displayName || description !== savedProfile.description;
  const modulesDirty = moduleIds.some((id) => modules[id] !== savedModules[id]);
  const hasUnsavedChanges = profileDirty || modulesDirty;
  useEffect(() => {
    onDraftChange?.(tenantId, hasUnsavedChanges);
    return () => onDraftChange?.(tenantId, false);
  }, [tenantId, hasUnsavedChanges, onDraftChange]);
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
    if (!stillCanEdit() || mutation.busy || (kind === 'profile' ? !profileDirty : !modulesDirty))
      return;
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
      if (kind === 'profile') {
        setSavedProfile({ displayName: updated.displayName, description: updated.description });
        setDisplayName(updated.displayName);
        setDescription(updated.description);
      } else {
        setSavedModules(updated.modules);
        setModules(updated.modules);
      }
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
            <div className={styles.sectionIntro}>
              <h2 id="school-detail-heading">{school.displayName}</h2>
              <p className={styles.muted}>
                目前狀態：{lifecycleLabels[school.lifecycle]}。
                {school.lifecycle === 'provisioned'
                  ? '已列入校園目錄；開通後才能使用校方服務。'
                  : ''}
              </p>
            </div>
            <div className={styles.actions}>
              {onPeople && (
                <Button disabled={mutation.busy} onClick={() => onPeople(tenantId)}>
                  查看校方授權
                </Button>
              )}
              <Button onClick={onClose} disabled={mutation.busy}>
                返回學校列表
              </Button>
            </div>
          </div>
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
          {hasUnsavedChanges && (
            <p role="status" className={styles.notice}>
              有尚未儲存的變更。離開此校設定前，請先儲存或捨棄草稿。
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
                <div className={styles.actions}>
                  <Button type="submit" disabled={!displayName.trim() || !profileDirty}>
                    儲存學校資料
                  </Button>
                  {profileDirty && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setDisplayName(savedProfile.displayName);
                        setDescription(savedProfile.description);
                      }}
                    >
                      捨棄學校資料變更
                    </Button>
                  )}
                </div>
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
                <div className={styles.actions}>
                  <Button type="submit" disabled={!modulesDirty}>儲存服務設定</Button>
                  {modulesDirty && (
                    <Button type="button" variant="ghost" onClick={() => setModules(savedModules)}>
                      捨棄服務變更
                    </Button>
                  )}
                </div>
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
