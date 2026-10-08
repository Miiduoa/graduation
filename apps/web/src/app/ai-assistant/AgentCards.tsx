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
    <div className="assistant-card-list">
      {cards.map((card, i) => (
        <AgentCardItem
          key={`${card.kind}-${i}`}
          card={card}
          schoolId={schoolId}
          onOrderConfirmed={onOrderConfirmed}
        />
      ))}
      <style jsx>{`
        .assistant-card-list {
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
    case 'directions_card':
      return <DirectionsCard payload={card.payload as DirectionsPayload} />;
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

type DirectionsPayload = {
  from: { name: string };
  to: { name: string };
  navigationUrl: string;
};

function DirectionsCard({ payload }: { payload: DirectionsPayload }) {
  return (
    <section className="card directions" aria-label="步行導航">
      <h3>
        {payload.from.name} → {payload.to.name}
      </h3>
      <p>由 Google 地圖提供可通行的路線與步行時間。</p>
      <a href={payload.navigationUrl} target="_blank" rel="noopener noreferrer" className="cta">
        開啟 Google 步行導航 ↗
      </a>
      <style jsx>{`
        .directions {
          padding: 18px;
          border: 1px solid var(--border);
          border-radius: var(--radius);
          background: var(--surface);
          color: var(--text);
        }
        h3 {
          margin: 0 0 8px;
          font-size: 16px;
          overflow-wrap: anywhere;
        }
        p {
          color: var(--muted);
          line-height: 1.6;
        }
        .cta {
          display: inline-flex;
          padding: 10px 14px;
          border-radius: var(--radius-sm);
          background: var(--brand);
          color: var(--on-brand);
          text-decoration: none;
          overflow-wrap: anywhere;
        }
      `}</style>
    </section>
  );
}

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
    navigationAvailable?: boolean;
  }>;
};

type CafeteriaListPayload = {
  cafeterias: Array<{
    id: string;
    name: string;
    openTime?: string;
    closeTime?: string;
    openingHours?: string;
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
  items: Array<{
    menuItemId: string;
    name: string;
    price: number;
    quantity: number;
    note?: string;
  }>;
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
      items: Array<{
        menuItemId: string;
        name: string;
        price: number;
        quantity: number;
        note?: string;
      }>;
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
        .card.route {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: 18px;
          color: var(--text);
        }
        .card-head {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          font-weight: 600;
          margin-bottom: 8px;
        }
        .title {
          flex: 1;
          min-width: 0;
          overflow-wrap: anywhere;
        }
        .meta {
          font-size: 12px;
          color: var(--brand);
          background: var(--accent-soft);
          padding: 2px 8px;
          border-radius: var(--radius-pill);
          font-weight: 500;
        }
        .endpoints {
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 8px 0;
        }
        .ep {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 14px;
        }
        .dot {
          flex-shrink: 0;
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }
        .dot.start {
          background: var(--success);
        }
        .dot.end {
          background: var(--danger);
        }
        .floor {
          font-style: normal;
          color: var(--muted);
          font-size: 12px;
        }
        .steps {
          margin: 6px 0 10px;
          padding-left: 18px;
          font-size: 13px;
          color: var(--muted);
        }
        .steps li {
          margin: 2px 0;
        }
        .cta {
          display: inline-block;
          background: var(--brand);
          color: var(--on-brand);
          padding: 10px 14px;
          border-radius: var(--radius-sm);
          font-size: 13px;
          font-weight: 600;
          text-decoration: none;
        }
        .cta:hover {
          background: var(--brand2);
        }
      `}</style>
    </div>
  );
}

// ── POI card ──

function PoiCard({ payload }: { payload: PoiPayload }) {
  return (
    <div className="card poi">
      <div className="head">
        <span className="title">找到 {payload.pois.length} 個地點</span>
      </div>
      <div className="list">
        {payload.pois.slice(0, 4).map((p) => {
          const content = (
            <>
              <div className="row-main">
                <span className="name">{p.name}</span>
                {p.code ? <em className="code">{p.code}</em> : null}
              </div>
              <div className="row-meta">
                {p.floor || ''} {p.openTime && p.closeTime ? `· ${p.openTime}–${p.closeTime}` : ''}
                {p.openNow === false ? ' · 目前未營業' : p.openNow === true ? ' · 營業中' : ''}
              </div>
            </>
          );
          return p.navigationAvailable === false ? (
            <div key={p.id} className="row">
              {content}
              <span className="row-meta">尚未提供座標，暫時無法導航。</span>
            </div>
          ) : (
            <Link key={p.id} href={`/map?focus=${p.id}`} className="row">
              {content}
            </Link>
          );
        })}
      </div>
      <style jsx>{`
        .card.poi {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: 18px;
        }
        .head {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          font-weight: 600;
          margin-bottom: 8px;
          color: var(--text);
        }
        .list {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .row {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 10px 12px;
          text-decoration: none;
          color: var(--text);
          overflow-wrap: anywhere;
        }
        .row:hover {
          border-color: var(--brand);
        }
        .row-main {
          display: flex;
          align-items: center;
          gap: 6px;
          font-weight: 500;
          font-size: 14px;
        }
        .code {
          font-style: normal;
          font-size: 11px;
          color: var(--brand);
          background: var(--accent-soft);
          padding: 1px 6px;
          border-radius: 4px;
        }
        .row-meta {
          font-size: 12px;
          color: var(--muted);
          margin-top: 2px;
        }
      `}</style>
    </div>
  );
}

// ── Cafeteria list card ──

function CafeteriaListCard({ payload }: { payload: CafeteriaListPayload }) {
  return (
    <div className="card cafs">
      <div className="head">
        <span className="title">校園餐廳（{payload.cafeterias.length}）</span>
      </div>
      <div className="list">
        {payload.cafeterias.map((c) => (
          <div key={c.id} className="row">
            <div className="name">{c.name}</div>
            <div className="meta">
              {c.openingHours || (c.openTime && c.closeTime ? `${c.openTime}–${c.closeTime}` : '')}
              {c.seats ? ` · ${c.seats} 座位` : ''}
              {c.openNow === false ? ' · 未營業' : c.openNow === true ? ' · 營業中' : ''}
            </div>
          </div>
        ))}
      </div>
      <style jsx>{`
        .card.cafs {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: 18px;
        }
        .head {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          font-weight: 600;
          margin-bottom: 8px;
          color: var(--text);
        }
        .list {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .row {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 10px 12px;
          overflow-wrap: anywhere;
        }
        .name {
          font-weight: 500;
          font-size: 14px;
          color: var(--text);
          gap: 12px;
          overflow-wrap: anywhere;
        }
        .meta {
          font-size: 12px;
          color: var(--muted);
          margin-top: 2px;
        }
      `}</style>
    </div>
  );
}

// ── Menu card ──

function MenuCard({ payload }: { payload: MenuPayload }) {
  return (
    <div className="card menu">
      <div className="head">
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
        .card.menu {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: 18px;
        }
        .head {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          font-weight: 600;
          margin-bottom: 10px;
          color: var(--text);
        }
        .title {
          flex: 1;
          min-width: 0;
          overflow-wrap: anywhere;
        }
        .meta {
          font-size: 12px;
          color: var(--muted);
          background: var(--accent-soft);
          padding: 2px 8px;
          border-radius: var(--radius-pill);
        }
        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr));
          gap: 8px;
        }
        .item {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 10px 12px;
          overflow-wrap: anywhere;
        }
        .row1 {
          display: flex;
          justify-content: space-between;
          font-size: 14px;
          gap: 12px;
        }
        .name {
          font-weight: 500;
          color: var(--text);
        }
        .price {
          color: var(--brand);
          font-weight: 600;
        }
        .desc {
          font-size: 12px;
          color: var(--muted);
          margin-top: 2px;
        }
        .tag {
          display: inline-block;
          font-size: 11px;
          color: var(--brand);
          background: var(--accent-soft);
          padding: 1px 6px;
          border-radius: 4px;
          margin-top: 4px;
        }
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
  const [result, setResult] = useState<{ ok: boolean; message: string; orderId?: string } | null>(
    null,
  );

  const handleConfirm = async () => {
    if (paymentMethod === 'tappay' || paymentMethod === 'linepay') {
      setResult({
        ok: false,
        message: `${paymentMethod === 'tappay' ? 'TapPay' : 'LINE Pay'} 尚未開放。請選擇取餐時付款。`,
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
      setResult({ ok: true, message: `訂單已建立，訂單號 ${res.orderId}`, orderId: res.orderId });
      onConfirmed?.({
        orderId: res.orderId,
        cafeteria: res.cafeteria || payload.cafeteriaName,
        total: res.total || payload.total,
      });
    } else {
      setResult({ ok: false, message: res.errorMessage || '下單失敗，請稍後再試' });
    }
  };

  return (
    <div className="card draft">
      <div className="head">
        <span className="title">{payload.cafeteriaName} 訂單草稿</span>
        <span className="meta">確認後送出</span>
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
            title="TapPay 尚未開放"
          >
            TapPay <em>（尚未開放）</em>
          </button>
          <button
            type="button"
            className={paymentMethod === 'linepay' ? 'sel' : ''}
            onClick={() => setPaymentMethod('linepay')}
            disabled={submitting || Boolean(result?.ok)}
            title="LINE Pay 尚未開放"
          >
            LINE Pay <em>（尚未開放）</em>
          </button>
        </div>
      </div>
      {result ? (
        <div className={result.ok ? 'note ok' : 'note err'}>{result.message}</div>
      ) : (
        <button type="button" className="confirm" onClick={handleConfirm} disabled={submitting}>
          {submitting ? '下單中…' : '確認下單'}
        </button>
      )}
      <style jsx>{`
        .card.draft {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: 18px;
        }
        .head {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          font-weight: 600;
          margin-bottom: 10px;
          color: var(--text);
        }
        .title {
          flex: 1;
          min-width: 0;
          overflow-wrap: anywhere;
        }
        .meta {
          font-size: 11px;
          color: var(--brand);
          background: var(--accent-soft);
          padding: 2px 8px;
          border-radius: var(--radius-pill);
        }
        .items {
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 8px;
          background: var(--surface);
          border-radius: var(--radius-sm);
          border: 1px solid var(--border);
        }
        .row {
          display: flex;
          justify-content: space-between;
          font-size: 14px;
          color: var(--text);
          gap: 12px;
          overflow-wrap: anywhere;
        }
        .totals {
          margin-top: 8px;
          padding-top: 8px;
          border-top: 1px dashed var(--border);
          display: flex;
          flex-direction: column;
          gap: 2px;
          font-size: 13px;
          color: var(--text);
        }
        .totals .total {
          font-size: 15px;
          font-weight: 700;
          color: var(--brand);
          margin-top: 2px;
        }
        .payment {
          margin-top: 10px;
        }
        .payment-label {
          display: block;
          font-size: 12px;
          color: var(--brand);
          margin-bottom: 4px;
          font-weight: 500;
        }
        .payment-options {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .payment-options button {
          font-size: 12px;
          min-height: 44px;
          padding: 10px 12px;
          border: 1px solid var(--border);
          background: var(--surface);
          color: var(--text);
          border-radius: var(--radius-pill);
          cursor: pointer;
        }
        .payment-options button.sel {
          background: var(--brand);
          color: var(--on-brand);
          border-color: var(--brand);
        }
        .payment-options button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .payment-options em {
          font-style: normal;
          font-size: 10px;
          opacity: 0.7;
        }
        .confirm {
          margin-top: 12px;
          width: 100%;
          background: var(--brand);
          color: var(--on-brand);
          padding: 10px 16px;
          border: none;
          border-radius: var(--radius-sm);
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
        }
        .confirm:hover {
          background: var(--brand2);
        }
        .confirm:disabled {
          background: var(--disabled-bg);
          color: var(--muted);
          cursor: not-allowed;
        }
        .note {
          margin-top: 12px;
          padding: 10px 12px;
          border-radius: var(--radius-sm);
          font-size: 13px;
        }
        .note.ok {
          background: var(--success-soft);
          color: var(--success);
        }
        .note.err {
          background: var(--danger-soft);
          color: var(--danger);
        }
      `}</style>
    </div>
  );
}

function OrderSubmittedCard({ payload }: { payload: OrderSubmittedPayload }) {
  return (
    <div className="card submitted">
      <div className="head">
        <span className="title">訂單已建立：{payload.cafeteria}</span>
      </div>
      <div className="body">
        訂單號 <code>{payload.orderId}</code>
        <br />共 {payload.itemCount} 項 / 總計 ${payload.total}
      </div>
      <style jsx>{`
        .card.submitted {
          background: var(--success-soft);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: 18px;
          color: var(--success);
        }
        .head {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          font-weight: 600;
        }
        .body {
          font-size: 13px;
          margin-top: 6px;
          overflow-wrap: anywhere;
        }
        code {
          background: var(--surface);
          padding: 2px 6px;
          border-radius: 4px;
          font-family: monospace;
        }
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
        <span>{payload.reason || '在地圖開啟'}</span>
        <span className="chev">›</span>
        <style jsx>{`
          .nav {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 10px 12px;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            color: var(--brand);
            text-decoration: none;
            font-size: 14px;
          }
          .nav:hover {
            background: var(--accent-soft);
          }
          .chev {
            margin-left: auto;
            color: var(--brand2);
            font-size: 18px;
          }
        `}</style>
      </Link>
    );
  }
  return null;
}
