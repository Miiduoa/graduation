'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { revealStopResult } from '@/lib/revealStopResult';
import {
  CAMPUS_TRANSIT, TRANSIT_CITIES, TRANSIT_MESSAGES, arrivalKind, arrivalLabel, arrivalMatchesCampusGroup,
  directionLabel, formatDistance, hasCampusNext, isCity, isPosition, isStaticTransitStop,
  listedCampusStops, nextLiveArrival, preferredTransitCity, publicPlaceName, queryTransit,
  readSavedStops, stopMapUrl, TAICHUNG_BUS_URL, TAICHUNG_CATALOG_URL,
  type TransitArrival, type TransitCity, type TransitFailure, type TransitQuery, type TransitResult, type TransitRoute, type TransitStop,
} from '@/lib/transit';
import { CampusBusBoard } from './CampusBusBoard';
import { DirectBusSearch } from './DirectBusSearch';
import css from './transit.module.css';

const SAVED_KEY = 'campus-one:transit-stops:v1';
const stopKey = (stop: TransitStop) => `${stop.city}:${stop.id}`;
const isAborted = (error: unknown) => error instanceof Error && error.name === 'AbortError';
type Mode = 'campus' | 'nearby' | 'search' | 'saved';
const catalogDirection = (direction: string) => direction === '去' ? '去程' : direction === '返' ? '返程' : direction || '方向未提供';
function catalogSummary(routes: TransitRoute[] = []): string {
  if (!routes.length) return '靜態站牌資料';
  const names = [...new Set(routes.map((route) => route.name))];
  const directions = [...new Set(routes.map((route) => catalogDirection(route.direction)))];
  return `${names.slice(0, 3).join('、')}${names.length > 3 ? ' 等路線' : ' 路線'} · ${directions.join('／')} · 靜態站牌資料`;
}
function stopSubtitle(stop: TransitStop): string {
  if (isStaticTransitStop(stop)) return catalogSummary(stop.routes);
  if (stop.routes?.length) {
    const names = [...new Set(stop.routes.map((route) => route.name))];
    return `${names.slice(0, 3).join('、')}${names.length > 3 ? ' 等路線' : ' 路線'}`;
  }
  return stop.distance !== null ? `${formatDistance(stop.distance)} · 直線距離` : TRANSIT_CITIES[stop.city];
}
function listedKey(stop: TransitStop) {
  return `${stop.city}:${stop.id}:${stop.name}`;
}

function StopArrivals({ stop, groupLabel }: { stop: TransitStop; groupLabel?: string }) {
  const pane = useRef<HTMLElement>(null);
  const [result, setResult] = useState<TransitResult | null>(null);
  const [busy, setBusy] = useState(true);
  const [revision, setRevision] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const [filter, setFilter] = useState('');
  const [direction, setDirection] = useState('all');
  const [offline, setOffline] = useState(false);
  const [failure, setFailure] = useState<TransitFailure | null>(null);
  const [retryAt, setRetryAt] = useState(0);
  const readyRef = useRef<TransitResult | null>(null);
  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function refresh() {
      if (!active || controller || document.visibilityState === 'hidden' || !navigator.onLine) {
        if (active && !navigator.onLine) { setOffline(true); setBusy(false); }
        return;
      }
      const current = new AbortController();
      controller = current;
      const timeout = setTimeout(() => current.abort(), 20_000);
      setBusy(true);
      let delay = 30_000;
      try {
        const next = await queryTransit({ action: 'arrivals', city: stop.city, stopId: stop.id }, current.signal);
        if (!active || current.signal.aborted) return;
        if (next.status === 'ready') {
          readyRef.current = next;
          setResult(next);
          setFailure(null);
          setRetryAt(0);
        } else {
          // 忙碌或暫時失敗時保留上次成功班次，不讓畫面整片消失；舊資料逾時後
          // arrivalLabel 會自動改顯示「資料待更新」，不會假裝還在倒數。
          setFailure(next.reason);
          setRetryAt(Date.now() + 60_000);
          if (!readyRef.current) setResult(next);
          delay = 60_000;
        }
        setClock(Date.now());
      } catch {
        if (active && controller === current) {
          setFailure('network');
          setRetryAt(Date.now() + 60_000);
          if (!readyRef.current) setResult({ status: 'unavailable', reason: 'network' });
          delay = 60_000;
        }
      } finally {
        clearTimeout(timeout);
        if (controller === current) controller = null;
        if (active) {
          setBusy(false);
          if (document.visibilityState === 'visible' && navigator.onLine) timer = setTimeout(() => void refresh(), delay);
        }
      }
    }
    const resume = () => {
      clearTimeout(timer);
      setOffline(!navigator.onLine);
      setClock(Date.now());
      if (document.visibilityState === 'visible' && navigator.onLine) void refresh();
    };
    const clockTimer = setInterval(() => setClock(Date.now()), 15_000);
    void refresh();
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    window.addEventListener('offline', resume);
    return () => {
      active = false;
      controller?.abort();
      clearTimeout(timer);
      clearInterval(clockTimer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('offline', resume);
    };
  }, [stop.city, stop.id, revision]);
  const arrivalsReady = result?.status === 'ready';
  useEffect(() => {
    revealStopResult(pane.current);
  }, [stop.city, stop.id, arrivalsReady]);
  const rows = result?.status === 'ready' && result.kind === 'arrivals' ? result.arrivals : [];
  const shown = rows.filter((row) => row.route.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()) &&
    (direction === 'all' || String(row.direction) === direction) &&
    (!groupLabel || arrivalMatchesCampusGroup(row, groupLabel)));
  const liveRows = shown.filter((row) => arrivalKind(row, clock) === 'live');
  const otherRows = shown.filter((row) => arrivalKind(row, clock) !== 'live');
  const nextBus = nextLiveArrival(shown, clock);
  const coolingDown = failure !== null && clock < retryAt;
  const fetchedTime = result?.status === 'ready' ? new Date(result.fetchedAt).toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit' }) : '';
  const renderRow = (row: TransitArrival, secondary: boolean) => <li key={row.id} className={secondary ? css.secondaryRow : undefined}>
    <div><strong className={css.route}>{row.route}</strong><span className={css.note}>{directionLabel(row)}</span></div>
    <strong className={css.eta}>{offline ? '離線，待更新' : arrivalLabel(row, clock)}</strong>
  </li>;
  return (
    <section
      ref={pane}
      className={css.arrivals}
      data-testid="stop-arrivals-pane"
      tabIndex={-1}
      aria-labelledby="transit-arrivals-title"
      aria-busy={busy}
    >
      <div className={css.sectionHeading}>
        <div><p className={css.eyebrow}>候車站牌 · {TRANSIT_CITIES[stop.city]}</p><h3 id="transit-arrivals-title">{stop.name}</h3></div>
        <button type="button" className={css.secondary} disabled={busy || offline || coolingDown} onClick={() => { setBusy(true); setRevision((value) => value + 1); }}>
          {busy ? '查詢中…' : coolingDown ? '稍後自動再試' : '更新班次'}
        </button>
      </div>
      <p className={css.note}>同名站牌可能位於道路兩側。上車前請核對車頭方向，勿只看站名。</p>
      <a className={css.mapLink} href={stopMapUrl(stop)} target="_blank" rel="noopener noreferrer">開啟步行導航 ↗</a>
      {offline && <p className={css.message} role="status">目前離線，恢復網路後會重新查詢。請勿依舊資料趕車。</p>}
      {!result && <p className={css.empty} role="status">正在取得這個站牌的班次…</p>}
      {result?.status === 'unavailable' && <p className={css.message} role="status">{TRANSIT_MESSAGES[result.reason]}{result.reason === 'rate-limited' ? ' 約 1 分鐘後會自動再查，這段時間先不要連續按更新。' : ''}</p>}
      {failure && result?.status === 'ready' && <p className={css.message} role="status">{failure === 'rate-limited' ? `查詢的人較多，先顯示 ${fetchedTime} 查到的班次，約 1 分鐘後會自動再查；請先不要連續按更新。` : `這次更新沒有成功，先顯示 ${fetchedTime} 查到的班次；資料太舊時會改顯示「資料待更新」。`}</p>}
      {result?.status === 'ready' && result.kind === 'arrivals' && <>
        {nextBus ? <p className={css.nextBus} role="status"><span>下一班</span><strong>{nextBus.route} 路 · {offline ? '離線，待更新' : arrivalLabel(nextBus, clock)}</strong><span>{directionLabel(nextBus)}</span></p> : shown.length > 0 && <p className={css.message} role="status">目前沒有可用的即時到站預估。下方班次多是末班已駛離或尚未發車，請勿依這些狀態趕車；出發前可再查官方網站。</p>}
        <div className={css.filters}>
          <label>篩選路線<input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="例如 300" /></label>
          <label>行車方向<select value={direction} onChange={(event) => setDirection(event.target.value)}><option value="all">所有方向</option><option value="0">去程</option><option value="1">返程</option></select></label>
        </div>
        {shown.length ? <>
          {liveRows.length > 0 && <ul className={css.arrivalList}>{liveRows.map((row) => renderRow(row, false))}</ul>}
          {otherRows.length > 0 && <>
            {liveRows.length > 0 && <h4 className={css.otherHeading}>其他班次（目前沒有即時預估）</h4>}
            <ul className={`${css.arrivalList} ${css.secondaryList}`}>{otherRows.map((row) => renderRow(row, true))}</ul>
          </>}
        </> : <p className={css.empty}>{rows.length ? '沒有符合篩選條件的路線，請清除路線或方向篩選。' : '目前沒有班次預估。這不代表今天沒有公車，請再向官方查詢確認。'}</p>}
        <p className={css.note}>{result.stale ? `查詢的人較多，先顯示 ${fetchedTime} 向 TDX 取得的最近一份資料，稍後會自動更新。` : `TDX 提供資料 · 查詢於 ${fetchedTime}。`}每筆預估依來源更新時間判斷，逾時不顯示倒數。</p>
      </>}
    </section>
  );
}


function StaticStopDetails({ stop }: { stop: TransitStop }) {
  const pane = useRef<HTMLElement>(null);
  useEffect(() => {
    revealStopResult(pane.current);
  }, [stop.city, stop.id]);
  return (
    <section
      ref={pane}
      className={css.arrivals}
      data-testid="stop-arrivals-pane"
      tabIndex={-1}
      aria-labelledby="transit-static-title"
    >
    <div className={css.sectionHeading}>
      <div><p className={css.eyebrow}>候車站牌 · 臺中市</p><h3 id="transit-static-title">{stop.name}</h3></div>
      <span className={css.source}>靜態站牌資料</span>
    </div>
    <p className={css.note}>同名站牌可能位於道路兩側。上車前請核對車頭方向，勿只看站名。</p>
    <a className={css.mapLink} href={stopMapUrl(stop)} target="_blank" rel="noopener noreferrer">開啟步行導航 ↗</a>
    <div className={css.message} role="status">
      <strong>班次時間請至官方網站確認</strong>
      <p>以下是站牌與行經路線資料，沒有班次時間或到站倒數。出發前請到官方網站確認目前營運與到站情況。</p>
      <a href={TAICHUNG_BUS_URL} target="_blank" rel="noopener noreferrer">前往臺中公車查即時到站 ↗</a>
    </div>
    <h4 className={css.routeHeading}>行經路線與方向</h4>
    {stop.routes?.length ? <ul className={css.catalogRoutes}>{stop.routes.map((route, index) => <li key={`${route.name}:${route.direction}:${route.destination}:${index}`}>
      <strong>{route.name}</strong>
      <span>{[catalogDirection(route.direction), route.destination ? `往 ${publicPlaceName(route.destination) || route.destination}` : '目的地未提供'].filter(Boolean).join(' · ')}</span>
    </li>)}</ul> : <p className={css.empty}>來源未提供行經路線，請至官方網站查詢。</p>}
    <p className={css.note}><a href={TAICHUNG_CATALOG_URL} target="_blank" rel="noopener noreferrer">臺中市政府公車路線站牌資料 ↗</a><br />
      {stop.catalogDate && <>資料快照：{new Date(stop.catalogDate).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' })}。</>}
      來源不定期更新，路線可能調整；收藏會保留當時的資料。
    </p>
    </section>
  );
}

function StopResults({ query, saved, toggleSaved }: {
  query: TransitQuery | null;
  saved: TransitStop[];
  toggleSaved: (stop: TransitStop) => void;
}) {
  const [result, setResult] = useState<TransitResult | null>(null);
  const [selected, setSelected] = useState<TransitStop | null>(null);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(Boolean(query));
  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 20_000);
    queryTransit(query, controller.signal).then((next) => {
      if (!active || controller.signal.aborted) return;
      setResult(next);
      if (next.status === 'ready' && next.kind === 'stops' && query.action !== 'campus') setSelected(next.stops[0] ?? null);
    }).catch((error: unknown) => {
      if (active) setResult({ status: 'unavailable', reason: isAborted(error) ? 'upstream' : 'network' });
    }).finally(() => { clearTimeout(timeout); if (active) setBusy(false); });
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [query, retry]);
  const stops = query ? (result?.status === 'ready' && result.kind === 'stops' ? result.stops : []) : saved;
  const grouped = Boolean(query?.action === 'campus' && stops.length);
  const campusList = grouped ? listedCampusStops(stops) : null;
  const shownStops = campusList ? campusList.listed : stops;
  const current = selected ? shownStops.find((stop) => listedKey(stop) === listedKey(selected)) ??
    stops.find((stop) => stopKey(stop) === stopKey(selected)) ?? null : null;
  const failed = result?.status === 'unavailable';
  const waiting = Boolean(query) && busy && !failed;
  const emptyCopy = !query ? '在站牌旁按「收藏」，下次便能直接查詢，不必再次定位。'
    : query.action === 'campus' ? '這間學校附近還沒有站牌資料。'
    : '沒有找到站牌。可以擴大搜尋範圍、確認縣市，或改用較短的站名。';
  return (
    <div className={css.workspace}>
      <section className={css.stops} aria-labelledby="transit-stops-title" aria-busy={busy} data-testid="stop-groups">
        <div className={css.sectionHeading}><h3 id="transit-stops-title">{query?.action === 'nearby' ? '附近站牌' : query ? '可搭乘站牌' : '我的常用站牌'}</h3>{!waiting && !failed && (shownStops.length > 0 || !query) && <span className={css.count}>{grouped ? `${shownStops.length} 組` : `${stops.length} 站`}</span>}</div>
        {query?.action === 'nearby' && !waiting && !failed && <p className={css.note}>{TRANSIT_CITIES[query.city]} · {query.radius} 公尺內，依直線距離排序。實際步行路線請看導航。</p>}
        {waiting && <p className={css.empty} role="status">正在讀取站牌…</p>}
        {!waiting && !failed && grouped && shownStops.length > 0 && <p className={css.note}>依站序和位置分成學生常用的幾組。點開後再確認路線與方向。</p>}
        {!waiting && !failed && !grouped && stops.length > 1 && new Set(stops.map((stop) => stop.name)).size < stops.length && <p className={css.note}>同名站牌不只一個，可能是道路兩側或行經路線不同；點開後先看路線與方向，再決定在哪裡上車。</p>}
        {failed && <div className={css.message} role="status"><p>{result?.status === 'unavailable' && result.reason === 'rate-limited' ? '查詢的人較多，服務忙碌中。請等約 1 分鐘再試一次，或先看下方官方公車網站。' : '暫時讀不到資料，請稍後再試'}</p><button type="button" className={css.secondary} disabled={busy} onClick={() => { setBusy(true); setResult(null); setSelected(null); setRetry((value) => value + 1); }}>再試一次</button></div>}
        {!waiting && !failed && !stops.length && <p className={css.empty}>{emptyCopy}</p>}
        {!waiting && !failed && shownStops.length > 0 && <ul className={`${css.stopList}${grouped ? ` ${css.groupedStops}` : ''}`}>{shownStops.map((stop, index) => {
          const isSaved = saved.some((entry) => stopKey(entry) === stopKey(stop));
          const accessibleName = `${stop.name} ${stopSubtitle(stop)} 第 ${index + 1} 站牌`;
          const repeatsCity = stop.distance === null && stopSubtitle(stop) === TRANSIT_CITIES[stop.city];
          return <li key={listedKey(stop)} data-selected={current && listedKey(current) === listedKey(stop) ? 'true' : undefined}>
            <button type="button" className={css.stopButton} aria-pressed={Boolean(current && listedKey(current) === listedKey(stop))} onClick={() => setSelected(stop)}>
              <span className={css.stopNumber}>{String(index + 1).padStart(2, '0')}</span><span><strong>{stop.name}</strong><small>{stop.distance !== null && !grouped ? `${formatDistance(stop.distance)} · 直線距離` : grouped ? stopSubtitle(stop) : TRANSIT_CITIES[stop.city]}{grouped || repeatsCity ? null : <><br />{stopSubtitle(stop)}</>}</small></span>
            </button>
            <button type="button" className={css.saveButton} aria-label={`${isSaved ? '取消收藏' : '收藏'} ${accessibleName}`} aria-pressed={isSaved} onClick={() => toggleSaved(stop)}>{isSaved ? '已收藏' : '收藏'}</button>
          </li>;
        })}</ul>}
        {campusList && campusList.extra.length > 0 && !waiting && !failed && <details className={css.extraStops}><summary>其他站牌 {campusList.extra.length} 組</summary>
          <ul className={css.stopList}>{campusList.extra.map((group, index) => {
            const stop = { ...group.representative, name: group.label };
            return <li key={listedKey(stop)}>
              <button type="button" className={css.stopButton} onClick={() => setSelected(stop)}>
                <span className={css.stopNumber}>{String(index + 1).padStart(2, '0')}</span><span><strong>{stop.name}</strong><small>{stopSubtitle(stop)}</small></span>
              </button>
            </li>;
          })}</ul>
        </details>}
        {result?.status === 'ready' && result.kind === 'stops' && result.limited && !waiting && !failed && !grouped && <p className={css.note}>{query?.action === 'campus' ? '學校附近站牌較多，目前先列出前 16 站；找不到要搭的站牌時，改用「搜尋站名」輸入完整站名。' : '此範圍資料較多，僅列出部分站牌；請縮小範圍確認。'}</p>}
      </section>
      {current ? isStaticTransitStop(current) ? <StaticStopDetails key={listedKey(current)} stop={current} /> : <StopArrivals key={listedKey(current)} stop={current} groupLabel={grouped ? current.name : undefined} /> : !waiting && !failed && (stops.length > 0 || !query) ? <div className={css.placeholder}><span aria-hidden="true">→</span><h3>選好站牌，再確認方向</h3><p>點選站牌，查看路線資料與步行導航；有接通動態資料的站牌會顯示到站預估。</p></div> : null}
    </div>
  );
}

export function TransitExplorer(props: { schoolId: string; schoolName: string; legacy?: ReactNode }) {
  return <TransitExplorerContent key={props.schoolId} {...props} />;
}

function TransitExplorerContent({ schoolId, schoolName, legacy }: { schoolId: string; schoolName: string; legacy?: ReactNode }) {
  const campus = Object.hasOwn(CAMPUS_TRANSIT, schoolId) ? CAMPUS_TRANSIT[schoolId] : undefined;
  const [mode, setMode] = useState<Mode>(campus ? 'campus' : 'search');
  const [city, setCity] = useState<TransitCity | ''>(campus?.city ?? preferredTransitCity(schoolId) ?? '');
  const [radius, setRadius] = useState(600);
  const [term, setTerm] = useState('');
  const [lookup, setLookup] = useState<{ query: TransitQuery | null; revision: number }>({
    query: campus && !hasCampusNext(schoolId) ? { action: 'campus', schoolId } : null,
    revision: 0,
  });
  const [saved, setSaved] = useState<TransitStop[]>([]);
  const [message, setMessage] = useState('');
  const [locating, setLocating] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    const restore = () => { try { setSaved(readSavedStops(localStorage.getItem(SAVED_KEY))); } catch { setSaved([]); } };
    restore();
    window.addEventListener('storage', restore);
    return () => { generation.current += 1; window.removeEventListener('storage', restore); };
  }, []);
  function search(query: TransitQuery | null) { setLookup((value) => ({ query, revision: value.revision + 1 })); }
  function switchMode(next: Mode) {
    generation.current += 1;
    setLocating(false);
    setMessage('');
    setMode(next);
    if (next === 'campus' && campus) setCity(campus.city);
    search(next === 'campus' && campus && !hasCampusNext(schoolId) ? { action: 'campus', schoolId } : null);
  }
  function locate() {
    const current = ++generation.current;
    setMessage('');
    const queryCity = city;
    if (!isCity(queryCity)) {
      setMessage('請先選擇要查詢的縣市，再尋找附近站牌。');
      return;
    }
    if (!window.isSecureContext || !navigator.geolocation) {
      setMessage('此瀏覽器無法使用定位。請改用學校站牌，或輸入站名搜尋。');
      return;
    }
    setLocating(true);
    search(null);
    navigator.geolocation.getCurrentPosition((position) => {
      if (current !== generation.current) return;
      setLocating(false);
      const point = { lat: position.coords.latitude, lon: position.coords.longitude };
      if (!isPosition(point)) { setMessage('無法確認目前位置，請改用站名搜尋。'); return; }
      if (position.coords.accuracy > 500) setMessage('定位誤差較大，站牌距離僅供參考；建議確認站名或重新定位。');
      search({ action: 'nearby', city: queryCity, ...point, radius });
    }, (error) => {
      if (current !== generation.current) return;
      setLocating(false);
      setMessage(error.code === 1 ? '你尚未允許定位。可直接使用學校站牌，或搜尋站名；不影響其他功能。' : error.code === 3 ? '定位逾時，請移到訊號較好的地方重試，或改用站名搜尋。' : '暫時無法取得位置，請重新定位或改用站名搜尋。');
    }, { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 });
  }
  function toggleSaved(stop: TransitStop) {
    const existing = saved.some((item) => stopKey(item) === stopKey(stop));
    if (!existing && saved.length >= 16) { setMessage('最多可收藏 16 個站牌，請先移除不常使用的站牌。'); return; }
    const next = existing ? saved.filter((item) => stopKey(item) !== stopKey(stop)) : [...saved, { ...stop, distance: null }];
    setSaved(next);
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(next)); setMessage(existing ? '已取消收藏。' : '已收藏在這個瀏覽器；不會儲存你目前的位置。'); }
    catch { setMessage('瀏覽器不允許儲存，這次收藏僅在目前頁面有效。'); }
  }
  const board = hasCampusNext(schoolId) && mode === 'campus';
  return <div className={`${css.explorer}${board ? ` ${css.campusFirst}` : ''}`}>
    {board && <DirectBusSearch schoolId={schoolId} />}
    {board && <CampusBusBoard schoolId={schoolId} schoolName={schoolName} />}
    {!board && <header className={css.intro}><div><p className={css.eyebrow}>公車與交通</p><h2>找到上車站牌</h2><p>先找上車地點，再確認路線和方向。沒有開啟定位，也能查詢。</p></div></header>}
    <div className={css.modeBar} role="group" aria-label="站牌查詢方式">
      {campus && <button type="button" aria-pressed={mode === 'campus'} onClick={() => switchMode('campus')}>學校站牌</button>}
      <button type="button" aria-pressed={mode === 'nearby'} onClick={() => switchMode('nearby')}>找我附近</button>
      <button type="button" aria-pressed={mode === 'search'} onClick={() => switchMode('search')}>搜尋站名</button>
      <button type="button" aria-pressed={mode === 'saved'} onClick={() => switchMode('saved')}>常用站牌{saved.length > 0 ? ` ${saved.length}` : ''}</button>
    </div>
    {!board && <>
      <div className={css.controls}>
        {mode === 'campus' && <p className={css.scope}><strong>{schoolName}</strong> · 尋找名稱含「{campus?.stopName}」的站牌，不需要先記住路線號碼。</p>}
        {(mode === 'nearby' || mode === 'search') && <label>查詢縣市<select value={city} onChange={(event) => {
          if (!isCity(event.target.value)) return;
          generation.current += 1; setLocating(false); setCity(event.target.value); setMessage(''); search(null);
        }}><option value="" disabled>請先選擇縣市</option>{Object.entries(TRANSIT_CITIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
        {mode === 'nearby' && <><label>搜尋半徑<select value={radius} onChange={(event) => { generation.current += 1; setLocating(false); setRadius(Number(event.target.value)); search(null); }}><option value={300}>300 公尺</option><option value={600}>600 公尺</option><option value={1000}>1 公里</option></select></label><button type="button" className={css.primary} disabled={locating} onClick={locate}>{locating ? '正在取得位置…' : '使用我的位置'}</button></>}
        {mode === 'search' && <form className={css.searchForm} onSubmit={(event) => { event.preventDefault(); if (term.trim().length < 2) { setMessage('請輸入至少兩個字的站名。'); return; } if (!isCity(city)) { setMessage('請先選擇要查詢的縣市。'); return; } setMessage(''); search({ action: 'search', city, text: term.trim() }); }}><label>站名或學校名稱<input type="search" value={term} maxLength={40} minLength={2} required placeholder="例如 靜宜大學、臺中車站" onChange={(event) => setTerm(event.target.value)} /></label><button type="submit" className={css.primary}>尋找站牌</button></form>}
        {mode === 'saved' && <p className={css.scope}>收藏只保存在目前瀏覽器。清除瀏覽器資料後，收藏也會移除。</p>}
      </div>
      {(mode === 'nearby' || mode === 'search') && <p className={css.privacy}>縣市僅決定查詢範圍；同一大學若有跨縣市校區，請切換到實際搭車地點的縣市。</p>}
      {mode === 'nearby' && <p className={css.privacy}>只查詢所選縣市。定位僅在你按下按鈕後使用，不會寫入個人檔案；不會持續追蹤。跨縣市旅行時請切換查詢縣市。</p>}
      {message && <p className={css.message} role="status">{message}</p>}
      {lookup.query || mode === 'saved' ? <StopResults key={`${mode}:${lookup.revision}`} query={lookup.query} saved={saved} toggleSaved={toggleSaved} /> : <p className={css.empty}>{locating ? '正在取得你的位置；也可以切回學校站牌，不需等待定位。' : mode === 'nearby' ? '選好縣市與範圍後，按「使用我的位置」查詢。' : '輸入站名後按搜尋，不會在每次打字時傳送查詢。'}</p>}
    </>}
    <footer className={css.footer}><a href={city === 'Taichung' ? TAICHUNG_BUS_URL : 'https://www.taiwanbus.tw/'} target="_blank" rel="noopener noreferrer">官方公車網站 ↗</a></footer>
    {legacy && <details className={css.legacy}><summary>已登錄校園路線 · 備用查詢</summary>{legacy}</details>}
  </div>;
}
