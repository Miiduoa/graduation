'use client';

import { useEffect, useRef, useState } from 'react';
import type { NuniAssignment, NuniWorkspace } from '@campus/shared/src/nuni';
import { AssignmentCard } from './AssignmentCard';
import { assignmentStatus, matchesAssignmentFilter, type AssignmentFilter } from './courseTasks';
import styles from './NuniApp.module.css';

type Props = {
  assignments: NuniAssignment[];
  workspace: NuniWorkspace;
  reload: () => void;
  onConfirmed: (assignment: NuniAssignment) => void;
};

export function CourseAssignments({ assignments, workspace, reload, onConfirmed }: Props) {
  const [filter, setFilter] = useState<AssignmentFilter>('all');
  const revealed = useRef('');
  const student = workspace.memberRole === 'student';
  const filters: [AssignmentFilter, string][] = student
    ? [
        ['all', '全部'],
        ['pending', '待繳交'],
        ['submitted', '已繳交'],
        ['feedback', '老師回饋'],
      ]
    : [
        ['all', '全部'],
        ['received', '已收到繳交'],
        ['open', '收件中'],
      ];
  const pending = assignments.filter((item) => matchesAssignmentFilter(item, workspace, 'pending'));
  const shown = assignments.filter((item) => matchesAssignmentFilter(item, workspace, filter));

  useEffect(() => {
    const revealLinkedAssignment = () => {
      if (window.location.hash.startsWith('#assignment-')) setFilter('all');
    };
    window.addEventListener('hashchange', revealLinkedAssignment);
    return () => window.removeEventListener('hashchange', revealLinkedAssignment);
  }, []);

  useEffect(() => {
    const target = window.location.hash.slice(1);
    if (
      filter !== 'all' ||
      revealed.current === target ||
      !assignments.some((item) => `assignment-${item.id}` === target)
    )
      return;
    const frame = window.requestAnimationFrame(() => {
      const element = document.getElementById(target);
      if (element) {
        element.scrollIntoView?.({ block: 'start' });
        revealed.current = target;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [assignments, filter]);

  return (
    <section aria-label="課程作業">
      <div className={styles.taskSummary}>
        <div>
          <h2>{student ? '我的作業' : '作業收件'}</h2>
          <p className={styles.muted}>
            {workspace.state !== 'active'
              ? '課程已封存，可以查看保留的內容與紀錄。'
              : student
                ? pending.length
                  ? `還有 ${pending.length} 份作業待繳交。送出後可在「已繳交」確認內容與老師回饋。`
                  : '目前沒有待繳交作業。已送出的內容與老師回饋都保留在這裡。'
                : '先選擇有繳交的作業，再查看學生內容並留下回饋。繳交份數不代表尚未批閱的份數。'}
          </p>
        </div>
        <div className={styles.filters} role="group" aria-label="篩選作業">
          {filters.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label}{' '}
              {assignments.filter((item) => matchesAssignmentFilter(item, workspace, value)).length}
            </button>
          ))}
        </div>
        {shown.length > 0 && (
          <nav aria-label="跳到作業" className={styles.assignmentIndex}>
            {shown.map((item) => (
              <a key={item.id} href={`#assignment-${item.id}`}>
                <span>{item.title}</span>
                <small>{assignmentStatus(item, workspace)}</small>
              </a>
            ))}
          </nav>
        )}
        {!shown.length && (
          <p role="status" className={styles.note}>
            {!assignments.length
              ? student
                ? '老師尚未發布作業。可以先查看教材，或稍後更新內容。'
                : '尚未發布作業。從「發布作業」開始，填寫學生需要完成的內容。'
              : '這個分類目前沒有作業。選擇「全部」可查看其他內容。'}
          </p>
        )}
      </div>
      {assignments.map((item) => (
        // Keep each form mounted so switching filters cannot discard a student's draft.
        <div key={item.id} hidden={!matchesAssignmentFilter(item, workspace, filter)}>
          <AssignmentCard
            item={item}
            workspace={workspace}
            reload={reload}
            onConfirmed={onConfirmed}
          />
        </div>
      ))}
    </section>
  );
}
