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
import { walkingDirectionsUrl, type MapLocation } from './mapService';
import { isProvidencePendingVerification, providencePlaceSourceUrl } from './providenceCampus';
import { PROVIDENCE_CAMPUS_PLACES, PROVIDENCE_CAMPUS_SOURCE } from '@campus/shared/src/providenceCampus';
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

// 0: enter/leave viewport; 1e-9: zero-area edge touch <-> any visible
// pixel (still representable as float32 in browser engines); 0.01: legacy
// coarse visibility step.
const VIEWPORT_THRESHOLDS = [0, 1e-9, 0.01];
// Reuse a single empty array to avoid recreating a WebGL context whenever
// the footprint status or the visible map selection changes.
const NO_VISIBLE_FOOTPRINTS: readonly ProvidenceFootprint[] = [];
// The 3D overlay is scoped to the *filtered* map. When the view contains
// only transit stops (official transit feed), OSM nodes or other non-outline
// POIs, downloading every campus building wastes bandwidth on mobile.
// Only audited OSM ways can become 3D volumes today. A relation-only POI
// still has its own map marker/source link, but must not trigger an unusable
// whole-campus Overpass download until relation geometries are implemented.
const POTENTIAL_OUTLINE_POI_IDS = new Set(
  PROVIDENCE_CAMPUS_PLACES
    .filter((place) => place.verification === 'cross-checked' &&
      /^https:\/\/www\.openstreetmap\.org\/way\/[1-9]\d*$/.test(place.sourceUrl))
    .map((place) => place.id),
);
const FOOTPRINT_DAY_MS = 24 * 60 * 60 * 1000;
// Link the original university building-unit listing, not the virtual tour.
// No university photographs or floor plans are copied into nuni.
const PROVIDENCE_OFFICIAL_BUILDING_UNITS_URL = 'https://c067.pu.edu.tw/p/412-1121-4218.php';
// The API bounds decoded upstream Overpass to 500 KB. A very large or
// ambiguous downstream Content-Length must not make mobile JSON parsing
// allocate unbounded memory if an intermediary changes the response.
// Keep the same cap for decoded response bytes. Content-Length alone is
// advisory: a proxy may omit it or advertise a shorter body than it sends.
const MAX_DECLARED_FOOTPRINT_BYTES = 2_000_000;
// A hostile stream can emit unlimited zero-byte/tiny chunks without ever
// reaching the byte cap, starving the browser's timeout and map controls.
// The public endpoint's 500 KB ceiling makes this generous for real responses.
const MAX_FOOTPRINT_STREAM_CHUNKS = 8_192;

// Response.json() buffers the entire document before our snapshot validator
// runs. Bound the *actual decoded bytes* so untrusted downstream responses
// cannot exhaust mobile memory even without a reliable Content-Length.
// Fallback is only for non-streaming WebViews / synthetic fetch stubs.
async function readBoundedFootprintJson(response: Response, signal?: AbortSignal): Promise<unknown> {
  // Content-Length describes transport bytes for gzip/br, but the browser
  // delivers decoded bytes. Enforce exact framing ONLY for identity responses;
  // a truncated but syntactically valid JSON document is not a complete map.
  const encoding = response.headers?.get('content-encoding')?.trim().toLowerCase() ?? null;
  const declared = response.headers?.get('content-length') ?? null;
  const identityLength = (encoding === null || encoding === 'identity') &&
    declared !== null && /^\d+$/.test(declared) ? Number(declared) : null;
  if (!response.body || typeof response.body.getReader !== 'function') {
    // Old embedded WebViews can expose a Response without a usable stream.
    // We cannot stop their text() buffering mid-flight, but reject decoded
    // content before JSON.parse() allocates a potentially huge object tree.
    // Check UTF-16 length first (a lower bound on encoded UTF-8 bytes) to
    // avoid creating an extra giant byte array for clearly oversized bodies.
    if (typeof response.text === 'function') {
      const raw = await response.text();
      if (signal?.aborted) throw new Error('Building outline read aborted');
      if (raw.length > MAX_DECLARED_FOOTPRINT_BYTES) {
        throw new Error('Building outline response exceeded byte limit');
      }
      const decodedBytes = new TextEncoder().encode(raw).byteLength;
      if (decodedBytes > MAX_DECLARED_FOOTPRINT_BYTES) {
        throw new Error('Building outline response exceeded byte limit');
      }
      if (identityLength !== null && decodedBytes !== identityLength) {
        throw new Error('Incomplete building outline response');
      }
      return JSON.parse(raw) as unknown;
    }
    // A JSON-only WebView bridge exposes no raw bytes. If an identity
    // Content-Length is present, we cannot verify that the complete HTTP
    // representation reached JSON.parse(); reserializing the object is not
    // an equivalent integrity check (whitespace and escaped text can differ).
    // Fail closed for mapped building outlines, leaving POIs and directions.
    if (identityLength !== null) {
      throw new Error('Unverifiable building outline response length');
    }
    // Without a declared length, retain the legacy JSON-only fallback with
    // its post-parse decoded-size check. This cannot cap initial allocation.
    const payload: unknown = await response.json();
    if (signal?.aborted) throw new Error('Building outline read aborted');
    const normalized = JSON.stringify(payload);
    if (typeof normalized !== 'string' ||
        normalized.length > MAX_DECLARED_FOOTPRINT_BYTES ||
        new TextEncoder().encode(normalized).byteLength > MAX_DECLARED_FOOTPRINT_BYTES) {
      throw new Error('Building outline response exceeded byte limit');
    }
    return payload;
  }
  const reader = response.body.getReader();
  // A mobile pagehide/unmount/timeout may arrive after the fetch headers but
  // while response-body streaming is still pending. Abort the *reader* as well
  // as fetch, so background tabs stop consuming OSM data on WebViews whose
  // fetch signal does not automatically cancel a handed-off body.
  const cancelReader = () => {
    try {
      void Promise.resolve(reader.cancel()).catch(() => {});
    } catch {
      // Cancellation is best effort; never delay UI cleanup.
    }
  };
  signal?.addEventListener('abort', cancelReader, { once: true });
  // Grow a single buffer rather than retaining an unbounded number of tiny
  // ReadableStream chunks (whose per-object overhead is not byte-limited).
  let bytes = new Uint8Array(16_384);
  let total = 0;
  let chunks = 0;
  try {
    if (signal?.aborted) {
      cancelReader();
      throw new Error('Building outline read aborted');
    }
    while (true) {
      const { done, value } = await reader.read();
      if (signal?.aborted) throw new Error('Building outline read aborted');
      if (done) break;
      // Count even empty chunks: a stream can otherwise loop forever while
      // retaining zero bytes, and microtasks can starve the 15s timeout.
      if (++chunks > MAX_FOOTPRINT_STREAM_CHUNKS ||
          value.byteLength > MAX_DECLARED_FOOTPRINT_BYTES - total) {
        // Do not let a locked or unusual stream prevent the rejection path.
        cancelReader();
        throw new Error('Building outline response exceeded byte/chunk limit');
      }
      const end = total + value.byteLength;
      if (identityLength !== null && end > identityLength) {
        cancelReader();
        throw new Error('Building outline response length mismatch');
      }
      if (end > bytes.byteLength) {
        const larger = new Uint8Array(Math.min(MAX_DECLARED_FOOTPRINT_BYTES,
          Math.max(bytes.byteLength * 2, end)));
        larger.set(bytes.subarray(0, total));
        bytes = larger;
      }
      bytes.set(value, total);
      total = end;
    }
  } finally {
    signal?.removeEventListener('abort', cancelReader);
    reader.releaseLock();
  }
  if (signal?.aborted) throw new Error('Building outline read aborted');
  if (identityLength !== null && total !== identityLength) {
    throw new Error('Incomplete building outline response');
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, total))) as unknown;
}
const OSM_COOLDOWN_STORAGE_KEY = 'nuni:pu:osm-footprint-cooldown-until';

// A modal-local Retry-After can be bypassed by closing and reopening the map.
// Keep the deadline only in same-tab session storage; never store geometry,
// student locations, or credentials. Private browsers may disable storage.
function readStoredFootprintCooldown(): { until: number; minutes: number } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(OSM_COOLDOWN_STORAGE_KEY);
    if (!raw || !/^\d{13}$/.test(raw)) {
      if (raw) window.sessionStorage.removeItem(OSM_COOLDOWN_STORAGE_KEY);
      return null;
    }
    const until = Number(raw);
    const remaining = until - Date.now();
    if (!Number.isSafeInteger(until) || remaining <= 0 || remaining > FOOTPRINT_DAY_MS) {
      window.sessionStorage.removeItem(OSM_COOLDOWN_STORAGE_KEY);
      return null;
    }
    return { until, minutes: Math.ceil(remaining / 60_000) };
  } catch {
    return null;
  }
}

function storeFootprintCooldown(until: number | null) {
  if (typeof window === 'undefined') return;
  try {
    if (until === null) window.sessionStorage.removeItem(OSM_COOLDOWN_STORAGE_KEY);
    else window.sessionStorage.setItem(OSM_COOLDOWN_STORAGE_KEY, String(until));
  } catch {
    // Keep the map usable in browsers that restrict session storage.
  }
}

// Rate limits can carry Retry-After as delay-seconds or an HTTP-date.
// Accept only a canonical IMF-fixdate, rejecting malformed/expired dates so a
// proxy cannot indefinitely lock mobile controls. Cap the pause at one day.
function footprintCooldownSeconds(response: Response): number | null {
  const raw = response.headers?.get('retry-after')?.trim();
  if (!raw) return null;
  // RFC 9110 delay-seconds is 1*DIGIT, with no 64-digit upper bound.
  // Cap a valid positive value *before* numeric conversion so an unusually
  // long gateway header cannot accidentally shorten an OSM rate-limit pause.
  // Leading zeroes do not change the requested delay.
  if (/^\d+$/.test(raw)) {
    const digits = raw.replace(/^0+/, '') || '0';
    if (digits === '0') return null;
    return digits.length > 5 || (digits.length === 5 && digits > '86400')
      ? 86_400 : Number(digits);
  }
  const until = Date.parse(raw);
  if (!Number.isFinite(until) || new Date(until).toUTCString() !== raw) return null;
  // A mobile device can be minutes ahead of the origin. HTTP-date and Date
  // are both origin-clock values; a client-only subtraction could treat a
  // still-active 429/503 cooldown as already expired and hammer Overpass.
  // Never shorten the locally calculated wait, and cap both at 24 hours.
  const serverDate = response.headers?.get('date')?.trim() ?? '';
  const serverTime = Date.parse(serverDate);
  const serverWait = serverDate && Number.isFinite(serverTime) &&
    new Date(serverTime).toUTCString() === serverDate ? until - serverTime : -Infinity;
  const seconds = Math.ceil(Math.max(until - Date.now(), serverWait) / 1000);
  return seconds > 0 ? Math.min(86_400, seconds) : null;
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
  // iOS Safari versions with legacy MediaQueryList listeners do not expose
  // addEventListener/removeEventListener. Keep reduced-motion and theme changes
  // reactive instead of breaking the spatial dialog on those devices.
  for (const query of media) {
    if (!query) continue;
    if (typeof query.addEventListener === 'function') query.addEventListener('change', notify);
    else query.addListener?.(notify);
  }
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-reduced-motion', 'data-theme'],
  });
  return () => {
    observer.disconnect();
    for (const query of media) {
      if (!query) continue;
      if (typeof query.removeEventListener === 'function') query.removeEventListener('change', notify);
      else query.removeListener?.(notify);
    }
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
  const [status, setStatus] = useState<'loading' | 'deferred' | 'ready' | 'error'>('loading');
  // Some mobile WebViews never report a fresh onscreen entry after suspending a
  // running scene. Keep a visible recovery control instead of a frozen canvas.
  const [renderSuspended, setRenderSuspended] = useState(false);
  const [deferredCause, setDeferredCause] = useState<'background' | 'offscreen'>('background');
  const [attempt, setAttempt] = useState(0);
  // An embedded WebView may construct an observer but never deliver entries.
  // Only an explicit user choice bypasses offscreen detection.
  const [manualStart, setManualStart] = useState(false);
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
    // No observer result (or legacy geometry fallback) has confirmed the
    // canvas yet. Starting with visible=true in an API-less WebView displayed
    // the loading spinner even after fallback geometry proved the map offscreen.
    // Wait for that measured decision; manual start remains user-authorized.
    let visible = manualStart;
    let pageSuspended = false;
    let scene: CampusSpatialScene | null = null;
    // Safari can fire pagehide before visibilitychange when entering bfcache.
    // Treat that window as suspended even if document.hidden stays false.
    const isBackgrounded = () => pageSuspended || document.hidden;
    const isDeferred = () => isBackgrounded() || !visible;
    const defer = () => {
      setDeferredCause(isBackgrounded() ? 'background' : 'offscreen');
      setStatus('deferred');
    };
    if (isDeferred()) defer();
    else setStatus('loading');

    const updateVisibility = () => {
      if (!scene) return;
      const shouldRender = visible && !isBackgrounded();
      scene.setActive(shouldRender);
      setRenderSuspended(!shouldRender);
    };
    const fail = () => {
      if (!active) return;
      active = false;
      scene?.dispose();
      scene = null;
      runtime.current = null;
      setStatus('error');
    };
    let timeout: number | null = null;
    let started = false;
    let pendingCreate: (() => void) | null = null;
    // Mobile tabs can be suspended after the dynamic import starts but before
    // it resolves. Pause the startup deadline and defer WebGL allocation until
    // the tab is visible again. Resuming must not duplicate the context.
    const syncPendingStartup = () => {
      if (!active || scene) return;
      // Even before startup, page events must refresh the deferred reason so
      // a stalled observer leaves the manual entry available in the foreground.
      if (!started) {
        if (isDeferred()) defer();
        return;
      }
      if (isDeferred()) {
        if (timeout !== null) window.clearTimeout(timeout);
        timeout = null;
        defer();
        return;
      }
      if (timeout === null) timeout = window.setTimeout(fail, 12000);
      setStatus('loading');
      pendingCreate?.();
    };
    const startWhenVisible = () => {
      if (!active || started || isDeferred()) return;
      started = true;
      syncPendingStartup();
      void import('./campusSpatialScene').then(({ createCampusSpatialScene }) => {
        if (!active) return;
        const finishStart = () => {
          if (!active || isDeferred() || scene) return;
          pendingCreate = null;
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
          if (timeout !== null) window.clearTimeout(timeout);
          timeout = null;
          setStatus('ready');
        };
        pendingCreate = finishStart;
        finishStart();
        // If import resolved after backgrounding, keep the pending factory for
        // the next visibilitychange/pageshow. Never allocate while hidden.
      }).catch(fail);
    };
    // Safari bfcache / WebView restore may retain a visible observer state
    // even if scroll restoration has moved the canvas outside the viewport.
    // Never wake an existing GPU context from that stale observation. Wait for
    // a fresh intersecting event or an explicit manual restart instead.
    // Delayed observer entries can still report a previously visible canvas
    // after Safari restores its scroll position. The current DOM rectangle
    // is authoritative only when it has measurable positive dimensions; on
    // legacy WebViews without usable layout measurements, keep the observer
    // signal and the accessible manual-recovery path.
    // On iOS the soft keyboard and pinch-zoom often change only the visual
    // viewport, leaving window.innerHeight unchanged. Its offset is relative
    // to the layout viewport used by getBoundingClientRect().
    // Read the current viewport on each check: WebViews can temporarily throw
    // when accessing it, or replace its instance after page restoration.
    // Geometry is only affirmative when both the host and the effective
    // viewport have valid, positive bounds. Unknown WebView measurements must
    // never be interpreted as proof that the map is back on screen.
    const hostViewportVisibility = (): 'onscreen' | 'offscreen' | 'unknown' | 'invalid-visual-viewport' | 'invalid-host-rect' => {
      // Some embedded Safari/WebViews expose VisualViewport but throw when a
      // dimension is read during keyboard, zoom or bfcache transitions. Read
      // each getter once; an exception is *not* permission to fall back to
      // the larger layout viewport and wake a hidden WebGL context.
      let visualBounds: { left: number; top: number; width: number; height: number } | null = null;
      let visualViewport: VisualViewport | null;
      try { visualViewport = window.visualViewport; }
      catch { return 'invalid-visual-viewport'; }
      if (visualViewport) {
        try {
          const { width, height, offsetLeft, offsetTop } = visualViewport;
          if (![width, height, offsetLeft, offsetTop].every(Number.isFinite) ||
            width <= 0 || height <= 0) return 'invalid-visual-viewport';
          visualBounds = { left: offsetLeft, top: offsetTop, width, height };
        } catch {
          return 'invalid-visual-viewport';
        }
      }
      try {
        const rect = host.getBoundingClientRect();
        const width = window.innerWidth;
        const height = window.innerHeight;
        const left = visualBounds?.left ?? 0;
        const top = visualBounds?.top ?? 0;
        const right = left + (visualBounds?.width ?? width);
        const bottom = top + (visualBounds?.height ?? height);
        // A malformed *reported* host coordinate is not an absent layout
        // measurement. In particular NaN/Infinity must never allow the
        // no-observer WebView fallback to start offscreen WebGL.
        if (![rect.left, rect.top, rect.right, rect.bottom, rect.width, rect.height]
          .every(Number.isFinite)) return 'invalid-host-rect';
        if (![width, height, left, top, right, bottom].every(Number.isFinite) ||
          rect.width <= 0 || rect.height <= 0 || width <= 0 || height <= 0 ||
          right <= left || bottom <= top) return 'unknown';
        // A WebView can expose positive width/height while its DOMRect edges
        // are reversed or collapsed. These bounds never prove the host visible.
        if (rect.right <= rect.left || rect.bottom <= rect.top) return 'invalid-host-rect';
        return rect.bottom <= top || rect.top >= bottom ||
          rect.right <= left || rect.left >= right ? 'offscreen' : 'onscreen';
      } catch {
        // A broken host/layout measurement is not evidence of an offscreen
        // canvas; keep the observer and keyboard recovery available.
        return 'unknown';
      }
    };
    // Both a confirmed offscreen rect and an invalid iOS VisualViewport must
    // block stale observer/page-restoration records from waking the GPU.
    // An unmeasurable legacy host rect remains 'unknown' so older WebViews
    // can still use a real observer signal or the manual-start control.
    const hostMustStaySuspended = () => {
      const position = hostViewportVisibility();
      return position === 'offscreen' || position === 'invalid-visual-viewport' || position === 'invalid-host-rect';
    };
    // Keep a way back when pageshow/visibilitychange (not a resize event)
    // invalidates an already-running scene. Safari may not issue another
    // IntersectionObserver entry after its visual viewport becomes valid.
    let suspendedByViewport = false;
    // When a broken WebView cannot observe the host, use measurable DOM bounds
    // instead of eagerly allocating offscreen WebGL. Unknown legacy layouts
    // retain the prior fallback, and a visible scroll can wake a deferred map.
    let observerFallback = false;
    // Safari can deliver a *positive* initial observer entry while its visual
    // viewport getters are transiently invalid. Remember that observation,
    // but do not allocate WebGL until a later viewport event proves the host
    // is actually on screen. A negative observer entry cancels this permit.
    let pendingInitialViewportConfirmation = false;
    const invalidateRestoredOffscreenVisibility = () => {
      if (visible && !manualStart && typeof IntersectionObserver !== 'undefined' &&
          hostMustStaySuspended()) {
        if (started) suspendedByViewport = true;
        visible = false;
      }
    };
    const onVisibilityChange = () => {
      if (!document.hidden) {
        // Ordinary iOS tab switches resume with visibilitychange, without
        // pageshow or any VisualViewport resize/scroll event. Revalidate the
        // current viewport and retry missing listeners on that foreground
        // transition, so a previously paused (or deferred first) scene
        // recovers only when its original observer permit is still valid.
        invalidateRestoredOffscreenVisibility();
        onViewportResize();
        return;
      }
      updateVisibility();
      startWhenVisible();
      syncPendingStartup();
    };
    const onPageHide = () => {
      pageSuspended = true;
      updateVisibility();
      syncPendingStartup();
    };
    const onPageShow = () => {
      pageSuspended = false;
      invalidateRestoredOffscreenVisibility();
      // A restored Safari page can recover a valid VisualViewport without
      // dispatching resize, scroll or a fresh IntersectionObserver callback.
      // Recheck the current rect on pageshow: the same two gates apply to
      // both a previously paused scene and a pending first render.
      onViewportResize();
    };
    // iOS VisualViewport can expand/scroll back into view without firing a
    // second IntersectionObserver callback. Only undo a pause that *this*
    // viewport listener initiated, on positive and measurable overlap, after
    // a real observer previously permitted startup. Never bypass the initial
    // offscreen-import gate or restart an unconfirmed/legacy WebView scene.
    // Page restore can replace the VisualViewport object. Transfer the two
    // listeners to the current instance, without leaving callbacks on an old
    // viewport or interpreting a throwing getter as an absent API.
    let subscribedVisualViewport: VisualViewport | null = null;
    // A temporary WebView addEventListener failure is not permanent. Retry
    // missing subscriptions on pageshow/window resize even when Safari keeps
    // the same VisualViewport object after a keyboard or bfcache transition.
    const registeredViewportEvents = new Set<'resize' | 'scroll'>();
    const refreshVisualViewportListeners = () => {
      let current: VisualViewport | null;
      try { current = window.visualViewport; }
      catch { return; }
      if (current !== subscribedVisualViewport) {
        for (const event of ['resize', 'scroll'] as const) {
          try { subscribedVisualViewport?.removeEventListener(event, onViewportResize); }
          catch { /* partially implemented WebView API */ }
        }
        registeredViewportEvents.clear();
        subscribedVisualViewport = current;
      }
      for (const event of ['resize', 'scroll'] as const) {
        if (registeredViewportEvents.has(event)) continue;
        try {
          subscribedVisualViewport?.addEventListener(event, onViewportResize);
          if (subscribedVisualViewport) registeredViewportEvents.add(event);
        } catch { /* retry when the same instance becomes usable again */ }
      }
    };
    const onViewportResize = () => {
      if (!active) return;
      refreshVisualViewportListeners();
      if (observerFallback) {
        const position = hostViewportVisibility();
        if (position !== 'unknown') visible = position === 'onscreen';
      } else if (!manualStart && typeof IntersectionObserver !== 'undefined') {
        const position = hostViewportVisibility();
        if (position === 'offscreen' || position === 'invalid-visual-viewport' || position === 'invalid-host-rect') {
          if (visible && started) suspendedByViewport = true;
          visible = false;
        } else if (position === 'onscreen' && pendingInitialViewportConfirmation && !started) {
          // The observer already confirmed positive intersection. This is
          // not an eager start: current valid geometry is the second gate.
          visible = true;
          pendingInitialViewportConfirmation = false;
        } else if (position === 'onscreen' && suspendedByViewport && started) {
          visible = true;
          suspendedByViewport = false;
        }
      }
      updateVisibility();
      startWhenVisible();
      syncPendingStartup();
    };

    // A few embedded WebViews expose IntersectionObserver but fail during
    // construction or observe(). Do not strand the tour in offscreen mode:
    // the safe fallback is the existing eager startup path.
    let intersection: IntersectionObserver | null = null;
    let observerLive = true;
    // Keep timestamps across observer callbacks, not only within one batch:
    // an old, queued notification must not restart offscreen mobile WebGL.
    let lastObservationTime = -Infinity;
    if (!manualStart && typeof IntersectionObserver !== 'undefined') {
      try {
        intersection = new IntersectionObserver((entries) => {
          // A WebView can deliver an already-queued callback after disconnect
          // (including after the modal closes). Do not reactivate a disposed
          // WebGL scene or issue state updates from the previous dialog.
          if (!active || !observerLive) return;
          // Only entries for this canvas host may change its visibility.
          // Legacy callback shims may omit target; a *different* explicit
          // target is never proof that our map entered the viewport.
          const hostEntries = entries.filter((entry) => !entry.target || entry.target === host);
          // A fast scroll can batch several transitions. Real observer
          // entries expose time; use the most recent timestamp rather than
          // trusting array order. Keep last-entry fallback for legacy WebViews
          // or test shims without timestamps; an empty batch changes nothing.
          if (!hostEntries.length) return;
          // Some embedded WebViews include a time only on *some* entries.
          // An untimed final item must not hide a newer timed transition,
          // and an untimed callback cannot safely supersede a timestamped
          // offscreen event delivered earlier. Purely untimed legacy shims
          // still follow array order until a trustworthy time is observed.
          const timed = hostEntries.filter((entry) => Number.isFinite(entry.time));
          let latest: IntersectionObserverEntry;
          if (timed.length) {
            latest = timed[0];
            // Equal timestamps can occur when a browser rounds time values.
            // Entries within one callback are queued in transition order,
            // so the last tied entry describes the latest state in that batch.
            // Equal-time records from a DIFFERENT callback remain ambiguous
            // and are rejected by the strict cross-batch check below.
            for (const entry of timed) {
              if (entry.time >= latest.time) latest = entry;
            }
            // A delayed older callback may arrive after a newer one, even
            // if it is the sole entry in its own callback.
            // Quantized timestamps can tie across separate callbacks.
            // Never wake GPU on an ambiguous equal-time positive event,
            // but accept an equal-time negative event to fail closed: keeping
            // an offscreen WebGL scene active wastes mobile power. A newer
            // positive event (or explicit manual recovery) can resume it.
            if (latest.time < lastObservationTime ||
                (latest.time === lastObservationTime && latest.isIntersecting)) return;
            lastObservationTime = latest.time;
          } else {
            if (lastObservationTime !== -Infinity) return;
            latest = hostEntries[hostEntries.length - 1];
          }
          // IntersectionObserver may report isIntersecting=true when the
          // canvas only touches the viewport boundary. A zero-area map has
          // no visible pixels and must not allocate or resume mobile WebGL.
          // Older WebViews that omit the entire intersectionRect still use
          // the boolean flag and retain the manual-start path.
          // Some embedded WebViews deliver an intersection rectangle with
          // positive dimensions but invalid origin/edge coordinates, or throw
          // when a DOMRect getter is read after tab restoration. Neither is
          // evidence of visible pixels. Ignore omitted coordinate fields in
          // legacy shims, but fail closed for any provided non-finite value.
          // A callback queued before bfcache scroll restoration can also
          // carry a newer timestamp for an old on-screen position.
          const position = hostViewportVisibility();
          let confirmedIntersecting = false;
          try {
            const rect = latest.intersectionRect;
            confirmedIntersecting = Boolean(latest.isIntersecting) && (!rect ||
              (Number.isFinite(rect.width) && Number.isFinite(rect.height) &&
                rect.width > 0 && rect.height > 0 &&
                [rect.x, rect.y, rect.left, rect.top, rect.right, rect.bottom]
                  .every((value) => value === undefined || Number.isFinite(value)) &&
                // Some WebViews report positive width/height alongside an
                // impossible or zero-area edge pair. An explicitly supplied
                // right/bottom edge must be beyond its matching start edge;
                // fully omitted legacy-shim coordinates remain supported.
                (rect.left === undefined || rect.right === undefined || rect.right > rect.left) &&
                (rect.top === undefined || rect.bottom === undefined || rect.bottom > rect.top)));
          } catch {
            // A partially implemented DOMRect getter cannot wake mobile GPU.
          }
          // An initial positive callback can arrive during Safari's 0/NaN
          // VisualViewport transition. Do not strand the initial render if
          // no second observer callback follows; require valid on-screen
          // geometry on the later viewport event before starting.
          if (!started) {
            pendingInitialViewportConfirmation =
              (position === 'invalid-visual-viewport' || position === 'invalid-host-rect') && confirmedIntersecting;
          }
          if (!confirmedIntersecting) {
            // A newer negative observer record revokes the viewport-only
            // recovery permit. Otherwise a subsequent valid resize can
            // resurrect a scene the observer has explicitly marked hidden.
            // Wait for the next genuine positive intersection instead.
            suspendedByViewport = false;
          } else if ((position === 'invalid-visual-viewport' || position === 'invalid-host-rect') && visible && started) {
            suspendedByViewport = true;
          }
          visible = confirmedIntersecting &&
            position !== 'offscreen' && position !== 'invalid-visual-viewport' && position !== 'invalid-host-rect';
          if (visible) suspendedByViewport = false;
          updateVisibility();
          startWhenVisible();
          syncPendingStartup();
        }, { threshold: VIEWPORT_THRESHOLDS });
        // An edge-touch (isIntersecting=true, zero area) and a sliver of
        // visible area (for example 0.5%) are both intersecting. A tiny
        // positive threshold guarantees a callback across that boundary in
        // both directions, so WebGL starts once any pixel shows and pauses
        // again when only the edge touches.
        intersection.observe(host);
      } catch {
        // observe() may have registered partially before throwing.
        try { intersection?.disconnect(); } catch { /* broken WebView observer */ }
        // disconnect() cannot cancel queued notifications from a failed
        // constructor/observe(). They must not deactivate the eager fallback.
        observerLive = false;
        intersection = null;
        observerFallback = true;
        const position = hostViewportVisibility();
        // A broken observer does not authorize starting a measurable offscreen
        // host (or one hidden by an invalid iOS VisualViewport). Older WebViews
        // whose host geometry is unknown still retain their eager fallback.
        visible = position === 'onscreen' || position === 'unknown';
      }
    }
    // Legacy WebViews with no IntersectionObserver should share the same
    // measured fallback as a broken observer, not eagerly start offscreen GPU.
    // The capture scroll listener below can wake the canvas once it appears.
    if (!manualStart && typeof IntersectionObserver === 'undefined') {
      observerFallback = true;
      const position = hostViewportVisibility();
      visible = position === 'onscreen' || position === 'unknown';
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('resize', onViewportResize);
    // With no functioning observer, capture nested container scrolling too:
    // a mobile map below the fold may enter view without resizing the window.
    // Scope the extra listener to the exceptional fallback path only.
    if (observerFallback) window.addEventListener('scroll', onViewportResize, { capture: true, passive: true });
    // Safari's visual viewport can resize/scroll without a layout resize or
    // a timely IntersectionObserver callback. Listen to both dimensions;
    // older WebViews without this optional API keep the window fallback.
    // An embedded WebView may support only one VisualViewport event. Register
    // independently: a throwing resize listener must not suppress scroll,
    // which is the only signal sent after certain keyboard/pinch changes.
    refreshVisualViewportListeners();
    startWhenVisible();
    return () => {
      active = false;
      if (timeout !== null) window.clearTimeout(timeout);
      // A broken embedded WebView may throw even on disconnect(). Complete
      // scene and listener cleanup regardless; never leak a WebGL context.
      try { intersection?.disconnect(); } catch { /* broken WebView observer teardown */ }
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('resize', onViewportResize);
      if (observerFallback) window.removeEventListener('scroll', onViewportResize, true);
      // Always attempt both removals even if the first WebView API throws.
      // Otherwise a retained scroll handler can touch a disposed GPU scene.
      for (const event of ['resize', 'scroll'] as const) {
        try { subscribedVisualViewport?.removeEventListener(event, onViewportResize); }
        catch { /* partially implemented WebView API */ }
      }
      pendingCreate = null;
      scene?.dispose();
      runtime.current = null;
    };
  }, [host, model, onSelect, onCameraChange, attempt, footprints, manualStart]);

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
          {status === 'loading' ? <p>正在開啟空間導覽…</p> : status === 'deferred' ? (
            deferredCause === 'background'
              ? <p>目前位於背景分頁，返回導覽後才會啟動立體畫面；仍可查看地點與步行導航。</p>
              : <>
                <p>尚未確認立體畫面在可見範圍；滑動至空間圖後才載入，以節省手機效能與電力。若沒有自動載入，可手動開啟。地點資訊與步行導航仍可使用。</p>
                <button className="btn" type="button" onClick={() => {
                  // The launch button disappears as loading begins. Preserve
                  // keyboard/screen-reader focus on the map instead of body.
                  host?.focus();
                  setManualStart(true);
                }}>手動開啟立體畫面</button>
              </>
          ) : <>
            <p>這次無法顯示立體畫面。你仍可選擇地點，查看資訊與導航。</p>
            <button className="btn" type="button" onClick={() => {
              // Retry replaces this button with a loading/status layer.
              // Keep keyboard and screen-reader focus inside the map instead
              // of losing focus when the button is removed from the dialog.
              host?.focus();
              setAttempt((value) => value + 1);
            }}>
              重試立體畫面
            </button>
          </>}
        </div>
      )}
      {status === 'ready' && renderSuspended && (
        <div className={styles.sceneMessage} role="status">
          <p>立體畫面已暫停。回到空間圖會自動恢復；若沒有恢復，可手動重新啟動。</p>
          <button className="btn" type="button" onClick={() => {
            // The recovery button disappears while the scene restarts; keep
            // keyboard focus within the tour instead of losing it to body.
            host?.focus();
            setManualStart(true);
          }}>重新啟動立體畫面</button>
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
        <button className="btn" type="button" onClick={() => onCameraChange({ ...camera, bearing: 0 })}>回到北向</button>
        <button className="btn" type="button" disabled={camera.zoom === 1}
          onClick={() => onCameraChange({ ...camera, zoom: 1 })}>還原 100% 縮放</button>
        <span role="status" aria-live="polite" aria-atomic="true">視角方位 {Math.round(camera.bearing)}° · 縮放 {Math.round(camera.zoom * 100)}%</span>
        <span className={styles.compass}>
          <svg viewBox="0 0 40 40" width="32" height="32" aria-hidden="true">
            <g transform={`rotate(${spatialNorthRotationDegrees(camera.bearing, overhead)} 20 20)`}>
              <path d="M20 4L28 30L20 24L12 30Z" fill="currentColor" />
            </g>
          </svg>
          <span>畫面北向</span>
        </span>
      </div>
      <p id={helpId} className={styles.note}>橫向拖曳旋轉；聚焦空間圖後，可用左右鍵旋轉、＋／− 縮放，Home 回到北向，0 還原 100% 縮放。</p>
    </>}
    </>
  );
}

function SpatialDialog({ school, locations, selected, onSelect, onClose }: Props & { onClose: () => void }) {
  const model = useMemo(() => buildCampusSpatialModel(locations), [locations]);
  // A matching ID alone is not an audited source: Firestore can reuse a POI
  // ID at different coordinates, under a new name or with a new category.
  // Skip the whole-campus download unless a *visible* marker still matches
  // the bundled OSM provenance identity used by visibleFootprints below.
  const auditedWayCandidateCount = school === 'pu'
    ? model.points.filter((point) => POTENTIAL_OUTLINE_POI_IDS.has(point.id) &&
      providencePlaceSourceUrl(school, point.location) !== null).length
    : 0;
  const hasOutlineCandidate = auditedWayCandidateCount > 0;
  // Only a deliberate in-dialog choice overrides the current map selection. If the
  // source withdraws an automatic match, do not silently navigate to its first replacement.
  const [selection, setSelection] = useState<string | null>(null);
  const [overview, setOverview] = useState(!selected);
  const [overhead, setOverhead] = useState(false);
  const [buildingPlanOpen, setBuildingPlanOpen] = useState(false);
  const [footprints, setFootprints] = useState<ProvidenceFootprint[]>([]);
  const [footprintAttempt, setFootprintAttempt] = useState(0);
  const [footprintStatus, setFootprintStatus] = useState<'loading' | 'ready' | 'unavailable' | 'deferred'>(
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
  // A hidden tab must evict expired geometry without fetching; retry when visible.
  const deferredExpiredRefreshRef = useRef(false);
  // Safari may fire pagehide while document.hidden is still false. The public
  // OSM source must share the same bfcache suspension boundary as WebGL.
  const pageSuspendedRef = useRef(false);
  // Respect a 503 Retry-After from our server instead of inviting users to
  // repeatedly retry while the public Overpass origin is in cooldown.
  const [footprintRetryAfter, setFootprintRetryAfter] = useState<{ until: number; minutes: number } | null>(readStoredFootprintCooldown);
  // Expiry enables a deliberate retry; it must not automatically poll Overpass.
  const restoredCooldownRef = useRef(footprintRetryAfter !== null);
  const [camera, setCamera] = useState<CampusSpatialCamera>({ bearing: DEFAULT_SPATIAL_BEARING, zoom: 1 });
  const changeCamera = useCallback((next: CampusSpatialCamera) => setCamera(normalizeSpatialCamera(next)), []);
  const selectedPoint = model.points.find((point) => point.id === (selection ?? selected?.id));
  const showOverview = overview || !selectedPoint;
  const place = selectedPoint?.location;
  const index = model.points.findIndex((point) => point.id === selectedPoint?.id);
  const selectId = useId();
  const progressId = useId();
  const directionsNoteId = useId();
  const footprintCooldownNoteId = useId();
  const footprintRefreshingNoteId = useId();
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
    // A source-checked OSM outline belongs to the bundled, audited POI
    // identity, not merely an ID string. Firestore or filtered map data may
    // reuse the same ID at a different name/position; never attach that real
    // building geometry to a displaced marker or advertise the wrong source.
    const verifiedPointIds = new Set(model.points
      .filter((point) => providencePlaceSourceUrl(school, point.location) !== null)
      .map((point) => point.id));
    const matching = footprints.filter((footprint) => verifiedPointIds.has(footprint.poiId));
    return matching.length ? matching : NO_VISIBLE_FOOTPRINTS;
  }, [school, footprintStatus, model.unavailableReason, model.points, footprints]);
  const sourceFootprint = place
    ? visibleFootprints.find((footprint) => footprint.poiId === place.id) : null;

  useEffect(() => {
    const onPageHide = () => { pageSuspendedRef.current = true; };
    const onPageShow = () => { pageSuspendedRef.current = false; };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);

  useEffect(() => {
    if (school === 'pu') storeFootprintCooldown(footprintRetryAfter?.until ?? null);
  }, [school, footprintRetryAfter?.until]);

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
      // A mobile clock correction can make the original timeout fire early.
      // Rearm from the absolute deadline even if the rounded minute display
      // did not change; background intervals may be heavily throttled.
      window.clearTimeout(timer);
      timer = window.setTimeout(synchronizeCooldown, Math.min(FOOTPRINT_DAY_MS, remaining));
      const minutes = Math.ceil(remaining / 60_000);
      setFootprintRetryAfter((current) =>
        current?.until === footprintRetryAfter.until && current.minutes !== minutes
          ? { ...current, minutes } : current);
    };
    // Browser timers are monotonic, but the server cooldown deadline uses wall time.
    // If the user sets the clock backwards while a timer is pending, its old
    // timeout can fire before the absolute deadline. Recheck before unlocking.
    let timer = window.setTimeout(synchronizeCooldown,
      Math.min(FOOTPRINT_DAY_MS, Math.max(0, footprintRetryAfter.until - Date.now())));
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
    if (school !== 'pu') {
      deferredExpiredRefreshRef.current = false;
      return;
    }
    const resumeExpiredRefresh = () => {
      if (!deferredExpiredRefreshRef.current || document.hidden || pageSuspendedRef.current ||
          footprintRetryAfter !== null || footprintRequestActiveRef.current) return;
      deferredExpiredRefreshRef.current = false;
      setFootprintAttempt((value) => value + 1);
    };
    // Also retry when a Retry-After that blocked the foreground resume ends.
    resumeExpiredRefresh();
    document.addEventListener('visibilitychange', resumeExpiredRefresh);
    window.addEventListener('pageshow', resumeExpiredRefresh);
    return () => {
      document.removeEventListener('visibilitychange', resumeExpiredRefresh);
      window.removeEventListener('pageshow', resumeExpiredRefresh);
    };
  }, [school, footprintRetryAfter]);

  useEffect(() => {
    if (school !== 'pu' || footprintClock === null) return;
    const nextDeadline = footprintStale ? footprintClock.expiresAt : footprintClock.staleAt;
    // A wall-clock correction may make a previously scheduled browser timer
    // fire before the source deadline. Keep one timer armed for the absolute
    // deadline instead of silently losing the seven-day geometry eviction.
    let timer: number;
    const checkSnapshotAge = () => {
      if (footprintExpiresAtRef.current !== footprintClock.expiresAt) return;
      const now = Date.now();
      // The hidden soft-deadline event marks the snapshot stale and moves
      // nextDeadline to the seven-day hard expiry. A visible resume before
      // that hard deadline must still perform the deferred revalidation.
      const softRefreshDeferredFromHiddenTab = !document.hidden && !pageSuspendedRef.current && footprintStale &&
        !staleSnapshotRef.current && now >= footprintClock.staleAt &&
        now < footprintClock.expiresAt;
      if (now < nextDeadline && !softRefreshDeferredFromHiddenTab) {
        window.clearTimeout(timer);
        // Bound waits to avoid setTimeout's 32-bit overflow after a large clock change.
        timer = window.setTimeout(checkSnapshotAge, Math.min(FOOTPRINT_DAY_MS, nextDeadline - now));
        return;
      }
      // Keep public Overpass work out of background tabs while a dated volume
      // remains retainable. The next visible resume event checks this same
      // absolute deadline; hard expiry still evicts geometry even when hidden.
      if ((document.hidden || pageSuspendedRef.current) && now < footprintClock.expiresAt) {
        // The soft deadline timer still has to arm the seven-day hard
        // deadline. Otherwise returning while hidden leaves no later timer
        // to evict old geometry until the user brings the tab back.
        // Keep staleSnapshotRef false so foreground resume revalidates once.
        if (now >= footprintClock.staleAt && !footprintStale) {
          setFootprintStale(true);
        }
        return;
      }
      if (now >= footprintClock.expiresAt) {
        // Seven days is the source's *hard* retention limit, not a trigger to
        // keep an unverified building on screen indefinitely during an outage.
        // Discard the volume before attempting a refresh; POIs and external
        // walking directions remain available even if the origin is offline.
        // An already-running request may still install a *new* valid snapshot.
        footprintExpiresAtRef.current = null;
        staleSnapshotRef.current = false;
        setFootprintClock(null);
        setFootprints([]);
        setFootprintDate(null);
        setFootprintBaseDate(null);
        setFootprintStale(false);
        setFootprintRefreshFailed(false);
        // A freshness refresh may already be in flight when a suspended tab
        // resumes past the seven-day retention limit. Hide expired geometry,
        // but keep the loading state until that bounded request finishes.
        const refreshing = footprintRequestActiveRef.current;
        setFootprintStatus(refreshing ? 'loading' : 'unavailable');
        if (!refreshing) {
          if (document.hidden || pageSuspendedRef.current || footprintRetryAfter !== null) {
            // The hard deadline clears geometry even in the background, but
            // network revalidation waits for a visible tab and server cooldown.
            deferredExpiredRefreshRef.current = true;
          } else {
            setFootprintAttempt((value) => value + 1);
          }
        }
      } else if (now >= footprintClock.staleAt && !staleSnapshotRef.current) {
        // Mark the dated source stale immediately on tab resume, and revalidate
        // it once without making the user search for a manual retry button.
        // The ref prevents duplicate network calls from timer/pageshow races.
        // Do not bypass a server Retry-After or start concurrent requests.
        staleSnapshotRef.current = true;
        setFootprintStale(true);
        if (!footprintRequestActiveRef.current && footprintRetryAfter === null) {
          setFootprintAttempt((value) => value + 1);
        }
      }
    };
    // A retainable but already-stale snapshot may have a hard deadline days
    // away. Recheck the absolute deadline at least daily, including after
    // device clock adjustments, rather than waiting several days initially.
    timer = window.setTimeout(checkSnapshotAge,
      Math.max(0, Math.min(FOOTPRINT_DAY_MS, nextDeadline - Date.now())));
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
    if (!hasOutlineCandidate) {
      // With no audited outline candidate, do not contact Overpass and do not
      // retain unused volumes in memory. An in-flight request is aborted by
      // this effect's previous cleanup when the map filter changes.
      deferredExpiredRefreshRef.current = false;
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
      return;
    }
    if (restoredCooldownRef.current) {
      // A resumed or hidden dialog must not bypass the previous failed request.
      if (footprintRetryAfter !== null || footprintAttempt === 0) {
        setFootprintStatus('unavailable');
        return;
      }
      restoredCooldownRef.current = false;
    }
    // The dialog can mount while a tab is suspended (e.g. restored from a
    // mobile browser session). Do not start a fresh public OSM request until
    // the user returns. The original POIs and walking link still work.
    if (document.hidden || pageSuspendedRef.current) {
      // Do not announce an active OSM fetch when mobile has suspended it.
      // Keep POIs and navigation usable while waiting for a visible tab.
      // Preserve previously verified, still-retainable outlines while a
      // background refresh waits; only the pending fetch becomes deferred.
      setFootprintStatus((current) => current === 'ready' ? current : 'deferred');
      let resumed = false;
      const fetchWhenVisible = () => {
        if (resumed || document.hidden || pageSuspendedRef.current) return;
        resumed = true;
        document.removeEventListener('visibilitychange', fetchWhenVisible);
        window.removeEventListener('pageshow', fetchWhenVisible);
        setFootprintAttempt((attempt) => attempt + 1);
      };
      document.addEventListener('visibilitychange', fetchWhenVisible);
      window.addEventListener('pageshow', fetchWhenVisible);
      return () => {
        document.removeEventListener('visibilitychange', fetchWhenVisible);
        window.removeEventListener('pageshow', fetchWhenVisible);
      };
    }
    let active = true;
    let timedOut = false;
    let requestPending = true;
    let suspendedInBackground = false;
    // Distinguish fetch-level network errors from a server response. Do not
    // overwrite a valid Retry-After from an HTTP or JSON-contract failure.
    let receivedResponse = false;
    // A freshness deadline may retain a dated snapshot; the seven-day hard
    // source expiry never may.
    // Both originally stale snapshots and once-fresh snapshots crossing
    // the 24-hour soft deadline can stay visible during revalidation.
    // Their hard retention may end while mobile timers are suspended.
    const preserveStale = staleSnapshotRef.current;
    // Never restore expired geometry after a failed or aborted refresh,
    // even if the browser has not delivered its seven-day deadline timer.
    const canRetainStale = () => preserveStale && footprintExpiresAtRef.current !== null &&
      Date.now() < footprintExpiresAtRef.current;
    // A manual refresh or an already-triggered request supersedes deferral.
    deferredExpiredRefreshRef.current = false;
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
      const keepStale = canRetainStale();
      if (keepStale) setFootprintRefreshFailed(true);
      setFootprintStatus(keepStale ? 'ready' : 'unavailable');
      // A timed-out proxy is not proof that the public OSM source recovered.
      // Pause manual retries locally even when AbortSignal was ignored.
      setFootprintRetryAfter({ until: Date.now() + 60_000, minutes: 1 });
    }, 15_000);
    // Ordinary mobile app/tab switches can fire visibilitychange without
    // pagehide. Stop the pending public OSM response in either suspension
    // path: AbortSignal is advisory, so quarantine late success as well.
    // A successful/failed settled request must not refetch on resume.
    const suspendForBackground = () => {
      if (!document.hidden && !pageSuspendedRef.current) return;
      if (!active || timedOut || !requestPending) return;
      suspendedInBackground = true;
      active = false;
      footprintRequestActiveRef.current = false;
      window.clearTimeout(timeout);
      controller.abort();
      setFootprintRefreshing(false);
      setFootprintStatus(canRetainStale() ? 'ready' : 'deferred');
    };
    const resumeAfterForeground = () => {
      if (!suspendedInBackground || document.hidden || pageSuspendedRef.current) return;
      suspendedInBackground = false;
      setFootprintAttempt((value) => value + 1);
    };
    const onVisibilityChange = () => {
      if (document.hidden) suspendForBackground();
      else resumeAfterForeground();
    };
    window.addEventListener('pagehide', suspendForBackground);
    window.addEventListener('pageshow', resumeAfterForeground);
    document.addEventListener('visibilitychange', onVisibilityChange);
    // A gateway can return HTTP 200 with truncated JSON or a payload that
    // fails our source/geometry contract. Treat that as a rejected source
    // response rather than letting repeated manual retries hammer Overpass.
    // Preserve a valid Retry-After when supplied; otherwise pause for 60s.
    const pauseForInvalidPayload = (seconds: number | null) => {
      if (!active || timedOut) return;
      const wait = seconds ?? 60;
      setFootprintRetryAfter({ until: Date.now() + wait * 1000, minutes: Math.ceil(wait / 60) });
    };
    void fetch('/api/public/campus-footprints', { signal: controller.signal })
      .then(async (response) => {
        receivedResponse = true;
        // Fetch considers 203/206 successful, but the map API contract is a
        // complete 200 JSON document. A CDN/proxy must not turn a transformed
        // or partial representation into a trusted 3D building snapshot.
        const contentRange = response.headers?.get('content-range') ?? null;
        const contentLength = response.headers?.get('content-length') ?? null;
        // Captive portals and misconfigured gateways can reply HTTP 200 with
        // non-JSON documents and a stalled body. Our endpoint only returns
        // JSON; reject any explicitly incompatible media type before reading
        // the stream, while accepting application/*+json with parameters
        // (RFC 6838 restricted-name characters, including `_`).
        // Missing Content-Type remains compatible with legacy WebView bridges.
        const contentType = response.headers?.get('content-type')?.trim().toLowerCase() ?? '';
        const mediaType = contentType.split(';', 1)[0]?.trim() ?? '';
        const invalidMediaType = mediaType !== '' && mediaType !== 'application/json' &&
          !/^application\/[a-z0-9][a-z0-9!#$&^_.+-]*\+json$/.test(mediaType);
        // RFC Content-Length is a decimal byte count, not a fraction, hex
        // number or comma-separated value. Do not trust a 200 JSON body whose
        // advertised size is invalid or implausibly large for this API.
        const invalidContentLength = contentLength !== null &&
          (!/^\d+$/.test(contentLength) ||
            !Number.isSafeInteger(Number(contentLength)) ||
            // HTTP 200 with a declared empty representation cannot contain
            // verified OSM geometry, regardless of identity/gzip encoding.
            // Reject at headers so a stalled WebView body cannot hold the map
            // for the full 15-second network deadline.
            Number(contentLength) === 0 ||
            Number(contentLength) > MAX_DECLARED_FOOTPRINT_BYTES);
        if (!response.ok || (typeof response.status === 'number' && response.status !== 200) ||
            contentRange !== null || invalidContentLength || invalidMediaType) {
          // Fetch resolves at the response headers. A rejected 2xx/3xx/5xx
          // can still stream a large body; release it without awaiting an
          // uncooperative proxy, rather than waste mobile bandwidth/memory.
          // The status and Retry-After headers remain usable after cancellation.
          if (response.body) {
            try {
              // A locked stream or some WebView implementations can throw
              // synchronously rather than returning a rejected promise.
              // Disposal is best-effort; never skip the status-derived
              // Retry-After cooldown because cancellation itself failed.
              void Promise.resolve(response.body.cancel()).catch(() => {});
            } catch {
              // Continue to evaluate the HTTP status and Retry-After below.
            }
          }
          // Match the API's fail-closed response policy: an upstream/proxy can
          // request a cooldown on 408, gateway failures, or partial content,
          // not only 429/503. Do not hammer a source that rejected a full map.
          const status = response.status;
          // 201/202/203/204/205/206 and other non-200 success statuses do
          // not satisfy our complete JSON snapshot contract. In particular
          // 204/205 have no body: repeated retries would only load the origin.
          // A stray 304 without a conditional request is also not a snapshot.
          const invalidSuccessStatus = typeof status === 'number' && status >= 200 &&
            status < 300 && status !== 200;
          const rateLimitedOrIncomplete = invalidSuccessStatus || status === 304 || status === 408 ||
            status === 429 || (typeof status === 'number' && status >= 500 && status <= 599) ||
            contentRange !== null || invalidContentLength || invalidMediaType;
          // A proxy can return an incomplete 206/Content-Range document or
          // a 408 without Retry-After. These responses cannot be trusted as
          // complete OSM geometry and should not trigger a manual retry loop.
          // Back off 60s for non-200 2xx, unexpected 304, 408, 429 and
          // gateway failures. Explicit valid Retry-After still wins; an
          // ordinary 500 keeps its existing manual-retry behavior.
          const fallbackBackoff = invalidSuccessStatus || status === 304 ||
            status === 408 || status === 429 || status === 502 ||
            status === 503 || status === 504 || contentRange !== null || invalidContentLength ||
            invalidMediaType;
          const seconds = rateLimitedOrIncomplete
            ? (footprintCooldownSeconds(response) ?? (fallbackBackoff ? 60 : null))
            : null;
          if (active && !timedOut && seconds !== null) {
            setFootprintRetryAfter({ until: Date.now() + seconds * 1000, minutes: Math.ceil(seconds / 60) });
          }
          throw new Error('footprint source unavailable');
        }
        const cooldownSeconds = response.status === 200 ? footprintCooldownSeconds(response) : null;
        let payload: unknown;
        try {
          payload = await readBoundedFootprintJson(response, controller.signal);
        } catch {
          pauseForInvalidPayload(cooldownSeconds);
          throw new Error('Invalid building outline response body');
        }
        return { payload, cooldownSeconds };
      })
      .then(({ payload, cooldownSeconds }) => {
        requestPending = false;
        if (!active || timedOut) return;
        const snapshot = parseProvidenceFootprintSnapshot(payload);
        if (!snapshot) {
          pauseForInvalidPayload(cooldownSeconds);
          throw new Error('No recent, source-checked building outlines');
        }
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
      .catch((error: unknown) => {
        requestPending = false;
        if (!active || timedOut) return;
        // WebView bridges can surface an offline fetch rejection as a normal
        // Error named NetworkError (not always a DOMException). Do not let
        // that representation bypass the same one-minute origin backoff.
        // An AbortError or unrelated app error must not be rate-limited.
        const networkFailure = error instanceof TypeError ||
          (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'NetworkError') ||
          (error instanceof Error && error.name === 'NetworkError');
        if (!receivedResponse && networkFailure) {
          setFootprintRetryAfter({ until: Date.now() + 60_000, minutes: 1 });
        }
        // Preserve only a still-retainable dated snapshot on refresh failure.
        // Once source retention expires, all failures stay marker-only.
        setFootprintRefreshing(false);
        const keepStale = canRetainStale();
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
      window.removeEventListener('pagehide', suspendForBackground);
      window.removeEventListener('pageshow', resumeAfterForeground);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      controller.abort();
    };
  }, [school, model.unavailableReason, hasOutlineCandidate, footprintAttempt]);

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
              <div className={styles.footprintInfo}>
                {hasOutlineCandidate && footprintStatus === 'loading' && <span role="status">正在讀取靜宜建築輪廓；地點標記仍可操作。</span>}
                {hasOutlineCandidate && footprintStatus === 'deferred' && <span role="status">目前位於背景分頁，返回導覽後才會讀取靜宜建築輪廓；地點標記與導航仍可使用。</span>}
                {!hasOutlineCandidate && <span role="status">
                  目前篩選的地點沒有已核對的 OSM 建築輪廓候選來源，不下載整座校園的建築資料；地點標記與步行導航仍可使用。
                </span>}
                {hasOutlineCandidate && footprintStatus === 'unavailable' && <>
                  <span role="status">公開建築輪廓目前無法取得，保留地點標記與導航，不顯示臆測建築。</span>
                  {footprintRetryAfter !== null && <span id={footprintCooldownNoteId} role="status">
                    為避免頻繁請求，建築輪廓更新約 {footprintRetryAfter.minutes} 分鐘冷卻，到期後可再試。
                  </span>}
                  <button className={styles.retryFootprints} type="button"
                    aria-describedby={footprintRetryAfter !== null ? footprintCooldownNoteId : undefined}
                    disabled={footprintRetryAfter !== null}
                    onClick={() => setFootprintAttempt((value) => value + 1)}>
                    重新讀取建築輪廓
                  </button>
                </>}
                {hasOutlineCandidate && footprintStatus === 'ready' && (
                  <>
                    <strong role="status">{visibleFootprints.length} 棟公開建築輪廓</strong>
                    {auditedWayCandidateCount > visibleFootprints.length && <span>
                      目前範圍另有 {auditedWayCandidateCount - visibleFootprints.length} 筆清單中的 OSM 建築 way 未取得可顯示的有效外框；不代表建築不存在，也不代表已驗證入口。
                    </span>}
                    <span>依 OpenStreetMap 圖徵立體化。高度使用 OSM 標註或 12 公尺示意值，未經校方測量；不是室內導覽或無障礙路線。</span>
                    {footprintDate && <small>資料讀取：{footprintDate}{footprintStale ? '（暫用舊快照）' : ''}</small>}
                    {footprintBaseDate && <small>OSM 資料庫同步：{footprintBaseDate}（非現地查證）</small>}
                    {footprintStale && <>
                      <span>目前使用有日期標註的舊輪廓，可手動檢查是否已有更新；原始地點與步行導航不受影響。</span>
                      {footprintRetryAfter !== null && <span id={footprintCooldownNoteId} role="status">
                        為避免頻繁請求，建築輪廓更新約 {footprintRetryAfter.minutes} 分鐘冷卻，到期後可再試。
                      </span>}
                      {footprintRefreshing && <span id={footprintRefreshingNoteId} role="status">正在檢查更新，暫時保留舊輪廓。</span>}
                      {footprintRefreshFailed && !footprintRefreshing && <span role="status">更新未成功，仍顯示先前有日期標註的舊輪廓；資料日期沒有更新。</span>}
                      <button className={styles.retryFootprints} type="button"
                        aria-describedby={[
                          footprintRetryAfter !== null ? footprintCooldownNoteId : '',
                          footprintRefreshing ? footprintRefreshingNoteId : '',
                        ].filter(Boolean).join(' ') || undefined}
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
                {sourceFootprint && (
                  <p className={styles.note}>
                    <a href={sourceFootprint.sourceUrl} target="_blank" rel="noopener noreferrer">
                      查看此棟建築的 OpenStreetMap 原始輪廓
                    </a>
                    {' '}（OSM 圖徵來源，非現地測繪；不代表已驗證入口）
                  </p>
                )}
                {sourceFootprint?.osmVersion && sourceFootprint.osmEditedAt && (
                  <p className={styles.note}>
                    OSM way 版本 v{sourceFootprint.osmVersion} · 圖徵最後編輯 {sourceFootprint.osmEditedAt.slice(0, 10)}。
                    此日期不代表現場查證，節點座標可能另有更新。
                  </p>
                )}
                {school === 'pu' && place.id === 'pu-zhugu' && source !== null && (
                  <div className={styles.officialFloors}>
                    <strong>主顧樓 · 校方公開樓層資訊</strong>
                    <p>4 樓：資訊管理學系、人工智慧應用學系。</p>
                    <p>5 樓：資訊工程學系。</p>
                    <p>6 樓：資訊學院、台灣文學系、管理碩士在職專班（EMBA）。</p>
                    <p>7 樓：會計室、校友聯絡暨就業輔導室、國際暨兩岸事務處。</p>
                    <p>8 樓：校長室、副校長室、秘書室、研發處、人事室。</p>
                    <a href={PROVIDENCE_OFFICIAL_BUILDING_UNITS_URL} target="_blank" rel="noopener noreferrer">
                      查看校史資料室主顧樓單位清單
                    </a>
                    <small>依校方校史資料室公開的主顧樓樓層單位資訊整理；單位可能調整，請以校方最新公告為準。這不是教室座標，不代表建築入口或室內動線已查證。</small>
                  </div>
                )}
                {school === 'pu' && place.id === 'pu-zhugu' && source === null && (
                  <p className={styles.pending} role="status">
                    這筆主顧樓地點尚未與校園已核對資料對上，暫不顯示校方樓層單位，避免把單位誤掛到其他位置。
                  </p>
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
