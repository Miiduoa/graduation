'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { BuildingPlan, PlanFloor } from './buildingPlan';
import { removeBuildingPlanFloor, updateBuildingPlanFloor } from './buildingPlanFloors';
import styles from './BuildingPlanFloorManager.module.css';

type Props = {
  plan: BuildingPlan;
  disabled?: boolean;
  onChange: (plan: BuildingPlan) => void;
  onEditingChange?: (editing: boolean) => void;
};
type EditDraft = {
  plan: BuildingPlan;
  floorId: string;
  label: string;
  elevation: string;
  height: string;
  error: string;
};
type Removal = { plan: BuildingPlan; floorId: string; error: string };
type FocusRequest = { target: 'edit' | 'remove'; floorId: string }
  | { target: 'name' | 'confirm' | 'error' | 'summary' };

export default function BuildingPlanFloorManager({ plan, disabled = false, onChange, onEditingChange }: Props) {
  const id = useId();
  const [editing, setEditing] = useState<EditDraft | null>(null);
  const [removing, setRemoving] = useState<Removal | null>(null);
  const [notice, setNotice] = useState<{ plan: BuildingPlan; text: string } | null>(null);
  const summary = useRef<HTMLElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const errorMessage = useRef<HTMLParagraphElement>(null);
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  const removeButtons = useRef(new Map<string, HTMLButtonElement>());
  const focusRequest = useRef<FocusRequest | null>(null);
  const focusedFloor = useRef<string | null>(null);
  const editingListener = useRef(onEditingChange);
  const reportedEditing = useRef(false);
  const draft = editing?.plan === plan ? editing : null;
  const removal = removing?.plan === plan ? removing : null;
  const editingActive = Boolean(draft || removal);
  const unit = plan.units === 'm' ? '公尺' : '示意單位';

  useEffect(() => { editingListener.current = onEditingChange; }, [onEditingChange]);
  useEffect(() => {
    if (reportedEditing.current === editingActive) return;
    reportedEditing.current = editingActive;
    editingListener.current?.(editingActive);
  }, [editingActive]);
  useEffect(() => () => {
    if (!reportedEditing.current) return;
    reportedEditing.current = false;
    editingListener.current?.(false);
  }, []);

  useEffect(() => {
    const request = focusRequest.current;
    focusRequest.current = null;
    let target: HTMLElement | null | undefined;
    if (request?.target === 'edit') target = editButtons.current.get(request.floorId);
    else if (request?.target === 'remove') target = removeButtons.current.get(request.floorId);
    else if (request?.target === 'name') target = nameInput.current;
    else if (request?.target === 'confirm') target = confirmButton.current;
    else if (request?.target === 'error') target = errorMessage.current;
    else if (request?.target === 'summary') target = summary.current;
    if (request) {
      (target ?? summary.current)?.focus();
    } else if (document.hasFocus() && document.activeElement === document.body && focusedFloor.current) {
      // An externally replaced model may remove a focused form or floor.
      (editButtons.current.get(focusedFloor.current) ?? summary.current)?.focus();
    }
  }, [plan, editing, removing]);

  function editFloor(floor: PlanFloor) {
    if (disabled) return;
    setRemoving(null);
    setNotice(null);
    if (draft?.floorId === floor.id) {
      focusRequest.current = { target: 'edit', floorId: floor.id };
      setEditing(null);
      return;
    }
    focusRequest.current = { target: 'name' };
    setEditing({ plan, floorId: floor.id, label: floor.label, elevation: String(floor.elevation), height: String(floor.height), error: '' });
  }

  function changeDraft(values: Partial<Pick<EditDraft, 'label' | 'elevation' | 'height'>>) {
    if (disabled || !draft) return;
    setEditing({ ...draft, ...values, error: '' });
  }

  function applyFloor() {
    if (disabled || !draft) return;
    let message = '';
    if (!draft.label.trim()) message = '請填寫樓層名稱。';
    else if (!draft.elevation.trim() || !Number.isFinite(Number(draft.elevation))) message = '請填寫有效的樓底標高。';
    else if (!draft.height.trim() || !Number.isFinite(Number(draft.height))) message = '請填寫有效的樓高。';
    const result = message ? { ok: false as const, message } : updateBuildingPlanFloor(plan, {
      schoolId: plan.schoolId, buildingId: plan.buildingId,
    }, draft.floorId, { label: draft.label, elevation: Number(draft.elevation), height: Number(draft.height) });
    if (!result.ok) {
      focusRequest.current = { target: 'error' };
      setEditing({ ...draft, error: result.message });
      return;
    }
    focusRequest.current = { target: 'edit', floorId: draft.floorId };
    setEditing(null);
    setNotice({ plan: result.plan, text: `${result.plan.floors.find(floor => floor.id === draft.floorId)?.label ?? draft.label} 的設定已套用。` });
    onChange(result.plan);
  }

  function requestRemoval(floor: PlanFloor) {
    if (disabled || plan.floors.length <= 1) return;
    setEditing(null);
    setNotice(null);
    focusRequest.current = { target: 'confirm' };
    setRemoving({ plan, floorId: floor.id, error: '' });
  }

  function removeFloor() {
    if (disabled || !removal) return;
    const result = removeBuildingPlanFloor(plan, { schoolId: plan.schoolId, buildingId: plan.buildingId }, removal.floorId);
    if (!result.ok) {
      focusRequest.current = { target: 'error' };
      setRemoving({ ...removal, error: result.message });
      return;
    }
    const index = plan.floors.findIndex(floor => floor.id === removal.floorId);
    const neighbor = result.plan.floors[Math.min(Math.max(index, 0), result.plan.floors.length - 1)];
    focusRequest.current = neighbor ? { target: 'edit', floorId: neighbor.id } : { target: 'summary' };
    setRemoving(null);
    setNotice({ plan: result.plan, text: `已移除 ${plan.floors[index]?.label ?? '樓層'}。` });
    onChange(result.plan);
  }

  return <details className={styles.manager}>
    <summary ref={summary}>管理樓層</summary>
    <section className={styles.content} aria-label="樓層管理">
      <p className={styles.hint}>依樓底標高由低到高排列；修改後按「套用樓層設定」。</p>
      {plan.units === 'relative' && <p className={styles.hint}>這份圖面使用示意單位，標高與樓高僅供預覽。</p>}
      {notice?.plan === plan && <p className={styles.notice} role="status">{notice.text}</p>}
      <fieldset className={styles.controls} disabled={disabled} aria-busy={disabled} onBlurCapture={event => {
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) focusedFloor.current = null;
      }}>
        <ol className={styles.floors}>
          {plan.floors.map((floor, index) => {
            const source = floor.source ?? plan.source;
            const isEditing = draft?.floorId === floor.id;
            const isRemoving = removal?.floorId === floor.id;
            return <li key={floor.id} className={styles.floor} onFocusCapture={() => { focusedFloor.current = floor.id; }}>
              <div role="group" aria-label={`${floor.label} 樓層設定`}>
                <div className={styles.heading}>
                  <h4>{floor.label}</h4>
                  <p className={styles.measurements}>樓底 {floor.elevation} {unit} · 樓高 {floor.height} {unit}</p>
                </div>
                {source && <p className={styles.source}>來源：{source.url
                  ? <a href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a>
                  : source.label}</p>}
                <div className={styles.actions}>
                  <button ref={button => { if (button) editButtons.current.set(floor.id, button); else editButtons.current.delete(floor.id); }} type="button"
                    aria-expanded={isEditing} aria-controls={`${id}-edit-${index}`} onClick={() => editFloor(floor)}>編輯樓層</button>
                  <button ref={button => { if (button) removeButtons.current.set(floor.id, button); else removeButtons.current.delete(floor.id); }} type="button"
                    aria-disabled={plan.floors.length <= 1} aria-describedby={plan.floors.length <= 1 ? `${id}-minimum` : undefined}
                    onClick={() => requestRemoval(floor)}>移除樓層</button>
                </div>
                {isEditing && <form id={`${id}-edit-${index}`} className={styles.editor} noValidate onSubmit={event => { event.preventDefault(); applyFloor(); }}>
                  <label className={styles.nameField}>樓層名稱
                    <input ref={nameInput} value={draft.label} maxLength={100} autoComplete="off" onChange={event => changeDraft({ label: event.target.value })} />
                  </label>
                  <label>樓底標高（{unit}）
                    <input type="number" inputMode="decimal" min={-30} max={150} step="any" value={draft.elevation}
                      onChange={event => changeDraft({ elevation: event.target.value })} />
                  </label>
                  <label>樓高（{unit}）
                    <input type="number" inputMode="decimal" min={1} max={10} step="any" value={draft.height}
                      onChange={event => changeDraft({ height: event.target.value })} />
                  </label>
                  {draft.error && <p ref={errorMessage} className={styles.error} role="alert" tabIndex={-1}>{draft.error}</p>}
                  <div className={styles.actions}>
                    <button type="submit" className={styles.primary}>套用樓層設定</button>
                    <button type="button" onClick={() => {
                      if (disabled) return;
                      focusRequest.current = { target: 'edit', floorId: floor.id };
                      setEditing(null);
                    }}>取消修改</button>
                  </div>
                </form>}
                {isRemoving && <div className={styles.removal}>
                  <p>移除「{floor.label}」及其中 {floor.rooms.length} 個房間？</p>
                  {removal.error && <p ref={errorMessage} className={styles.error} role="alert" tabIndex={-1}>{removal.error}</p>}
                  <div className={styles.actions}>
                    <button ref={confirmButton} type="button" onClick={removeFloor}>確認移除</button>
                    <button type="button" onClick={() => {
                      if (disabled) return;
                      focusRequest.current = { target: 'remove', floorId: floor.id };
                      setRemoving(null);
                    }}>保留樓層</button>
                  </div>
                </div>}
              </div>
            </li>;
          })}
        </ol>
      </fieldset>
      {plan.floors.length === 1 && <p id={`${id}-minimum`} className={styles.hint}>至少保留一個樓層；要移除整份內容，請使用「清除圖面」。</p>}
    </section>
  </details>;
}
