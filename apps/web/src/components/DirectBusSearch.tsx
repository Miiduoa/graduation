'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  campusEtaView, hasCampusNext, queryTransit,
  type DirectTripView, type TransferTripView, type TransitFailure, type TransitResult,
} from '@/lib/transit';
import {
  PROVIDENCE_DIRECT_CHIPS, directWaitLine, isDirectQueryText, suggestDirectDestinations,
} from '@/lib/transit-direct';
import css from './transit.module.css';

function LiveSignal() {
  return (
    <svg className={css.liveSignal} viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
      <path d="M2.2 8.2a5.2 5.2 0 0 1 7.6 0" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M4 9.4a2.6 2.6 0 0 1 4 0" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function TripEta({ trip, now }: { trip: DirectTripView; now: number }) {
  const view = campusEtaView(trip.arrival, now);
  if (view.kind === 'live' && view.minutes != null) {
    return (
      <span className={css.rowEta} data-kind="live">
        <LiveSignal />
        <span className={css.etaNumber}>{view.minutes}</span>
        <span className={css.etaUnit}>分</span>
      </span>
    );
  }
  return <span className={css.rowEta} data-kind={view.kind}>{view.text}</span>;
}

function transferNextLabel(view: ReturnType<typeof campusEtaView>): string {
  if (view.kind === 'live' || view.kind === 'soon') return view.text;
  if (view.clock) return `表定 ${view.clock}`;
  return '表定';
}

function TransferEta({ trip, now }: { trip: TransferTripView; now: number }) {
  const view = campusEtaView(trip.arrival, now);
  const live = view.kind === 'live' || view.kind === 'soon';
  return (
    <span className={css.rowEta} data-kind={live ? view.kind : 'scheduled'}>
      <span className={css.etaNumber}>{trip.totalMinutes}</span>
      <span className={css.etaUnit}>分</span>
      <small className={css.transferNext}>下一班 {transferNextLabel(view)}</small>
    </span>
  );
}

export function DirectBusSearch({ schoolId }: { schoolId: string }) {
  const enabled = hasCampusNext(schoolId);
  const [term, setTerm] = useState('');
  const [selected, setSelected] = useState('');
  const [result, setResult] = useState<TransitResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<TransitFailure | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [open, setOpen] = useState<string | null>(null);
  const generation = useRef(0);
  const suggestions = useMemo(() => suggestDirectDestinations(term), [term]);

  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 15_000);
    return () => {
      generation.current += 1;
      clearInterval(timer);
    };
  }, []);

  if (!enabled) return null;

  async function runSearch(destination: string) {
    const query = destination.normalize('NFKC').trim();
    if (!isDirectQueryText(query)) return;
    const current = ++generation.current;
    setSelected(query);
    setTerm(query);
    setBusy(true);
    setFailure(null);
    setOpen(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const next = await queryTransit({ action: 'direct', schoolId, destination: query }, controller.signal);
      if (current !== generation.current) return;
      if (next.status === 'ready') {
        setResult(next);
        setFailure(null);
      } else {
        setFailure(next.reason);
        setResult((currentResult) => currentResult?.status === 'ready' ? currentResult : next);
      }
      setClock(Date.now());
    } catch {
      if (current !== generation.current) return;
      setFailure('network');
      setResult((currentResult) => currentResult?.status === 'ready' ? currentResult : { status: 'unavailable', reason: 'network' });
    } finally {
      clearTimeout(timeout);
      if (current === generation.current) setBusy(false);
    }
  }

  const ready = result?.status === 'ready' && result.kind === 'direct' ? result : null;
  const trips = ready?.trips ?? [];
  const transfers = ready?.transfers ?? [];
  const mapsUrl = ready?.googleMapsUrl ?? '';
  const destinationLabel = ready?.destination?.label || selected;
  const noDirect = Boolean(ready && selected && !trips.length && !transfers.length);

  return (
    <section className={`${css.board} ${css.directSearch}`} aria-labelledby="direct-bus-title" data-testid="direct-bus-search">
      <header className={css.directHead}>
        <p className={css.eyebrow}>靜宜直達公車</p>
        <h2 id="direct-bus-title" className={css.directTitle}>去哪裡</h2>
        <p className={css.directLead}>輸入或點目的地，先找不用轉乘的公車；沒有直達或轉乘明顯較快時會列出轉乘建議。</p>
      </header>
      <form
        className={css.directForm}
        onSubmit={(event) => {
          event.preventDefault();
          void runSearch(term);
        }}
      >
        <label className={css.directLabel}>
          目的地
          <input
            type="search"
            value={term}
            maxLength={40}
            minLength={2}
            autoComplete="off"
            placeholder="沙鹿車站、臺中車站、主顧樓"
            onChange={(event) => setTerm(event.target.value)}
            data-testid="direct-destination-input"
          />
        </label>
        <button type="submit" className={css.primary} disabled={busy || !isDirectQueryText(term)}>
          {busy ? '查詢中…' : '找直達公車'}
        </button>
      </form>
      <div className={css.directChips} role="group" aria-label="常用目的地">
        {PROVIDENCE_DIRECT_CHIPS.map((chip) => (
          <button
            key={chip.query}
            type="button"
            className={css.directChip}
            aria-pressed={selected === chip.query}
            disabled={busy}
            onClick={() => void runSearch(chip.query)}
          >
            {chip.label}
          </button>
        ))}
      </div>
      {term.trim().length >= 2 && suggestions.length > 0 && suggestions.every((item) => item.query !== term.trim()) ? (
        <ul className={css.directSuggest} data-testid="direct-suggestions">
          {suggestions.slice(0, 6).map((item) => (
            <li key={item.query}>
              <button type="button" disabled={busy} onClick={() => void runSearch(item.query)}>{item.label}</button>
            </li>
          ))}
        </ul>
      ) : null}
      {failure && !ready ? <p className={css.directStatus} role="status">暫時讀不到到站資料，請稍後再試。</p> : null}
      {busy && !ready ? <p className={css.directStatus} role="status">正在找直達公車…</p> : null}
      {noDirect ? (
        <div className={css.directEmpty} role="status" data-testid="direct-no-result">
          <p><strong>沒有直達車</strong></p>
          <p>從靜宜到{destinationLabel}這版找不到不用轉乘的公車，也沒有可用的轉乘建議，沒有編造班次時間。</p>
          {mapsUrl ? <p><a href={mapsUrl} target="_blank" rel="noopener noreferrer">用 Google 地圖看更多路線 ↗</a></p> : null}
        </div>
      ) : null}
      {ready && !trips.length && transfers.length ? (
        <p className={css.directStatus} role="status">沒有直達車，以下是轉乘建議。</p>
      ) : null}
      {trips.length ? (
        <ol className={css.directTrips} data-testid="direct-trip-list">
          {trips.map((trip) => {
            const key = `${trip.route}:${trip.boardStopName}:${trip.alightStopName}`;
            const view = campusEtaView(trip.arrival, clock);
            const opened = open === key;
            return (
              <li key={key}>
                <button
                  type="button"
                  className={css.arrivalRow}
                  aria-expanded={opened}
                  data-testid="direct-trip"
                  onClick={() => setOpen(opened ? null : key)}
                >
                  <span className={css.routeBadge}>{trip.route}</span>
                  <span className={css.rowCopy}>
                    <strong>{directWaitLine(trip.boardStopName)}</strong>
                    <small>下車 {trip.alightStopName.replace(/[（(].*$/, '')}</small>
                  </span>
                  <TripEta trip={trip} now={clock} />
                </button>
                {opened ? (
                  <div className={css.rowPanel}>
                    <p>搭 {trip.route}，{directWaitLine(trip.boardStopName)}，在 {trip.alightStopName} 下車。</p>
                    <p>走到上車站約 {trip.walkMinutes} 分鐘（直線 {trip.walkMeters} 公尺 ÷ 每分鐘 80 公尺，四捨五入；不是導航路線時間）。</p>
                    {view.kind === 'scheduled' || view.kind === 'night' ? <p>目前沒有即時位置，顯示表定時間。</p> : null}
                    {view.kind === 'ended' ? <p>今天這班已收班，沒有另外編造末班時間。</p> : null}
                    {view.kind === 'empty' ? <p>暫無班次資訊，沒有用猜測時間代替。</p> : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}
      {transfers.length ? (
        <ol className={css.directTrips} data-testid="transfer-trip-list">
          {transfers.map((trip) => {
            const key = `transfer:${trip.firstRoute}:${trip.secondRoute}:${trip.boardStopName}:${trip.alightStopName}`;
            const view = campusEtaView(trip.arrival, clock);
            const opened = open === key;
            const live = view.kind === 'live' || view.kind === 'soon';
            const nextLine = transferNextLabel(view);
            return (
              <li key={key}>
                <button
                  type="button"
                  className={`${css.arrivalRow} ${css.transferRow}`}
                  aria-expanded={opened}
                  data-testid="transfer-trip"
                  onClick={() => setOpen(opened ? null : key)}
                >
                  <span className={css.routeBadge}>{trip.firstRoute}→{trip.secondRoute}</span>
                  <span className={css.rowCopy}>
                    <strong>{directWaitLine(trip.boardStopName)}</strong>
                    <small>轉乘 {trip.transferStopName.replace(/[（(].*$/, '')}（步行 {trip.transferWalkMinutes} 分）· 下車 {trip.alightStopName.replace(/[（(].*$/, '')}</small>
                  </span>
                  <TransferEta trip={trip} now={clock} />
                </button>
                {opened ? (
                  <div className={css.rowPanel}>
                    <p>上車站 {trip.boardStopName}，先搭 {trip.firstRoute}。</p>
                    <p>轉乘站 {trip.transferStopName}，步行約 {trip.transferWalkMinutes} 分鐘後搭 {trip.secondRoute}。</p>
                    <p>下車站 {trip.alightStopName}。全程約 {trip.totalMinutes} 分鐘。</p>
                    <p>下一班{live ? ` ${nextLine}` : ` ${nextLine}（沒有即時資料）`}。</p>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}
      {(trips.length || transfers.length) && mapsUrl ? (
        <p className={css.directMore}>
          <a href={mapsUrl} target="_blank" rel="noopener noreferrer">用 Google 地圖看更多路線 ↗</a>
        </p>
      ) : null}
    </section>
  );
}
