'use client';

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { Modal } from '@/components/ui/Modal';
import { createExampleBuildingPlan, MAX_BUILDING_PLAN_BYTES, parseBuildingPlan, type BuildingPlan, type PlanFloor } from './buildingPlan';
import { importBuildingPlanProject } from './buildingPlanProject';
import type { BuildingPlanView, BuildingPlanScene } from './buildingPlanScene';
import BuildingPlanTracer from './BuildingPlanTracer';
import BuildingPlanFloorImporter from './BuildingPlanFloorImporter';
import BuildingPlanFloorManager from './BuildingPlanFloorManager';
import styles from './BuildingPlanPreview.module.css';

type Props = { schoolId: string; buildingId: string; buildingName: string; onClose: () => void };
const initialView = { floorId: null, roomId: null, exploded: true, overhead: false, bearing: 0, zoom: 1 };
const serverAppearance = () => false;
function readDark() {
  return document.documentElement.dataset.theme === 'dark' || (document.documentElement.dataset.theme !== 'light' && Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches));
}
function subscribeAppearance(notify: () => void) {
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  media?.addEventListener('change', notify);
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => { observer.disconnect(); media?.removeEventListener('change', notify); };
}

function PlanCanvas({ plan, view, onSelect }: { plan: BuildingPlan; view: BuildingPlanView; onSelect: (floorId: string, roomId: string) => void }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const runtime = useRef<BuildingPlanScene | null>(null);
  const latestView = useRef(view);
  const reportFailure = useRef<() => void>(() => {});
  useEffect(() => {
    if (!host) return;
    let alive = true;
    let visible = true;
    let scene: BuildingPlanScene | null = null;
    const syncActive = () => { if (alive) scene?.setActive(visible && !document.hidden); };
    const fail = () => {
      if (!alive) return;
      alive = false;
      scene?.dispose();
      scene = null;
      runtime.current = null;
      setStatus('error');
    };
    reportFailure.current = fail;
    const timeout = window.setTimeout(fail, 12_000);
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting);
      syncActive();
    });
    observer?.observe(host);
    document.addEventListener('visibilitychange', syncActive);
    void import('./buildingPlanScene').then(module => {
      if (!alive) return;
      scene = module.createBuildingPlanScene(host, plan, {
        onSelect: (roomId: string) => {
          if (!alive) return;
          const floor = plan.floors.find(item => item.rooms.some(room => room.id === roomId));
          if (floor) onSelect(floor.id, roomId);
        },
        onError: fail,
      });
      if (!alive) { scene.dispose(); scene = null; return; }
      runtime.current = scene;
      scene.setView(latestView.current);
      if (!alive) return;
      syncActive();
      window.clearTimeout(timeout);
      setStatus('ready');
    }).catch(fail);
    return () => {
      alive = false;
      window.clearTimeout(timeout);
      observer?.disconnect();
      document.removeEventListener('visibilitychange', syncActive);
      scene?.dispose();
      runtime.current = null;
    };
  }, [host, plan, attempt, onSelect]);
  useEffect(() => {
    latestView.current = view;
    try { runtime.current?.setView(view); } catch { reportFailure.current(); }
  }, [view]);
  return <section className={styles.sceneSection} aria-label="立體圖面預覽">
    <div ref={setHost} className={styles.scene} data-building-plan-state={status} role="group" tabIndex={-1} aria-label="立體圖面" />
    {status === 'loading' && <p role="status" className={styles.sceneNotice}>正在載入立體預覽…</p>}
    {status === 'error' && <div className={styles.sceneNotice} role="alert">
      <p>目前無法顯示立體圖面，仍可使用下方平面圖與房間清單。</p>
      <button type="button" onClick={() => { setStatus('loading'); setAttempt(value => value + 1); }}>重試立體預覽</button>
    </div>}
  </section>;
}

function FloorDrawing({ floor, selected, onSelect }: { floor: PlanFloor; selected: string | null; onSelect: (floorId: string, roomId: string) => void }) {
  const xs = floor.outline.map(point => point[0]);
  const ys = floor.outline.map(point => point[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const width = Math.max(...xs) - minX, height = Math.max(...ys) - minY;
  const pad = Math.max(width, height) * 0.06;
  return <figure className={styles.floorDrawing}>
    <figcaption>{floor.label}</figcaption>
    <svg viewBox={`${minX - pad} ${minY - pad} ${width + pad * 2} ${height + pad * 2}`} aria-label={`${floor.label} 平面圖`}>
      <polygon className={styles.outline} points={floor.outline.map(point => point.join(',')).join(' ')} />
      {floor.rooms.map(room => <polygon key={room.id} className={styles.room} data-selected={selected === room.id}
        points={room.polygon.map(point => point.join(',')).join(' ')} role="button" tabIndex={0}
        aria-label={`平面圖 ${floor.label} ${room.name}`} aria-pressed={selected === room.id}
        onClick={() => onSelect(floor.id, room.id)} onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(floor.id, room.id); }
        }}><title>{room.name}</title></polygon>)}
      {floor.walls.map((wall, index) => <line key={index} className={styles.wall}
        x1={wall.start[0]} y1={wall.start[1]} x2={wall.end[0]} y2={wall.end[1]} strokeWidth={wall.thickness} />)}
    </svg>
  </figure>;
}

function PlanWorkspace({ schoolId, buildingId, buildingName, onClose }: Props) {
  const inputId = useId();
  const projectInputId = useId();
  const floorId = useId();
  const searchId = useId();
  const [plan, setPlan] = useState<BuildingPlan | null>(null);
  const [planRevision, setPlanRevision] = useState(0);
  const [example, setExample] = useState(false);
  const [roomQuery, setRoomQuery] = useState('');
  const [floorNotice, setFloorNotice] = useState('');
  const [floorTool, setFloorTool] = useState<'importer' | 'manager' | null>(null);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const [readingProject, setReadingProject] = useState(false);
  const [tracing, setTracing] = useState(false);
  const [traceSession, setTraceSession] = useState(false);
  const [initialProject, setInitialProject] = useState<Awaited<ReturnType<typeof importBuildingPlanProject>>>();
  const [traceRevision, setTraceRevision] = useState(0);
  const [mode, setMode] = useState<'flat' | '3d'>('flat');
  const [view, setView] = useState<Omit<BuildingPlanView, 'dark'>>(initialView);
  const generation = useRef(0);
  const projectRead = useRef<AbortController | null>(null);
  const projectFile = useRef<HTMLInputElement>(null);
  const workspace = useRef<HTMLDivElement>(null);
  const traceWorkspace = useRef<HTMLDivElement>(null);
  const traceStart = useRef<HTMLButtonElement>(null);
  const floorSelect = useRef<HTMLSelectElement>(null);
  const roomSearch = useRef<HTMLInputElement>(null);
  const floorTools = useRef<HTMLDivElement>(null);
  const focusAfterFloorImport = useRef(false);
  const focusAfterTrace = useRef<'preview' | 'return' | null>(null);
  const dark = useSyncExternalStore(subscribeAppearance, readDark, serverAppearance);
  const onFloorStagingChange = useCallback((active: boolean) => {
    setFloorTool(current => active ? 'importer' : current === 'importer' ? null : current);
  }, []);
  const onFloorEditingChange = useCallback((active: boolean) => {
    setFloorTool(current => active ? 'manager' : current === 'manager' ? null : current);
  }, []);
  useEffect(() => () => { generation.current += 1; projectRead.current?.abort(); }, []);
  function cancelPendingRead() {
    projectRead.current?.abort();
    projectRead.current = null;
    setReading(false);
    setReadingProject(false);
    return ++generation.current;
  }
  const clearPlan = () => { setPlan(null); setPlanRevision(value => value + 1); setRoomQuery(''); setFloorNotice(''); setFloorTool(null); setExample(false); setError(''); setReading(false); setReadingProject(false); setMode('flat'); setView(initialView); setTracing(false); setTraceSession(false); setInitialProject(undefined); };
  useEffect(() => {
    if (focusAfterFloorImport.current) {
      focusAfterFloorImport.current = false;
      floorTools.current?.querySelector<HTMLElement>('summary')?.focus();
    }
  }, [planRevision]);
  useEffect(() => {
    if (tracing) {
      traceWorkspace.current?.focus();
      return;
    }
    const requested = focusAfterTrace.current;
    if (!requested) return;
    focusAfterTrace.current = null;
    const target = requested === 'preview'
      ? workspace.current?.querySelector<HTMLElement>('[data-building-plan-state]')
      : plan ? floorSelect.current : traceStart.current;
    target?.focus();
    target?.scrollIntoView?.({ block: 'center' });
  }, [tracing, plan, traceRevision]);
  const onSelect = useCallback((selectedFloor: string, selectedRoom: string) => {
    setView(current => ({ ...current, floorId: selectedFloor, roomId: selectedRoom }));
  }, []);
  async function importFile(file: File) {
    const request = cancelPendingRead();
    setError('');
    if (!/\.json$/i.test(file.name)) { setError('請選擇 .json 圖面檔案。'); return; }
    if (file.size > MAX_BUILDING_PLAN_BYTES) { setError('圖面檔案不可超過 256 KB。'); return; }
    setReading(true);
    try {
      const contents = await file.text();
      if (request !== generation.current) return;
      const result = parseBuildingPlan(contents, { schoolId, buildingId });
      if (result.ok) { clearPlan(); setPlan(result.plan); }
      else setError(result.message);
    } catch {
      if (request === generation.current) setError('無法讀取檔案，請重新選擇 JSON 圖面。');
    } finally {
      if (request === generation.current) setReading(false);
    }
  }
  async function importProject(file: File) {
    const request = cancelPendingRead();
    const controller = new AbortController();
    projectRead.current = controller;
    setReadingProject(true);
    setError('');
    try {
      const restored = await importBuildingPlanProject(file, { schoolId, buildingId }, controller.signal);
      if (request !== generation.current || controller.signal.aborted) return;
      clearPlan();
      setInitialProject(restored);
      setTraceRevision(value => value + 1);
      setTraceSession(true);
      setTracing(true);
    } catch (cause) {
      if (request !== generation.current || controller.signal.aborted || (cause instanceof Error && cause.name === 'AbortError')) return;
      setError(cause instanceof Error ? cause.message : '無法開啟編輯檔，請重新選擇已保存的編輯檔。');
    } finally {
      if (request === generation.current) { projectRead.current = null; setReadingProject(false); }
    }
  }
  function loadExample() {
    cancelPendingRead();
    clearPlan();
    setExample(true);
    setPlan(createExampleBuildingPlan({ schoolId, buildingId }));
  }
  function downloadPlan(drawing: BuildingPlan, filename: string) {
    const formatted = JSON.stringify(drawing, null, 2);
    const contents = new TextEncoder().encode(formatted).byteLength <= MAX_BUILDING_PLAN_BYTES
      ? formatted : JSON.stringify(drawing);
    const blob = new Blob([contents], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    try { anchor.click(); } finally {
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    }
  }
  function startTracing() {
    cancelPendingRead();
    setError('');
    setMode('flat');
    if (!traceSession) { setInitialProject(undefined); setTraceRevision(value => value + 1); }
    setTraceSession(true);
    setTracing(true);
  }
  function changeFloors(next: BuildingPlan, addedFloorId?: string) {
    if (reading || readingProject || traceSession) return;
    cancelPendingRead();
    setPlan(next);
    setPlanRevision(value => value + 1);
    setError('');
    setExample(false);
    setRoomQuery('');
    setFloorNotice(addedFloorId ? `已加入 ${next.floors.find(floor => floor.id === addedFloorId)?.label}，目前共 ${next.floors.length} 層。` : '');
    setView(current => {
      if (addedFloorId) return { ...current, floorId: null, roomId: null };
      const selected = next.floors.find(floor => floor.id === current.floorId);
      return { ...current, floorId: selected?.id ?? null,
        roomId: selected?.rooms.some(room => room.id === current.roomId) ? current.roomId : null };
    });
    if (addedFloorId) focusAfterFloorImport.current = true;
  }
  const floors = plan?.floors.filter(floor => !view.floorId || floor.id === view.floorId) ?? [];
  const selectedFloor = plan?.floors.find(floor => floor.id === view.floorId);
  const selectedRoom = selectedFloor?.rooms.find(room => room.id === view.roomId);
  const searchTerms = roomQuery.normalize('NFKC').trim().toLocaleLowerCase('zh-TW').split(/\s+/u).filter(Boolean);
  const matchingRooms = (searchTerms.length ? plan?.floors ?? [] : floors).flatMap(floor =>
    floor.rooms.map(room => ({ floor, room })).filter(({ room }) => {
      const label = `${floor.label} ${room.name}`.normalize('NFKC').toLocaleLowerCase('zh-TW');
      return searchTerms.every(term => label.includes(term));
    }));
  return <Modal isOpen onClose={onClose} title="平面圖建模預覽" description={buildingName} size="full">
    <div ref={workspace} className={styles.workspace}>
      <div className={styles.projectControls}>
        <div className={styles.actions}>
          <label htmlFor={projectInputId} className={styles.fileButton}>開啟編輯檔</label>
          <input ref={projectFile} id={projectInputId} className={styles.fileInput} type="file" accept=".json,application/json" onChange={event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void importProject(file);
          }} />
          {readingProject && <button type="button" onClick={() => { cancelPendingRead(); projectFile.current?.focus(); }}>取消開啟</button>}
        </div>
        <p className={styles.hint}>載入先前儲存的底圖與描點。</p>
      </div>
      {readingProject && <p role="status">正在開啟編輯檔…</p>}
      {reading && <p role="status">正在讀取圖面…</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {traceSession && <div ref={traceWorkspace} className={styles.traceWorkspace} tabIndex={-1} hidden={!tracing} inert={readingProject} aria-busy={readingProject}>
        <BuildingPlanTracer key={traceRevision} schoolId={schoolId} buildingId={buildingId} buildingName={buildingName} initialProject={initialProject}
          onComplete={drawing => {
            cancelPendingRead();
            setPlan(drawing);
            setPlanRevision(value => value + 1);
            setRoomQuery('');
            setFloorNotice('');
            setExample(false);
            setError('');
            setView(initialView);
            setMode('3d');
            focusAfterTrace.current = 'preview';
            setTracing(false);
          }}
          onCancel={() => {
            cancelPendingRead();
            setError('');
            focusAfterTrace.current = 'return';
            setTracing(false);
            setTraceSession(false);
            setInitialProject(undefined);
          }} />
      </div>}
      {!tracing && <>
      <details className={styles.importer} open={!plan}>
        <summary hidden={!plan}>更換圖面與範本</summary>
        <div><p className={styles.intro}>從平面圖圖片標出外框與房間，或匯入 JSON 圖面，查看立體結構。</p>
          <p className={styles.hint}>圖片由你描點建立，不會自動辨識。離開前下載編輯檔，可保留底圖與描點；檔案不會上傳。</p></div>
        <div className={styles.actions}>
          <button ref={traceStart} type="button" onClick={startTracing}>{traceSession ? '繼續圖片描圖' : '從圖片建立圖面'}</button>
          <label htmlFor={inputId} className={styles.fileButton}>匯入 JSON 圖面</label>
          <input id={inputId} className={styles.fileInput} type="file" accept=".json,application/json" onChange={event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void importFile(file);
          }} />
          <button type="button" onClick={loadExample}>載入示意範例</button>
          <button type="button" onClick={() => downloadPlan(createExampleBuildingPlan({ schoolId, buildingId }), 'building-plan-template.json')}>下載圖面範本</button>
          {plan && <button type="button" onClick={() => { cancelPendingRead(); clearPlan(); }}>清除圖面</button>}
        </div>
      </details>
      {!plan && !reading && <div className={styles.empty}><strong>尚未載入圖面</strong><p>可從單張平面圖圖片開始描點、匯入 JSON（上限 256 KB），或先操作示意範例。</p></div>}
      {plan && <>
        <div className={styles.metadata}>
          <p className={styles.badge}>{example ? `示意範例，不代表${buildingName}` : '待核對圖面'}</p>
          <h3>{plan.name}</h3>
          <p>{example ? '範例套用範圍' : '圖面範圍'}：{buildingName}（{schoolId} / {buildingId}）</p>
          {!example && <p className={styles.hint}>尚未與現場核對，請勿作為室內導航或尺寸量測依據。</p>}
          <p className={styles.hint}>{plan.units === 'relative'
            ? '未校正比例：使用示意單位，尺寸與樓高僅供預覽。'
            : '圖面單位：公尺（m），比例與樓高仍需與來源核對。'}</p>
          {plan.source && <p className={styles.hint}>來源：{plan.source.url
            ? <a href={plan.source.url} target="_blank" rel="noreferrer">{plan.source.label} ↗</a>
            : plan.source.label}</p>}
          <div className={styles.actions}>
            <button type="button" onClick={() => downloadPlan(plan, 'building-plan.json')}>下載目前圖面</button>
            {traceSession && <button type="button" onClick={startTracing}>返回圖面編輯</button>}
          </div>
          <p className={styles.hint}>下載內容包含圖面與來源標示，不含底圖圖片。{traceSession && '要保存可續編的版本，請返回圖面編輯並下載編輯檔。'}</p>
        </div>
        <div ref={floorTools}>
          {floorNotice && <p className={styles.floorEditingHint} role="status">{floorNotice}</p>}
          {traceSession && <p className={styles.floorEditingHint}>目前保留原圖片編輯內容。要組合或管理樓層，請先下載各層圖面與需要保留的編輯檔，再從「匯入 JSON 圖面」開啟第一份圖面。</p>}
          {floorTool && <p className={styles.floorEditingHint}>{floorTool === 'importer' ? '請先完成或取消加入樓層，再編輯其他樓層設定。' : '請先套用或取消樓層設定，再加入其他樓層。'}</p>}
          <BuildingPlanFloorImporter key={planRevision} plan={plan} disabled={reading || readingProject || traceSession || floorTool === 'manager'} onChange={changeFloors} onStagingChange={onFloorStagingChange} />
          <BuildingPlanFloorManager plan={plan} disabled={reading || readingProject || traceSession || floorTool === 'importer'} onChange={changeFloors} onEditingChange={onFloorEditingChange} />
        </div>
        <div className={styles.toolbar}>
          <label htmlFor={floorId}>樓層</label>
          <select ref={floorSelect} id={floorId} value={view.floorId ?? ''} onChange={event => setView(current => ({ ...current, floorId: event.target.value || null, roomId: null }))}>
            <option value="">全部樓層</option>{plan.floors.map(floor => <option key={floor.id} value={floor.id}>{floor.label}</option>)}
          </select>
          <div className={styles.actions} aria-label="預覽模式">
            <button type="button" aria-pressed={mode === 'flat'} onClick={() => setMode('flat')}>平面</button>
            <button type="button" aria-pressed={mode === '3d'} onClick={() => setMode('3d')}>立體</button>
          </div>
          {mode === '3d' && <div className={styles.actions} aria-label="立體視角控制">
            <button type="button" onClick={() => setView(current => ({ ...current, exploded: !current.exploded }))}>{view.exploded ? '組合樓層' : '分層展開'}</button>
            <button type="button" onClick={() => setView(current => ({ ...current, overhead: !current.overhead }))}>{view.overhead ? '斜視' : '俯視'}</button>
            <button type="button" onClick={() => setView(current => ({ ...current, bearing: (current.bearing - 15 + 360) % 360 }))}>向左旋轉</button>
            <button type="button" onClick={() => setView(current => ({ ...current, bearing: (current.bearing + 15) % 360 }))}>向右旋轉</button>
            <button type="button" aria-disabled={view.zoom >= 2.5} onClick={() => setView(current => ({ ...current, zoom: Math.min(2.5, current.zoom + 0.25) }))}>放大</button>
            <button type="button" aria-disabled={view.zoom <= 0.65} onClick={() => setView(current => ({ ...current, zoom: Math.max(0.65, current.zoom - 0.25) }))}>縮小</button>
            <button type="button" onClick={() => setView(current => ({ ...current, bearing: 0, zoom: 1, overhead: false, exploded: true }))}>重設視角</button>
          </div>}
        </div>
        {mode === '3d' && <>
          <PlanCanvas plan={plan} view={{ ...view, dark }} onSelect={onSelect} />
          <p className={styles.hint}>牆面以剖視呈現，顯示高度不代表實際牆高。</p>
        </>}
        <p className={styles.selection} role="status">{selectedRoom ? `已選取：${selectedFloor?.label} · ${selectedRoom.name}` : '點選平面圖或清單中的房間，查看所在樓層。'}</p>
        <div className={styles.planLayout}>
          <section aria-label="平面圖" className={styles.drawings}>{floors.map(floor => <FloorDrawing key={floor.id} floor={floor} selected={view.roomId} onSelect={onSelect} />)}</section>
          <section className={styles.rooms} aria-label="房間清單"><h3>房間清單</h3>
            <label htmlFor={searchId} className={styles.searchLabel}>搜尋圖面房間</label>
            <div className={styles.searchControls}>
              <input ref={roomSearch} id={searchId} type="search" value={roomQuery} maxLength={100}
                placeholder="房名或樓層" autoComplete="off" aria-describedby={`${searchId}-hint`}
                onChange={event => setRoomQuery(event.target.value)} />
              {roomQuery && <button type="button" onClick={() => { setRoomQuery(''); roomSearch.current?.focus(); }}>清除搜尋</button>}
            </div>
            <p id={`${searchId}-hint`} className={styles.hint}>搜尋本次圖面的所有樓層，選擇房間後才切換樓層。</p>
            <p className={styles.hint} role="status">{searchTerms.length
              ? matchingRooms.length ? `找到 ${matchingRooms.length} 個房間，請選擇。` : '找不到符合的房間，請換個房名或樓層，或清除搜尋。'
              : matchingRooms.length ? `${selectedFloor?.label ?? '全部樓層'}：${matchingRooms.length} 個房間。` : '這些樓層尚未標示房間。'}</p>
            <div className={styles.roomResults}>
              {matchingRooms.map(({ floor, room }) => <button key={room.id} type="button" aria-label={`${floor.label} ${room.name}`} aria-pressed={view.roomId === room.id} onClick={() => onSelect(floor.id, room.id)}><span>{floor.label}</span>{room.name}</button>)}
            </div>
          </section>
        </div>
      </>}
      </>}
    </div>
  </Modal>;
}

export default function BuildingPlanPreview(props: Props) {
  return <PlanWorkspace key={JSON.stringify([props.schoolId, props.buildingId])} {...props} />;
}
