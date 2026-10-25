'use client';

import { useEffect, useRef, useState } from 'react';
import type { NuniAssignment, NuniWorkspace } from '@campus/shared/src/nuni';
import { formatTaipeiDateTime } from '@campus/shared/src/taipeiTime';
import {
  COURSE_WORK_MISSING_ASSIGNMENT,
  courseWorkElementId,
  landOnCourseWork,
  parseCourseWorkHash,
} from '@/lib/courseWorkLanding';
import { useLocationHash } from '@/lib/useLocationHash';
import { AssignmentCard } from './AssignmentCard';
import { assignmentStatus, matchesAssignmentFilter, type AssignmentFilter } from './courseTasks';
import { gradeReadOwner, markPublishedGradeReadByLanding } from '@/lib/lmsStudentGrades';
import { useNuniSession } from './Session';
import styles from './NuniApp.module.css';
import workspaceStyles from './CourseWorkspace.module.css';
import { matchesAssignmentSearch, prioritizeCourseAssignments } from './courseAssignmentDiscovery';

type Props = {
  assignments: NuniAssignment[];
  workspace: NuniWorkspace;
  reload: () => void;
  onConfirmed: (assignment: NuniAssignment) => void;
};

export function CourseAssignments({ assignments, workspace, reload, onConfirmed }: Props) {
  const [filter, setFilter] = useState<AssignmentFilter>('all');
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const hash = useLocationHash();
  const revealed = useRef('');
  const { session } = useNuniSession();
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
  const ordered = prioritizeCourseAssignments(assignments, workspace);
  const visible = (item: NuniAssignment) =>
    matchesAssignmentFilter(item, workspace, filter) && matchesAssignmentSearch(item, query);
  const shown = ordered.filter(visible);

  useEffect(() => {
    const revealLinkedAssignment = () => {
      if (window.location.hash.startsWith('#assignment-')) {
        setFilter('all');
        setQuery('');
      }
    };
    window.addEventListener('hashchange', revealLinkedAssignment);
    window.addEventListener('popstate', revealLinkedAssignment);
    return () => {
      window.removeEventListener('hashchange', revealLinkedAssignment);
      window.removeEventListener('popstate', revealLinkedAssignment);
    };
  }, []);

  const linked = parseCourseWorkHash(hash);
  const missingLinked =
    linked?.kind === 'assignment' && !assignments.some((item) => item.id === linked.id);

  useEffect(() => {
    if (!linked || linked.kind !== 'assignment') {
      revealed.current = '';
      return;
    }
    const target = courseWorkElementId(linked.kind, linked.id);
    if (
      filter !== 'all' ||
      query.trim() ||
      revealed.current === target ||
      !assignments.some((item) => item.id === linked.id)
    )
      return;
    const frame = window.requestAnimationFrame(() => {
      if (!landOnCourseWork(target)) return;
      revealed.current = target;
      const current = assignments.find((entry) => entry.id === linked.id);
      if (session && current?.mySubmission?.reviewedAt) {
        markPublishedGradeReadByLanding(gradeReadOwner('nuni', session.platformAccountId), {
          source: 'nuni',
          courseId: workspace.id,
          kind: 'assignment',
          id: current.id,
          publishedAt: current.mySubmission.reviewedAt,
        });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [assignments, filter, query, linked?.id, linked?.kind, session, workspace.id]);

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
        {assignments.length > 0 && (
          <div className={workspaceStyles.discovery}>
            <label className={workspaceStyles.search} htmlFor="course-assignment-search">
              <span>搜尋作業</span>
              <input
                ref={searchRef}
                id="course-assignment-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && query) {
                    event.preventDefault();
                    setQuery('');
                  }
                }}
                placeholder="作業名稱、說明或章節"
              />
            </label>
            {query && (
              <button
                type="button"
                className={`${styles.button} ${styles.secondary}`}
                onClick={() => {
                  setQuery('');
                  searchRef.current?.focus();
                }}
              >
                清除搜尋
              </button>
            )}
          </div>
        )}
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
        {query.trim() && (
          <p className={workspaceStyles.searchCount} aria-live="polite">
            找到 {shown.length} 份作業
          </p>
        )}
        {shown.length > 0 && (
          <nav aria-label="跳到作業" className={workspaceStyles.activityIndex}>
            {shown.map((item) => (
              <a key={item.id} href={`#assignment-${item.id}`}>
                <span className={workspaceStyles.activityTitle}>
                  <strong>{item.title}</strong>
                  <small>{item.unitTitle || '未分章節'}</small>
                </span>
                <span className={workspaceStyles.activityMeta}>
                  <span
                    className={workspaceStyles.activityState}
                    data-pending={student && matchesAssignmentFilter(item, workspace, 'pending')}
                  >
                    {assignmentStatus(item, workspace)}
                  </span>
                  <small>
                    {item.dueAt ? (
                      <>
                        參考{' '}
                        <time dateTime={item.dueAt}>
                          {formatTaipeiDateTime(item.dueAt, { seconds: false })}
                        </time>
                      </>
                    ) : (
                      '未設定參考期限'
                    )}
                  </small>
                </span>
                <span aria-hidden className={workspaceStyles.activityArrow}>
                  ↗
                </span>
              </a>
            ))}
          </nav>
        )}
        {missingLinked ? (
          <p role="status" className={styles.notice}>
            {COURSE_WORK_MISSING_ASSIGNMENT}
          </p>
        ) : null}
        {!shown.length && (
          <p role="status" className={styles.note}>
            {!assignments.length
              ? student
                ? '老師尚未發布作業。可以先查看教材，或稍後更新內容。'
                : '尚未發布作業。從「發布作業」開始，填寫學生需要完成的內容。'
              : query.trim()
                ? '沒有符合的作業。試試其他關鍵字，或清除搜尋。'
                : '這個分類目前沒有作業。選擇「全部」可查看其他內容。'}
          </p>
        )}
      </div>
      {ordered.map((item) => (
        // Keep each form mounted so switching filters cannot discard a student's draft.
        <div key={item.id} hidden={!visible(item)}>
          <AssignmentCard
            item={item}
            workspace={workspace}
            reload={reload}
            onConfirmed={(assignment) => {
              if (student && assignment.mySubmission && filter === 'pending')
                setFilter('submitted');
              onConfirmed(assignment);
            }}
          />
        </div>
      ))}
    </section>
  );
}
