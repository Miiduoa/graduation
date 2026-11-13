'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Modal } from '@/components/ui/Modal';
import { buildCampusSpatialModel } from './campusSpatialModel';
import {
  DEFAULT_SPATIAL_BEARING,
  MAX_SPATIAL_ZOOM,
  MIN_SPATIAL_ZOOM,
  SPATIAL_ROTATION_STEP,
  SPATIAL_ZOOM_FACTOR,
  normalizeSpatialCamera,
  spatialNorthRotationDegrees,
  type CampusSpatialCamera,
} from './campusSpatialCamera';
import type { CampusSpatialScene } from './campusSpatialScene';
import { appleWalkingDirectionsUrl, walkingDirectionsUrl, type MapLocation } from './mapService';
import { isProvidencePendingVerification, providencePlaceSourceUrl } from './providenceCampus';
import { PROVIDENCE_CAMPUS_SOURCE } from '@campus/shared/src/providenceCampus';
import { parseProvidenceFootprintSnapshot, type ProvidenceFootprint } from './providenceFootprints';
import { reuseUnchangedProvidenceFootprints } from './footprintSnapshotEquality';
import BuildingPlanPreview from './buildingPlans/BuildingPlanPreview';
import styles from './CampusSpatialExplorer.module.css';

type Props = {
  school: string;
  locations: MapLocation[];
  selected: MapLocation | null;
  onSelect: (location: MapLocation) => void;
};

// Reuse a single empty array to avoid recreating a WebGL context whenever
// the footprint status or the visible map selection changes.
const NO_VISIBLE_FOOTPRINTS: readonly ProvidenceFootprint[] = [];
const FOOTPRINT_DAY_MS = 24 * 60 * 60 * 1000;

// A dated stale fallback may return HTTP 200 together with Retry-After.
// Validate the seconds before disabling the manual retry on mobile.
function footprintCooldownSeconds(response: Response): number | null {
  const raw = response.headers?.get('retry-after')?.trim();
  return raw && /^[1-9]\d{0,5}$/.test(raw) ? Math.min(86_400, Number(raw)) : null;
}

function readAppearance() {
  const root = document.documentElement;
  const reduced = root.dataset.reducedMotion === 'true' ||
    Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const dark = root.dataset.theme === 'dark' ||
    (root.dataset.theme !== 'light' && Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches));
  return `${reduced ? 'reduced' : 'motion'}:${dark ? 'dark' : 'light'}`;
}

function subscribeAppearance(notify: () => void) {
  const media = ['(prefers-reduced-motion: reduce)', '(prefers-color-scheme: dark)']
    .map((query) => window.matchMedia?.(query));
  for (const query of media) query?.addEventListener('change', notify);
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-reduced-motion', 'data-theme'],
  });
  return () => {
    observer.disconnect();
    for (const query of media) query?.removeEventListener('change', notify);
  };
}

function SpatialCanvas({ model, selectedId, overhead, camera, onCameraChange, onSelect, footprints }: {
  model: ReturnType<typeof buildCampusSpatialModel>;
  selectedId: string | null;
  overhead: boolean;
  camera: CampusSpatialCamera;
  onCameraChange: (camera: CampusSpatialCamera) => void;
  onSelect: (id: string) => void;
  footprints: readonly ProvidenceFootprint[];
}) {
  const appearance = useSyncExternalStore(subscribeAppearance, readAppearance, () => 'reduced:light');
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const helpId = useId();
  const runtime = useRef<CampusSpatialScene | null>(null);
  const view = useMemo(() => ({
    selectedId,
    overhead,
    bearing: camera.bearing,
    zoom: camera.zoom,
    motion: appearance.startsWith('motion:'),
    dark: appearance.endsWith(':dark'),
  }), [selectedId, overhead, camera.bearing, camera.zoom, appearance]);
  const currentView = useRef(view);

  useEffect(() => {
    currentView.current = view;
    runtime.current?.setView(view);
  }, [view]);

  useEffect(() => {
    if (!host) return;
    let active = true;
    let visible = true;
    let scene: CampusSpatialScene | null = null;
    setStatus('loading');

    const updateVisibility = () => scene?.setActive(visible && !document.hidden);
    const fail = () => {
      if (!active) return;
      active = false;
      scene?.dispose();
      scene = null;
      runtime.current = null;
      setStatus('error');
    };
    const timeout = window.setTimeout(fail, 12000);
    // Neither Three.js nor a graphics context is requested before the dialog opens.
    void import('./campusSpatialScene').then(({ createCampusSpatialScene }) => {
      if (!active) return;
      scene = createCampusSpatialScene(host, model, { onSelect, onCameraChange, onError: fail, footprints });
      if (!active) {
        scene.dispose();
        scene = null;
        return;
      }
      runtime.current = scene;
      scene.setView(currentView.current);
      if (!active) return;
      updateVisibility();
      window.clearTimeout(timeout);
      setStatus('ready');
    }).catch(fail);

    const intersection = typeof IntersectionObserver === 'undefined' ? null :
      new IntersectionObserver(([entry]) => {
        visible = entry?.isIntersecting ?? false;
        updateVisibility();
      });
    intersection?.observe(host);
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      active = false;
      window.clearTimeout(timeout);
      intersection?.disconnect();
      document.removeEventListener('visibilitychange', updateVisibility);
      scene?.dispose();
      runtime.current = null;
    };
  }, [host, model, onSelect, onCameraChange, attempt, footprints]);

  return (
    <>
    <div className={styles.scene} data-spatial-state={status}>
      <div
        ref={setHost}
        className={styles.sceneHost}
        role="group"
        aria-label="校園地點空間圖"
        aria-describedby={status === 'ready' ? helpId : undefined}
        tabIndex={status === 'ready' ? 0 : -1}
      />
      {status !== 'ready' && (
        <div className={styles.sceneMessage} role="status">
          {status === 'loading' ? <p>正在開啟空間導覽…</p> : <>
            <p>這次無法顯示立體畫面。你仍可選擇地點，查看資訊與導航。</p>
            <button className="btn" type="button" onClick={() => setAttempt((value) => value + 1)}>
              重試立體畫面
            </button>
          </>}
        </div>
      )}
      <span className={styles.sceneCaption}>地點位置示意</span>
    </div>
    {status === 'ready' && <>
      <div className={styles.cameraTools} role="group" aria-label="調整空間視角">
        <button className="btn" type="button" aria-label="向左旋轉" title="向左旋轉" onClick={() => onCameraChange({ ...camera, bearing: camera.bearing - SPATIAL_ROTATION_STEP })}>↶</button>
        <button className="btn" type="button" aria-label="向右旋轉" title="向右旋轉" onClick={() => onCameraChange({ ...camera, bearing: camera.bearing + SPATIAL_ROTATION_STEP })}>↷</button>
        <button className="btn" type="button" aria-label="縮小空間圖" title="縮小空間圖" disabled={camera.zoom <= MIN_SPATIAL_ZOOM} onClick={() => {
          if (camera.zoom > MIN_SPATIAL_ZOOM) onCameraChange({ ...camera, zoom: camera.zoom / SPATIAL_ZOOM_FACTOR });
        }}>−</button>
        <button className="btn" type="button" aria-label="放大空間圖" title="放大空間圖" disabled={camera.zoom >= MAX_SPATIAL_ZOOM} onClick={() => {
          if (camera.zoom < MAX_SPATIAL_ZOOM) onCameraChange({ ...camera, zoom: camera.zoom * SPATIAL_ZOOM_FACTOR });
        }}>＋</button>
        <button className="btn" type="button" onClick={() => onCameraChange({ bearing: 0, zoom: 1 })}>回到北向</button>
        <span>縮放 {Math.round(camera.zoom * 100)}%</span>
        <span className={styles.compass}>
          <svg viewBox="0 0 40 40" width="32" height="32" aria-hidden="true">
            <g transform={`rotate(${spatialNorthRotationDegrees(camera.bearing, overhead)} 20 20)`}>
              <path d="M20 4L28 30L20 24L12 30Z" fill="currentColor" />
            </g>
          </svg>
          <span>畫面北向</span>
        </span>
      </div>
      <p id={helpId} className={styles.note}>橫向拖曳旋轉；聚焦空間圖後，可用左右鍵旋轉、＋／− 縮放，Home 回到北向。</p>
    </>}
    </>
  );
}

function SpatialDialog({ school, locations, selected, onSelect, onClose }: Props & { onClose: () => void }) {
  const model = useMemo(() => buildCampusSpatialModel(locations), [locations]);
  // Only a deliberate in-dialog choice overrides the current map selection. If the
  // source withdraws an automatic match, do not silently navigate to its first replacement.
  const [selection, setSelection] = useState<string | null>(null);
  const [overview, setOverview] = useState(!selected);
  const [overhead, setOverhead] = useState(false);
  const [buildingPlanOpen, setBuildingPlanOpen] = useState(false);
  const [footprints, setFootprints] = useState<ProvidenceFootprint[]>([]);
  const [footprintAttempt, setFootprintAttempt] = useState(0);
  const [footprintStatus, setFootprintStatus] = useState<'loading' | 'ready' | 'unavailable'>(
    school === 'pu' ? 'loading' : 'unavailable',
  );
  const [footprintDate, setFootprintDate] = useState<string | null>(null);
  const [footprintBaseDate, setFootprintBaseDate] = useState<string | null>(null);
  const [footprintStale, setFootprintStale] = useState(false);
  const [footprintRefreshing, setFootprintRefreshing] = useState(false);
  const [footprintRefreshFailed, setFootprintRefreshFailed] = useState(false);
  const staleSnapshotRef = useRef(false);
  // Refresh previously valid snapshots at their deadline, including in suspended tabs.
  const [footprintClock, setFootprintClock] = useState<{ staleAt: number; expiresAt: number } | null>(null);
  const footprintExpiresAtRef = useRef<number | null>(null);
  const footprintRequestActiveRef = useRef(false);
  // Respect a 503 Retry-After from our server instead of inviting users to
  // repeatedly retry while the public Overpass origin is in cooldown.
  const [footprintRetryAfter, setFootprintRetryAfter] = useState<{ until: number; minutes: number } | null>(null);
  const [camera, setCamera] = useState<CampusSpatialCamera>({ bearing: DEFAULT_SPATIAL_BEARING, zoom: 1 });
  const changeCamera = useCallback((next: CampusSpatialCamera) => setCamera(normalizeSpatialCamera(next)), []);
  const selectedPoint = model.points.find((point) => point.id === (selection ?? selected?.id));
  const showOverview = overview || !selectedPoint;
  const place = selectedPoint?.location;
  const index = model.points.findIndex((point) => point.id === selectedPoint?.id);
  const selectId = useId();
  const progressId = useId();
  const directionsNoteId = useId();
  const selectPlace = useCallback((id: string) => {
    setSelection(id);
    setOverview(false);
    setCamera((previous) => ({ ...previous, zoom: 1 }));
  }, []);
  const source = place ? providencePlaceSourceUrl(school, place) : null;
  // The map can be filtered while a spatial dialog remains open. Never count,
  // attribute or frame OSM buildings whose POIs are no longer in that view.
  const visibleFootprints = useMemo(() => {
    if (school !== 'pu' || footprintStatus !== 'ready' || model.unavailableReason) {
      return NO_VISIBLE_FOOTPRINTS;
    }
    const pointIds = new Set(model.points.map((point) => point.id));
    const matching = footprints.filter((footprint) => pointIds.has(footprint.poiId));
    return matching.length ? matching : NO_VISIBLE_FOOTPRINTS;
  }, [school, footprintStatus, model.unavailableReason, model.points, footprints]);
  const sourceFootprint = place
    ? visibleFootprints.find((footprint) => footprint.poiId === place.id) : null;

  useEffect(() => {
    if (footprintRetryAfter === null) return;
    // Mobile browsers can throttle a background tab's timers. On resume,
    // check the absolute deadline instead of leaving the retry disabled until
    // the delayed timeout finally runs. Never refetch automatically.
    const synchronizeCooldown = () => {
      const remaining = footprintRetryAfter.until - Date.now();
      if (remaining <= 0) {
        setFootprintRetryAfter((current) =>
          current?.until === footprintRetryAfter.until ? null : current);
        return;
      }
      const minutes = Math.ceil(remaining / 60_000);
      setFootprintRetryAfter((current) =>
        current?.until === footprintRetryAfter.until && current.minutes !== minutes
          ? { ...current, minutes } : current);
    };
    // A previously queued timeout can run after a later 503 replaces this
    // cooldown. Only release the exact deadline that scheduled the callback;
    // otherwise an old timer can re-enable Retry during a new server pause.
    const timer = window.setTimeout(() => {
      setFootprintRetryAfter((current) =>
        current?.until === footprintRetryAfter.until ? null : current);
    }, Math.max(0, footprintRetryAfter.until - Date.now()));
    const interval = window.setInterval(synchronizeCooldown, 60_000);
    document.addEventListener('visibilitychange', synchronizeCooldown);
    window.addEventListener('pageshow', synchronizeCooldown);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', synchronizeCooldown);
      window.removeEventListener('pageshow', synchronizeCooldown);
    };
  }, [footprintRetryAfter]);

  useEffect(() => {
    if (school !== 'pu' || footprintClock === null) return;
    const checkSnapshotAge = () => {
      if (footprintExpiresAtRef.current !== footprintClock.expiresAt) return;
      const now = Date.now();
      if (now >= footprintClock.expiresAt) {
        // Seven days is a hard expiry, not just a prompt to refresh. A long-lived
        // browser tab must not keep showing buildings after the server would
        // discard them, even if an in-flight refresh stalls or fails.
        footprintExpiresAtRef.current = null;
        staleSnapshotRef.current = false;
        setFootprintClock(null);
        setFootprints([]);
        setFootprintDate(null);
        setFootprintBaseDate(null);
        setFootprintStale(false);
        setFootprintRefreshing(false);
        setFootprintRefreshFailed(false);
        setFootprintStatus('unavailable');
        if (!footprintRequestActiveRef.current && footprintRetryAfter === null) {
          setFootprintAttempt((value) => value + 1);
        }
      } else if (now >= footprintClock.staleAt) {
        staleSnapshotRef.current = true;
        setFootprintStale(true);
      }
    };
    const nextDeadline = footprintStale ? footprintClock.expiresAt : footprintClock.staleAt;
    const timer = window.setTimeout(checkSnapshotAge, Math.max(0, nextDeadline - Date.now()));
    document.addEventListener('visibilitychange', checkSnapshotAge);
    window.addEventListener('pageshow', checkSnapshotAge);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', checkSnapshotAge);
      window.removeEventListener('pageshow', checkSnapshotAge);
    };
  }, [school, footprintClock, footprintStale, footprintRetryAfter]);

  useEffect(() => {
    if (school !== 'pu' || model.unavailableReason) {
      staleSnapshotRef.current = false;
      return;
    }
    let active = true;
    let timedOut = false;
    // Within the seven-day retention boundary, a dated stale outline may
    // survive a refresh failure. Once expired, even a pending request must not
    // restore that outline on failure or timeout.
    const preserveStale = staleSnapshotRef.current &&
      footprintExpiresAtRef.current !== null && Date.now() < footprintExpiresAtRef.current;
    footprintRequestActiveRef.current = true;
    setFootprintStatus(preserveStale ? 'ready' : 'loading');
    setFootprintRefreshing(preserveStale);
    const controller = new AbortController();
    // Aborting fetch is advisory: a stalled response body or a proxy/mock that
    // ignores AbortSignal may never settle. End the loading UI independently,
    // and quarantine any late completion from this expired request.
    const timeout = window.setTimeout(() => {
      if (!active) return;
      timedOut = true;
      footprintRequestActiveRef.current = false;
      controller.abort();
      setFootprintRefreshing(false);
      const keepStale = preserveStale &&
        footprintExpiresAtRef.current !== null && Date.now() < footprintExpiresAtRef.current;
      if (keepStale) setFootprintRefreshFailed(true);
      setFootprintStatus(keepStale ? 'ready' : 'unavailable');
    }, 15_000);
    void fetch('/api/public/campus-footprints', { signal: controller.signal })
      .then(async (response) => {
        // Fetch considers 203/206 successful, but the map API contract is a
        // complete 200 JSON document. A CDN/proxy must not turn a transformed
        // or partial representation into a trusted 3D building snapshot.
        const contentRange = response.headers?.get('content-range') ?? null;
        if (!response.ok || (typeof response.status === 'number' && response.status !== 200) ||
            contentRange !== null) {
          // Only our 503 responses use this contract. Ignore malformed or
          // unreasonably large intermediary values rather than freezing the UI.
          const seconds = response.status === 503 ? footprintCooldownSeconds(response) : null;
          if (active && !timedOut && seconds !== null) {
            setFootprintRetryAfter({ until: Date.now() + seconds * 1000, minutes: Math.ceil(seconds / 60) });
          }
          throw new Error('footprint source unavailable');
        }
        const cooldownSeconds = response.status === 200 ? footprintCooldownSeconds(response) : null;
        return { payload: await response.json() as unknown, cooldownSeconds };
      })
      .then(({ payload, cooldownSeconds }) => {
        if (!active || timedOut) return;
        const snapshot = parseProvidenceFootprintSnapshot(payload);
        if (!snapshot) throw new Error('No recent, source-checked building outlines');
        const fetchedMs = Date.parse(snapshot.fetchedAt);
        const replicationMs = snapshot.osmBaseAt === null ? Infinity : Date.parse(snapshot.osmBaseAt);
        const expiresAt = Math.min(fetchedMs + 7 * FOOTPRINT_DAY_MS, replicationMs + 7 * FOOTPRINT_DAY_MS);
        const staleAt = Math.min(fetchedMs + FOOTPRINT_DAY_MS, replicationMs + 2 * FOOTPRINT_DAY_MS);
        footprintExpiresAtRef.current = expiresAt;
        setFootprintClock({ staleAt, expiresAt });
        // A fresh timestamp alone must not tear down and recreate the WebGL context.
        // Keep geometry only when all source, revision and shape fields match.
        setFootprints((current) => reuseUnchangedProvidenceFootprints(current, snapshot.buildings));
        setFootprintDate(snapshot.fetchedAt.slice(0, 10));
        setFootprintBaseDate(snapshot.osmBaseAt?.slice(0, 10) ?? null);
        setFootprintStale(snapshot.stale);
        staleSnapshotRef.current = snapshot.stale;
        const seconds = snapshot.stale ? cooldownSeconds : null;
        setFootprintRetryAfter(seconds === null ? null : {
          until: Date.now() + seconds * 1000, minutes: Math.ceil(seconds / 60),
        });
        setFootprintRefreshing(false);
        setFootprintRefreshFailed(false);
        setFootprintStatus('ready');
      })
      .catch(() => {
        if (!active || timedOut) return;
        // Keep the previously verified snapshot even after its refresh deadline.
        // Normal first-load failures remain marker-only.
        setFootprintRefreshing(false);
        const keepStale = preserveStale &&
        footprintExpiresAtRef.current !== null && Date.now() < footprintExpiresAtRef.current;
        if (keepStale) setFootprintRefreshFailed(true);
        setFootprintStatus(keepStale ? 'ready' : 'unavailable');
      })
      .finally(() => {
        if (active) footprintRequestActiveRef.current = false;
        window.clearTimeout(timeout);
      });
    return () => {
      active = false;
      footprintRequestActiveRef.current = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [school, model.unavailableReason, footprintAttempt]);

  // Replace the spatial modal so there is only one focus trap and graphics context.
  // The key prevents a late local-file read from crossing a school/building boundary.
  if (buildingPlanOpen && place) {
    return <BuildingPlanPreview
      key={`${school}:${place.id}`}
      schoolId={school}
      buildingId={place.id}
      buildingName={place.name}
      onClose={() => setBuildingPlanOpen(false)}
    />;
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="校園空間導覽"
      description="用地點的相對位置認識校園。圖釘是位置標記，不代表建築外觀或室內動線。"
      size="full"
    >
      {model.unavailableReason ? (
        <div className={styles.unavailable} role="status">
          <p>{model.unavailableReason === 'area-too-large'
            ? '這組地點的範圍超出單一校區，請縮小地圖篩選範圍後再開啟導覽。'
            : '目前沒有可用的地點座標。'}</p>
          <button className="btn" type="button" onClick={onClose}>返回平面地圖</button>
        </div>
      ) : (
        <div className={styles.layout}>
          <div className={styles.visual}>
            <SpatialCanvas
              model={model}
              selectedId={showOverview ? null : selectedPoint?.id ?? null}
              overhead={overhead}
              camera={camera}
              onCameraChange={changeCamera}
              onSelect={selectPlace}
              footprints={visibleFootprints}
            />
            <div className={styles.viewTools} role="group" aria-label="導覽視角">
              <button className="btn" type="button" aria-pressed={showOverview} onClick={() => {
                setOverview(true);
                setCamera((previous) => ({ ...previous, zoom: 1 }));
              }}>
                看全部地點
              </button>
              <button className="btn" type="button" aria-pressed={overhead} onClick={() => setOverhead((value) => !value)}>
                俯視
              </button>
              <span>{model.points.length} 個地點 · 沿用目前地圖範圍</span>
            </div>
            <p className={styles.note}>選擇地點或拖動導覽進度，讓視角跟著移動。步行路線請使用導航。</p>
            {school === 'pu' && (
              <div className={styles.footprintInfo} role="status">
                {footprintStatus === 'loading' && '正在讀取靜宜建築輪廓；地點標記仍可操作。'}
                {footprintStatus === 'unavailable' && <>
                  <span>公開建築輪廓目前無法取得，保留地點標記與導航，不顯示臆測建築。</span>
                  {footprintRetryAfter !== null && <span>
                    來源要求約 {footprintRetryAfter.minutes} 分鐘冷卻，到期後可再試。
                  </span>}
                  <button className={styles.retryFootprints} type="button"
                    disabled={footprintRetryAfter !== null}
                    onClick={() => setFootprintAttempt((value) => value + 1)}>
                    重新讀取建築輪廓
                  </button>
                </>}
                {footprintStatus === 'ready' && (
                  <>
                    <strong>{visibleFootprints.length} 棟公開建築輪廓</strong>
                    <span>依 OpenStreetMap 圖徵立體化。高度使用 OSM 標註或 12 公尺示意值，未經校方測量；不是室內導覽或無障礙路線。</span>
                    {footprintDate && <small>資料讀取：{footprintDate}{footprintStale ? '（暫用舊快照）' : ''}</small>}
                    {footprintBaseDate && <small>OSM 資料庫同步：{footprintBaseDate}（非現地查證）</small>}
                    {footprintStale && <>
                      <span>目前使用有日期標註的舊輪廓，可手動檢查是否已有更新；原始地點與步行導航不受影響。</span>
                      {footprintRetryAfter !== null && <span>
                        來源要求約 {footprintRetryAfter.minutes} 分鐘冷卻，到期後可再試。
                      </span>}
                      {footprintRefreshing && <span>正在檢查更新，暫時保留舊輪廓。</span>}
                      {footprintRefreshFailed && !footprintRefreshing && <span>更新未成功，仍顯示先前有日期標註的舊輪廓；資料日期沒有更新。</span>}
                      <button className={styles.retryFootprints} type="button"
                        disabled={footprintRetryAfter !== null || footprintRefreshing}
                        onClick={() => {
                          setFootprintRefreshFailed(false);
                          setFootprintAttempt((value) => value + 1);
                        }}>
                        重新讀取建築輪廓
                      </button>
                    </>}
                  </>
                )}
                <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap 貢獻者</a>
                <a href={PROVIDENCE_CAMPUS_SOURCE.officialCampusTourUrl} target="_blank" rel="noopener noreferrer">靜宜官方校園圖與實境導覽</a>
              </div>
            )}
            {model.excludedCount > 0 && <p className={styles.note} role="status">部分地點資料無法用於空間圖。</p>}
          </div>
            <div className={styles.details}>
              <div className={styles.selectField}>
                <label htmlFor={selectId}>想去哪裡</label>
                <select id={selectId} value={place?.id ?? ''} onChange={(event) => selectPlace(event.target.value)}>
                  {!place && <option value="" disabled>請選擇地點</option>}
                  {model.points.map((point) => <option key={point.id} value={point.id}>{point.name}</option>)}
                </select>
              </div>
              {place ? <>
              <div className={styles.progress}>
                <label htmlFor={progressId}>導覽進度 <span>{index + 1} / {model.points.length}</span></label>
                <input
                  id={progressId}
                  type="range"
                  min={0}
                  max={Math.max(0, model.points.length - 1)}
                  value={Math.max(0, index)}
                  disabled={model.points.length < 2}
                  aria-valuetext={`第 ${index + 1} 個地點，共 ${model.points.length} 個：${place.name}`}
                  onChange={(event) => {
                    const point = model.points[Number(event.target.value)];
                    if (point) selectPlace(point.id);
                  }}
                />
                <div className={styles.steps}>
                  <button className="btn" type="button" disabled={index <= 0} onClick={() => selectPlace(model.points[index - 1].id)}>上一個地點</button>
                  <button className="btn" type="button" disabled={index >= model.points.length - 1} onClick={() => selectPlace(model.points[index + 1].id)}>下一個地點</button>
                </div>
              </div>
              <section className={styles.place} aria-label="導覽地點資訊">
                <p className={styles.category}>{place.category}</p>
                <h3 aria-live="polite" aria-atomic="true">{place.name}</h3>
                {place.description && <p>{place.description}</p>}
                {(place.building || place.floor) && <p>{[place.building, place.floor && `樓層：${place.floor}`].filter(Boolean).join(' · ')}</p>}
                {Boolean(place.facilities?.length) && <p>設施：{place.facilities!.join('、')}</p>}
                {school === 'pu' && footprintStatus === 'ready' && (
                  <p className={styles.note}>
                    {sourceFootprint ? <>
                      建築外框：OpenStreetMap 來源，經校園地點與外框對位檢查。
                      {' '}
                      {sourceFootprint.heightBasis === 'osm-tag'
                        ? `高度：${Number(sourceFootprint.heightMeters.toFixed(2))} 公尺（OSM 使用者標註，非校方實測）。`
                        : `高度：${sourceFootprint.heightMeters} 公尺示意（無 OSM 高度標註，非實際樓高）。`}
                    </> : '此地點沒有可用的已核對 OSM 建築外框；只顯示原有地點標記，不代表已驗證入口。'}
                  </p>
                )}
                {sourceFootprint?.osmVersion && sourceFootprint.osmEditedAt && (
                  <p className={styles.note}>
                    OSM way 版本 v{sourceFootprint.osmVersion} · 圖徵最後編輯 {sourceFootprint.osmEditedAt.slice(0, 10)}。
                    此日期不代表現場查證，節點座標可能另有更新。
                  </p>
                )}
                {school === 'pu' && place.id === 'pu-zhugu' && (
                  <div className={styles.officialFloors}>
                    <strong>主顧樓 · 校方公開樓層資訊</strong>
                    <p>4 樓：資訊管理學系、資訊傳播工程學系。5 樓：資訊工程學系。6 樓：資訊學院。</p>
                    <a href={PROVIDENCE_CAMPUS_SOURCE.officialCampusTourUrl} target="_blank" rel="noopener noreferrer">
                      查看官方建築資料
                    </a>
                    <small>此處是樓層資訊，不代表教室入口或室內行走路線已驗證。</small>
                  </div>
                )}
                {isProvidencePendingVerification(school, place) && (
                  <p className={styles.pending} role="status">此地點僅有單一資料來源，位置待再次確認。</p>
                )}
              </section>
              <div className={styles.actions}>
                <button className="btn primary" type="button" onClick={() => { onSelect(place); onClose(); }}>
                  在平面地圖查看
                </button>
                <a className="btn" href={walkingDirectionsUrl(place)} target="_blank" rel="noopener noreferrer" aria-describedby={directionsNoteId}>開啟步行導航</a>
                <a className="btn" href={appleWalkingDirectionsUrl(place)} target="_blank" rel="noopener noreferrer" aria-describedby={directionsNoteId}>Apple 地圖步行導航</a>
                <p id={directionsNoteId} className={styles.note}>導航僅以目前地點標記為目的地，並非已核實的校舍入口、可通行道路或無障礙動線；請依現場指標確認。</p>
                <button className="btn" type="button" onClick={() => setBuildingPlanOpen(true)}>平面圖建模預覽</button>
                {source && <a className={styles.source} href={source} target="_blank" rel="noopener noreferrer">查看地點資料來源 ↗</a>}
              </div>
              </> : <p className={styles.note} role="status">請選擇地點，確認位置後再開啟導航。</p>}
            </div>
        </div>
      )}
    </Modal>
  );
}

function AvailableSpatialExplorer(props: Props) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return <>
    <button className="btn" type="button" aria-haspopup="dialog" onClick={() => setOpen(true)}>
      空間導覽
    </button>
    {open && <SpatialDialog {...props} key={props.school} onClose={close} />}
  </>;
}

export default function CampusSpatialExplorer(props: Props) {
  return props.locations.length ? <AvailableSpatialExplorer key={props.school} {...props} /> : null;
}
