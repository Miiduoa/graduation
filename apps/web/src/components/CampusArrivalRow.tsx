'use client';

import { useEffect, useRef, useState } from 'react';
import { revealStopResult } from '@/lib/revealStopResult';
import {
  campusArrivalA11yLabel, campusDestinationFull, campusEtaView, campusHeadingText,
  nextScheduledClock, waitingPlaceLine,
  type CampusNextRow,
} from '@/lib/transit';
import css from './transit.module.css';

function LiveSignal() {
  return (
    <svg className={css.liveSignal} viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
      <path d="M2.2 8.2a5.2 5.2 0 0 1 7.6 0" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M4 9.4a2.6 2.6 0 0 1 4 0" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function Eta(props: { view: ReturnType<typeof campusEtaView> }) {
  const { view } = props;
  if (view.kind === 'live' && view.minutes != null) {
    return (
      <span className={css.rowEta} data-kind="live">
        <LiveSignal />
        <span className={css.etaNumber}>{view.minutes}</span>
        <span className={css.etaUnit}>分</span>
      </span>
    );
  }
  if (view.kind === 'soon') {
    return <span className={css.rowEta} data-kind="soon">{view.text}</span>;
  }
  return <span className={css.rowEta} data-kind={view.kind}>{view.text}</span>;
}

export function CampusArrivalRow(props: {
  row: CampusNextRow;
  now: number;
  active?: boolean;
  onSelect?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) revealStopResult(panel.current);
  }, [open]);
  const view = campusEtaView(props.row.arrival, props.now);
  const heading = campusHeadingText(props.row);
  const destination = campusDestinationFull(props.row);
  const nextClock = nextScheduledClock(props.row.arrival, props.now);
  const ended = view.kind === 'ended';
  const stopName = props.row.arrival?.stopName ?? '';
  const wait = stopName ? waitingPlaceLine(stopName) : '';
  const label = campusArrivalA11yLabel(props.row, props.now);
  return (
    <div>
      <button
        type="button"
        className={`${css.arrivalRow}${ended ? ` ${css.arrivalRowEnded}` : ''}`}
        aria-expanded={open}
        aria-current={props.active ? 'true' : undefined}
        aria-label={label}
        onClick={() => {
          props.onSelect?.();
          setOpen((value) => !value);
        }}
      >
        <span className={css.routeBadge}>{props.row.route}</span>
        <span className={css.rowCopy}>
          {heading ? <strong title={heading}>{heading}</strong> : null}
          {nextClock ? <small>下一班表定 {nextClock}</small> : null}
        </span>
        <Eta view={view} />
      </button>
      {open ? (
        <div ref={panel} className={css.rowPanel} data-testid="opened-route-panel">
          {destination ? <p>終點 {destination}</p> : <p>終點未提供</p>}
          {wait ? <p>{wait}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
