'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  NuniError,
  nuniErrorMessage,
  type NuniAssignment,
  type NuniUnit,
  type NuniWorkspace,
} from '@campus/shared/src/nuni';
import { AppHeader } from '@/components/AppHeader';
import { SiteShell } from '@/components/SiteShell';
import { Button } from '@/components/ui/Button';
import { CourseAccessBoundary, useClasses } from '@/features/nuni/CourseUI';
import { CourseAssignments } from '@/features/nuni/CourseAssignments';
import { CourseLearningPath } from '@/features/nuni/CourseLearningPath';
import { CourseMaterials } from '@/features/nuni/CourseMaterials';
import { CourseQuizzes } from '@/features/nuni/CourseQuizzes';
import { courseRoleLabels } from '@/features/nuni/courseTasks';
import { useNuniSession } from '@/features/nuni/Session';
import nuni from '@/features/nuni/NuniApp.module.css';
import common from '@/app/servicePages.module.css';
import { ClassHonestyBanner } from './ClassHonestyBanner';
import { ClassroomSessions } from './ClassroomSessions';
import { accountReturnHref, JOIN_PATH, WORKSPACE_ID_PATTERN, workspacePath } from './constants';
import { asRecords, platformFetch } from './platformFetch';
import {
  parseMembers,
  WorkspaceAffiliation,
  WorkspaceInvite,
  WorkspaceMembers,
} from './WorkspaceExtras';
import styles from './Platform.module.css';
import { CLASSROOM_ACCESS_ERROR, classroomAccessDenied } from './classroomAccess';
import { useActiveRequest } from './useActiveRequest';

type Tab = 'session' | 'course' | 'members' | 'affiliation';

export function ClassWorkspace({ workspaceId }: { workspaceId: string }) {
  const valid = WORKSPACE_ID_PATTERN.test(workspaceId);
  const auth = useNuniSession();
  if (!valid) {
    return (
      <SiteShell header={<AppHeader />}>
        <section className={styles.panel}>
          <h1>找不到課班</h1>
          <p className={styles.muted}>可能邀請已失效，或你還沒有加入。</p>
          <Link className={nuni.button} href={JOIN_PATH}>
            回到加入課班
          </Link>
        </section>
      </SiteShell>
    );
  }

  if (auth.loading || auth.pendingLogout) {
    return (
      <SiteShell header={<AppHeader />}>
        <p role="status">正在確認課班帳號…</p>
      </SiteShell>
    );
  }

  if (!auth.session) {
    return (
      <SiteShell header={<AppHeader />}>
        <section className={`${common.stateCard} ${styles.panel}`}>
          <h1>請先登入</h1>
          <p>打開課班工作台需要已登入的平台帳號。</p>
          <Link className={nuni.button} href={accountReturnHref(workspacePath(workspaceId))}>
            前往登入
          </Link>
        </section>
      </SiteShell>
    );
  }

  return (
    <ClassWorkspaceContent
      key={`${auth.session.platformAccountId}:${auth.session.context}:${workspaceId}`}
      workspaceId={workspaceId}
      context={auth.session.context}
    />
  );
}

function ClassWorkspaceContent({ workspaceId, context }: { workspaceId: string; context: string }) {
  const classes = useClasses(beginCourseRequest);
  const params = useSearchParams();
  const invite = params.get('invite') || '';
  const [tab, setTab] = useState<Tab>('session');
  const [workspace, setWorkspace] = useState<NuniWorkspace | null>(null);
  const [assignments, setAssignments] = useState<NuniAssignment[]>([]);
  const [units, setUnits] = useState<NuniUnit[] | null>(null);
  const [members, setMembers] = useState<ReturnType<typeof parseMembers>>([]);
  const [affiliation, setAffiliation] = useState<Record<string, unknown> | null>(null);
  const [affiliationApps, setAffiliationApps] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [outlineVersion, setOutlineVersion] = useState(0);
  const generation = useRef(0);
  const captureRequest = useActiveRequest();

  function clearPrivateWorkspace() {
    setWorkspace(null);
    setAssignments([]);
    setUnits(null);
    setMembers([]);
    setAffiliation(null);
    setAffiliationApps([]);
  }

  function beginCourseRequest() {
    const started = generation.current;
    const isCurrent = captureRequest();
    return () => {
      if (!isCurrent() || generation.current !== started) return;
      ++generation.current;
      clearPrivateWorkspace();
      setError(CLASSROOM_ACCESS_ERROR);
    };
  }

  useEffect(() => {
    const isCurrent = captureRequest();
    let active = true;
    const run = ++generation.current;
    setError('');
    setMissing(false);
    const readExtra = async (resource: string, clear: () => void) => {
      const result = await platformFetch(
        `class-workspaces/${workspaceId}/${resource}`,
        'GET',
        undefined,
        context,
      );
      if (!active || !isCurrent() || generation.current !== run) return result;
      if (classroomAccessDenied(result)) {
        // A denied optional read is authoritative even if another parallel read
        // has not completed. Do not retain its old private projection meanwhile.
        clear();
        if (result.status === 401 || result.status === 409) {
          ++generation.current;
          clearPrivateWorkspace();
          setError(CLASSROOM_ACCESS_ERROR);
          if (result.status === 401)
            window.location.replace(accountReturnHref(workspacePath(workspaceId)));
        }
      }
      return result;
    };
    void Promise.all([
      classes.get(workspaceId),
      classes.assignments(workspaceId),
      classes.units(workspaceId).catch(() => [] as NuniUnit[]),
      readExtra('members', () => setMembers([])),
      readExtra('affiliation', () => setAffiliation(null)),
      readExtra('affiliation-applications', () => setAffiliationApps([])),
    ])
      .then(([item, nextAssignments, nextUnits, memberResult, affiliationResult, appsResult]) => {
        if (!active || !isCurrent() || generation.current !== run) return;
        setWorkspace(item);
        setAssignments(nextAssignments);
        setUnits(nextUnits);
        setMembers(memberResult.ok ? parseMembers(memberResult.body.members) : []);
        setAffiliation(
          affiliationResult.ok && affiliationResult.body.affiliation
            ? (affiliationResult.body.affiliation as Record<string, unknown>)
            : null,
        );
        setAffiliationApps(appsResult.ok ? asRecords(appsResult.body.applications) : []);
      })
      .catch((failure) => {
        if (!active || !isCurrent() || generation.current !== run) return;
        if (classroomAccessDenied(failure)) {
          clearPrivateWorkspace();
          setError(CLASSROOM_ACCESS_ERROR);
          if (failure instanceof NuniError && [403, 404].includes(failure.status)) setMissing(true);
          if (failure instanceof NuniError && failure.status === 401)
            window.location.replace(accountReturnHref(workspacePath(workspaceId)));
          return;
        }
        setError(nuniErrorMessage(failure) || '暫時打不開');
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, context, epoch, captureRequest]);

  if (missing) {
    return (
      <SiteShell header={<AppHeader />}>
        <section className={styles.panel}>
          <p className={styles.eyebrow}>課班工作區</p>
          <h1>找不到課班</h1>
          <p className={styles.muted}>可能邀請已失效，或你還沒有加入。</p>
          <Link className={nuni.button} href={JOIN_PATH}>
            回到加入課班
          </Link>
        </section>
      </SiteShell>
    );
  }

  if (error && !workspace) {
    return (
      <SiteShell header={<AppHeader />}>
        <section className={styles.panel}>
          <h1>暫時打不開</h1>
          <p role="alert">{error}</p>
          <Button onClick={() => setEpoch((value) => value + 1)}>重試</Button>
        </section>
      </SiteShell>
    );
  }

  if (!workspace) {
    return (
      <SiteShell header={<AppHeader />}>
        <p role="status">正在打開課班工作台…</p>
      </SiteShell>
    );
  }

  const teacher = workspace.memberRole !== 'student';
  const tabs: Array<[Tab, string]> = [
    ['session', '課堂簽到'],
    ['course', '課程內容'],
    ['members', '成員'],
    ['affiliation', '掛靠班次'],
  ];

  return (
    <SiteShell header={<AppHeader />}>
      <div className={styles.page}>
        <ClassHonestyBanner />
        <Link href="/classroom" className={nuni.muted}>
          ← 我的課程
        </Link>
        <header className={styles.heading}>
          <div>
            <p className={styles.eyebrow}>{courseRoleLabels[workspace.memberRole]}</p>
            <h1>{workspace.title}</h1>
            <p className={styles.muted}>課班工作台。課程內容、簽到、邀請與掛靠都在這一頁。</p>
          </div>
          <Button onClick={() => setEpoch((value) => value + 1)}>更新內容</Button>
        </header>
        <div className={styles.tabs} role="tablist" aria-label="課班工作台">
          {tabs.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === 'session' ? (
          <ClassroomSessions
            workspaceId={workspace.id}
            isTeacher={teacher}
            context={context}
            beginRequest={beginCourseRequest}
            refreshVersion={epoch}
            units={(units ?? []).map((unit) => ({ id: unit.id, title: unit.title }))}
          />
        ) : null}
        {tab === 'course' ? (
          <CourseAccessBoundary beginRequest={beginCourseRequest}>
            <div className={styles.stack}>
              <WorkspaceInvite
                workspaceId={workspace.id}
                canInvite={workspace.memberRole === 'owner-teacher' && workspace.state === 'active'}
                initialCode={invite}
                context={context}
                beginRequest={beginCourseRequest}
              />
              <CourseLearningPath
                workspace={workspace}
                assignments={assignments}
                units={units}
                unitsError=""
                refreshVersion={outlineVersion}
                reloadUnits={() => setEpoch((value) => value + 1)}
                onUnitCreated={(unit) =>
                  setUnits((current) =>
                    current ? [...current.filter((entry) => entry.id !== unit.id), unit] : [unit],
                  )
                }
                onNavigate={() => setTab('course')}
              />
              <CourseMaterials
                workspace={workspace}
                units={units}
                onChanged={() => setOutlineVersion((value) => value + 1)}
              />
              <CourseAssignments
                assignments={assignments}
                workspace={workspace}
                reload={() => setEpoch((value) => value + 1)}
                onConfirmed={(assignment) =>
                  setAssignments((current) =>
                    current.map((item) => (item.id === assignment.id ? assignment : item)),
                  )
                }
              />
              <CourseQuizzes
                workspace={workspace}
                units={units}
                onChanged={() => setOutlineVersion((value) => value + 1)}
              />
            </div>
          </CourseAccessBoundary>
        ) : null}
        {tab === 'members' ? <WorkspaceMembers members={members} /> : null}
        {tab === 'affiliation' ? (
          <WorkspaceAffiliation
            workspaceId={workspace.id}
            canApply={workspace.memberRole === 'owner-teacher' && workspace.state === 'active'}
            affiliation={affiliation}
            applications={affiliationApps}
            context={context}
            beginRequest={beginCourseRequest}
            onChanged={() => setEpoch((value) => value + 1)}
          />
        ) : null}
      </div>
    </SiteShell>
  );
}
