'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Modal } from '@/components/ui/Modal';
import { buildCampusSpatialModel } from './campusSpatialModel';
import type { CampusSpatialScene } from './campusSpatialScene';
import { walkingDirectionsUrl, type MapLocation } from './mapService';
import { isProvidencePendingVerification, providencePlaceSourceUrl } from './providenceCampus';
import styles from './CampusSpatialExplorer.module.css';

type Props = {
  school: string;
  locations: MapLocation[];
  selected: MapLocation | null;
  onSelect: (location: MapLocation) => void;
};

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

function SpatialCanvas({ model, selectedId, overhead, onSelect }: {
  model: ReturnType<typeof buildCampusSpatialModel>;
  selectedId: string | null;
  overhead: boolean;
  onSelect: (id: string) => void;
}) {
  const appearance = useSyncExternalStore(subscribeAppearance, readAppearance, () => 'reduced:light');
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const runtime = useRef<CampusSpatialScene | null>(null);
  const view = useMemo(() => ({
    selectedId,
    overhead,
    motion: appearance.startsWith('motion:'),
    dark: appearance.endsWith(':dark'),
  }), [selectedId, overhead, appearance]);
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
      scene = createCampusSpatialScene(host, model, { onSelect, onError: fail });
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
  }, [host, model, onSelect, attempt]);

  return (
    <div className={styles.scene} data-spatial-state={status}>
      <div ref={setHost} className={styles.sceneHost} role="group" aria-label="校園地點空間圖" tabIndex={-1} />
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
  );
}

function SpatialDialog({ school, locations, selected, onSelect, onClose }: Props & { onClose: () => void }) {
  const model = useMemo(() => buildCampusSpatialModel(locations), [locations]);
  const [selection, setSelection] = useState(selected?.id ?? null);
  const [overview, setOverview] = useState(!selected);
  const [overhead, setOverhead] = useState(false);
  const selectedPoint = model.points.find((point) => point.id === selection) ?? model.points[0];
  const place = selectedPoint?.location;
  const index = model.points.findIndex((point) => point.id === selectedPoint?.id);
  const selectId = useId();
  const progressId = useId();
  const selectPlace = useCallback((id: string) => {
    setSelection(id);
    setOverview(false);
  }, []);
  const source = place ? providencePlaceSourceUrl(school, place) : null;

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
              selectedId={overview ? null : selectedPoint?.id ?? null}
              overhead={overhead}
              onSelect={selectPlace}
            />
            <div className={styles.viewTools} role="group" aria-label="導覽視角">
              <button className="btn" type="button" aria-pressed={overview} onClick={() => setOverview(true)}>
                看全部地點
              </button>
              <button className="btn" type="button" aria-pressed={overhead} onClick={() => setOverhead((value) => !value)}>
                俯視
              </button>
              <span>{model.points.length} 個地點 · 沿用目前地圖範圍</span>
            </div>
            <p className={styles.note}>選擇地點或拖動導覽進度，讓視角跟著移動。步行路線請使用導航。</p>
            {model.excludedCount > 0 && <p className={styles.note} role="status">部分地點資料無法用於空間圖。</p>}
          </div>
          {place && (
            <div className={styles.details}>
              <div className={styles.selectField}>
                <label htmlFor={selectId}>想去哪裡</label>
                <select id={selectId} value={place.id} onChange={(event) => selectPlace(event.target.value)}>
                  {model.points.map((point) => <option key={point.id} value={point.id}>{point.name}</option>)}
                </select>
              </div>
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
                {isProvidencePendingVerification(school, place) && (
                  <p className={styles.pending} role="status">此地點僅有單一資料來源，位置待再次確認。</p>
                )}
              </section>
              <div className={styles.actions}>
                <button className="btn primary" type="button" onClick={() => { onSelect(place); onClose(); }}>
                  在平面地圖查看
                </button>
                <a className="btn" href={walkingDirectionsUrl(place)} target="_blank" rel="noopener noreferrer">開啟步行導航</a>
                {source && <a className={styles.source} href={source} target="_blank" rel="noopener noreferrer">查看地點資料來源 ↗</a>}
              </div>
            </div>
          )}
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
