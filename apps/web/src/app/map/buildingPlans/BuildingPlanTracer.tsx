'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { BuildingPlan, PlanPoint } from './buildingPlan';
import { buildTracedBuildingPlan, type PlanTraceDraft } from './buildingPlanTracing';
import { prepareBuildingPlanReference } from './buildingPlanReference';
import { exportBuildingPlanProject, type BuildingPlanProjectDraft, type BuildingPlanProjectReference } from './buildingPlanProject';
import styles from './BuildingPlanTracer.module.css';

type Props = {
  schoolId: string;
  buildingId: string;
  buildingName: string;
  initialProject?: { draft: BuildingPlanProjectDraft; reference: BuildingPlanProjectReference };
  onComplete: (plan: BuildingPlan) => void;
  onCancel: () => void;
};
type Reference = BuildingPlanProjectReference;
type Mode = BuildingPlanProjectDraft['mode'];
type Rooms = PlanTraceDraft['rooms'];
const percentage = (value: number) => String(Math.round(value * 10_000) / 100);
const clamp = (value: number) => Math.min(1, Math.max(0, value));

function initialRoomSequence(rooms: Rooms): number {
  return rooms.reduce((maximum, room) => {
    const match = /^traced-room-(\d+)$/.exec(room.id);
    const value = match ? Number(match[1]) : 0;
    return Number.isSafeInteger(value) ? Math.max(maximum, value) : maximum;
  }, 0);
}

function TracerWorkspace({ schoolId, buildingId, buildingName, initialProject, onComplete, onCancel }: Props) {
  const fileId = useId();
  const helpId = useId();
  const restored = initialProject?.draft;
  const [reference, setReference] = useState<Reference | null>(initialProject?.reference ?? null);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [name, setName] = useState(restored?.name ?? `${buildingName} · 圖面草稿`.slice(0, 100));
  const [floorLabel, setFloorLabel] = useState(restored?.floorLabel ?? '1F');
  const [sourceLabel, setSourceLabel] = useState(restored?.sourceLabel ?? '');
  const [sourceUrl, setSourceUrl] = useState(restored?.sourceUrl ?? '');
  const [outline, setOutline] = useState<PlanPoint[]>(restored?.outline ?? []);
  const [rooms, setRooms] = useState<Rooms>(restored?.rooms ?? []);
  const [mode, setMode] = useState<Mode>(restored ? restored.mode : 'outline');
  const [points, setPoints] = useState<PlanPoint[]>(restored?.points ?? []);
  const [roomName, setRoomName] = useState(restored?.roomName ?? '');
  const [calibration, setCalibration] = useState<[PlanPoint, PlanPoint] | null>(restored?.calibration ?? null);
  const [metres, setMetres] = useState(restored?.metres ?? '');
  const [floorHeight, setFloorHeight] = useState(restored?.floorHeight ?? '');
  const [x, setX] = useState(restored?.x ?? '50');
  const [y, setY] = useState(restored?.y ?? '50');
  const generation = useRef(0);
  const job = useRef<AbortController | null>(null);
  const saveJob = useRef<AbortController | null>(null);
  const objectUrl = useRef('');
  const roomSequence = useRef(initialRoomSequence(restored?.rooms ?? []));
  useEffect(() => () => {
    generation.current += 1;
    job.current?.abort();
    saveJob.current?.abort();
  }, []);
  const referenceImage = useCallback((image: SVGImageElement | null) => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = '';
    if (image && reference) {
      const url = URL.createObjectURL(reference.blob);
      objectUrl.current = url;
      image.setAttribute('href', url);
    }
  }, [reference]);

  function cancelPendingRead() {
    generation.current += 1;
    job.current?.abort();
    job.current = null;
    saveJob.current?.abort();
    saveJob.current = null;
    setReading(false);
    setSaving(false);
    setNotice('');
  }
  function releaseReference() {
    cancelPendingRead();
    setReference(null);
  }
  async function chooseFile(file: File) {
    cancelPendingRead();
    const request = generation.current;
    const controller = new AbortController();
    job.current = controller;
    setReading(true);
    setError('');
    try {
      const prepared = await prepareBuildingPlanReference(file, controller.signal);
      if (request !== generation.current || controller.signal.aborted) return;
      setOutline([]);
      setRooms([]);
      roomSequence.current = 0;
      setPoints([]);
      setMode('outline');
      setRoomName('');
      setCalibration(null);
      setMetres('');
      setFloorHeight('');
      setName(`${buildingName} · 圖面草稿`.slice(0, 100));
      setFloorLabel('1F');
      setSourceLabel('');
      setSourceUrl('');
      setX('50');
      setY('50');
      setReference(prepared);
      setSourceLabel(prepared.name.slice(0, 160));
    } catch (cause) {
      if (request === generation.current && !controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : '圖片無法讀取，請重新選擇。');
    } finally {
      if (request === generation.current) { setReading(false); job.current = null; }
    }
  }
  function makeDraft(): PlanTraceDraft {
    return {
      name, floorLabel, imageWidth: reference!.width, imageHeight: reference!.height,
      outline, rooms, source: { label: sourceLabel, ...(sourceUrl.trim() ? { url: sourceUrl.trim() } : {}) },
      ...(calibration ? { calibration: { start: calibration[0], end: calibration[1], metres: Number(metres) }, floorHeight: Number(floorHeight) } : {}),
    };
  }
  async function downloadProject() {
    if (!reference || reading || saving) return;
    const request = generation.current;
    const controller = new AbortController();
    saveJob.current?.abort();
    saveJob.current = controller;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const file = await exportBuildingPlanProject({ schoolId, buildingId }, {
        name, floorLabel, sourceLabel, sourceUrl, outline, rooms, mode, points,
        roomName, calibration, metres, floorHeight, x, y,
      }, reference, controller.signal);
      if (controller.signal.aborted || request !== generation.current) return;
      const url = URL.createObjectURL(file);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'building-plan-project.json';
      document.body.append(anchor);
      try { anchor.click(); } finally {
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      }
      setNotice('編輯檔已準備下載，內含底圖與目前描點。');
    } catch (cause) {
      if (!controller.signal.aborted && request === generation.current)
        setError(cause instanceof Error ? cause.message : '無法建立編輯檔，請稍後再試。');
    } finally {
      if (request === generation.current && saveJob.current === controller) {
        saveJob.current = null;
        setSaving(false);
      }
    }
  }
  function addPoint(point: PlanPoint) {
    if (!mode || !reference) return;
    const limit = mode === 'calibration' ? 2 : 64;
    if (points.length >= limit) { setError(`目前最多可加入 ${limit} 個描點，請先完成或返回上一步。`); return; }
    if (points.some(existing => existing[0] === point[0] && existing[1] === point[1])) {
      setError('這個位置已有描點；外框會自動閉合，不必重複起點。');
      return;
    }
    setPoints(current => [...current, point]);
    setX(percentage(point[0]));
    setY(percentage(point[1]));
    setError('');
  }
  function addCoordinates() {
    const px = Number(x), py = Number(y);
    if (!x.trim() || !y.trim() || !Number.isFinite(px) || !Number.isFinite(py) || px < 0 || px > 100 || py < 0 || py > 100) {
      setError('圖片座標請填 0 到 100 的百分比。');
      return;
    }
    addPoint([px / 100, py / 100]);
  }
  function cancelPoints() {
    setPoints([]);
    setMode(outline.length ? null : 'outline');
    setRoomName('');
    setError('');
  }
  function finishPolygon() {
    if (!reference || (mode !== 'outline' && mode !== 'room')) return;
    if (mode === 'room' && !roomName.trim()) { setError('請填寫房間名稱。'); return; }
    let nextSequence = roomSequence.current;
    do { nextSequence = nextSequence < Number.MAX_SAFE_INTEGER ? nextSequence + 1 : 1; }
    while (rooms.some(room => room.id === `traced-room-${nextSequence}`));
    const room = { id: `traced-room-${nextSequence}`, name: roomName.trim(), polygon: points };
    const nextOutline = mode === 'outline' ? points : outline;
    const nextRooms = mode === 'room' ? [...rooms, room] : [];
    const checked = buildTracedBuildingPlan({
      name: '描圖草稿', floorLabel: '1F', imageWidth: reference.width, imageHeight: reference.height,
      outline: nextOutline, rooms: nextRooms, source: { label: '圖片描圖' },
    }, { schoolId, buildingId });
    if (!checked.ok) { setError(checked.message); return; }
    if (mode === 'room') { roomSequence.current = nextSequence; setRooms(nextRooms); }
    else setOutline(nextOutline);
    setPoints([]);
    setMode(null);
    setRoomName('');
    setError('');
  }
  function applyCalibration() {
    if (!reference || points.length !== 2) { setError('請先在圖上選擇兩個校正點。'); return; }
    const checked = buildTracedBuildingPlan({ ...makeDraft(), calibration: { start: points[0], end: points[1], metres: Number(metres) }, floorHeight: Number(floorHeight) }, { schoolId, buildingId });
    if (!checked.ok) { setError(checked.message); return; }
    setCalibration([points[0], points[1]]);
    setPoints([]);
    setMode(null);
    setError('');
  }
  function complete() {
    if (!reference || !outline.length || mode || reading || job.current) return;
    const checked = buildTracedBuildingPlan(makeDraft(), { schoolId, buildingId });
    if (!checked.ok) { setError(checked.message); return; }
    cancelPendingRead();
    setError('');
    onComplete(checked.plan);
  }
  const cursor: PlanPoint = [clamp((Number(x) || 0) / 100), clamp((Number(y) || 0) / 100)];
  const drawingLabel = mode === 'outline' ? '樓層外框' : mode === 'room' ? '房間' : '校正距離';
  const renderPoints = (items: PlanPoint[]) => items.map(([px, py]) => `${px * reference!.width},${py * reference!.height}`).join(' ');
  const calibrationLine = mode === 'calibration' ? points : calibration ?? [];
  return <section className={styles.tracer} aria-label="從圖片描圖">
    <div className={styles.heading}><div><h3>從圖片描圖</h3><p>{buildingName}（{schoolId} / {buildingId}）</p></div>
      <button type="button" onClick={() => { releaseReference(); onCancel(); }}>取消描圖</button></div>
    <p className={styles.hint}>先描外框，再依需要標記房間。下載編輯檔可保留底圖與未完成描點，下次開啟後繼續；這是手動描圖，不會自動辨識圖片。</p>
    <div className={styles.actions}>
      <label htmlFor={fileId} className={styles.fileButton}>{reference ? '更換圖面圖片' : '選擇圖面圖片'}</label>
      <input id={fileId} aria-label="選擇圖面圖片" className={styles.fileInput} type="file" accept="image/png,image/jpeg,image/webp" onChange={event => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (file) void chooseFile(file);
      }} />
      {reference && <button type="button" disabled={reading || saving} onClick={() => { void downloadProject(); }}>
        {saving ? '正在準備編輯檔…' : '下載編輯檔'}
      </button>}
      <span className={styles.hint}>PNG／JPEG／WebP，10 MiB 內。成功換圖後會清除房間、描點與比例；讀取失敗則保留原有內容。</span>
    </div>
    {reading && <p role="status">正在讀取圖面圖片…</p>}
    {notice && <p role="status" className={styles.hint}>{notice}</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {reference && <>
      <p className={styles.badge}>{calibration ? '使用公尺比例 · 仍為待核對圖面' : '未校正比例／示意單位 · 仍為待核對圖面'}</p>
      <div className={styles.fields}>
        <label>圖面名稱<input value={name} maxLength={100} onChange={event => setName(event.target.value)} /></label>
        <label>樓層名稱<input value={floorLabel} maxLength={100} onChange={event => setFloorLabel(event.target.value)} /></label>
      </div>
      <div className={styles.actions}>
        {outline.length > 0 && <>
          <button type="button" disabled={!!mode || rooms.length >= 200} onClick={() => { setMode('room'); setPoints([]); setRoomName(''); setError(''); }}>新增房間</button>
          <button type="button" disabled={!!mode} onClick={() => { setMode('calibration'); setPoints([]); setError(''); }}>選兩點校正比例</button>
          <button type="button" disabled={!!mode} onClick={() => { setOutline([]); setRooms([]); setPoints([]); setCalibration(null); setMetres(''); setFloorHeight(''); setMode('outline'); setError(''); }}>重畫外框與房間</button>
        </>}
      </div>
      <p id={helpId} className={styles.hint}>{mode ? `正在描${drawingLabel}。點按圖片加點；也可聚焦圖片後用方向鍵移動準星（Shift 加速），按 Enter 加點。` : '外框已完成。可以新增房間、校正比例，或直接建立預覽。'}</p>
      <svg className={styles.canvas} viewBox={`0 0 ${reference.width} ${reference.height}`} preserveAspectRatio="xMidYMid meet"
        role="group" tabIndex={0} aria-label="圖片描圖區" aria-describedby={helpId} data-building-plan-tracer="canvas"
        onClick={event => {
          if (!mode) return;
          const matrix = event.currentTarget.getScreenCTM();
          if (!matrix) return;
          const pointer = event.currentTarget.createSVGPoint();
          pointer.x = event.clientX;
          pointer.y = event.clientY;
          const local = pointer.matrixTransform(matrix.inverse());
          const px = local.x / reference.width, py = local.y / reference.height;
          if (px >= 0 && px <= 1 && py >= 0 && py <= 1) addPoint([px, py]);
        }}
        onKeyDown={event => {
          if (!mode) return;
          const steps: Record<string, PlanPoint> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
          if (steps[event.key]) {
            event.preventDefault();
            const step = event.shiftKey ? 0.05 : 0.01;
            setX(percentage(clamp(cursor[0] + steps[event.key][0] * step)));
            setY(percentage(clamp(cursor[1] + steps[event.key][1] * step)));
          } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); addCoordinates(); }
        }}>
        <image ref={referenceImage} width={reference.width} height={reference.height} aria-hidden="true" />
        {outline.length > 0 && <polygon className={styles.outline} points={renderPoints(outline)} />}
        {rooms.map(room => <polygon key={room.id} className={styles.room} points={renderPoints(room.polygon)}><title>{room.name}</title></polygon>)}
        {mode !== 'calibration' && points.length > 0 && <polyline className={styles.pending} points={renderPoints(points)} />}
        {calibrationLine.length > 0 && <polyline className={styles.calibration} points={renderPoints(calibrationLine)} />}
        {points.map((point, index) => <circle key={index} className={styles.point} cx={point[0] * reference.width} cy={point[1] * reference.height} r={Math.max(reference.width, reference.height) * 0.006} />)}
        {mode && <path className={styles.cursor} d={`M ${cursor[0] * reference.width - 12} ${cursor[1] * reference.height} h 24 M ${cursor[0] * reference.width} ${cursor[1] * reference.height - 12} v 24`} />}
      </svg>
      {mode && <div className={styles.drawingTools}>
        <p role="status">{drawingLabel}描點：{points.length} / {mode === 'calibration' ? 2 : 64}</p>
        <div className={styles.coordinates}>
          <label>水平位置（%）<input type="number" min="0" max="100" step="0.1" value={x} onChange={event => setX(event.target.value)} /></label>
          <label>垂直位置（%）<input type="number" min="0" max="100" step="0.1" value={y} onChange={event => setY(event.target.value)} /></label>
          <button type="button" onClick={addCoordinates}>加入描點</button>
        </div>
        <p className={styles.hint}>左上角為 0%、0%；右下角為 100%、100%。外框與房間依邊線順序描至少 3 點，最後會自動閉合。</p>
        {mode === 'room' && <label className={styles.field}>新房間名稱<input value={roomName} maxLength={100} onChange={event => setRoomName(event.target.value)} /></label>}
        <div className={styles.actions}>
          <button type="button" disabled={!points.length} onClick={() => { setPoints(current => current.slice(0, -1)); setError(''); }}>上一步</button>
          <button type="button" onClick={cancelPoints}>取消目前描點</button>
          {mode !== 'calibration' && <button type="button" onClick={finishPolygon}>{mode === 'outline' ? '完成外框' : '完成房間'}</button>}
        </div>
      </div>}
      {(mode === 'calibration' || calibration) && <div className={styles.calibrationFields}>
        <div className={styles.fields}>
          <label>兩點實際距離（公尺）<input type="number" min="0" step="any" value={metres} onChange={event => setMetres(event.target.value)} /></label>
          <label>樓高（公尺）<input type="number" min="1" max="10" step="0.1" value={floorHeight} onChange={event => setFloorHeight(event.target.value)} /></label>
        </div>
        <p className={styles.hint}>請依圖面標示或已知尺寸填寫，樓高限 1–10 公尺。透視照片可能失真。</p>
        <div className={styles.actions}>
          {mode === 'calibration' && <button type="button" onClick={applyCalibration}>套用比例</button>}
          {calibration && <button type="button" onClick={() => { setCalibration(null); setMetres(''); setFloorHeight(''); if (mode === 'calibration') cancelPoints(); }}>移除比例校正</button>}
        </div>
      </div>}
      {rooms.length > 0 && <section className={styles.rooms} aria-label="已描房間"><h4>已描房間（{rooms.length}）</h4>
        {rooms.map((room, index) => <div className={styles.roomRow} key={room.id}>
          <label>房間 {index + 1} 名稱<input value={room.name} maxLength={100} onChange={event => setRooms(current => current.map(item => item.id === room.id ? { ...item, name: event.target.value } : item))} /></label>
          <button type="button" aria-label={`移除房間 ${index + 1} ${room.name}`} onClick={() => setRooms(current => current.filter(item => item.id !== room.id))}>移除房間</button>
        </div>)}
      </section>}
      <details className={styles.source}>
        <summary>圖面來源</summary>
        <div className={styles.fields}>
          <label>來源名稱<input value={sourceLabel} maxLength={160} onChange={event => setSourceLabel(event.target.value)} /></label>
          <label>來源網址（選填，HTTPS）<input type="url" value={sourceUrl} maxLength={2048} onChange={event => setSourceUrl(event.target.value)} /></label>
        </div>
      </details>
      <div className={styles.footer}>
        {!calibration && <p className={styles.hint}>未校正時使用示意單位：圖片長邊為 20、樓高為 3，不代表實際尺寸。</p>}
        <p className={styles.hint}>外框會產生示意牆線；房間只表示命名區域，未標示門窗或可通行動線。</p>
        <button type="button" className={styles.primary} disabled={reading || !outline.length || !!mode} onClick={complete}>建立立體預覽</button>
      </div>
    </>}
  </section>;
}

export default function BuildingPlanTracer(props: Props) {
  return <TracerWorkspace key={JSON.stringify([props.schoolId, props.buildingId])} {...props} />;
}
