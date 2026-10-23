'use client';

import type { CSSProperties } from 'react';
import type { CampusApproachModel } from '@/lib/transit';
import css from './transit.module.css';

function BusMark() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="11" rx="2.4" fill="currentColor" />
      <rect x="5.2" y="7.1" width="3.4" height="3" rx="0.6" fill="var(--brand)" />
      <rect x="9.8" y="7.1" width="4.4" height="3" rx="0.6" fill="var(--brand)" />
      <rect x="15.4" y="7.1" width="3.4" height="3" rx="0.6" fill="var(--brand)" />
      <circle cx="8" cy="16.6" r="1.55" fill="currentColor" />
      <circle cx="16" cy="16.6" r="1.55" fill="currentColor" />
    </svg>
  );
}

export function CampusApproachTrack(props: { model: CampusApproachModel }) {
  const { model } = props;
  const count = Math.max(2, model.stops.length);
  const busIndex = model.busIndex === null ? null : Math.min(count - 1, Math.max(0, model.busIndex));
  const busLeft = busIndex === null ? null : `${(busIndex / (count - 1)) * 100}%`;
  const showBus = model.status !== 'scheduled' && busLeft !== null;
  const trackStyle = { '--stop-count': String(count), '--bus-left': busLeft ?? '0%' } as CSSProperties;
  return (
    <section
      className={css.approach}
      data-testid="campus-approach"
      data-sticky-cover="true"
      data-status={model.status}
      aria-label={model.a11y}
    >
      <p className={css.approachCaption}>
        <strong>{model.route} 路</strong>
        <span className={css.approachStatus} data-kind={model.status}>
          {model.status === 'arriving' ? '進站中' : model.status === 'soon' ? '快到' : model.status === 'far' ? '還很久' : '表定'}
        </span>
        {model.status === 'scheduled' ? <span>沒有即時位置</span> : null}
        {model.status !== 'scheduled' && model.status !== 'arriving' && model.minutes != null ? (
          <span>約 {model.minutes} 分</span>
        ) : null}
        {model.status === 'scheduled' && model.clock ? <span>{model.clock}</span> : null}
      </p>
      <div className={css.approachTrack} style={trackStyle} aria-hidden="true">
        <div className={css.approachRail} data-kind={model.status}>
          {model.stops.map((stop, index) => (
            <span
              key={`dot-${stop.key}`}
              className={css.approachDot}
              data-here={stop.here ? 'true' : undefined}
              style={{ left: `${(index / (count - 1)) * 100}%` }}
            />
          ))}
          {showBus ? (
            <span
              className={`${css.approachBus} ${css.approachBusReady}`}
              data-kind={model.status}
              data-testid="campus-approach-bus"
            >
              <BusMark />
            </span>
          ) : null}
        </div>
        <ol className={css.approachStops}>
          {model.stops.map((stop) => (
            <li key={stop.key} data-here={stop.here ? 'true' : undefined}>
              <strong>{stop.name}</strong>
              {stop.here ? <small>你在這裡</small> : null}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
