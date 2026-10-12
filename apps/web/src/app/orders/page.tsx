'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { SiteShell } from '@/components/SiteShell';
import { useAuth } from '@/components/AuthGuard';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import { watchMyOrders, type MyOrder } from '@/lib/myOrders';
import { describePickupNumber, formatShortOrderCode } from '@campus/shared/src/ordering/pickupNumber';
import { isWebOnlineOrderingEnabled, ONLINE_ORDERING_OFF_TEXT } from '@/lib/onlineOrdering';
import home from '../home.module.css';

const school = resolveSchoolPageContext();

const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: '等店家接單',
  confirmed: '店家已接單',
  preparing: '準備中',
  ready: '餐點好了',
  completed: '已取餐',
  cancelled: '訂單已取消',
};

function OrderCard({ order }: { order: MyOrder }) {
  const pickup = describePickupNumber(order);
  return <article aria-label={formatShortOrderCode(order.id)} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 16, display: 'grid', gap: 6 }}>
    <p style={{ margin: 0, fontWeight: 600 }}>{ORDER_STATUS_LABELS[order.status] ?? '訂單紀錄'} · {order.shop}</p>
    {pickup.state === 'assigned' && <p style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{pickup.text}</p>}
    {pickup.state === 'cancelled' && <p style={{ margin: 0, fontWeight: 700, color: 'var(--danger, #b42318)' }}>{pickup.text}</p>}
    {pickup.state === 'pending' && <>
      <p style={{ margin: 0, fontWeight: 700 }}>{pickup.text}</p>
      {pickup.detail && <p style={{ margin: 0 }}>{pickup.detail}</p>}
      <p style={{ margin: 0 }}>狀態：{pickup.label}</p>
    </>}
    {order.total != null && <p style={{ margin: 0 }}>到店付款 NT${order.total}</p>}
    <p style={{ margin: 0, opacity: 0.75 }}>{formatShortOrderCode(order.id)}</p>
  </article>;
}

function OrdersList({ uid }: { uid: string }) {
  const [orders, setOrders] = useState<MyOrder[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setOrders(null);
    setFailed(false);
    const stop = watchMyOrders(uid, school.schoolId, next => { if (active) { setOrders(next); setFailed(false); } }, () => { if (active) setFailed(true); });
    return () => { active = false; stop(); };
  }, [uid]);
  if (failed) return <p role="alert">目前讀不到訂單，請確認連線後重新整理。</p>;
  if (orders === null) return <p role="status">正在讀取訂單…</p>;
  if (orders.length === 0) {
    if (!isWebOnlineOrderingEnabled()) return <div><h2>{ONLINE_ORDERING_OFF_TEXT}</h2></div>;
    return <div><h2>還沒有訂單</h2><p>網頁還不能點餐。要點餐，請用 Campus One App 的「餐廳」，訂單和取餐號碼會出現在這裡。</p></div>;
  }
  return <section aria-label="訂單列表" style={{ display: 'grid', gap: 12 }}>{orders.map(order => <OrderCard key={order.id} order={order} />)}</section>;
}

function OrdersRoute() {
  const { user, loading, error } = useAuth();
  if (loading) return <p role="status">正在確認登入狀態…</p>;
  if (error) return <p role="alert">無法確認登入狀態，請重新整理後再試。</p>;
  if (!user) {
    if (!isWebOnlineOrderingEnabled()) return <div><h2>{ONLINE_ORDERING_OFF_TEXT}</h2></div>;
    return <div><h2>登入後查看訂單</h2><Link className={home.primary} href={`/login?returnUrl=${encodeURIComponent('/orders')}`}>登入</Link></div>;
  }
  return <OrdersList key={user.uid} uid={user.uid} />;
}

export default function OrdersPage() {
  const orderingOn = isWebOnlineOrderingEnabled();
  return <SiteShell
    title={orderingOn ? '我的訂單' : ONLINE_ORDERING_OFF_TEXT}
    subtitle={orderingOn ? '取餐號碼和訂單狀態以店家那邊為準，會自動更新。' : ONLINE_ORDERING_OFF_TEXT}
    schoolName={school.schoolName}
    schoolCode={school.schoolCode}
  >
    <OrdersRoute />
  </SiteShell>;
}
