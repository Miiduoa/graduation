'use client';

import { useState } from 'react';
import type { TransitRoute } from '@/lib/transit';
import { Modal } from './ui/Modal';
import { CampusIcon } from './CampusIcon';
import css from './transit.module.css';

export function catalogDirection(direction: string): string {
  if (direction === '去') return '去程';
  if (direction === '返') return '返程';
  return direction || '方向未提供';
}

export function CatalogRouteList({
  stopName,
  routes,
}: {
  stopName: string;
  routes: TransitRoute[];
}) {
  const [sign, setSign] = useState<TransitRoute | null>(null);
  if (!routes.length) return <p className={css.empty}>來源未提供行經路線，請至官方網站查詢。</p>;

  return (
    <>
      <p className={css.signHint}>點選一條路線，放大號碼和終點，方便候車時對照車頭。</p>
      <ul className={css.catalogRoutes}>
        {routes.map((route, index) => {
          const destination = route.destination ? `往 ${route.destination}` : '終點未提供';
          const direction = catalogDirection(route.direction);
          return (
            <li key={`${route.name}:${route.direction}:${route.destination}:${index}`}>
              <button
                type="button"
                aria-haspopup="dialog"
                aria-label={`放大 ${route.name} 路線牌，${direction}，${destination}`}
                onClick={() => setSign(route)}
              >
                <strong>{route.name}</strong>
                <span>
                  {direction} · {destination}
                </span>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <path d="M14 4h6v6m0-6-7 7M10 20H4v-6m0 6 7-7" />
                </svg>
              </button>
            </li>
          );
        })}
      </ul>
      {sign && (
        <Modal isOpen onClose={() => setSign(null)} title="候車路線牌" size="lg">
          <div className={css.destinationSign}>
            <div className={css.signHeader}>
              <span>
                <CampusIcon name="bus" size={18} />
                {stopName}
              </span>
              <span>{catalogDirection(sign.direction)}</span>
            </div>
            <div className={css.signDisplay}>
              <strong className={css.signNumber}>{sign.name}</strong>
              <p className={css.signDestination}>
                {sign.destination ? (
                  <>
                    <span>往</span>
                    {sign.destination}
                  </>
                ) : (
                  '終點未提供'
                )}
              </p>
            </div>
          </div>
          <p className={css.signCaption}>臺中市靜態路線資料 · 上車前請核對車頭顯示。</p>
        </Modal>
      )}
    </>
  );
}
