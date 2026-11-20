'use client';

import { useEffect, useRef, useState } from 'react';
import type { NuniWorkspace } from '@campus/shared/src/nuni';
import { asRecords, platformFetch, type PlatformResponse } from '@/features/platform/platformFetch';
import { classroomAccessDenied, CLASSROOM_ACCESS_ERROR } from '@/features/platform/classroomAccess';
import { useActiveRequest } from '@/features/platform/useActiveRequest';
import { WorkspaceAffiliation, WorkspaceMembers } from '@/features/platform/WorkspaceExtras';
import styles from './NuniApp.module.css';

type Props = {
  workspace: NuniWorkspace;
  context: string;
  refreshVersion: number;
  beginRequest: () => () => void;
};

export function CourseMembers(props: Props) {
  if (props.workspace.memberRole === 'student') return null;
  return (
    <CourseMembersContent
      key={`${props.context}:${props.workspace.id}:${props.workspace.memberRole}:${props.workspace.state}`}
      {...props}
    />
  );
}

function CourseMembersContent({ workspace, context, refreshVersion, beginRequest }: Props) {
  const [members, setMembers] = useState<Record<string, unknown>[] | null>(null);
  const [affiliation, setAffiliation] = useState<Record<string, unknown> | null>(null);
  const [applications, setApplications] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState('');
  const [affiliationError, setAffiliationError] = useState('');
  const [affiliationLoading, setAffiliationLoading] = useState(true);
  const [epoch, setEpoch] = useState(0);
  const generation = useRef(0);
  const captureRequest = useActiveRequest();

  useEffect(() => {
    const current = captureRequest();
    const run = ++generation.current;
    let active = true;
    const onDenied = beginRequest();
    const isCurrent = () => active && current() && generation.current === run;
    const base = `class-workspaces/${workspace.id}`;
    setMembers(null);
    setAffiliation(null);
    setApplications([]);
    setError('');
    setAffiliationError('');
    setAffiliationLoading(true);
    const clearCourse = () => {
      ++generation.current;
      setMembers(null);
      setAffiliation(null);
      setApplications([]);
      setError(CLASSROOM_ACCESS_ERROR);
      onDenied();
    };
    const readAffiliation = async (resource: string): Promise<PlatformResponse> => {
      const result = await platformFetch(`${base}/${resource}`, 'GET', undefined, context);
      if (
        isCurrent() &&
        classroomAccessDenied(result) &&
        (result.status === 401 || result.status === 409)
      )
        clearCourse();
      return result;
    };

    void platformFetch(`${base}/members`, 'GET', undefined, context)
      .then((result) => {
        if (!isCurrent()) return;
        if (classroomAccessDenied(result)) {
          clearCourse();
          return;
        }
        if (!result.ok) throw new Error('目前讀不到課程名冊，請稍後再試。');
        setMembers(asRecords(result.body.members));
      })
      .catch((failure: unknown) => {
        if (isCurrent())
          setError(failure instanceof Error ? failure.message : '目前讀不到課程名冊，請稍後再試。');
      });

    void Promise.all([readAffiliation('affiliation'), readAffiliation('affiliation-applications')])
      .then(([affiliationResult, applicationsResult]) => {
        if (!isCurrent()) return;
        setAffiliationLoading(false);
        if (!affiliationResult.ok || !applicationsResult.ok) {
          setAffiliationError('目前讀不到課程掛靠資料，請稍後更新。');
          return;
        }
        const value = affiliationResult.body.affiliation;
        setAffiliation(
          value && typeof value === 'object' ? (value as Record<string, unknown>) : null,
        );
        setApplications(asRecords(applicationsResult.body.applications));
      })
      .catch(() => {
        if (isCurrent()) {
          setAffiliationLoading(false);
          setAffiliationError('目前讀不到課程掛靠資料，請稍後更新。');
        }
      });
    return () => {
      active = false;
    };
    // The keyed lifetime owns the account, course, and membership scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshVersion, epoch, captureRequest]);

  return (
    <div>
      <button
        className={`${styles.button} ${styles.secondary}`}
        onClick={() => setEpoch((value) => value + 1)}
      >
        更新名冊
      </button>
      {error ? (
        <p role="alert" className={styles.notice}>
          {error}
        </p>
      ) : members === null ? (
        <p role="status">正在讀取課程名冊…</p>
      ) : (
        <WorkspaceMembers members={members} />
      )}
      <details className={styles.panel}>
        <summary>課程掛靠</summary>
        {affiliationLoading ? (
          <p role="status">正在讀取課程掛靠資料…</p>
        ) : affiliationError ? (
          <p role="alert">{affiliationError}</p>
        ) : (
          <WorkspaceAffiliation
            workspaceId={workspace.id}
            canApply={workspace.memberRole === 'owner-teacher' && workspace.state === 'active'}
            affiliation={affiliation}
            applications={applications}
            context={context}
            beginRequest={beginRequest}
            onChanged={() => setEpoch((value) => value + 1)}
          />
        )}
      </details>
    </div>
  );
}
