'use client';

import Link from 'next/link';
import { useId } from 'react';
import { assistantServiceHref } from '@campus/shared/src/assistantServices';
import {
  ASSISTANT_ROLE_WORKFLOWS,
  getAssistantRoleWorkflow,
  type AssistantWorkContext,
} from '@campus/shared/src/assistantRoleWorkflows';
import styles from './AssistantRoleTasks.module.css';

/** Changes recommendations only; the caller keeps the current conversation,
 * draft, action journal and unresolved confirmation cards. */
export function AssistantRoleTasks({ context, onContext, schoolId, compact = false }: {
  context: AssistantWorkContext;
  onContext: (context: AssistantWorkContext) => void;
  schoolId: string;
  compact?: boolean;
}) {
  const fieldId = useId();
  const workflow = getAssistantRoleWorkflow(context);
  return (
    <div className={compact ? styles.compact : styles.panel}>
      <div className={styles.choice}>
        <label htmlFor={fieldId}>目前處理的工作</label>
        <select id={fieldId} value={workflow.id}
          onChange={event => onContext(getAssistantRoleWorkflow(event.target.value).id)}>
          {ASSISTANT_ROLE_WORKFLOWS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </div>
      {!compact && <p className={styles.purpose}>{workflow.purpose}</p>}
      {workflow.services.length > 0 && (
        <nav className={styles.links} aria-label={`${workflow.label}工作入口`}>
          {workflow.services.map(service => {
            const href = assistantServiceHref(service.id, schoolId, 'platform');
            return href ? <Link key={service.id} href={href}>{service.label}<span aria-hidden="true"> →</span></Link> : null;
          })}
        </nav>
      )}
    </div>
  );
}
