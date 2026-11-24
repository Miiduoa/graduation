'use client';

import { AssistantReplyLink } from '@/components/AssistantReplyLink';
import { useId } from 'react';
import { assistantServiceHref, type AssistantServiceId } from '@campus/shared/src/assistantServices';
import {
  ASSISTANT_ROLE_WORKFLOWS,
  getAssistantRoleWorkflow,
  type AssistantWorkContext,
} from '@campus/shared/src/assistantRoleWorkflows';
import styles from './AssistantRoleTasks.module.css';

/** Changes recommendations only; the caller keeps the current conversation,
 * draft, action journal and unresolved confirmation cards. */
export function AssistantRoleTasks({ context, onContext, schoolId, compact = false, disabled = false, linkedServiceIds = [] }: {
  context: AssistantWorkContext;
  onContext: (context: AssistantWorkContext) => void;
  schoolId: string;
  compact?: boolean;
  disabled?: boolean;
  linkedServiceIds?: readonly AssistantServiceId[];
}) {
  const fieldId = useId();
  const workflow = getAssistantRoleWorkflow(context);
  const services = workflow.services.filter(service => !linkedServiceIds.includes(service.id));
  return (
    <div className={compact ? styles.compact : styles.panel}>
      <div className={styles.choice}>
        <label htmlFor={fieldId}>目前處理的工作</label>
        <select id={fieldId} value={workflow.id} disabled={disabled}
          onChange={event => { if (!disabled) onContext(getAssistantRoleWorkflow(event.target.value).id); }}>
          {ASSISTANT_ROLE_WORKFLOWS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </div>
      {!compact && <p className={styles.purpose}>{workflow.purpose}</p>}
      {services.length > 0 && (
        <nav className={styles.links} aria-label={`${workflow.label}工作入口`}>
          {services.map(service => {
            const href = assistantServiceHref(service.id, schoolId, 'platform');
            return href ? <AssistantReplyLink key={service.id} href={href}>{service.label}<span aria-hidden="true"> →</span></AssistantReplyLink> : null;
          })}
        </nav>
      )}
    </div>
  );
}
