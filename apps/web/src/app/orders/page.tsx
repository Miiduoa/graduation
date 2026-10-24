'use client';

import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { useAuth } from '@/components/AuthGuard';
import { resolveSchoolPageContext, type SchoolSearchParams } from '@/lib/pageContext';
import { watchMyOrders, type MyOrder } from '@/lib/myOrders';
import {
  describePickupNumber,
  formatShortOrderCode,
} from '@campus/shared/src/ordering/pickupNumber';
import { isWebOnlineOrderingEnabled, ONLINE_ORDERING_OFF_TEXT } from '@/lib/onlineOrdering';
import home from '../home.module.css';
import styles from './orders.module.css';

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

function OrderCard({ order }: { order: MyOrder }) {
  const pickup = describePickupNumber(order);
  const active = !FINISHED_STATUSES.has(order.status);
  return (
    <article
      className={styles.card}
      data-tone={active ? 'active' : 'done'}
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

function OrdersList({ uid, schoolId }: { uid: string; schoolId: string }) {
  const [orders, setOrders] = useState<MyOrder[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setOrders(null);
    setFailed(false);
    const stop = watchMyOrders(
      uid,
      schoolId,
      (next) => {
        if (active) {
          setOrders(next);
          setFailed(false);
        }
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
      stop();
    };
  }, [uid, schoolId]);

  const grouped = useMemo(() => {
    const rows = orders ?? [];
    return {
      active: rows.filter((order) => !FINISHED_STATUSES.has(order.status)),
      done: rows.filter((order) => FINISHED_STATUSES.has(order.status)),
    };
  }, [orders]);

  if (failed) return <p role="alert">目前讀不到訂單，請確認連線後重新整理。</p>;
  if (orders === null) return <p role="status">正在讀取訂單…</p>;
  if (orders.length === 0) {
    if (!isWebOnlineOrderingEnabled()) {
      return (
        <div className={styles.empty}>
          <h2>{ONLINE_ORDERING_OFF_TEXT}</h2>
        </div>
      );
    }
    return (
      <div className={styles.empty}>
        <h2>還沒有訂單</h2>
        <p>
          這裡顯示 Campus One App「餐廳」下的訂單與取餐號碼。網頁站內點餐與取餐請到「點餐與取餐」。
        </p>
        <div className={styles.actions}>
          <Link className={home.primary} href="/food">
            前往點餐與取餐
          </Link>
          <Link
            className={home.secondary}
            href={`/cafeteria?schoolId=${encodeURIComponent(schoolId)}`}
          >
            查看餐廳資訊
          </Link>
        </div>
      </div>
    );
  }

  return (
    <section className={styles.list} aria-label="訂單列表">
      {grouped.active.length > 0 && (
        <div className={styles.group}>
          <h2 className={styles.groupTitle}>
            進行中 <span>{grouped.active.length}</span>
          </h2>
          {grouped.active.map((order) => (
            <OrderCard key={order.id} order={order} />
          ))}
        </div>
      )}
      {grouped.done.length > 0 && (
        <div className={styles.group}>
          <h2 className={styles.groupTitle}>
            已結束 <span>{grouped.done.length}</span>
          </h2>
          {grouped.done.map((order) => (
            <OrderCard key={order.id} order={order} />
          ))}
        </div>
      )}
    </section>
  );
}

function OrdersRoute({ schoolId }: { schoolId: string }) {
  const { user, loading, error } = useAuth();
  if (loading) return <p role="status">正在確認登入狀態…</p>;
  if (error) return <p role="alert">無法確認登入狀態，請重新整理後再試。</p>;
  if (!user) {
    if (!isWebOnlineOrderingEnabled()) {
      return (
        <div className={styles.empty}>
          <h2>{ONLINE_ORDERING_OFF_TEXT}</h2>
        </div>
      );
    }
    return (
      <div className={styles.signIn}>
        <h2>登入後查看訂單</h2>
        <p>這裡是 App 餐廳訂單。登入後可查看取餐號碼與狀態。</p>
        <Link
          className={home.primary}
          href={`/login?returnUrl=${encodeURIComponent(`/orders?schoolId=${encodeURIComponent(schoolId)}`)}`}
        >
          登入
        </Link>
      </div>
    );
  }
  return <OrdersList key={`${user.uid}:${schoolId}`} uid={user.uid} schoolId={schoolId} />;
}

export default function OrdersPage(props: { searchParams?: Promise<SchoolSearchParams> }) {
  const searchParams = props.searchParams ? use(props.searchParams) : undefined;
  const school = resolveSchoolPageContext(searchParams);
  const orderingOn = isWebOnlineOrderingEnabled();
  return (
    <SiteShell
      title={orderingOn ? '我的訂單' : ONLINE_ORDERING_OFF_TEXT}
      subtitle={
        orderingOn ? '取餐號碼和訂單狀態以店家那邊為準，會自動更新。' : ONLINE_ORDERING_OFF_TEXT
      }
      schoolName={orderingOn ? school.schoolName : undefined}
      schoolCode={orderingOn ? school.schoolCode : undefined}
    >
      <div className={styles.page}>
        {orderingOn ? (
          <p className={styles.routeNote}>
            此頁是 App「餐廳」留下的訂單。站內點餐、付款與取餐憑證請到{' '}
            <Link href="/food">點餐與取餐</Link>
            ；瀏覽菜單請到{' '}
            <Link href={`/cafeteria?schoolId=${encodeURIComponent(school.schoolId)}`}>
              餐廳資訊
            </Link>
            。
          </p>
        ) : (
          <p className={styles.routeNote}>
            這裡顯示 App 餐廳的取餐號碼。其他訂單請到 <Link href="/food">訂單與取餐進度</Link>{' '}
            查看。
          </p>
        )}
        <OrdersRoute schoolId={school.schoolId} />
      </div>
    </SiteShell>
  );
}
