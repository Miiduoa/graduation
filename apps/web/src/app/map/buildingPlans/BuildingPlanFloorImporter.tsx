'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { MAX_BUILDING_PLAN_BYTES, parseBuildingPlan, type BuildingPlan, type PlanFloor, type PlanPoint } from './buildingPlan';
import { appendBuildingPlanFloor, suggestBuildingPlanFloorAlignment, type BuildingPlanFloorPlacement } from './buildingPlanFloors';
import styles from './BuildingPlanFloorImporter.module.css';

type Props = {
  plan: BuildingPlan;
  disabled?: boolean;
  onChange: (plan: BuildingPlan, addedFloorId: string) => void;
  onStagingChange?: (staging: boolean) => void;
};
type Prepared = { base: BuildingPlan; plan: BuildingPlan; addedFloorId: string };

function cornerOptions(points: PlanPoint[]) {
  return points.map(([x, y], index) => <option key={index} value={index}>角點 {index + 1}（{x}, {y}）</option>);
}

function AlignmentDrawing({ reference, candidate }: { reference: PlanFloor; candidate: PlanFloor }) {
  const points = [...reference.outline, ...candidate.outline];
  const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const width = Math.max(...xs) - minX, height = Math.max(...ys) - minY;
  const pad = Math.max(width, height) * 0.08;
  return <figure className={styles.alignment}>
    <figcaption>樓層位置預覽</figcaption>
    <svg role="img" aria-label="樓層位置預覽" viewBox={`${minX - pad} ${minY - pad} ${width + 2 * pad} ${height + 2 * pad}`}>
      <polygon className={styles.referenceOutline} points={reference.outline.map(point => point.join(',')).join(' ')}>
        <title>參考樓層：{reference.label}</title>
      </polygon>
      <polygon className={styles.candidateOutline} points={candidate.outline.map(point => point.join(',')).join(' ')}>
        <title>待加入樓層：{candidate.label}</title>
      </polygon>
    </svg>
    <p className={styles.legend}><span>虛線：{reference.label}</span><span>實線：{candidate.label}</span></p>
  </figure>;
}

export default function BuildingPlanFloorImporter({ plan, disabled = false, onChange, onStagingChange }: Props) {
  const fileId = useId();
  const summary = useRef<HTMLElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const previewRegion = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const focusPrepared = useRef(false);
  const [reading, setReading] = useState(false);
  const [incoming, setIncoming] = useState<BuildingPlan | null>(null);
  const [sourceFloorId, setSourceFloorId] = useState('');
  const [label, setLabel] = useState('');
  const [elevation, setElevation] = useState('');
  const [offsetX, setOffsetX] = useState('0');
  const [offsetY, setOffsetY] = useState('0');
  const [rotation, setRotation] = useState<BuildingPlanFloorPlacement['rotationDegrees']>(0);
  const [referenceId, setReferenceId] = useState(plan.floors[0].id);
  const [referenceA, setReferenceA] = useState(0);
  const [referenceB, setReferenceB] = useState(1);
  const [incomingA, setIncomingA] = useState(0);
  const [incomingB, setIncomingB] = useState(1);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const limited = plan.units !== 'm' || plan.floors.length >= 12;
  const blocked = disabled || limited;

  // A read or reviewed candidate belongs to one specific model, never its replacement.
  useEffect(() => () => { generation.current += 1; onStagingChange?.(false); }, [plan, onStagingChange]);
  const sourceFloor = incoming?.floors.find(floor => floor.id === sourceFloorId);
  const reference = plan.floors.find(floor => floor.id === referenceId) ?? plan.floors[0];
  const candidate = prepared?.base === plan ? prepared.plan.floors.find(floor => floor.id === prepared.addedFloorId) : undefined;
  const source = sourceFloor?.source ?? incoming?.source;

  function resetCandidate() {
    generation.current += 1;
    setReading(false);
    setIncoming(null);
    setPrepared(null);
    setError('');
    setNotice('');
    focusPrepared.current = false;
    onStagingChange?.(false);
  }

  async function readFloorFile(file: File) {
    if (blocked) return;
    const request = ++generation.current;
    setReading(false);
    setError('');
    setNotice('');
    if (!/\.json$/i.test(file.name)) { setError('請選擇已完成的 .json 圖面檔案。'); onStagingChange?.(Boolean(incoming)); return; }
    if (file.size > MAX_BUILDING_PLAN_BYTES) { setError('圖面檔案不可超過 256 KB。'); onStagingChange?.(Boolean(incoming)); return; }
    setReading(true);
    onStagingChange?.(true);
    let accepted = false;
    try {
      const contents = await file.text();
      if (request !== generation.current) return;
      const parsed = parseBuildingPlan(contents, { schoolId: plan.schoolId, buildingId: plan.buildingId });
      if (!parsed.ok) { setError(parsed.message); return; }
      if (parsed.plan.units !== 'm') {
        setError('加入的圖面尚未校正為公尺。請先在原圖片描圖中完成比例與樓高校正，再下載圖面。');
        return;
      }
      setIncoming(parsed.plan);
      setSourceFloorId(parsed.plan.floors[0].id);
      setLabel(parsed.plan.floors[0].label);
      setElevation('');
      setOffsetX('0');
      setOffsetY('0');
      setRotation(0);
      setReferenceA(0); setReferenceB(1);
      setIncomingA(0); setIncomingB(1);
      setPrepared(null);
      accepted = true;
      setNotice('圖面已讀取，請設定樓層位置。尚未加入目前建築。');
    } catch {
      if (request === generation.current) setError('無法讀取樓層圖面，原有圖面仍保留。');
    } finally {
      if (request === generation.current) { setReading(false); onStagingChange?.(accepted || Boolean(incoming)); }
    }
  }

  function invalidatePreview() { focusPrepared.current = false; setPrepared(null); setError(''); setNotice(''); }

  function calculateAlignment() {
    if (blocked || reading || !sourceFloor) return;
    invalidatePreview();
    const alignment = suggestBuildingPlanFloorAlignment({
      referenceA: reference.outline[referenceA],
      referenceB: reference.outline[referenceB],
      incomingA: sourceFloor.outline[incomingA],
      incomingB: sourceFloor.outline[incomingB],
    });
    if (!alignment.ok) { setError(alignment.message); return; }
    // Keep sub-millimetre precision in the editable fields, without auto-scaling.
    setOffsetX(String(Number(alignment.offsetX.toFixed(5))));
    setOffsetY(String(Number(alignment.offsetY.toFixed(5))));
    setRotation(alignment.rotationDegrees);
    setNotice(`已帶入 ${alignment.rotationDegrees}° 旋轉與位移；第二對角點誤差 ${alignment.errorMetres.toFixed(2)} 公尺。請預覽核對後再加入樓層。`);
  }

  function prepareFloor() {
    if (blocked || reading || !incoming) return;
    setError('');
    if (![elevation, offsetX, offsetY].every(value => value.trim() && Number.isFinite(Number(value)))) {
      setError('請填寫樓底標高與兩個位移，位置不移動時填 0。');
      return;
    }
    const result = appendBuildingPlanFloor(plan, incoming, { schoolId: plan.schoolId, buildingId: plan.buildingId }, {
      sourceFloorId, label, elevation: Number(elevation), offsetX: Number(offsetX), offsetY: Number(offsetY), rotationDegrees: rotation,
    });
    if (!result.ok) { setPrepared(null); setError(result.message); return; }
    focusPrepared.current = true;
    setPrepared({ base: plan, plan: result.plan, addedFloorId: result.addedFloorId });
    setNotice('請核對外框位置與標高，再加入這個樓層。');
  }

  useEffect(() => {
    if (!focusPrepared.current) return;
    focusPrepared.current = false;
    if (prepared && !disabled) previewRegion.current?.focus();
  }, [prepared, disabled]);

  return <details className={styles.importer}>
    <summary ref={summary}>加入樓層圖面</summary>
    <div className={styles.content}>
      <p className={styles.hint}>把同一棟建築的已完成圖面逐層組合。每份圖面需先校正為公尺；請依共同參考點與方向調整位置。</p>
      {plan.units !== 'm' && <p className={styles.hint}>目前圖面尚未校正比例。請先完成各樓層的比例與樓高校正，再匯入公尺圖面組合。</p>}
      {plan.floors.length >= 12 && <p className={styles.hint}>目前已有 12 層；移除一層後才能再加入。</p>}
      <fieldset disabled={blocked} className={styles.fields}>
        <legend className={styles.srOnly}>加入樓層的檔案與位置</legend>
        <div className={styles.actions}>
          <label htmlFor={fileId} className={styles.fileButton}>選擇要加入的圖面</label>
          <input id={fileId} ref={fileInput} className={styles.fileInput} type="file" accept=".json,application/json" onChange={event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void readFloorFile(file);
          }} />
          {(reading || incoming) && <button type="button" onClick={() => { resetCandidate(); fileInput.current?.focus(); }}>取消加入樓層</button>}
        </div>
        {reading && <p role="status">正在讀取要加入的樓層…</p>}
        {incoming && <fieldset disabled={reading} className={styles.fields}>
          <legend className={styles.srOnly}>新增樓層設定</legend>
          <p className={styles.hint}>來源圖面：{incoming.name}</p>
          <div className={styles.field}><label htmlFor={`${fileId}-floor`}>加入哪一層</label><select id={`${fileId}-floor`} value={sourceFloorId} onChange={event => {
            const floor = incoming.floors.find(item => item.id === event.target.value);
            if (!floor) return;
            setSourceFloorId(floor.id); setLabel(floor.label);
            setIncomingA(0); setIncomingB(1); invalidatePreview();
          }}>{incoming.floors.map(floor => <option key={floor.id} value={floor.id}>{floor.label}</option>)}</select></div>
          <p className={styles.hint}>此層來源：{source?.url
            ? <a href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a>
            : source?.label ?? '原檔未提供來源'}</p>
          <div className={styles.grid}>
            <label>新增樓層名稱<input value={label} maxLength={100} onChange={event => { setLabel(event.target.value); invalidatePreview(); }} /></label>
            <label>樓底標高（公尺）<input type="number" min={-30} max={150} step="any" value={elevation} onChange={event => { setElevation(event.target.value); invalidatePreview(); }} /></label>
            <label>水平位移（公尺）<input type="number" step="any" value={offsetX} onChange={event => { setOffsetX(event.target.value); invalidatePreview(); }} /></label>
            <label>垂直位移（公尺）<input type="number" step="any" value={offsetY} onChange={event => { setOffsetY(event.target.value); invalidatePreview(); }} /></label>
            <div className={styles.field}><label htmlFor={`${fileId}-rotation`}>圖面旋轉</label><select id={`${fileId}-rotation`} value={rotation} onChange={event => { setRotation(Number(event.target.value) as BuildingPlanFloorPlacement['rotationDegrees']); invalidatePreview(); }}>
              <option value="0">不旋轉</option><option value="90">順時針 90°</option><option value="180">旋轉 180°</option><option value="270">順時針 270°</option>
            </select></div>
            <div className={styles.field}><label htmlFor={`${fileId}-reference`}>位置參考樓層</label><select id={`${fileId}-reference`} value={reference.id} onChange={event => {
              setReferenceId(event.target.value); setReferenceA(0); setReferenceB(1); invalidatePreview();
            }}>
              {plan.floors.map(floor => <option key={floor.id} value={floor.id}>{floor.label}</option>)}
            </select></div>
          </div>
          <details className={styles.importer}>
            <summary>依兩組角點對位（選用）</summary>
            <div className={styles.content}>
              <p className={styles.hint}>請選同一個實際位置，在參考樓層與來源圖面各標示 A、B 兩個角點；兩點要有足夠距離。只計算 90° 倍數的旋轉與位移，不自動縮放、也不推測北向。</p>
              <div className={styles.grid}>
                <div className={styles.field}>
                  <label htmlFor={`${fileId}-reference-a`}>參考樓層對位點 A</label>
                  <select id={`${fileId}-reference-a`} value={referenceA} onChange={event => { setReferenceA(Number(event.target.value)); invalidatePreview(); }}>{cornerOptions(reference.outline)}</select>
                </div>
                <div className={styles.field}>
                  <label htmlFor={`${fileId}-reference-b`}>參考樓層對位點 B</label>
                  <select id={`${fileId}-reference-b`} value={referenceB} onChange={event => { setReferenceB(Number(event.target.value)); invalidatePreview(); }}>{cornerOptions(reference.outline)}</select>
                </div>
                <div className={styles.field}>
                  <label htmlFor={`${fileId}-incoming-a`}>來源圖面對位點 A</label>
                  <select id={`${fileId}-incoming-a`} value={incomingA} onChange={event => { setIncomingA(Number(event.target.value)); invalidatePreview(); }}>{cornerOptions(sourceFloor?.outline ?? [])}</select>
                </div>
                <div className={styles.field}>
                  <label htmlFor={`${fileId}-incoming-b`}>來源圖面對位點 B</label>
                  <select id={`${fileId}-incoming-b`} value={incomingB} onChange={event => { setIncomingB(Number(event.target.value)); invalidatePreview(); }}>{cornerOptions(sourceFloor?.outline ?? [])}</select>
                </div>
              </div>
              <button type="button" onClick={calculateAlignment}>依兩組對位點計算位置</button>
            </div>
          </details>
          <p className={styles.hint}>樓底標高沿用目前建築的高度基準。平面位置先繞來源原點旋轉，再平移；正值向右、向下。來源樓高為 {sourceFloor?.height} 公尺，組合不縮放圖面。</p>
          <button type="button" onClick={prepareFloor}>預覽樓層位置</button>
          {prepared && candidate && <div ref={previewRegion} className={styles.prepared} tabIndex={-1} aria-label="待加入樓層確認">
            <AlignmentDrawing reference={reference} candidate={candidate} />
            <p>{candidate.label}：樓底標高 {candidate.elevation} 公尺，樓高 {candidate.height} 公尺。</p>
            <button type="button" onClick={() => {
              if (blocked || reading || prepared.base !== plan) return;
              const confirmed = prepared;
              resetCandidate();
              summary.current?.focus();
              onChange(confirmed.plan, confirmed.addedFloorId);
            }}>加入這個樓層</button>
          </div>}
        </fieldset>}
      </fieldset>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {notice && <p className={styles.hint} role="status">{notice}</p>}
    </div>
  </details>;
}
