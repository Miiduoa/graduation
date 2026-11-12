'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { SiteShell } from '@/components/SiteShell';
import { Button } from '@/components/ui/Button';
import { SchoolScopePlaceholder } from '@/components/SchoolScopePlaceholder';
import { useAuth } from '@/components/AuthGuard';
import { useOptionalNuniSession } from '@/features/nuni/Session';
import { clearAllFoodPendingForAccount } from '@/features/food/foodPersistence';
import type { FoodDraftCache } from '@/features/food/foodState';
import { useCampusBrowseContext } from '@/lib/useCampusBrowseContext';
import { watchMyOrder, watchMyOrders, type MyOrder } from '@/lib/myOrders';
import {
  describePickupNumber,
  formatShortOrderCode,
} from '@campus/shared/src/ordering/pickupNumber';
import { isWebOnlineOrderingEnabled } from '@/lib/onlineOrdering';
import { toPublicSchoolId } from '@campus/shared/src/schoolIds';
import home from '../home.module.css';
import styles from './orders.module.css';
import {
  ORDER_FOCUS_MISSING,
  landOnOrder,
  orderFocusElementId,
  parseOrderFocusId,
  parsePlatformOrderLink,
  resolveOrderFocus,
} from './orderDeepLink';
import { PlatformOrders } from './PlatformOrders';

const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: '等店家接單',
  confirmed: '店家已接單',
  preparing: '準備中',
  ready: '餐點好了',
  completed: '已取餐',
  cancelled: '訂單已取消',
};

const FINISHED_STATUSES = new Set(['completed', 'cancelled']);

function legacyOrderNextStep(order: MyOrder): string {
  const pickup = describePickupNumber(order);
  if (order.status === 'cancelled') return '這張訂單已結束。';
  if (order.status === 'completed') return '這張訂單已取餐完成。';
  if (!Object.hasOwn(ORDER_STATUS_LABELS, order.status)) return '訂單進度尚待確認。';
  if (order.status === 'ready') return '餐點好了，請到店取餐。';
  if (pickup.state === 'pending') return '等待店家提供取餐號碼';
  if (order.status === 'preparing' || order.status === 'confirmed') {
    return '店家處理中，取餐號碼與狀態會自動更新。';
  }
  return order.status === 'pending' ? '等待店家接單。' : '訂單進度尚待確認。';
}

function OrderCard({ order, focused = false }: { order: MyOrder; focused?: boolean }) {
  const pickup = describePickupNumber(order);
  const active = !FINISHED_STATUSES.has(order.status);
  return (
    <article
      id={orderFocusElementId(order.id)}
      tabIndex={focused ? -1 : undefined}
      className={styles.card}
      data-tone={active ? 'active' : 'done'}
      data-order-focused={focused ? 'true' : undefined}
      aria-current={focused ? 'true' : undefined}
      aria-label={formatShortOrderCode(order.id)}
    >
      <p className={styles.status}>
        {Object.hasOwn(ORDER_STATUS_LABELS, order.status)
          ? ORDER_STATUS_LABELS[order.status]
          : '訂單紀錄'}{' '}
        · {order.shop}
      </p>
      {pickup.state === 'assigned' && <p className={styles.pickup}>{pickup.text}</p>}
      {pickup.state === 'cancelled' && (
        <p className={styles.pickup} data-tone="danger">
          {pickup.text}
        </p>
      )}
      {pickup.state === 'pending' && (
        <>
          <p className={styles.pickup}>{pickup.text}</p>
          {pickup.detail && <p className={styles.detail}>{pickup.detail}</p>}
          <p className={styles.detail}>狀態：{pickup.label}</p>
        </>
      )}
      {order.total != null && <p className={styles.detail}>到店付款 NT${order.total}</p>}
      {active ? <p className={styles.next}>{legacyOrderNextStep(order)}</p> : null}
      <p className={styles.meta}>{formatShortOrderCode(order.id)}</p>
    </article>
  );
}

function OrdersList({
  uid,
  schoolId,
  focusOrderId,
}: {
  uid: string;
  schoolId: string;
  focusOrderId: string | null;
}) {
  const [recent, setRecent] = useState<{ orders: MyOrder[]; fromCache: boolean } | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [linked, setLinked] = useState<
    { order: MyOrder | null; fromCache: boolean } | 'error' | null
  >(null);
  const [linkedAttempt, setLinkedAttempt] = useState(0);
  const landed = useRef(false);
  useEffect(() => {
    let active = true;
    setRecent(null);
    setFailed(false);
    const stop = watchMyOrders(
      uid,
      schoolId,
      (orders, fromCache) => {
        if (active) setRecent({ orders, fromCache });
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
      stop();
    };
  }, [uid, schoolId, attempt]);

  const lookupId =
    recent && !failed && !recent.orders.some((order) => order.id === focusOrderId)
      ? focusOrderId
      : null;
  useEffect(() => {
    setLinked(null);
    if (!lookupId) return;
    let active = true;
    const stop = watchMyOrder(
      uid,
      schoolId,
      lookupId,
      (order, fromCache) => {
        if (active) setLinked({ order, fromCache });
      },
      () => {
        if (active) setLinked('error');
      },
    );
    return () => {
      active = false;
      stop();
    };
  }, [uid, schoolId, lookupId, linkedAttempt]);

  const extra = lookupId && linked !== 'error' ? linked : null;
  const orders = useMemo(
    () => recent && (extra?.order ? [...recent.orders, extra.order] : recent.orders),
    [recent, extra],
  );
  const fromCache = recent?.fromCache || extra?.fromCache;

  const grouped = useMemo(() => {
    const rows = orders ?? [];
    return {
      active: rows.filter((order) => !FINISHED_STATUSES.has(order.status)),
      done: rows.filter((order) => FINISHED_STATUSES.has(order.status)),
    };
  }, [orders]);

  const focus = resolveOrderFocus(
    (orders ?? []).map((order) => order.id),
    focusOrderId,
  );

  useEffect(() => {
    if (landed.current || !focus.found || !focusOrderId) return;
    const frame = window.requestAnimationFrame(() => {
      landed.current = landOnOrder(focusOrderId);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focus.found, focusOrderId]);

  if (failed) {
    return (
      <div className={styles.empty}>
        <p role="alert">目前讀不到訂單，請確認連線後再試一次。</p>
        <div className={styles.actions}>
          <Button onClick={() => setAttempt((n) => n + 1)}>重新讀取訂單</Button>
        </div>
      </div>
    );
  }
  if (orders === null) return <p role="status">正在讀取訂單…</p>;
  const lookupNotice =
    lookupId && linked === 'error' ? (
      <div className={styles.empty}>
        <p role="alert">目前讀不到通知中的訂單。</p>
        <div className={styles.actions}>
          <Button onClick={() => setLinkedAttempt((n) => n + 1)}>重新讀取這筆訂單</Button>
        </div>
      </div>
    ) : lookupId && !linked ? (
      <p role="status">正在查詢通知中的訂單…</p>
    ) : null;
  if (!orders.length && lookupNotice) return lookupNotice;
  if (!orders.length && fromCache) {
    return <p role="status">正在等候連線確認訂單，這台裝置尚無可顯示的紀錄。</p>;
  }
  if (orders.length === 0) {
    return (
      <div className={styles.empty}>
        {focus.missing ? <p role="status">{ORDER_FOCUS_MISSING}</p> : null}
        <h2>還沒有 App 餐廳訂單</h2>
        <p>這個帳號在目前校園還沒有 App 餐廳的訂單紀錄。</p>
        {isWebOnlineOrderingEnabled() ? (
          <div className={styles.actions}>
            <Link className={home.primary} href="/food">
              前往點餐與取餐
            </Link>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <section className={styles.list} aria-label="訂單列表">
      {lookupNotice}
      {fromCache ? (
        <p role="status" className={styles.routeNote}>
          目前顯示上次同步的訂單，取餐號碼及進度會在連線後更新。
        </p>
      ) : !lookupNotice && focus.missing ? (
        <p role="status" className={styles.routeNote}>
          {ORDER_FOCUS_MISSING}
        </p>
      ) : null}
      {grouped.active.length > 0 && (
        <div className={styles.group}>
          <h2 className={styles.groupTitle}>
            進行中 <span>{grouped.active.length}</span>
          </h2>
          {grouped.active.map((order) => (
            <OrderCard key={order.id} order={order} focused={order.id === focusOrderId} />
          ))}
        </div>
      )}
      {grouped.done.length > 0 && (
        <div className={styles.group}>
          <h2 className={styles.groupTitle}>
            已結束 <span>{grouped.done.length}</span>
          </h2>
          {grouped.done.map((order) => (
            <OrderCard key={order.id} order={order} focused={order.id === focusOrderId} />
          ))}
        </div>
      )}
    </section>
  );
}

function OrdersRoute({
  schoolId,
  focusOrderId,
}: {
  schoolId: string;
  focusOrderId: string | null;
}) {
  const { user, loading, error } = useAuth();
  if (loading) return <p role="status">正在確認登入狀態…</p>;
  if (error) return <p role="alert">無法確認登入狀態，請重新整理後再試。</p>;
  if (!user || user.isAnonymous) {
    return (
      <div className={styles.signIn}>
        <h2>登入後查看訂單</h2>
        <p>這裡是 App 餐廳訂單。登入後可查看取餐號碼與狀態。</p>
        <Link
          className={home.primary}
          href={`/login?returnUrl=${encodeURIComponent(`/orders?campus=${encodeURIComponent(schoolId)}${focusOrderId ? `&orderId=${encodeURIComponent(focusOrderId)}` : ''}`)}`}
        >
          登入
        </Link>
      </div>
    );
  }
  return (
    <OrdersList
      key={`${user.uid}:${schoolId}:${focusOrderId ?? ''}`}
      uid={user.uid}
      schoolId={schoolId}
      focusOrderId={focusOrderId}
    />
  );
}

function OrdersSources({
  platform,
  legacyUid,
  schoolId,
  schoolName,
  focusOrderId,
  platformLink,
}: {
  platform: ReturnType<typeof useOptionalNuniSession>;
  legacyUid: string | null;
  schoolId: string;
  schoolName: string;
  focusOrderId: string | null;
  platformLink: ReturnType<typeof parsePlatformOrderLink>;
}) {
  // The parent's account/context/campus/link key creates an isolated draft cache.
  const [cache] = useState<FoodDraftCache>(() => new Map());
  const [source, setSource] = useState<'platform' | 'legacy'>(() => {
    if (focusOrderId && !platformLink.orderId) return 'legacy';
    if (!platform) return 'legacy';
    if (
      platform.session ||
      platform.loading ||
      platform.error ||
      platform.pendingLogout ||
      !legacyUid
    )
      return 'platform';
    return 'legacy';
  });
  const showSources = !!platform && (!!legacyUid || !!focusOrderId);
  const signInSearch = new URLSearchParams({ campus: schoolId });
  if (!platformLink.invalid && platformLink.tenant) {
    signInSearch.set('tenant', platformLink.tenant);
    if (platformLink.orderId) signInSearch.set('order', platformLink.orderId);
  }
  const signInHref = '/login?returnUrl=' + encodeURIComponent(`/orders?${signInSearch.toString()}`);
  let content;
  if (source === 'legacy' || !platform) {
    content = <OrdersRoute schoolId={schoolId} focusOrderId={focusOrderId} />;
  } else if (platform.pendingLogout) {
    content = (
      <div role="alert">
        <p>正在結束帳號登入，完成後即可重新確認訂單。</p>
        <Button onClick={() => void platform.logout()}>重試登出</Button>
      </div>
    );
  } else if (platform.loading) {
    content = <p role="status">正在確認 Google 帳號…</p>;
  } else if (platform.error) {
    content = (
      <div role="alert">
        <p>暫時無法確認 Google 帳號，訂單尚未讀取。</p>
        <Button onClick={() => void platform.refresh()}>重新確認帳號</Button>
      </div>
    );
  } else if (!platform.session) {
    content = (
      <div className={styles.signIn}>
        <h2>登入後查看訂單</h2>
        <p>使用 Google 帳號查看站內點餐的訂單、處理進度與取餐憑證。</p>
        <Link className={home.primary} href={signInHref}>
          登入
        </Link>
      </div>
    );
  } else if (
    platformLink.invalid ||
    (platformLink.tenant && toPublicSchoolId(platformLink.tenant) !== toPublicSchoolId(schoolId))
  ) {
    content = (
      <div className={styles.empty}>
        <p role="alert">訂單連結無效或與目前校園不同，請確認連結與所選校園。</p>
        <Link className={home.secondary} href={`/orders?campus=${encodeURIComponent(schoolId)}`}>
          查看目前校園的訂單
        </Link>
      </div>
    );
  } else {
    content = (
      <PlatformOrders
        accountId={platform.session.platformAccountId}
        context={platform.session.context}
        schoolId={schoolId}
        schoolName={schoolName}
        tenant={platformLink.tenant}
        orderId={platformLink.orderId}
        cache={cache}
      />
    );
  }
  return (
    <>
      {showSources ? (
        <div className={styles.actions} role="group" aria-label="訂單來源">
          <Button aria-pressed={source === 'platform'} onClick={() => setSource('platform')}>
            站內點餐訂單
          </Button>
          <Button aria-pressed={source === 'legacy'} onClick={() => setSource('legacy')}>
            App 餐廳訂單
          </Button>
        </div>
      ) : null}
      {source === 'legacy' ? (
        <p className={styles.routeNote}>目前顯示 App「餐廳」留下的訂單。</p>
      ) : null}
      {content}
    </>
  );
}

export default function OrdersPage() {
  const platform = useOptionalNuniSession();
  const legacy = useAuth();
  const campus = useCampusBrowseContext();
  const searchParams = useSearchParams();
  const focusOrderId = parseOrderFocusId(searchParams.get('orderId'));
  const platformLink = parsePlatformOrderLink(searchParams);
  const accountId = platform?.session?.platformAccountId ?? null;
  const context = platform?.session?.context ?? null;
  const hasPlatform = platform !== null;
  const platformLoading = platform?.loading ?? false;
  const platformError = !!platform?.error;
  const pendingLogout = platform?.pendingLogout ?? false;
  const legacyUid =
    !legacy.loading && !legacy.error && legacy.user && !legacy.user.isAnonymous
      ? legacy.user.uid
      : null;
  const previousAccount = useRef<string | null>(null);
  const [cleanupError, setCleanupError] = useState('');
  useEffect(() => {
    if (!hasPlatform) return;
    if (pendingLogout || (!platformLoading && !platformError && !accountId)) {
      const previous = previousAccount.current;
      previousAccount.current = null;
      if (previous) {
        try {
          clearAllFoodPendingForAccount(previous);
        } catch {
          setCleanupError('未能清除這個分頁的訂餐重試紀錄，關閉分頁即可清除。');
        }
      }
    } else if (accountId) {
      previousAccount.current = accountId;
    }
  }, [accountId, hasPlatform, platformLoading, platformError, pendingLogout]);
  const ready = campus.status === 'ready' && !!campus.schoolId;
  return (
    <SiteShell
      title="我的訂單"
      subtitle="查看目前校園的訂單、取餐號碼與處理進度。"
      schoolName={ready ? campus.schoolName : undefined}
    >
      <div className={styles.page}>
        {cleanupError ? <p role="alert">{cleanupError}</p> : null}
        {ready ? (
          <p className={styles.routeNote}>
            <Link href={`/food?campus=${encodeURIComponent(campus.schoolId!)}`}>點餐與取餐</Link>
            {' · '}
            <Link href={`/cafeteria?schoolId=${encodeURIComponent(campus.schoolId!)}`}>
              餐廳資訊
            </Link>
          </p>
        ) : null}
        {!ready ? (
          campus.status === 'loading' ? (
            <p role="status">正在確認所選校園…</p>
          ) : campus.status === 'error' ? (
            <p role="alert">無法取得校園目錄，請稍後再試。</p>
          ) : (
            <SchoolScopePlaceholder />
          )
        ) : (
          <OrdersSources
            key={JSON.stringify([
              accountId,
              context,
              legacyUid,
              campus.schoolId,
              focusOrderId,
              platformLink.tenant,
              platformLink.orderId,
            ])}
            platform={platform}
            legacyUid={legacyUid}
            schoolId={campus.schoolId!}
            schoolName={campus.schoolName}
            focusOrderId={focusOrderId}
            platformLink={platformLink}
          />
        )}
      </div>
    </SiteShell>
  );
}
