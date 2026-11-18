import { useId } from 'react';
import {
  ASSISTANT_ROLE_PROFILES,
  ASSISTANT_ROLE_CAPABILITY_LABELS,
  getAssistantRoleProfile,
  type AssistantRoleProfileId,
} from '@campus/shared/src/assistantRoleProfiles';
import styles from './AssistantRoleContext.module.css';

export function AssistantRoleContext({ value, disabled, onChange }: {
  value: AssistantRoleProfileId;
  disabled?: boolean;
  onChange: (profile: AssistantRoleProfileId) => void;
}) {
  const id = useId();
  const profile = getAssistantRoleProfile(value)!;
  return <section className={styles.context} aria-label="助理工作情境">
    <div className={styles.heading}>
      <label htmlFor={id}>目前要處理</label>
      <select id={id} value={profile.id} disabled={disabled} onChange={event => {
        const next = getAssistantRoleProfile(event.target.value);
        if (next && !disabled) onChange(next.id);
      }}>
        {ASSISTANT_ROLE_PROFILES.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}
      </select>
    </div>
    <p className={styles.description}>{profile.description}</p>
    <details className={styles.details}>
      <summary>查看這個情境可處理的事</summary>
      <ul>{profile.capabilities.map(item => <li key={item.id}>
        <span>{ASSISTANT_ROLE_CAPABILITY_LABELS[item.level]}</span>{item.label}
      </li>)}</ul>
      <p>工作情境只調整任務建議。課程、店家與管理資料仍依你原有的權限開放。</p>
    </details>
    {disabled && <p className={styles.lock}>先完成或取消目前的安排，再切換工作情境。</p>}
  </section>;
}
