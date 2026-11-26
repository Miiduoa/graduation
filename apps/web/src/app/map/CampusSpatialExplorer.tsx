'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
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
import { PROVIDENCE_CAMPUS_PLACES, PROVIDENCE_CAMPUS_SOURCE } from '@campus/shared/src/providenceCampus';
import { parseProvidenceFootprintSnapshot, type ProvidenceFootprint } from './providenceFootprints';
import { reuseUnchangedProvidenceFootprints } from './footprintSnapshotEquality';
import { isSupportedUtf8JsonMediaType } from './jsonMediaType';
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
function requestsReducedData(): boolean {
  try {
    return (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
  } catch {
    return false;
  }
}

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
// A JSON-only response cannot expose the original byte count.
function isWellFormedUtf8(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i];
    if (b <= 0x7f) { i += 1; continue; }
    let need: number; let min: number; let code: number;
    if (b >= 0xc2 && b <= 0xdf) { need = 1; min = 0x80; code = b & 0x1f; }
    else if (b >= 0xe0 && b <= 0xef) { need = 2; min = 0x800; code = b & 0x0f; }
    else if (b >= 0xf0 && b <= 0xf4) { need = 3; min = 0x10000; code = b & 0x07; }
    else return false;
    if (i + need >= bytes.length) return false;
    for (let k = 1; k <= need; k += 1) {
      const c = bytes[i + k];
      if ((c & 0xc0) !== 0x80) return false;
      code = (code << 6) | (c & 0x3f);
    }
    if (code < min || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return false;
    i += need + 1;
  }
  return true;
}

async function readBoundedFootprintJson(response: Response, signal?: AbortSignal): Promise<unknown> {
  // Browser fetch exposes decoded body bytes, while a compressed response's
  // Content-Length describes the wire representation. Compare exact lengths
  // only when the response explicitly uses identity encoding (or no coding).
  // The outer fetch gate already rejects invalid/oversized declared lengths.
  const declaredHeader = response.headers?.get('content-length') ?? null;
  const codingHeader = response.headers?.get('content-encoding');
  const declaredIdentityBytes = declaredHeader !== null &&
    (codingHeader === null || codingHeader.trim().toLowerCase() === 'identity')
      ? Number(declaredHeader) : null;
  const checkIdentityLength = (actualBytes: number) => {
    if (declaredIdentityBytes !== null && actualBytes !== declaredIdentityBytes) {
      throw new Error('Building outline response length mismatch');
    }
  };
  let decoder: TextDecoder | undefined;
  try {
    const candidate = new TextDecoder('utf-8', { fatal: true });
    if (candidate.decode(new Uint8Array([0xe4, 0xb8, 0xad])) === '中') decoder = candidate;
  } catch { /* WebView may lack a usable TextDecoder. */ }

  const parseBytes = async (bytes: ArrayBuffer | Uint8Array<ArrayBuffer>) => {
    // Fetch can decode UTF-8 even when the global TextDecoder is unavailable.
    // This local response contains only bytes that passed the size check.
    // Without a fatal decoder, reject malformed UTF-8 before text() can
    // silently replace it with U+FFFD.
    // Some older WebViews accept { fatal: true } but silently ignore it,
    // replacing invalid source bytes with U+FFFD. Even a seemingly usable
    // TextDecoder must not turn corrupted OSM data into valid JSON geometry.
    if (!isWellFormedUtf8(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))) {
      throw new Error('Building outline response is not valid UTF-8');
    }
    const raw = decoder ? decoder.decode(bytes) : await new Response(bytes).text();
    if (signal?.aborted) throw new Error('Building outline read aborted');
    return JSON.parse(raw) as unknown;
  };

  const checkSize = (length: number) => {
    if (length > MAX_DECLARED_FOOTPRINT_BYTES) {
      throw new Error('Building outline response exceeded byte limit');
    }
  };
  // A missing/partial TextEncoder must not turn 2 MB of UTF-8 into an
  // unchecked UTF-16 character count. Count code points without allocating
  // another large byte array; lone surrogates encode as U+FFFD (3 bytes).
  const checkTextSize = (raw: string) => {
    checkSize(raw.length);
    let bytes = 0;
    for (let i = 0; i < raw.length; i += 1) {
      const code = raw.charCodeAt(i);
      if (code <= 0x7f) bytes += 1;
      else if (code <= 0x7ff) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff && i + 1 < raw.length) {
        const next = raw.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          bytes += 4;
          i += 1;
        } else bytes += 3;
      } else bytes += 3;
      checkSize(bytes);
    }
    return bytes;
  };

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    reader = response.body?.getReader?.();
    if (reader && typeof reader.read !== 'function') {
      reader.releaseLock?.();
      reader = undefined;
    }
  } catch { reader = undefined; }

  if (!reader) {
    let bytes: ArrayBuffer | undefined;
    try {
      const readBytes = response.arrayBuffer ??
        (typeof Response !== 'undefined' && response instanceof Response ? Response.prototype.arrayBuffer : undefined);
      bytes = await readBytes?.call(response);
    } catch (error) {
      if (response.bodyUsed) throw error;
    }
    if (bytes && (Object.prototype.toString.call(bytes) === '[object ArrayBuffer]' || ArrayBuffer.isView(bytes))) {
      checkSize(bytes.byteLength);
      checkIdentityLength(bytes.byteLength);
      return parseBytes(bytes);
    }
    // Some older WebViews expose text() but no readable body or arrayBuffer().
    // Verify their decoded UTF-8 byte count before parsing, including any
    // identity Content-Length. text() strips an optional UTF-8 BOM: if that
    // makes the length unverifiable, reject the optional outline instead of
    // silently accepting a mismatched or truncated source representation.
    if (typeof response.text === 'function') {
      let raw: string | undefined;
      try { raw = await response.text(); }
      catch (error) {
        if (response.bodyUsed) throw error;
      }
      if (typeof raw === 'string') {
        if (signal?.aborted) throw new Error('Building outline read aborted');
        checkIdentityLength(checkTextSize(raw));
        return JSON.parse(raw) as unknown;
      }
    }
    // JSON-only bridges expose no raw bytes. Their body can exceed the size
    // cap and cannot be compared to Content-Length, so json() is not a safe
    // fallback for trusted OSM geometry. Keep POIs and external directions.
    throw new Error('Building outline response bytes unavailable');
  }
  // A mobile pagehide/unmount/timeout may arrive after the fetch headers but
  // while response-body streaming is still pending. Abort the *reader* as well
  // as fetch, so background tabs stop consuming OSM data on WebViews whose
  // fetch signal does not automatically cancel a handed-off body.
  let readerCancelRequested = false;
  const cancelReader = () => {
    if (readerCancelRequested) return;
    readerCancelRequested = true;
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
  let completed = false;
  try {
    if (signal?.aborted) {
      cancelReader();
      throw new Error('Building outline read aborted');
    }
    while (true) {
      const { done, value } = await reader.read();
      if (signal?.aborted) throw new Error('Building outline read aborted');
      if (done) { completed = true; break; }
      // Count even empty chunks: a stream can otherwise loop forever while
      // retaining zero bytes, and microtasks can starve the 15s timeout.
      if (++chunks > MAX_FOOTPRINT_STREAM_CHUNKS ||
          value.byteLength > MAX_DECLARED_FOOTPRINT_BYTES - total) {
        // Do not let a locked or unusual stream prevent the rejection path.
        cancelReader();
        throw new Error('Building outline response exceeded byte/chunk limit');
      }
      const end = total + value.byteLength;
      if (declaredIdentityBytes !== null && end > declaredIdentityBytes) {
        // A misframed identity body is already invalid. Cancel immediately,
        // rather than waiting for EOF from an uncooperative mobile proxy.
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
      // A hostile proxy can drip already-resolved zero-byte/tiny chunks.
      // Yield periodically so browser timers, touch input and cancellation
      // can run before the 8,192-chunk guard is reached on mobile WebViews.
      if (chunks % 128 === 0) {
        await new Promise<void>((resolve) => window.setTimeout(() => resolve(), 0));
        if (signal?.aborted) throw new Error('Building outline read aborted');
      }
    }
  } finally {
    // A network/bridge reader may throw after some bytes. Release the source
    // instead of leaving a partially consumed mobile stream alive; EOF needs
    // no cancellation, and abort/size guards must not cancel twice.
    if (!completed) cancelReader();
    signal?.removeEventListener('abort', cancelReader);
    try { reader.releaseLock(); } catch { /* Partially implemented reader. */ }
  }
  if (signal?.aborted) throw new Error('Building outline read aborted');
  checkIdentityLength(total);
  return parseBytes(bytes.subarray(0, total));
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

function SpatialCanvas({ model, selectedId, overhead, camera, onCameraChange, onSelect, footprints, manualStart, onManualStart }: {
  model: ReturnType<typeof buildCampusSpatialModel>;
  selectedId: string | null;
  overhead: boolean;
  camera: CampusSpatialCamera;
  onCameraChange: (camera: CampusSpatialCamera) => void;
  onSelect: (id: string) => void;
  footprints: readonly ProvidenceFootprint[];
  manualStart: number;
  onManualStart: () => void;
}) {
  const appearance = useSyncExternalStore(subscribeAppearance, readAppearance, () => 'reduced:light');
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<'loading' | 'deferred' | 'ready' | 'error'>('loading');
  // Some mobile WebViews never report a fresh onscreen entry after suspending a
  // running scene. Keep a visible recovery control instead of a frozen canvas.
  const [renderSuspended, setRenderSuspended] = useState(false);
  const [deferredCause, setDeferredCause] = useState<'background' | 'offscreen' | 'data-saver'>('background');
  const pageSuspended = useRef(false);
  const helpId = useId();
  const runtime = useRef<CampusSpatialScene | null>(null);
  const sceneContainer = useRef<HTMLDivElement | null>(null);
  const restartButton = useRef<HTMLButtonElement | null>(null);
  const manualOpenButton = useRef<HTMLButtonElement | null>(null);
  // Only move keyboard focus into the recovery UI when it was inside the 3D scene.
  // An observer pause caused by scrolling must not steal focus from directions or POI controls.
  const restoreFocusAfterPause = useRef(false);
  const sceneWasSuspended = useRef(false);
  // Remember a stale visual-viewport signature only for an explicit restart or
  // overlay touch. Effect remounts (for example when outlines arrive) must not
  // re-arm it after focus or keyboard intersection already cleared it.
  const ignoredViewportRef = useRef<string | null>(null);
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
    const hasDataConsent = manualStart > 0;
    // Avoid loading the optional Three.js bundle or allocating WebGL when the
    // browser requests reduced data use. Marker details and walking links
    // remain available; the visitor can explicitly opt into 3D at any time.
    const saveData = requestsReducedData();
    let visibility: 'unknown' | 'visible' | 'hidden' = 'unknown';
    let scene: CampusSpatialScene | null = null;
    // Safari can fire pagehide before visibilitychange when entering bfcache.
    // Treat that window as suspended even if document.hidden stays false.
    const isBackgrounded = () => pageSuspended.current || document.hidden;
    // Measure the visual viewport even when layout already hides the canvas,
    // so keyboard occlusion is tracked across a subsequent focus change.
    const isOffscreen = () => measureVisualViewportVisibility() === false ||
      keyboardOverlayIntersectsCanvas() || visibility === 'hidden' ||
      (visibility === 'unknown' && measureLayoutVisibility() === false) ||
      // A positive IntersectionObserver can be stale after nested modal
      // scrolling. Only override that signal when the dialog's *actual*
      // scrollport has valid measurements and demonstrably clips the canvas.
      // Incomplete layout geometry must not contradict a valid observer.
      (visibility === 'visible' && measureDialogScrollportVisibility() === false);
    const isDeferred = () => isOffscreen() || isBackgrounded() || (saveData && !hasDataConsent);
    const defer = () => {
      setDeferredCause(isBackgrounded() ? 'background' :
        saveData && !hasDataConsent ? 'data-saver' : 'offscreen');
      setStatus('deferred');
    };
    const updateVisibility = () => {
      if (!scene) return;
      const shouldRender = !isOffscreen() && !isBackgrounded();
      // Capture focus before setActive() marks 3D marker buttons inert. Some
      // browsers blur the active marker immediately on that DOM change.
      if (!shouldRender && !sceneWasSuspended.current) {
        restoreFocusAfterPause.current = host.contains(host.ownerDocument.activeElement);
      } else if (shouldRender && sceneWasSuspended.current) {
        // Auto-resume unmounts the restart control. If it holds keyboard
        // focus, return it to the scene instead of leaving it on document.body.
        const focused = host.ownerDocument.activeElement;
        if (focused && focused === restartButton.current) {
          restoreFocusAfterPause.current = true;
        }
      }
      sceneWasSuspended.current = !shouldRender;
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
      // Automatic startup removes the manual-open control. If a keyboard user
      // had focus on it (e.g. Tab scrolled the canvas into view), return focus
      // to the canvas once it is ready instead of dropping it onto document.body.
      const focused = host.ownerDocument.activeElement;
      if (focused && focused === manualOpenButton.current) restoreFocusAfterPause.current = true;
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
          if (!active || scene) return;
          if (isDeferred()) {
            syncPendingStartup();
            return;
          }
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
    // Fall back to layout and dialog clipping when the observer has no result.
    let scrollDialog: Element | null | undefined;
    try { scrollDialog = host.closest?.('dialog'); }
    catch { /* Dialog clipping is optional when this API is unavailable. */ }
    const measureVisibilityAgainst = (
      viewLeft: number, viewTop: number, viewRight: number, viewBottom: number,
      clipToDialog = true,
    ): boolean | null => {
      try {
        const rect = host.getBoundingClientRect();
        // Incomplete geometry cannot establish an empty intersection.
        if (![rect.left, rect.top, rect.right, rect.bottom, rect.width, rect.height,
          viewLeft, viewTop, viewRight, viewBottom].every(Number.isFinite) ||
          rect.width <= 0 || rect.height <= 0 ||
          viewRight <= viewLeft || viewBottom <= viewTop ||
          rect.right <= rect.left || rect.bottom <= rect.top) return null;
        // The dialog clips its overflowing contents even where the window
        // still has visible pixels outside the dialog.
        const dialogRect = clipToDialog ? scrollDialog?.getBoundingClientRect() : undefined;
        let clippedLeft = Math.max(rect.left, viewLeft);
        let clippedTop = Math.max(rect.top, viewTop);
        let clippedRight = Math.min(rect.right, viewRight);
        let clippedBottom = Math.min(rect.bottom, viewBottom);
        if (scrollDialog && dialogRect) {
          const { clientLeft, clientTop, clientWidth, clientHeight } = scrollDialog;
          const contentLeft = dialogRect.left + clientLeft;
          const contentTop = dialogRect.top + clientTop;
          const contentRight = contentLeft + clientWidth;
          const contentBottom = contentTop + clientHeight;
          if (clientWidth > 0 && clientHeight > 0 &&
              [contentLeft, contentTop, contentRight, contentBottom].every(Number.isFinite)) {
            clippedLeft = Math.max(clippedLeft, contentLeft);
            clippedTop = Math.max(clippedTop, contentTop);
            clippedRight = Math.min(clippedRight, contentRight);
            clippedBottom = Math.min(clippedBottom, contentBottom);
          }
        }
        return clippedRight > clippedLeft && clippedBottom > clippedTop;
      } catch {
        // A broken host/layout measurement is not evidence of an offscreen
        // canvas; keep the observer and manual recovery available.
        return null;
      }
    };
    const measureLayoutVisibility = (): boolean | null =>
      measureVisibilityAgainst(0, 0, window.innerWidth, window.innerHeight);
    // Do not compare against the window viewport when the observer has
    // positively identified this canvas: some WebViews report stale window
    // dimensions while the dialog itself is onscreen. The dialog's measurable
    // scrollport is the independent clipping boundary we can verify.
    const measureDialogScrollportVisibility = (): boolean | null => {
      if (!scrollDialog) return null;
      try {
        const dialogRect = scrollDialog.getBoundingClientRect();
        const { clientLeft, clientTop, clientWidth, clientHeight } = scrollDialog;
        const left = dialogRect.left + clientLeft;
        const top = dialogRect.top + clientTop;
        const right = left + clientWidth;
        const bottom = top + clientHeight;
        if (![left, top, right, bottom].every(Number.isFinite) ||
            clientWidth <= 0 || clientHeight <= 0) return null;
        return measureVisibilityAgainst(left, top, right, bottom, false);
      } catch {
        return null;
      }
    };
    // The on-screen canvas is the host rectangle clipped to the dialog
    // scrollport. Both the visual-viewport and virtualKeyboard signals use
    // this same visible area; overflow hidden by the modal must not count.
    const visibleCanvasRect = (): { left: number; top: number; right: number; bottom: number } | null => {
      try {
        const rect = host.getBoundingClientRect();
        if (![rect.left, rect.top, rect.right, rect.bottom, rect.width, rect.height].every(Number.isFinite) ||
            rect.width <= 0 || rect.height <= 0 ||
            rect.right <= rect.left || rect.bottom <= rect.top) return null;
        let left = rect.left;
        let top = rect.top;
        let right = rect.right;
        let bottom = rect.bottom;
        if (scrollDialog) {
          const dialogRect = scrollDialog.getBoundingClientRect();
          const { clientLeft, clientTop, clientWidth, clientHeight } = scrollDialog;
          const contentLeft = dialogRect.left + clientLeft;
          const contentTop = dialogRect.top + clientTop;
          const contentRight = contentLeft + clientWidth;
          const contentBottom = contentTop + clientHeight;
          if (clientWidth > 0 && clientHeight > 0 &&
              [contentLeft, contentTop, contentRight, contentBottom].every(Number.isFinite)) {
            left = Math.max(left, contentLeft);
            top = Math.max(top, contentTop);
            right = Math.min(right, contentRight);
            bottom = Math.min(bottom, contentBottom);
          }
        }
        if (!(right > left && bottom > top)) return null;
        return { left, top, right, bottom };
      } catch {
        return null;
      }
    };
    const intersectsVisibleCanvas = (
      viewLeft: number, viewTop: number, viewRight: number, viewBottom: number,
    ): boolean | null => {
      const canvas = visibleCanvasRect();
      if (!canvas ||
          ![viewLeft, viewTop, viewRight, viewBottom].every(Number.isFinite) ||
          viewRight <= viewLeft || viewBottom <= viewTop) return null;
      const left = Math.max(canvas.left, viewLeft);
      const top = Math.max(canvas.top, viewTop);
      const right = Math.min(canvas.right, viewRight);
      const bottom = Math.min(canvas.bottom, viewBottom);
      return right > left && bottom > top;
    };
    const viewportSignature = (viewport: VisualViewport): string =>
      [viewport.offsetLeft, viewport.offsetTop, viewport.width, viewport.height,
        viewport.scale].join(':');
    type VirtualKeyboard = EventTarget & { boundingRect: DOMRectReadOnly; overlaysContent?: boolean };
    let virtualKeyboard: VirtualKeyboard | undefined;
    try {
      virtualKeyboard = (window.navigator as Navigator & { virtualKeyboard?: VirtualKeyboard }).virtualKeyboard;
    } catch { /* Optional in embedded browsers. */ }
    const keyboardOverlayIntersectsCanvas = (): boolean => {
      try {
        const bounds = virtualKeyboard?.boundingRect;
        if (!bounds || ![bounds.left, bounds.top, bounds.right, bounds.bottom,
          bounds.width, bounds.height].every(Number.isFinite) ||
          !(bounds.width > 0 && bounds.height > 0)) return false;
        // A reported rectangle that actually overlaps the visible canvas is
        // enough; do not require overlaysContent, which some WebViews omit.
        return intersectsVisibleCanvas(bounds.left, bounds.top, bounds.right, bounds.bottom) === true;
      } catch {
        return false;
      }
    };
    const isPinchZoomed = (viewport: VisualViewport) =>
      Number.isFinite(viewport.scale) && viewport.scale > 1.01;
    const isTextEntryTarget = (element: Element | null): boolean => {
      if (!element) return false;
      const tag = element.tagName;
      if (tag === 'TEXTAREA') return true;
      if (tag === 'INPUT') {
        const type = ((element as HTMLInputElement).type || 'text').toLowerCase();
        return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'image',
          'file', 'color', 'hidden'].includes(type);
      }
      return (element as HTMLElement).isContentEditable === true;
    };
    // Visual geometry handles keyboard coverage; isOffscreen separately checks
    // measured dialog clipping even when a positive observer has become stale.
    // Recovering a hidden observation must prove both intersections together.
    const measureVisualViewportVisibility = (clipToDialog = false): boolean | null => {
      try {
        const viewport = window.visualViewport;
        if (!viewport) return keyboardOverlayIntersectsCanvas() ? false : null;
        const { offsetLeft: left, offsetTop: top, width, height } = viewport;
        // Keyboard overlap must be evaluated even if a manual restart asked
        // us to ignore this exact viewport size. Clear that cache as soon as
        // an intersection begins so later focus/viewport checks stay honest.
        if (keyboardOverlayIntersectsCanvas()) {
          ignoredViewportRef.current = null;
          if (!clipToDialog) return false;
        }
        // The visitor explicitly restarted 3D while the viewport read this
        // way. Ignore it as an occlusion signal until it changes, an editable
        // gains focus, or a keyboard overlaps. Positive geometry can still
        // recover a hidden observation inside both the viewport and dialog.
        if (ignoredViewportRef.current !== null) {
          if (viewportSignature(viewport) !== ignoredViewportRef.current) ignoredViewportRef.current = null;
          else if (!clipToDialog) return null;
        }
        const visible = intersectsVisibleCanvas(left, top, left + width, top + height);
        if (clipToDialog) return visible;
        // Structural signals only: a shrunken visual viewport is not itself
        // proof that the keyboard still covers the canvas.
        if (isPinchZoomed(viewport)) return visible;
        const textEntryFocused = isTextEntryTarget(host.ownerDocument.activeElement);
        // No input/textarea/contenteditable focus and no keyboard overlap:
        // treat the keyboard as closed. A stale resize must not keep 3D paused.
        if (!textEntryFocused) return null;
        // While an editable is focused, never auto-resume from a closed
        // keyboard rectangle, a grace timer, or leftover shrunken bounds.
        // Only a visual viewport that once again includes the visible canvas
        // (dialog-clipped, same rect as the virtualKeyboard path) may resume.
        if (visible === false) return false;
        return null;
      } catch {
        return keyboardOverlayIntersectsCanvas() ? false : null;
      }
    };
    const syncVisibility = () => {
      if (!active) return;
      updateVisibility();
      if (!started && !isDeferred()) startWhenVisible();
      else syncPendingStartup();
    };

    let intersection: IntersectionObserver | null = null;
    const disconnectObserver = () => {
      const previous = intersection;
      intersection = null;
      try { previous?.disconnect(); } catch { /* broken WebView observer */ }
    };
    const observeHost = () => {
      try {
        const Observer = globalThis.IntersectionObserver;
        if (!Observer) return;
        let observing = false;
        const current = new Observer((entries) => {
          // Queued notifications can arrive after disconnect.
          if (!active || intersection === null || intersection !== current) return;
          // Only entries for this canvas host may change its visibility.
          // Legacy callback shims may omit target; a *different* explicit
          // target is never proof that our map entered the viewport.
          // A throwing target getter is not an omitted target: a broken or
          // foreign callback must never wake an offscreen WebGL context.
          const hostEntries = entries.filter((entry) => {
            try {
              const target = entry.target;
              return !target || target === host;
            } catch {
              return false;
            }
          });
          // W3C IO §3.2.5–3.2.6 append transitions to a queue before delivery.
          // Use the last host entry even when timestamps are rounded,
          // missing or repeated; the first can describe an obsolete state.
          const latest = hostEntries[hostEntries.length - 1];
          if (!latest) return;
          // Fall back to the original boolean when the optional rectangle
          // is unavailable. A valid zero-area intersection is an edge touch.
          const readIntersection = (entry: IntersectionObserverEntry) => {
            let intersects: boolean;
            try {
              const intersecting = entry.isIntersecting;
              if (typeof intersecting !== 'boolean') return undefined;
              intersects = intersecting;
            } catch { return undefined; }
            if (intersects) {
              try {
                const rect = entry.intersectionRect;
                if (rect) {
                  const { width, height, x, y, left, top, right, bottom } = rect;
                  if (Number.isFinite(width) && Number.isFinite(height) &&
                      width >= 0 && height >= 0 &&
                      [x, y, left, top, right, bottom].every((value) => value === undefined || Number.isFinite(value)) &&
                      !(left !== undefined && right !== undefined && right < left) &&
                      !(top !== undefined && bottom !== undefined && bottom < top)) {
                    intersects = width > 0 && height > 0 &&
                      (left === undefined || right === undefined || right > left) &&
                      (top === undefined || bottom === undefined || bottom > top);
                  }
                }
              } catch { /* Legacy observer boolean still applies. */ }
            }
            return intersects;
          };
          const intersects = readIntersection(latest);
          if (intersects === undefined) return;
          visibility = intersects ? 'visible' : 'hidden';
          if (observing) syncVisibility();
        }, { threshold: VIEWPORT_THRESHOLDS });
        // An edge-touch (isIntersecting=true, zero area) and a sliver of
        // visible area (for example 0.5%) are both intersecting. A tiny
        // positive threshold guarantees a callback across that boundary in
        // both directions, so WebGL starts once any pixel shows and pauses
        // again when only the edge touches.
        intersection = current;
        current.observe(host);
        observing = true;
      } catch {
        disconnectObserver();
        visibility = 'unknown';
      }
    };
    const onVisibilityChange = () => syncVisibility();
    const onPageHide = () => {
      pageSuspended.current = true;
      syncVisibility();
    };
    const onPageShow = () => {
      pageSuspended.current = false;
      syncVisibility();
    };
    observeHost();
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    // Nested dialog scroll can move the canvas without an observer callback.
    const viewportEvents = ['resize', 'scroll', 'orientationchange', 'focus'] as const;
    for (const event of viewportEvents) {
      try { window.addEventListener(event, syncVisibility, event === 'scroll' ? { capture: true, passive: true } : false); }
      catch { /* Observer and page events still report visibility. */ }
    }
    // Keyboard transitions can move the host without a window event.
    const onVisualViewportChange = () => {
      if (visibility === 'hidden' && measureVisualViewportVisibility(true) === true) {
        // Recover from a stale hidden observer entry after the keyboard moves.
        // A valid intersection with the visual viewport is evidence the host
        // has returned, even if this WebView emits no new observer callback.
        visibility = 'unknown';
      }
      // Also run when the observer last said "visible": a shrinking mobile
      // viewport can cover the canvas while its layout intersection stays true.
      // Invalid/missing visual geometry is not proof that the host is hidden.
      // A stale shrunken size is not treated as coverage unless an editable
      // is focused or virtualKeyboard overlaps the visible canvas.
      syncVisibility();
    };
    // Focus moving into or out of a field can open or close the keyboard
    // without a viewport event. Re-measure immediately, and once more after
    // the keyboard animation may have settled. Timers never override the
    // structural signals (editable focus or virtualKeyboard overlap).
    const focusTimers = new Set<number>();
    const onFocusChange = (event: FocusEvent) => {
      // A later focus on an input must re-evaluate a shrunken viewport that
      // was ignored only for the visitor's explicit restart.
      if (event.type === 'focusin' && event.target instanceof Element &&
          isTextEntryTarget(event.target)) {
        ignoredViewportRef.current = null;
      }
      for (const delay of [0, 350]) {
        const id = window.setTimeout(() => {
          focusTimers.delete(id);
          if (active) syncVisibility();
        }, delay);
        focusTimers.add(id);
      }
    };
    try {
      document.addEventListener('focusin', onFocusChange, true);
      document.addEventListener('focusout', onFocusChange, true);
    } catch { /* Window events still recheck layout in partial WebViews. */ }
    // The overlay receives input while the canvas host is inert. A touch in
    // the scene can disprove stale viewport bounds after keyboard dismissal.
    const onSceneTouched = (event: Event) => {
      const target = event.target;
      const restart = restartButton.current;
      if (!(target instanceof Node)) return;
      // Keep the button mounted through its click so manual restart can run.
      if (restart?.contains(target)) return;
      if (!restart && !host.contains(target)) return;
      try {
        const viewport = window.visualViewport;
        if (viewport) {
          if (isPinchZoomed(viewport) || keyboardOverlayIntersectsCanvas()) return;
          ignoredViewportRef.current = viewportSignature(viewport);
        }
      } catch { /* Partial WebViews: nothing to ignore. */ }
      syncVisibility();
    };
    const container = sceneContainer.current;
    const touchEvents = ['pointerdown', 'touchstart', 'mousedown'] as const;
    for (const event of touchEvents) {
      try { container?.addEventListener(event, onSceneTouched, { capture: true, passive: true }); }
      catch { /* Manual restart remains available. */ }
    }
    let visualViewport: VisualViewport | null | undefined;
    try {
      visualViewport = window.visualViewport;
      visualViewport?.addEventListener('resize', onVisualViewportChange);
      visualViewport?.addEventListener('scroll', onVisualViewportChange);
    } catch { /* Window events still recheck layout in partial WebViews. */ }
    try { virtualKeyboard?.addEventListener('geometrychange', syncVisibility); }
    catch { /* Visual viewport and observer events still report visibility. */ }
    syncVisibility();
    return () => {
      active = false;
      if (timeout !== null) window.clearTimeout(timeout);
      for (const id of focusTimers) window.clearTimeout(id);
      focusTimers.clear();
      for (const event of touchEvents) {
        try { container?.removeEventListener(event, onSceneTouched, true); }
        catch { /* Complete the remaining cleanup. */ }
      }
      try {
        document.removeEventListener('focusin', onFocusChange, true);
        document.removeEventListener('focusout', onFocusChange, true);
      } catch { /* Complete the remaining cleanup. */ }
      // A broken embedded WebView may throw even on disconnect(). Complete
      // scene and listener cleanup regardless; never leak a WebGL context.
      disconnectObserver();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      for (const event of viewportEvents) {
        try { window.removeEventListener(event, syncVisibility, event === 'scroll'); }
        catch { /* Complete the remaining cleanup. */ }
      }
      try {
        visualViewport?.removeEventListener('resize', onVisualViewportChange);
        visualViewport?.removeEventListener('scroll', onVisualViewportChange);
      } catch { /* Complete scene cleanup even in partial WebViews. */ }
      try { virtualKeyboard?.removeEventListener('geometrychange', syncVisibility); }
      catch { /* Complete scene cleanup even in partial WebViews. */ }
      pendingCreate = null;
      scene?.dispose();
      runtime.current = null;
    };
  }, [host, model, onSelect, onCameraChange, footprints, manualStart]);

  const startManually = () => {
    // The user's explicit recovery action should return keyboard focus to 3D
    // once it is usable, even if focus was outside the scene when it paused.
    if (status === 'ready' && renderSuspended) restoreFocusAfterPause.current = true;
    // A recovery button may be visible while the canvas is below the modal
    // scrollport. Focus alone does not scroll in some mobile WebViews.
    // Bring the host into view before the new scene measures its bounds.
    try { host?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'auto' }); }
    catch { /* Legacy WebViews may not implement scrolling. */ }
    // Keep focus inside the map when its start control disappears.
    try { host?.focus(); } catch { /* Focus is advisory. */ }
    // Record the current (possibly stale) geometry before the scene remounts.
    try {
      const viewport = window.visualViewport;
      if (viewport) {
        ignoredViewportRef.current = [
          viewport.offsetLeft, viewport.offsetTop, viewport.width, viewport.height,
          viewport.scale,
        ].join(':');
      }
    } catch { /* Partial WebViews: nothing to ignore. */ }
    onManualStart();
  };
  const paused = status === 'ready' && renderSuspended;
  useLayoutEffect(() => {
    if (paused) {
      // Inert can blur a focused marker before commit, or a WebView can leave
      // focus on the now-inert host. Recover either case before paint, without
      // overriding a deliberate move to directions or another dialog control.
      if (host) {
        const focused = host.ownerDocument.activeElement;
        if (host.contains(focused) ||
            (restoreFocusAfterPause.current && focused === host.ownerDocument.body)) {
          restoreFocusAfterPause.current = true;
          try { restartButton.current?.focus({ preventScroll: true }); } catch { /* Focus is advisory. */ }
        }
      }
      return;
    }
    if (status === 'ready' && restoreFocusAfterPause.current) {
      restoreFocusAfterPause.current = false;
      if (!host) return;
      const focused = host.ownerDocument.activeElement;
      // Do not override a deliberate focus move made while the scene paused.
      if (focused === host.ownerDocument.body || focused === restartButton.current) {
        try { host.focus({ preventScroll: true }); } catch { /* Focus is advisory. */ }
      }
    }
  }, [paused, status, host]);
  return (
    <>
    <div ref={sceneContainer} className={styles.scene} data-spatial-state={status}>
      <div
        ref={setHost}
        className={styles.sceneHost}
        role="group"
        aria-label="校園地點空間圖"
        aria-describedby={status === 'ready' && !paused ? helpId : undefined}
        aria-hidden={paused || undefined}
        tabIndex={status === 'ready' && !paused ? 0 : -1}
        inert={paused || undefined}
      />
      {status !== 'ready' && (
        <div className={styles.sceneMessage} role="status">
          {status === 'loading' ? <p>正在開啟空間導覽…</p> : status === 'deferred' ? (
            deferredCause === 'background'
              ? <p>目前位於背景分頁，返回導覽後才會啟動立體畫面；仍可查看地點與步行導航。</p>
              : <>
                <p>{deferredCause === 'data-saver'
                  ? '瀏覽器已開啟省流量模式，因此立體畫面不會自動載入；仍可直接查看地點資訊與步行導航。需要 3D 時可自行開啟。'
                  : '尚未確認立體畫面在可見範圍；滑動至空間圖後才載入，以節省手機效能與電力。若沒有自動載入，可手動開啟。地點資訊與步行導航仍可使用。'}</p>
                <button ref={manualOpenButton} className="btn" type="button" onClick={startManually}>{deferredCause === 'data-saver' ? '仍要開啟立體畫面' : '手動開啟立體畫面'}</button>
              </>
          ) : <>
            <p>這次無法顯示立體畫面。你仍可選擇地點，查看資訊與導航。</p>
            <button className="btn" type="button" onClick={startManually}>
              重試立體畫面
            </button>
          </>}
        </div>
      )}
      {status === 'ready' && renderSuspended && (
        <div className={styles.sceneMessage} role="status">
          <p>立體畫面已暫停。回到空間圖會自動恢復；若沒有恢復，可手動重新啟動。</p>
          <button ref={restartButton} className="btn" type="button" onClick={startManually}>重新啟動立體畫面</button>
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

// A POI ID alone is not a stable navigation destination. The same ID can be
// reused with a different location or building after a live map refresh.
// Freeze the identity used for a choice; the user must explicitly select a
// replacement before a new coordinate can be sent to walking directions.
function spatialDestinationIdentity(place: MapLocation): string {
  return JSON.stringify([
    place.id, place.name, place.category, place.lat, place.lng,
    place.building ?? null, place.floor ?? null,
  ]);
}

// Existing map-record context is easier to recognize than raw coordinates,
// but is not a verified room, entrance or indoor route.
function spatialPlaceContext(place: MapLocation): string {
  const building = place.building?.trim();
  const floor = place.floor?.trim();
  return [building, floor ? `樓層：${floor}` : null].filter(Boolean).join(' · ');
}

// Search only the currently visible POI records, not inferred classroom numbers
// or route data. NFKC allows full-width letters and digits from timetables.
function normalizeSpatialSearch(value: string): string {
  return value.normalize('NFKC').toLowerCase().trim();
}

function SpatialDialog({ school, locations, selected, onSelect, onClose, manualStart, onManualStart }: Props & {
  onClose: () => void;
  manualStart: number;
  onManualStart: () => void;
}) {
  const model = useMemo(() => buildCampusSpatialModel(locations), [locations]);
  // Two map records can have the same public-facing name (including two
  // buildings of the same category). A screen reader or keyboard user must
  // be able to distinguish the exact pinned destination before navigating.
  // Only use existing marker/category data; coordinates are not entrances.
  const { optionLabels, repeatedNames } = useMemo(() => {
    const nameCounts = new Map<string, number>();
    const categoryCounts = new Map<string, number>();
    for (const point of model.points) {
      nameCounts.set(point.name, (nameCounts.get(point.name) ?? 0) + 1);
      const group = JSON.stringify([point.name, point.category || '未分類']);
      categoryCounts.set(group, (categoryCounts.get(group) ?? 0) + 1);
    }
    const repeatedNames = new Set([...nameCounts].filter(([, count]) => count > 1).map(([name]) => name));
    const optionLabels = new Map(model.points.map((point, index) => {
      if (!repeatedNames.has(point.name)) return [point.id, point.name] as const;
      const sameCategory = (categoryCounts.get(JSON.stringify([point.name, point.category || '未分類'])) ?? 0) > 1;
      const detail = sameCategory
        ? ` · 地圖座標 ${point.location.lat}, ${point.location.lng} · 清單第 ${index + 1} 項`
        : '';
      const context = spatialPlaceContext(point.location);
      const contextLabel = context ? ` · 地點資料：${context}` : '';
      return [point.id, `${point.name}（${point.category || '未分類'}${contextLabel}${detail}）`] as const;
    }));
    return { optionLabels, repeatedNames };
  }, [model.points]);
  // A matching ID alone is not an audited source: Firestore can reuse a POI
  // ID at different coordinates, under a new name or with a new category.
  // Skip the whole-campus download unless a *visible* marker still matches
  // the bundled OSM provenance identity used by visibleFootprints below.
  const auditedWayCandidateCount = school === 'pu'
    ? model.points.filter((point) => POTENTIAL_OUTLINE_POI_IDS.has(point.id) &&
      providencePlaceSourceUrl(school, point.location) !== null).length
    : 0;
  const hasOutlineCandidate = auditedWayCandidateCount > 0;
  // A student's explicit 3D start also authorizes its optional OSM transfer.
  // Save-Data must defer BOTH WebGL and the parent dialog's network request.
  const deferOutlinesForSaveData = manualStart === 0 && requestsReducedData();
  // Capture the first inherited destination. MapClient may
  // resolve the same selected ID to a different location after a source update.
  const [selection, setSelection] = useState<{ id: string; identity: string; inherited?: boolean } | 'revoked' | 'cleared' | null>(() =>
    selected ? { id: selected.id, identity: spatialDestinationIdentity(selected), inherited: true } : null);
  const [overview, setOverview] = useState(!selected);
  const [overhead, setOverhead] = useState(false);
  const [buildingPlanId, setBuildingPlanId] = useState<string | null>(null);
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
  const inheritedIdentity = selected ? spatialDestinationIdentity(selected) : null;
  if (selection === null && selected && inheritedIdentity !== null && model.points.some((point) =>
    point.id === selected.id && spatialDestinationIdentity(point.location) === inheritedIdentity)) {
    setSelection({ id: selected.id, identity: inheritedIdentity, inherited: true });
    setOverview(false);
  }
  const chosen = typeof selection === 'object' ? selection : null;
  const selectedPoint = model.points.find((point) =>
    point.id === chosen?.id && spatialDestinationIdentity(point.location) === chosen.identity);
  // The preview owns an editing session scoped to the building ID.
  const buildingPlanPlace = model.points.find((point) => point.id === buildingPlanId)?.location ??
    locations.find((location) => location.id === buildingPlanId);
  if (buildingPlanId !== null && !buildingPlanPlace) setBuildingPlanId(null);
  if (chosen && (!selectedPoint ||
      (chosen.inherited && inheritedIdentity !== chosen.identity))) {
    setSelection('revoked');
    setOverview(true);
    setCamera((previous) => ({ ...previous, zoom: 1 }));
  }
  const showOverview = overview || !selectedPoint;
  const place = selectedPoint?.location;
  const index = model.points.findIndex((point) => point.id === selectedPoint?.id);
  const previousPoint = model.points[index - 1];
  const nextPoint = model.points[index + 1];
  const [destinationQuery, setDestinationQuery] = useState('');
  // When the map narrows to one or zero valid POIs, the search controls disappear.
  // Discard their hidden query so expanding the map cannot restore an invisible stale filter.
  if (model.points.length <= 1 && destinationQuery !== '') setDestinationQuery('');
  const destinationSearchRef = useRef<HTMLInputElement>(null);
  const searchId = useId();
  const searchStatusId = useId();
  const searchTerms = model.points.length > 1 ? normalizeSpatialSearch(destinationQuery).split(/\s+/).filter(Boolean) : [];
  const matchingPoints = searchTerms.length === 0 ? model.points : model.points.filter((point) => {
    const searchable = normalizeSpatialSearch([
      point.name, point.category, point.location.building, point.location.floor,
    ].filter(Boolean).join(' '));
    return searchTerms.every((term) => searchable.includes(term));
  });
  // Filtering suggestions is not a destination change. Keep the explicit
  // current choice visible even when it does not match the search.
  const currentOutsideSearch = selectedPoint && !matchingPoints.some((point) => point.id === selectedPoint.id);
  const pickerPoints = currentOutsideSearch ? [selectedPoint, ...matchingPoints] : matchingPoints;
  const selectId = useId();
  const progressId = useId();
  const directionsNoteId = useId();
  const footprintCooldownNoteId = useId();
  const footprintRefreshingNoteId = useId();
  const selectPlace = useCallback((id: string) => {
    const point = model.points.find((candidate) => candidate.id === id);
    if (!point) return;
    setSelection({ id, identity: spatialDestinationIdentity(point.location) });
    setOverview(false);
    setCamera((previous) => ({ ...previous, zoom: 1 }));
  }, [model.points]);
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
    if (deferOutlinesForSaveData) {
      // Leave the verified POI and external walking links usable without
      // downloading optional whole-campus geometry on metered connections.
      // Reopening the dialog resets consent; manualStart changes this gate.
      setFootprintStatus((current) => current === 'ready' ? current : 'deferred');
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
    // Only the fixed same-origin API may supply source-checked outlines.
    // Redirects to login pages or other hosts must never become OSM snapshots.
    void fetch('/api/public/campus-footprints', { signal: controller.signal, redirect: 'error' })
      .then(async (response) => {
        receivedResponse = true;
        // Fail closed even if a legacy fetch bridge ignored redirect: 'error'
        // and exposed the final JSON from a different endpoint.
        const redirectedResponse = response.redirected === true;
        // Fetch considers 203/206 successful, but the map API contract is a
        // complete 200 JSON document. A CDN/proxy must not turn a transformed
        // or partial representation into a trusted 3D building snapshot.
        const contentRange = response.headers?.get('content-range') ?? null;
        const contentLength = response.headers?.get('content-length') ?? null;
        const transferEncoding = response.headers?.get('transfer-encoding') ?? null;
        // RFC 9112 §6.3: both Transfer-Encoding and Content-Length cannot
        // frame the same HTTP response. Some WebView bridges or proxies can
        // expose such conflicting headers despite a nominal 200 status.
        // Reject on headers before reading an unbounded response body.
        const invalidFraming = transferEncoding !== null && contentLength !== null;
        // RFC Content-Length is a decimal byte count, not a fraction, hex
        // number or comma-separated value. Do not trust a 200 JSON body whose
        // advertised size is invalid or implausibly large for this API.
        // Fetch exposes the decoded body, so validate its size and JSON
        // independently of Content-Encoding, Content-Type and wire length.
        const invalidContentLength = contentLength !== null &&
          (!/^\d+$/.test(contentLength) ||
            !Number.isSafeInteger(Number(contentLength)) ||
            Number(contentLength) > MAX_DECLARED_FOOTPRINT_BYTES);
        const emptySuccess = response.ok && contentLength !== null && Number(contentLength) === 0;
        // Reject incompatible 200 media before reading a potentially stalled
        // captive-portal body, without changing other HTTP status handling.
        const invalidMediaType = !isSupportedUtf8JsonMediaType(response.headers?.get('content-type') ?? null);
        if (!response.ok || (typeof response.status === 'number' && response.status !== 200) ||
            contentRange !== null || invalidFraming || invalidContentLength || emptySuccess || invalidMediaType || redirectedResponse) {
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
            contentRange !== null || invalidFraming || invalidContentLength || emptySuccess ||
            (status === 200 && invalidMediaType) || redirectedResponse;
          // A proxy can return an incomplete 206/Content-Range document or
          // a 408 without Retry-After. These responses cannot be trusted as
          // complete OSM geometry and should not trigger a manual retry loop.
          // Back off 60s for non-200 2xx, unexpected 304, 408, 429 and
          // gateway failures. Explicit valid Retry-After still wins; an
          // ordinary 500 keeps its existing manual-retry behavior.
          const fallbackBackoff = invalidSuccessStatus || status === 304 ||
            status === 408 || status === 429 || status === 502 ||
            status === 503 || status === 504 || contentRange !== null ||
            invalidFraming || invalidContentLength || emptySuccess ||
            (status === 200 && invalidMediaType) || redirectedResponse;
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
  }, [school, model.unavailableReason, hasOutlineCandidate, footprintAttempt, deferOutlinesForSaveData]);

  // Replace the spatial modal so there is only one focus trap and graphics context.
  // The key prevents a late local-file read from crossing a school/building boundary.
  if (buildingPlanPlace) {
    return <BuildingPlanPreview
      key={`${school}:${buildingPlanPlace.id}`}
      schoolId={school}
      buildingId={buildingPlanPlace.id}
      buildingName={buildingPlanPlace.name}
      onClose={() => setBuildingPlanId(null)}
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
              manualStart={manualStart}
              onManualStart={onManualStart}
            />
            <div className={styles.viewTools} role="group" aria-label="導覽視角">
              <button className="btn" type="button" aria-pressed={showOverview} onClick={() => {
                if (selection === null) setSelection('cleared');
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
                {hasOutlineCandidate && footprintStatus === 'deferred' && <span role="status">
                  {deferOutlinesForSaveData
                    ? '省流量模式已暫停下載靜宜建築輪廓；選擇「仍要開啟立體畫面」後才會讀取。地點標記與導航仍可使用。'
                    : '目前位於背景分頁，返回導覽後才會讀取靜宜建築輪廓；地點標記與導航仍可使用。'}
                </span>}
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
                    <span>依 OpenStreetMap 建築外框立體化：實色量體的高度來自 OSM 使用者標註；半透明量體的高度採 12 公尺示意值。兩者均未經校方測量，不代表建築真實外觀、室內樓層或無障礙路線。</span>
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
                {model.points.length > 1 && <>
                  <label htmlFor={searchId}>搜尋導覽地點</label>
                  <div className={styles.searchRow}>
                    <input ref={destinationSearchRef} id={searchId} type="search" value={destinationQuery}
                      placeholder="地點、棟別或樓層"
                      aria-describedby={searchTerms.length ? searchStatusId : undefined}
                      onChange={(event) => setDestinationQuery(event.target.value)} />
                    <button className="btn" type="button" aria-label="清除地點搜尋"
                      disabled={destinationQuery.length === 0}
                      onClick={() => {
                        // Return focus before disabling the clear control; keep the selected destination.
                        destinationSearchRef.current?.focus();
                        setDestinationQuery('');
                      }}>清除</button>
                  </div>
                  {searchTerms.length > 0 && <small id={searchStatusId} role="status">
                    {matchingPoints.length === 0 ? '沒有符合的地點，請調整關鍵字。' : `找到 ${matchingPoints.length} 個地點。`}
                    {currentOutsideSearch ? ' 目前選擇仍保留，搜尋不會變更導航目的地。' : ''}
                  </small>}
                  {searchTerms.length > 0 && matchingPoints.length === 1 && (
                    <button className="btn" type="button"
                      onClick={() => selectPlace(matchingPoints[0].id)}>
                      選擇：{optionLabels.get(matchingPoints[0].id) ?? matchingPoints[0].name}
                    </button>
                  )}
                </>}
                <label htmlFor={selectId}>想去哪裡</label>
                <select id={selectId} value={place?.id ?? ''} onChange={(event) => selectPlace(event.target.value)}>
                  {!place && <option value="" disabled>請選擇地點</option>}
                  {pickerPoints.map((point) => <option key={point.id} value={point.id}>{optionLabels.get(point.id) ?? point.name}</option>)}
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
                  aria-valuetext={`第 ${index + 1} 個地點，共 ${model.points.length} 個：${optionLabels.get(place.id) ?? place.name}`}
                  onChange={(event) => {
                    const point = model.points[Number(event.target.value)];
                    if (point) selectPlace(point.id);
                  }}
                />
                <div className={styles.steps}>
                  <button className="btn" type="button" disabled={index <= 0}
                    aria-label={previousPoint && repeatedNames.has(previousPoint.name)
                      ? `上一個地點：${optionLabels.get(previousPoint.id) ?? previousPoint.name}` : undefined}
                    onClick={() => { if (previousPoint) selectPlace(previousPoint.id); }}>上一個地點</button>
                  <button className="btn" type="button" disabled={index >= model.points.length - 1}
                    aria-label={nextPoint && repeatedNames.has(nextPoint.name)
                      ? `下一個地點：${optionLabels.get(nextPoint.id) ?? nextPoint.name}` : undefined}
                    onClick={() => { if (nextPoint) selectPlace(nextPoint.id); }}>下一個地點</button>
                </div>
              </div>
              <section className={styles.place} aria-label="導覽地點資訊">
                <p className={styles.category}>{place.category}</p>
                <h3 aria-live="polite" aria-atomic="true">{place.name}</h3>
                {place.description && <p>{place.description}</p>}
                <p className={styles.note}>地圖標記座標：{place.lat}, {place.lng}（非建築入口）</p>
                {/* A changing live status distinguishes same-name scene markers even when the heading stays identical. */}
                {repeatedNames.has(place.name) && (
                  <p className={styles.note} role="status" aria-live="polite" aria-atomic="true">
                    同名地點：目前選擇「{place.category || '未分類'}」
                    {spatialPlaceContext(place) ? `，地點資料：${spatialPlaceContext(place)}` : ''}，地圖標記座標 {place.lat}, {place.lng}，清單第 {index + 1} 項。
                    這是地點標記，不代表已核實的建築入口；請核對位置再開啟導航。
                  </p>
                )}
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
                <a className="btn" href={appleWalkingDirectionsUrl(place)} target="_blank" rel="noopener noreferrer" aria-describedby={directionsNoteId}>開啟 Apple 地圖步行導航</a>
                <p id={directionsNoteId} className={styles.note}>導航僅以目前地點標記為目的地，並非已核實的校舍入口、可通行道路或無障礙動線；請依現場指標確認。</p>
                <button className="btn" type="button" onClick={() => setBuildingPlanId(place.id)}>平面圖建模預覽</button>
                {source && <a className={styles.source} href={source} target="_blank" rel="noopener noreferrer">查看地點資料來源 ↗</a>}
              </div>
              </> : <p className={styles.note} role="status" aria-live="polite" aria-atomic="true">
                {selection === 'revoked'
                  ? '先前選擇的地點已變更或不在目前地圖範圍，已停用導航。請重新選擇地點，核對標記位置後再開啟導航。'
                  : '請選擇地點，確認位置後再開啟導航。'}
              </p>}
            </div>
        </div>
      )}
    </Modal>
  );
}

function AvailableSpatialExplorer(props: Props) {
  const [open, setOpen] = useState(false);
  // Keep manual startup intent across canvas and school changes within the open tour.
  const [manualStart, setManualStart] = useState(0);
  const startManually = () => setManualStart((value) => value + 1);
  const close = useCallback(() => {
    setOpen(false);
    setManualStart(0);
  }, []);
  return <>
    <button className="btn" type="button" aria-haspopup="dialog" onClick={() => setOpen(true)}>
      空間導覽
    </button>
    {open && <SpatialDialog {...props} key={props.school} onClose={close}
      manualStart={manualStart} onManualStart={startManually} />}
  </>;
}

export default function CampusSpatialExplorer(props: Props) {
  return props.locations.length ? <AvailableSpatialExplorer {...props} /> : null;
}
