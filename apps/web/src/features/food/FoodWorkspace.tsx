'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { createNuniFoodClient } from '@campus/shared/src/nuniFood';
import { browserRequest, useNuniSession } from '@/features/nuni/Session';
import { SiteShell } from '@/components/SiteShell';
import { NuniSignIn } from '@/components/NuniSignIn';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Input';
import { FoodMenu } from './FoodMenu';
import { FoodOrders } from './FoodOrders';
import { clearAllFoodPendingForAccount } from './foodPersistence';
import { useFoodDraft, useFoodRead, type FoodDraftCache } from './foodState';
import styles from './Food.module.css';

export type FoodClient = ReturnType<typeof createNuniFoodClient>;
export function FoodWorkspace({
  initialTenant = '',
  initialOrder = '',
}: {
  initialTenant?: string;
  initialOrder?: string;
}) {
  const auth = useNuniSession();
  const [cleanupError, setCleanupError] = useState('');
  const [scope, setScope] = useState<{ account: string | null; drafts: FoodDraftCache }>(() => ({
    account: null,
    drafts: new Map(),
  }));
  const account = auth.pendingLogout
    ? null
    : (auth.session?.platformAccountId ?? (!auth.loading && !auth.error ? null : scope.account));
  if (account !== scope.account) {
    if (scope.account && !account) {
      try {
        clearAllFoodPendingForAccount(scope.account);
      } catch {
        setCleanupError('未能清除這個分頁的訂餐重試紀錄，關閉分頁即可清除。');
      }
    }
    setScope({ account, drafts: new Map() });
    return null;
  }
  return (
    <SiteShell title="點餐與取餐" subtitle="先看菜單與金額，確認後才送出訂單。">
      <div className={styles.stack}>
        {cleanupError ? <p role="alert">{cleanupError}</p> : null}
        <nav className={styles.bar} aria-label="餐飲服務">
          <Link href="/cafeteria">餐廳資訊</Link>
          <Link href="/orders">原有餐廳訂單</Link>
          <Link href="/merchant">店家工作台</Link>
        </nav>
        {auth.loading ? (
          <p role="status">正在確認帳號…</p>
        ) : auth.error ? (
          <div role="alert">
            <p>{auth.error}</p>
            <Button onClick={() => void auth.refresh()}>重新確認帳號</Button>
          </div>
        ) : auth.session && !auth.pendingLogout ? (
          <FoodAccount
            key={`${auth.session.platformAccountId}:${auth.session.context}`}
            accountId={auth.session.platformAccountId}
            context={auth.session.context}
            cache={scope.drafts}
            initialTenant={initialTenant}
            initialOrder={initialOrder}
          />
        ) : (
          <NuniSignIn
            returnUrl={
              initialTenant && initialOrder
                ? `/food?tenant=${encodeURIComponent(initialTenant)}&order=${encodeURIComponent(initialOrder)}`
                : '/food'
            }
          />
        )}
      </div>
    </SiteShell>
  );
}

function FoodAccount({
  accountId,
  context,
  cache,
  initialTenant,
  initialOrder,
}: {
  accountId: string;
  context: string;
  cache: FoodDraftCache;
  initialTenant: string;
  initialOrder: string;
}) {
  const client = useMemo(
    () =>
      createNuniFoodClient((path, input, query) =>
        browserRequest(path, context, input, undefined, query),
      ),
    [context],
  );
  const [tab, setTab] = useFoodDraft<'menu' | 'orders'>(
    cache,
    'food:tab',
    initialOrder ? 'orders' : 'menu',
  );
  const [tenant, setTenant] = useFoodDraft(cache, 'food:tenant', initialTenant);
  const realmsLoad = useCallback(
    () => (tab === 'orders' ? client.listOrderRealms() : client.listRealms()),
    [client, tab],
  );
  const realms = useFoodRead(realmsLoad);
  const available =
    realms.data?.filter(
      (realm) =>
        !('services' in realm) ||
        (Array.isArray(realm.services) && realm.services.includes('food')),
    ) ?? [];
  const tenantId = available.some((realm) => realm.tenantId === tenant)
    ? tenant
    : (available[0]?.tenantId ?? '');
  const [created, setCreated] = useState<{ tenantId: string; orderId: string } | null>(null);
  return (
    <div className={styles.stack}>
      <div className={styles.bar}>
        <Button aria-pressed={tab === 'menu'} onClick={() => setTab('menu')}>
          我要點餐
        </Button>
        <Button aria-pressed={tab === 'orders'} onClick={() => setTab('orders')}>
          我的訂單與取餐
        </Button>
        <Button disabled={realms.loading} onClick={() => void realms.reload()}>
          更新場域
        </Button>
      </div>
      {realms.loading && <p role="status">正在查詢場域…</p>}
      {realms.error && <p role="alert">{realms.error}</p>}
      {realms.data && (
        <>
          {available.length ? (
            <Select
              label={tab === 'menu' ? '點餐場域' : '訂單場域'}
              value={tenantId}
              options={available.map((realm) => ({ value: realm.tenantId, label: realm.name }))}
              onChange={(event) => setTenant(event.target.value)}
            />
          ) : (
            <p>
              {tab === 'menu'
                ? '目前沒有開放點餐的場域。既有訂單仍可從「我的訂單與取餐」查看。'
                : '這個帳號目前沒有訂單紀錄。'}
            </p>
          )}
          {tenantId &&
            (tab === 'menu' ? (
              <FoodLocations
                key={tenantId}
                client={client}
                cache={cache}
                accountId={accountId}
                tenantId={tenantId}
                onOrder={(orderId) => {
                  cache.set(`food:orders:${tenantId}:selected`, orderId);
                  setCreated({ tenantId, orderId });
                  setTenant(tenantId);
                  setTab('orders');
                  window.history.replaceState(
                    null,
                    '',
                    `/food?tenant=${encodeURIComponent(tenantId)}&order=${encodeURIComponent(orderId)}`,
                  );
                }}
              />
            ) : (
              <FoodOrders
                key={tenantId}
                client={client}
                cache={cache}
                accountId={accountId}
                tenantId={tenantId}
                initialOrder={
                  created?.tenantId === tenantId
                    ? created.orderId
                    : initialTenant === tenantId
                      ? initialOrder
                      : ''
                }
              />
            ))}
        </>
      )}
    </div>
  );
}

function FoodLocations({
  client,
  cache,
  accountId,
  tenantId,
  onOrder,
}: {
  client: FoodClient;
  cache: FoodDraftCache;
  accountId: string;
  tenantId: string;
  onOrder(orderId: string): void;
}) {
  const [cursor, setCursor] = useState<string | undefined>();
  const load = useCallback(
    () => client.listLocations(tenantId, { limit: 30, cursor }),
    [client, tenantId, cursor],
  );
  const locations = useFoodRead(load);
  const [selected, setSelected] = useFoodDraft(cache, `food:${tenantId}:location`, '');
  return (
    <div className={styles.stack}>
      <div className={styles.bar}>
        <h2>選一家店</h2>
        <Button disabled={locations.loading} onClick={() => void locations.reload()}>
          更新店家
        </Button>
      </div>
      {locations.loading && <p role="status">正在讀取店家…</p>}
      {locations.error && <p role="alert">{locations.error}</p>}
      {locations.data && (
        <>
          {!locations.data.locations.length && <p>目前沒有可點餐的門市。</p>}
          <div className={styles.grid}>
            {locations.data.locations.map((location) => (
              <section className={styles.panel} key={location.id}>
                <h3>{location.name}</h3>
                <p>
                  {[
                    location.zoneLabel,
                    location.state === 'open' &&
                    location.description === '店家進駐已核准，尚待完成營運設定。'
                      ? ''
                      : location.description,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {location.sourceLabel && (
                  <p className={styles.muted}>
                    資訊來源：{location.sourceLabel}
                    {location.sourceUpdatedAt ? ` · ${location.sourceUpdatedAt}` : ''}
                  </p>
                )}
                {location.merchantMode === 'full' &&
                location.allowedActions.includes('view-menu') ? (
                  <Button onClick={() => setSelected(location.id)}>
                    查看菜單：{location.name}
                  </Button>
                ) : (
                  <p>目前提供店家資訊，尚未開放站內點餐。</p>
                )}
                {location.externalOrderUrl && (
                  <a href={location.externalOrderUrl} target="_blank" rel="noopener noreferrer">
                    前往店家訂餐網站
                  </a>
                )}
              </section>
            ))}
          </div>
          <div className={styles.bar}>
            {cursor && <Button onClick={() => setCursor(undefined)}>回到第一頁店家</Button>}
            {locations.data.nextCursor && (
              <Button onClick={() => setCursor(locations.data!.nextCursor)}>下一頁店家</Button>
            )}
          </div>
        </>
      )}
      {selected && (
        <FoodMenu
          key={`${tenantId}:${selected}`}
          client={client}
          cache={cache}
          accountId={accountId}
          tenantId={tenantId}
          locationId={selected}
          onOrder={onOrder}
        />
      )}
    </div>
  );
}
