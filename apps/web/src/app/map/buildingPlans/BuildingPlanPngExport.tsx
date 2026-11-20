'use client';

import { useLayoutEffect, useId, useRef, useState } from 'react';
import type { BuildingPlan } from './buildingPlan';
import { exportBuildingPlanPng, getBuildingPlanPngSize } from './buildingPlanPng';
import { getBuildingPlanSvgFilename } from './buildingPlanSvgFilename';
import styles from './BuildingPlanPngExport.module.css';

type Props = { plan: BuildingPlan; floorId: string | null };
type Selection = Props & { scale: 1 | 2 };
type Job = Selection & { controller: AbortController };
type Status = Selection & { kind: 'busy' | 'done' | 'error' | 'cancelled'; message: string };

export default function BuildingPlanPngExport({ plan, floorId }: Props) {
  const qualityId = useId();
  const [scale, setScale] = useState<1 | 2>(2);
  const [status, setStatus] = useState<Status | null>(null);
  const job = useRef<Job | null>(null);
  const size = getBuildingPlanPngSize(plan, floorId, scale);
  const current = status?.plan === plan && status.floorId === floorId && status.scale === scale ? status : null;
  const busy = current?.kind === 'busy';
  const floor = plan.floors.find(item => item.id === floorId);

  useLayoutEffect(() => () => {
    const active = job.current;
    if (active?.plan === plan && active.floorId === floorId && active.scale === scale) {
      job.current = null;
      active.controller.abort();
      setStatus(null);
    }
  }, [plan, floorId, scale]);

  async function download() {
    if (job.current) return;
    const active: Job = { plan, floorId, scale, controller: new AbortController() };
    job.current = active;
    setStatus({ ...active, kind: 'busy', message: '正在產生 PNG，請稍候…' });
    try {
      const result = await exportBuildingPlanPng(plan, floorId, scale, active.controller.signal);
      if (job.current !== active || active.controller.signal.aborted) return;
      const filename = getBuildingPlanSvgFilename(plan.name, floor?.label ?? null).slice(0, -4) + '.png';
      const url = URL.createObjectURL(result.blob);
      try {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.append(anchor);
        try { anchor.click(); } finally { anchor.remove(); }
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      }
      setStatus({ ...active, kind: 'done', message: 'PNG 已交給瀏覽器下載：' + filename });
    } catch {
      if (job.current === active && !active.controller.signal.aborted) {
        setStatus({ ...active, kind: 'error', message: '無法產生 PNG。請重試、改選單一樓層，或下載 SVG。' });
      }
    } finally {
      if (job.current === active) job.current = null;
    }
  }

  function cancel() {
    const active = job.current;
    if (!active) return;
    job.current = null;
    active.controller.abort();
    setStatus({ ...active, kind: 'cancelled', message: '已取消 PNG 匯出。' });
  }

  return <section className={styles.export} role="group" aria-label="PNG 圖片匯出" aria-busy={busy}>
    <p className={styles.hint}>PNG 適合放入簡報或分享圖片；淺色背景，保留來源及待核對提醒。</p>
    <div className={styles.controls}>
      <label htmlFor={qualityId}>PNG 畫質
        <select id={qualityId} value={scale} disabled={busy}
          onChange={event => setScale(event.target.value === '1' ? 1 : 2)}>
          <option value="1">一般（1 倍）</option>
          <option value="2">清晰（2 倍）</option>
        </select>
      </label>
      <div className={styles.actions}>
        <button type="button" disabled={busy} aria-describedby={qualityId + '-size'}
          onClick={() => { void download(); }}>{busy ? '正在產生 PNG…' : '下載平面圖 PNG'}</button>
        {busy && <button type="button" onClick={cancel}>取消 PNG 匯出</button>}
      </div>
    </div>
    <p id={qualityId + '-size'} className={styles.hint}>
      {floor?.label ?? '全部樓層'} · {size.width} × {size.height} px
      {size.limited && '。已限制圖片尺寸；選單一樓層可看得更清楚。'}
    </p>
    {current && <p role={current.kind === 'error' ? 'alert' : 'status'}
      className={current.kind === 'error' ? styles.error : styles.hint}>{current.message}</p>}
  </section>;
}
