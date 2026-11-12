'use client';

import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { createNuniFoodClient } from '@campus/shared/src/nuniFood';
import { browserRequest, useNuniSession } from '@/features/nuni/Session';
import { SiteShell } from '@/components/SiteShell';
import { AccountDemoDiningPanel } from './AccountDemoDiningPanel';
import { NuniSignIn } from '@/components/NuniSignIn';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Input';
import { FoodMenu } from './FoodMenu';
import { FoodOrders } from './FoodOrders';
import { clearAllFoodPendingForAccount } from './foodPersistence';
import { foodMoney, useFoodDraft, useFoodRead, type FoodDraftCache } from './foodState';
import { isWebOnlineOrderingEnabled } from '@/lib/onlineOrdering';
import { foodPageSubtitle } from '@campus/shared/src/foodPageCopy';
import { buildCampusNavigationSearch, campusServiceHref } from '@/lib/campusNavigationLinks';
import styles from './Food.module.css';

const subscribeToHydration = () => () => {};
const clientHydrated = () => true;
const serverHydrated = () => false;

export type FoodClient = ReturnType<typeof createNuniFoodClient>;
export type PreparedFoodItem = {
  menuItemId: string;
  quantity: number;
  selectedOptionIds: string[];
};
export function FoodWorkspace({
  initialTenant = '',
  initialOrder = '',
  initialLocation = '',
  initialItems = [],
  campusSearch = '',
}: {
  initialTenant?: string;
  initialOrder?: string;
  initialLocation?: string;
  initialItems?: PreparedFoodItem[];
  campusSearch?: string;
}) {
  const auth = useNuniSession();
  const browseSearch = buildCampusNavigationSearch(new URLSearchParams(campusSearch));
  // Delayed Suspense on /food must hydrate against the server's account-checking markup.
  const hydrated = useSyncExternalStore(subscribeToHydration, clientHydrated, serverHydrated);
  const [cleanupError, setCleanupError] = useState('');
  const [scope, setScope] = useState<{ account: string | null; drafts: FoodDraftCache }>(() => ({
    account: null,
    drafts: new Map(),
  }));
  const account = auth.pendingLogout
    ? null
    : (auth.session?.platformAccountId ?? (!auth.loading && !auth.error ? null : scope.account));
  if (hydrated && account !== scope.account) {
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
  const orderingOn = isWebOnlineOrderingEnabled();
  const checkingAccount = !hydrated || auth.loading;
  const nativeAccount = auth.session ? (
    <>
      <p className={styles.muted}>{foodPageSubtitle(orderingOn)}</p>
      <FoodAccount
        key={`${auth.session.platformAccountId}:${auth.session.context}`}
        accountId={auth.session.platformAccountId}
        context={auth.session.context}
        cache={scope.drafts}
        initialLocation={initialLocation}
        initialTenant={initialTenant}
        initialOrder={initialOrder}
        initialItems={initialItems}
      />
    </>
  ) : null;
  return (
    <SiteShell title="點餐與取餐" subtitle="查看餐點、訂單與取餐進度。">
      <div className={styles.stack}>
        {cleanupError ? <p role="alert">{cleanupError}</p> : null}
        <nav className={styles.serviceNav} aria-label="餐飲服務">
          <Link href="/cafeteria" className={styles.serviceLink}>
            餐廳資訊
          </Link>
          <Link href="/orders" className={styles.serviceLink}>
            App 餐廳訂單
          </Link>
          <Link
            href={campusServiceHref('/merchant/workspace', browseSearch)}
            className={styles.serviceLink}
          >
            店家工作台
          </Link>
        </nav>
        {checkingAccount ? (
          <p role="status">正在確認帳號…</p>
        ) : auth.error ? (
          <div role="alert">
            <p>{auth.error}</p>
            <Button onClick={() => void auth.refresh()}>重新確認帳號</Button>
          </div>
        ) : auth.session && !auth.pendingLogout ? (
          initialTenant || initialOrder || initialLocation ? (
            nativeAccount
          ) : (
            <AccountDemoDiningPanel view="student" fallback={nativeAccount} />
          )
        ) : (
          <NuniSignIn
            returnUrl={campusServiceHref(
              initialTenant && initialOrder
                ? `/food?tenant=${encodeURIComponent(initialTenant)}&order=${encodeURIComponent(initialOrder)}`
                : '/food',
              browseSearch,
            )}
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
  initialLocation,
  initialItems,
}: {
  accountId: string;
  context: string;
  cache: FoodDraftCache;
  initialTenant: string;
  initialOrder: string;
  initialLocation: string;
  initialItems: PreparedFoodItem[];
}) {
  const client = useMemo(
    () =>
      createNuniFoodClient((path, input, query) =>
        browserRequest(path, context, input, undefined, query),
      ),
    [context],
  );
  const orderingOn = isWebOnlineOrderingEnabled();
  const [storedTab, setTab] = useFoodDraft<'menu' | 'orders'>(
    cache,
    'food:tab',
    initialOrder ? 'orders' : 'menu',
  );
  const tab = orderingOn ? storedTab : 'orders';
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
  const selectedRealm = available.find((realm) => realm.tenantId === tenantId);
  const [created, setCreated] = useState<{ tenantId: string; orderId: string } | null>(null);
  const previewLoad = useCallback(async () => {
    if (orderingOn || initialOrder || !initialTenant || !initialLocation) return false;
    const visible = await client.listRealms();
    if (!visible.some((r) => r.tenantId === initialTenant && r.services.includes('food')))
      return false;
    const locations = await client.listLocations(initialTenant, { limit: 30 });
    return locations.locations.some(
      (l) =>
        l.id === initialLocation &&
        l.merchantMode === 'full' &&
        l.allowedActions.includes('view-menu'),
    );
  }, [client, orderingOn, initialOrder, initialTenant, initialLocation]);
  const preview = useFoodRead(previewLoad);
  if (preview.data === true)
    return (
      <FoodMenuPreview
        client={client}
        tenantId={initialTenant}
        locationId={initialLocation}
        prepared={initialItems}
      />
    );

  return (
    <div className={styles.accountStack}>
      <div className={`${styles.bar} ${styles.accountBar}`}>
        {orderingOn ? (
          <>
            <Button aria-pressed={tab === 'menu'} onClick={() => setTab('menu')}>
              我要點餐
            </Button>
            <Button aria-pressed={tab === 'orders'} onClick={() => setTab('orders')}>
              我的訂單與取餐
            </Button>
          </>
        ) : null}
        <Button variant="ghost" disabled={realms.loading} onClick={() => void realms.reload()}>
          重新整理
        </Button>
      </div>
      {realms.loading && <p role="status">正在查詢可用校園…</p>}
      {realms.error && <p role="alert">{realms.error}</p>}
      {realms.data && (
        <>
          {available.length > 1 ? (
            <Select
              label={tab === 'menu' ? '選擇點餐校園' : '選擇訂單校園'}
              value={tenantId}
              options={available.map((realm) => ({ value: realm.tenantId, label: realm.name }))}
              onChange={(event) => setTenant(event.target.value)}
            />
          ) : available.length === 1 && selectedRealm ? (
            <p className={styles.realmContext}>
              {tab === 'menu' ? '點餐校園' : '訂單校園'}：{selectedRealm.name}
            </p>
          ) : (
            <p>
              {tab === 'menu'
                ? '目前沒有開放點餐的校園。既有訂單仍可從「我的訂單與取餐」查看。'
                : '這個帳號目前沒有訂單紀錄。'}
            </p>
          )}
          {tenantId &&
            (tab === 'menu' ? (
              <FoodLocations
                initialLocation={!initialOrder && tenantId === initialTenant ? initialLocation : ''}
                initialItems={!initialOrder && tenantId === initialTenant ? initialItems : []}
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
  initialLocation,
  initialItems,
  client,
  cache,
  accountId,
  tenantId,
  onOrder,
}: {
  initialLocation: string;
  initialItems: PreparedFoodItem[];
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
  const [selected, setSelected] = useFoodDraft(cache, `food:${tenantId}:location`, initialLocation);
  const validSelected =
    selected !== initialLocation ||
    locations.data?.locations.some(
      (l) =>
        l.id === selected && l.merchantMode === 'full' && l.allowedActions.includes('view-menu'),
    );
  if (selected && validSelected) {
    return (
      <FoodMenu
        key={`${tenantId}:${selected}`}
        client={client}
        cache={cache}
        accountId={accountId}
        tenantId={tenantId}
        locationId={selected}
        initialItems={selected === initialLocation ? initialItems : []}
        onBack={() => setSelected('')}
        onOrder={onOrder}
      />
    );
  }
  return (
    <div className={styles.stack}>
      <div className={styles.bar}>
        <div>
          <h2>選一家店</h2>
          <p className={styles.muted}>依樓層或區域找到店家，選餐後再確認取餐時間與金額。</p>
        </div>
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
            {locations.data.locations.map((location) => {
              const canViewMenu =
                location.merchantMode === 'full' && location.allowedActions.includes('view-menu');
              const stateLabel =
                location.state === 'closed'
                  ? '目前暫停營業'
                  : location.state === 'open'
                    ? '營業中'
                    : '';
              const meta = [
                location.zoneLabel,
                stateLabel,
                location.state === 'open' &&
                location.description === '店家進駐已核准，尚待完成營運設定。'
                  ? ''
                  : location.description,
              ]
                .filter(Boolean)
                .join(' · ');
              return (
                <section className={`${styles.panel} ${styles.locationCard}`} key={location.id}>
                  <h3>{location.name}</h3>
                  {meta ? <p>{meta}</p> : null}
                  {location.sourceLabel && (
                    <p className={styles.muted}>
                      資訊來源：{location.sourceLabel}
                      {location.sourceUpdatedAt ? ` · ${location.sourceUpdatedAt}` : ''}
                    </p>
                  )}
                  {canViewMenu ? (
                    <Button
                      variant="primary"
                      fullWidth
                      aria-label={`查看菜單：${location.name}`}
                      onClick={() => setSelected(location.id)}
                    >
                      查看菜單
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
              );
            })}
          </div>
          <div className={styles.bar}>
            {cursor && <Button onClick={() => setCursor(undefined)}>回到第一頁店家</Button>}
            {locations.data.nextCursor && (
              <Button onClick={() => setCursor(locations.data!.nextCursor)}>下一頁店家</Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function FoodMenuPreview({
  client,
  tenantId,
  locationId,
  prepared = [],
}: {
  client: FoodClient;
  tenantId: string;
  locationId: string;
  prepared?: PreparedFoodItem[];
}) {
  const load = useCallback(
    () => client.getMenu(tenantId, locationId),
    [client, tenantId, locationId],
  );
  const menu = useFoodRead(load);
  return (
    <section aria-label="餐廳菜單預覽">
      <p>線上點餐尚未開放；可先查看菜單，備好的品項請見助理確認卡。</p>
      {menu.loading && <p role="status">正在讀取菜單…</p>}
      {menu.error && <p role="alert">{menu.error}</p>}
      {menu.data && (
        <>
          <h2>{menu.data.location.name}</h2>
          {prepared.length > 0 && (
            <p>
              已備好：
              {prepared
                .map((line) => {
                  const listed = menu.data;
                  const item = listed?.sections
                    .flatMap((section) => section.items)
                    .find((row) => row.id === line.menuItemId);
                  if (!item) return '';
                  const options = line.selectedOptionIds
                    .map(
                      (id) =>
                        item.optionGroups
                          .flatMap((group) => group.options)
                          .find((option) => option.id === id)?.name,
                    )
                    .filter(Boolean);
                  return `${item.name} × ${line.quantity}${options.length ? `（${options.join('、')}）` : ''}`;
                })
                .filter(Boolean)
                .join('、')}
            </p>
          )}
          {menu.data.sections.map((section) => (
            <section key={section.id}>
              <h3>{section.name}</h3>
              <ul>
                {section.items.map((item) => (
                  <li key={item.id}>
                    {item.name} · {foodMoney(item.basePrice)} ·{' '}
                    {item.available ? '供應中' : '暫停供應'}
                    <p>
                      {item.description} {item.dietaryTags.join('、')}
                    </p>
                    {item.optionGroups.map((group) => (
                      <p key={group.id}>
                        {group.name}：
                        {group.options
                          .map(
                            (option) =>
                              `${option.name} ${foodMoney(option.priceDelta)}${option.available ? '' : '（暫停供應）'}`,
                          )
                          .join('、')}
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </section>
  );
}
