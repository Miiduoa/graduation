'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { AgentCard } from '@/lib/campusAssistantClient';
import { confirmCreateOrder } from '@/lib/campusAssistantClient';

interface Props {
  cards: AgentCard[];
  schoolId?: string;
  onOrderConfirmed?: (result: { orderId: string; cafeteria: string; total: number }) => void;
}

export function AgentCardList({ cards, schoolId = 'pu', onOrderConfirmed }: Props) {
  if (!cards || cards.length === 0) return null;
  return (
    <div className="ai-card-list">
      {cards.map((card, i) => (
        <AgentCardItem key={`${card.kind}-${i}`} card={card} schoolId={schoolId} onOrderConfirmed={onOrderConfirmed} />
      ))}
      <style jsx>{`
        .ai-card-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-top: 8px;
        }
      `}</style>
    </div>
  );
}

function AgentCardItem({
  card,
  schoolId,
  onOrderConfirmed,
}: {
  card: AgentCard;
  schoolId: string;
  onOrderConfirmed?: Props['onOrderConfirmed'];
}) {
  switch (card.kind) {
    case 'route_card':
      return <RouteCard payload={card.payload as RoutePayload} />;
    case 'poi_card':
      return <PoiCard payload={card.payload as PoiPayload} />;
    case 'cafeteria_list_card':
      return <CafeteriaListCard payload={card.payload as CafeteriaListPayload} />;
    case 'menu_card':
      return <MenuCard payload={card.payload as MenuPayload} />;
    case 'order_draft_card':
      return (
        <OrderDraftCard
          payload={card.payload as OrderDraftPayload}
          schoolId={schoolId}
          onConfirmed={onOrderConfirmed}
        />
      );
    case 'order_submitted':
      return <OrderSubmittedCard payload={card.payload as OrderSubmittedPayload} />;
    case 'navigate':
      return <NavigateCard payload={card.payload as NavigatePayload} />;
    default:
      return null;
  }
}

// ── Type defs (loose because they come from backend dynamically) ──

type RoutePayload = {
  from: { id: string; name: string; lat: number; lng: number; code?: string };
  to: { id: string; name: string; lat: number; lng: number; code?: string; floor?: string };
  distanceMeters: number;
  walkMinutes: number;
  polyline: Array<{ lat: number; lng: number; label?: string }>;
  steps: Array<{ instruction: string; distance: number; direction: string }>;
  deepLink?: { web?: string; mobile?: { screen: string; params: Record<string, unknown> } };
};

type PoiPayload = {
  query: string;
  pois: Array<{
    id: string;
    name: string;
    code?: string;
    category?: string;
    lat: number;
    lng: number;
    floor?: string;
    description?: string;
    departments?: string[];
    openTime?: string;
    closeTime?: string;
    openNow?: boolean | null;
    cafeteriaId?: string | null;
  }>;
};

type CafeteriaListPayload = {
  cafeterias: Array<{
    id: string;
    name: string;
    openTime?: string;
    closeTime?: string;
    seats?: number;
    openNow?: boolean | null;
    orderingEnabled?: boolean;
  }>;
};

type MenuPayload = {
  cafeteriaId: string;
  cafeteriaName: string;
  items: Array<{
    id: string;
    menuItemId: string;
    name: string;
    price: number;
    category?: string;
    description?: string;
    tags?: string[];
  }>;
  orderingEnabled?: boolean;
};

type OrderDraftPayload = {
  cafeteriaId: string;
  cafeteriaName: string;
  items: Array<{ menuItemId: string; name: string; price: number; quantity: number; note?: string }>;
  subtotal: number;
  tax: number;
  total: number;
  itemCount: number;
  pickupTime?: string | null;
  paymentMethod: string;
  note?: string | null;
  unavailable?: unknown[];
  confirmHint?: string;
  confirmAction: {
    functionName: string;
    input: {
      cafeteriaId: string;
      items: Array<{ menuItemId: string; name: string; price: number; quantity: number; note?: string }>;
      pickupTime?: string | null;
      paymentMethod?: string;
      note?: string | null;
    };
  };
};

type OrderSubmittedPayload = {
  orderId: string;
  cafeteria: string;
  total: number;
  itemCount: number;
};

type NavigatePayload = {
  screen: string;
  params?: { fromPoiId?: string; toPoiId?: string; poiId?: string };
  reason?: string;
};

// ── Route card ──

function RouteCard({ payload }: { payload: RoutePayload }) {
  const url = payload.deepLink?.web || `/map?route=${payload.from.id},${payload.to.id}`;
  return (
    <div className="card route">
      <div className="card-head">
        <span className="icon">🗺️</span>
        <span className="title">校園路線</span>
        <span className="meta">
          {payload.walkMinutes} 分鐘 · {payload.distanceMeters} m
        </span>
      </div>
      <div className="endpoints">
        <div className="ep">
          <span className="dot start" />
          <span>{payload.from.name}</span>
        </div>
        <div className="ep">
          <span className="dot end" />
          <span>
            {payload.to.name}
            {payload.to.floor ? <em className="floor">（{payload.to.floor}）</em> : null}
          </span>
        </div>
      </div>
      {payload.steps && payload.steps.length > 0 ? (
        <ol className="steps">
          {payload.steps.slice(0, 5).map((s, i) => (
            <li key={i}>{s.instruction}</li>
          ))}
        </ol>
      ) : null}
      <Link href={url} className="cta">
        在地圖開啟路線 →
      </Link>
      <style jsx>{`
        .card.route { background: linear-gradient(135deg, #eff6ff, #f0fdf4); border: 1px solid #bfdbfe; border-radius: 14px; padding: 14px; color: #0f172a; }
        .card-head { display: flex; align-items: center; gap: 8px; font-weight: 600; margin-bottom: 8px; }
        .icon { font-size: 18px; }
        .title { flex: 1; }
        .meta { font-size: 12px; color: #0f766e; background: #ccfbf1; padding: 2px 8px; border-radius: 999px; font-weight: 500; }
        .endpoints { display: flex; flex-direction: column; gap: 4px; padding: 8px 0; }
        .ep { display: flex; align-items: center; gap: 8px; font-size: 14px; }
        .dot { width: 8px; height: 8px; border-radius: 50%; }
        .dot.start { background: #22c55e; }
        .dot.end { background: #ef4444; }
        .floor { font-style: normal; color: #64748b; font-size: 12px; }
        .steps { margin: 6px 0 10px; padding-left: 18px; font-size: 13px; color: #475569; }
        .steps li { margin: 2px 0; }
        .cta { display: inline-block; background: #2563eb; color: white; padding: 7px 14px; border-radius: 10px; font-size: 13px; font-weight: 600; text-decoration: none; }
        .cta:hover { background: #1d4ed8; }
      `}</style>
    </div>
  );
}

// ── POI card ──

function PoiCard({ payload }: { payload: PoiPayload }) {
  return (
    <div className="card poi">
      <div className="head">
        <span className="icon">📍</span>
        <span className="title">找到 {payload.pois.length} 個地點</span>
      </div>
      <div className="list">
        {payload.pois.slice(0, 4).map((p) => (
          <Link key={p.id} href={`/map?focus=${p.id}`} className="row">
            <div className="row-main">
              <span className="name">{p.name}</span>
              {p.code ? <em className="code">{p.code}</em> : null}
            </div>
            <div className="row-meta">
              {p.floor || ''} {p.openTime && p.closeTime ? `· ${p.openTime}–${p.closeTime}` : ''}
              {p.openNow === false ? ' · 目前未營業' : p.openNow === true ? ' · 營業中' : ''}
            </div>
          </Link>
        ))}
      </div>
      <style jsx>{`
        .card.poi { background: #fefce8; border: 1px solid #fde68a; border-radius: 14px; padding: 14px; }
        .head { display: flex; align-items: center; gap: 8px; font-weight: 600; margin-bottom: 8px; color: #713f12; }
        .list { display: flex; flex-direction: column; gap: 6px; }
        .row { background: white; border: 1px solid #fde68a; border-radius: 10px; padding: 8px 10px; text-decoration: none; color: #0f172a; }
        .row:hover { border-color: #f59e0b; }
        .row-main { display: flex; align-items: center; gap: 6px; font-weight: 500; font-size: 14px; }
        .code { font-style: normal; font-size: 11px; color: #92400e; background: #fef3c7; padding: 1px 6px; border-radius: 4px; }
        .row-meta { font-size: 12px; color: #78716c; margin-top: 2px; }
      `}</style>
    </div>
  );
}

// ── Cafeteria list card ──

function CafeteriaListCard({ payload }: { payload: CafeteriaListPayload }) {
  return (
    <div className="card cafs">
      <div className="head">
        <span className="icon">🍱</span>
        <span className="title">校園餐廳（{payload.cafeterias.length}）</span>
      </div>
      <div className="list">
        {payload.cafeterias.map((c) => (
          <div key={c.id} className="row">
            <div className="name">{c.name}</div>
            <div className="meta">
              {c.openTime && c.closeTime ? `${c.openTime}–${c.closeTime}` : ''}
              {c.seats ? ` · ${c.seats} 座位` : ''}
              {c.openNow === false ? ' · 未營業' : c.openNow === true ? ' · 營業中' : ''}
            </div>
          </div>
        ))}
      </div>
      <style jsx>{`
        .card.cafs { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 14px; padding: 14px; }
        .head { display: flex; align-items: center; gap: 8px; font-weight: 600; margin-bottom: 8px; color: #14532d; }
        .list { display: flex; flex-direction: column; gap: 6px; }
        .row { background: white; border: 1px solid #bbf7d0; border-radius: 10px; padding: 8px 10px; }
        .name { font-weight: 500; font-size: 14px; color: #0f172a; }
        .meta { font-size: 12px; color: #166534; margin-top: 2px; }
      `}</style>
    </div>
  );
}

// ── Menu card ──

function MenuCard({ payload }: { payload: MenuPayload }) {
  return (
    <div className="card menu">
      <div className="head">
        <span className="icon">📜</span>
        <span className="title">{payload.cafeteriaName} 菜單</span>
        <span className="meta">{payload.items.length} 項</span>
      </div>
      <div className="grid">
        {payload.items.slice(0, 8).map((it) => (
          <div key={it.menuItemId} className="item">
            <div className="row1">
              <span className="name">{it.name}</span>
              <span className="price">${it.price}</span>
            </div>
            {it.description ? <div className="desc">{it.description}</div> : null}
            {it.category ? <span className="tag">{it.category}</span> : null}
          </div>
        ))}
      </div>
      <style jsx>{`
        .card.menu { background: #fff7ed; border: 1px solid #fed7aa; border-radius: 14px; padding: 14px; }
        .head { display: flex; align-items: center; gap: 8px; font-weight: 600; margin-bottom: 10px; color: #9a3412; }
        .icon { font-size: 18px; }
        .title { flex: 1; }
        .meta { font-size: 12px; color: #9a3412; background: #ffedd5; padding: 2px 8px; border-radius: 999px; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px; }
        .item { background: white; border: 1px solid #fed7aa; border-radius: 10px; padding: 8px 10px; }
        .row1 { display: flex; justify-content: space-between; font-size: 14px; }
        .name { font-weight: 500; color: #0f172a; }
        .price { color: #c2410c; font-weight: 600; }
        .desc { font-size: 12px; color: #78716c; margin-top: 2px; }
        .tag { display: inline-block; font-size: 11px; color: #92400e; background: #fef3c7; padding: 1px 6px; border-radius: 4px; margin-top: 4px; }
      `}</style>
    </div>
  );
}

// ── Order draft (the critical confirm-to-write card) ──

function OrderDraftCard({
  payload,
  schoolId,
  onConfirmed,
}: {
  payload: OrderDraftPayload;
  schoolId: string;
  onConfirmed?: Props['onOrderConfirmed'];
}) {
  const [paymentMethod, setPaymentMethod] = useState(payload.paymentMethod || 'campus_card');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; orderId?: string } | null>(null);

  const handleConfirm = async () => {
    if (paymentMethod === 'tappay' || paymentMethod === 'linepay') {
      setResult({
        ok: false,
        message: `${paymentMethod === 'tappay' ? 'TapPay' : 'Line Pay'} sandbox 待商家審核中（本 demo 暫不串接金流）。請改用「校園卡 / 取餐付款」。`,
      });
      return;
    }
    setSubmitting(true);
    const res = await confirmCreateOrder({
      schoolId,
      cafeteriaId: payload.cafeteriaId,
      items: payload.confirmAction.input.items,
      pickupTime: payload.pickupTime,
      paymentMethod,
      note: payload.note,
    });
    setSubmitting(false);
    if (res.success && res.orderId) {
      setResult({ ok: true, message: `訂單建立成功！訂單號 ${res.orderId}`, orderId: res.orderId });
      onConfirmed?.({ orderId: res.orderId, cafeteria: res.cafeteria || payload.cafeteriaName, total: res.total || payload.total });
    } else {
      setResult({ ok: false, message: res.errorMessage || '下單失敗，請稍後再試' });
    }
  };

  return (
    <div className="card draft">
      <div className="head">
        <span className="icon">📝</span>
        <span className="title">{payload.cafeteriaName} 訂單草稿</span>
        <span className="meta">確認後寫入</span>
      </div>
      <div className="items">
        {payload.items.map((it, i) => (
          <div key={i} className="row">
            <span className="name">
              {it.name} × {it.quantity}
            </span>
            <span className="price">${it.price * it.quantity}</span>
          </div>
        ))}
      </div>
      <div className="totals">
        <div className="row">
          <span>小計</span>
          <span>${payload.subtotal}</span>
        </div>
        <div className="row">
          <span>稅 (5%)</span>
          <span>${payload.tax}</span>
        </div>
        <div className="row total">
          <span>總計</span>
          <span>${payload.total}</span>
        </div>
      </div>
      <div className="payment">
        <label className="payment-label">付款方式</label>
        <div className="payment-options">
          <button
            type="button"
            className={paymentMethod === 'campus_card' ? 'sel' : ''}
            onClick={() => setPaymentMethod('campus_card')}
            disabled={submitting || Boolean(result?.ok)}
          >
            校園卡（取餐付款）
          </button>
          <button
            type="button"
            className={paymentMethod === 'tappay' ? 'sel' : ''}
            onClick={() => setPaymentMethod('tappay')}
            disabled={submitting || Boolean(result?.ok)}
            title="TapPay sandbox 待商家審核"
          >
            TapPay <em>（sandbox 待審）</em>
          </button>
          <button
            type="button"
            className={paymentMethod === 'linepay' ? 'sel' : ''}
            onClick={() => setPaymentMethod('linepay')}
            disabled={submitting || Boolean(result?.ok)}
            title="Line Pay sandbox 待商家審核"
          >
            Line Pay <em>（sandbox 待審）</em>
          </button>
        </div>
      </div>
      {result ? (
        <div className={result.ok ? 'note ok' : 'note err'}>
          {result.ok ? '✓ ' : '⚠️ '}
          {result.message}
        </div>
      ) : (
        <button type="button" className="confirm" onClick={handleConfirm} disabled={submitting}>
          {submitting ? '下單中…' : '✅ 確認下單'}
        </button>
      )}
      <style jsx>{`
        .card.draft { background: #faf5ff; border: 1px solid #d8b4fe; border-radius: 14px; padding: 14px; }
        .head { display: flex; align-items: center; gap: 8px; font-weight: 600; margin-bottom: 10px; color: #581c87; }
        .icon { font-size: 18px; }
        .title { flex: 1; }
        .meta { font-size: 11px; color: #6b21a8; background: #f3e8ff; padding: 2px 8px; border-radius: 999px; }
        .items { display: flex; flex-direction: column; gap: 4px; padding: 8px; background: white; border-radius: 10px; border: 1px solid #e9d5ff; }
        .row { display: flex; justify-content: space-between; font-size: 14px; color: #0f172a; }
        .totals { margin-top: 8px; padding-top: 8px; border-top: 1px dashed #d8b4fe; display: flex; flex-direction: column; gap: 2px; font-size: 13px; color: #4a044e; }
        .totals .total { font-size: 15px; font-weight: 700; color: #6b21a8; margin-top: 2px; }
        .payment { margin-top: 10px; }
        .payment-label { display: block; font-size: 12px; color: #6b21a8; margin-bottom: 4px; font-weight: 500; }
        .payment-options { display: flex; flex-wrap: wrap; gap: 6px; }
        .payment-options button { font-size: 12px; padding: 5px 10px; border: 1px solid #d8b4fe; background: white; color: #581c87; border-radius: 999px; cursor: pointer; }
        .payment-options button.sel { background: #6b21a8; color: white; border-color: #6b21a8; }
        .payment-options button:disabled { opacity: 0.5; cursor: not-allowed; }
        .payment-options em { font-style: normal; font-size: 10px; opacity: 0.7; }
        .confirm { margin-top: 12px; width: 100%; background: #16a34a; color: white; padding: 10px 16px; border: none; border-radius: 10px; font-size: 14px; font-weight: 600; cursor: pointer; }
        .confirm:hover { background: #15803d; }
        .confirm:disabled { background: #94a3b8; cursor: not-allowed; }
        .note { margin-top: 12px; padding: 10px 12px; border-radius: 10px; font-size: 13px; }
        .note.ok { background: #d1fae5; color: #065f46; }
        .note.err { background: #fee2e2; color: #991b1b; }
      `}</style>
    </div>
  );
}

function OrderSubmittedCard({ payload }: { payload: OrderSubmittedPayload }) {
  return (
    <div className="card submitted">
      <div className="head">
        <span className="icon">✅</span>
        <span className="title">訂單已建立：{payload.cafeteria}</span>
      </div>
      <div className="body">
        訂單號 <code>{payload.orderId}</code>
        <br />
        共 {payload.itemCount} 項 / 總計 ${payload.total}
      </div>
      <style jsx>{`
        .card.submitted { background: #ecfdf5; border: 1px solid #6ee7b7; border-radius: 14px; padding: 14px; color: #065f46; }
        .head { display: flex; align-items: center; gap: 8px; font-weight: 600; }
        .body { font-size: 13px; margin-top: 6px; }
        code { background: white; padding: 2px 6px; border-radius: 4px; font-family: monospace; }
      `}</style>
    </div>
  );
}

function NavigateCard({ payload }: { payload: NavigatePayload }) {
  // Mobile screen names don't map 1:1 to Web routes; only render link if we
  // know the equivalent path. GoogleMapsLike → /map with from/to params.
  if (payload.screen === 'GoogleMapsLike') {
    const from = payload.params?.fromPoiId;
    const to = payload.params?.toPoiId;
    if (!from || !to) return null;
    const url = `/map?route=${from},${to}`;
    return (
      <Link href={url} className="nav">
        <span>🗺️</span>
        <span>{payload.reason || '在地圖開啟'}</span>
        <span className="chev">›</span>
        <style jsx>{`
          .nav { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: white; border: 1px solid #c7d2fe; border-radius: 10px; color: #3730a3; text-decoration: none; font-size: 14px; }
          .nav:hover { background: #eef2ff; }
          .chev { margin-left: auto; color: #818cf8; font-size: 18px; }
        `}</style>
      </Link>
    );
  }
  return null;
}
