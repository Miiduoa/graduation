'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { getAssistantRoleProfile } from '@campus/shared/src/assistantRoleProfiles';
import { assistantWorkContextForTaskProfile } from '@campus/shared/src/assistantRoleWorkflows';
import { useCampusBrowseContext } from '@/lib/useCampusBrowseContext';
import { acceptsAssistantWorkspaceRoute, useOptionalAssistantWorkspace } from './AssistantWorkspaceContext';
import { SiteShell } from './SiteShell';
import { SchoolSelector } from './SchoolSelector';
import { useOptionalSelectedSchool } from './SelectedSchoolProvider';
import styles from '@/app/home.module.css';

/** Direct links and new tabs enter the same workspace as the home and header.
 * Course-specific legacy links retain their explicitly scoped reader. */
export function AssistantWorkspacePage({ children }: { children: ReactNode }) {
  const workspace = useOptionalAssistantWorkspace();
  const search = useSearchParams();
  const campus = useCampusBrowseContext({ schoolId: search?.get('schoolId') ?? undefined,
    campus: search?.get('campus') ?? undefined, school: search?.get('school') ?? undefined });
  const selection = useOptionalSelectedSchool();
  const query = search?.toString() ?? '';
  const scopedCourse = !acceptsAssistantWorkspaceRoute(search);
  const prompt = (search?.get('q') ?? '').slice(0, 1000);
  // Selecting a school can rewrite its URL aliases. That is the same question,
  // not permission to replay a previous account's entry under a new owner.
  const entryKey = JSON.stringify([prompt, search?.get('taskProfile') ?? '',
    search?.get('courseId') ?? '', search?.get('groupId') ?? '']);
  const identity = workspace?.identityKey ?? null;
  const [seed, setSeed] = useState({ entryKey, identity, consumed: false, invalidated: false });
  // Record an already observed owner even while readiness is paused. Only a
  // completely unknown initial identity may bind after hydration finishes.
  if (seed.entryKey !== entryKey) setSeed({ entryKey, identity, consumed: false, invalidated: false });
  else if (seed.identity === null && identity !== null && !seed.invalidated) setSeed({ ...seed, identity });
  else if (seed.identity !== null && identity !== null && seed.identity !== identity && !seed.invalidated)
    setSeed({ ...seed, invalidated: true });
  const sameIdentity = seed.identity === null || seed.identity === identity;
  useEffect(() => {
    if (!workspace || scopedCourse || seed.entryKey !== entryKey) return;
    if (workspace.paused || seed.identity === null || seed.identity !== identity || seed.consumed || seed.invalidated) return;
    if (campus.status !== 'ready' || !campus.schoolId) return;
    const params = new URLSearchParams(query);
    const profile = getAssistantRoleProfile(params.get('taskProfile'));
    if (prompt) {
      if (workspace.requestEntry({ prompt, schoolId: campus.schoolId,
        ...(profile ? { workContext: assistantWorkContextForTaskProfile(profile.id) } : {}) }))
        setSeed({ ...seed, consumed: true });
    } else { workspace.openWorkspace(); setSeed({ ...seed, consumed: true }); }
  }, [workspace, identity, query, entryKey, prompt, scopedCourse, campus.schoolId, campus.status, seed]);

  if (!workspace || scopedCourse) return children;
  return (
    <SiteShell title="助理" subtitle="接續目前的對話，查資料或安排下一步。">
      {prompt && sameIdentity && !seed.consumed && !seed.invalidated && campus.status !== 'ready' && (
        <section aria-label="保留的助理問題">
          <label htmlFor="workspace-entry-question">保留的問題</label>
          <textarea id="workspace-entry-question" readOnly value={prompt} rows={3}
            aria-describedby="workspace-entry-help" style={{ width: '100%', maxWidth: '40rem' }} />
          <p id="workspace-entry-help">問題尚未送出。確認校園後會帶入助理，再由你決定送出。</p>
          {campus.status === 'unselected' && <SchoolSelector />}
          {campus.status === 'error' && <p role="alert">目前無法確認校園，問題已保留。</p>}
          {campus.status === 'error' && selection?.onRetryCatalog && (
            <button type="button" className={styles.secondary} onClick={() => void selection.onRetryCatalog?.()}>重新讀取校園</button>
          )}
        </section>
      )}
      <p>目前對話會在這個分頁接續。開啟服務後，也可以隨時回來。</p>
      <button type="button" className={styles.primary} disabled={workspace.paused}
        data-assistant-workspace-trigger aria-controls="campus-assistant-workspace"
        aria-expanded={workspace.open} onClick={() => workspace.openWorkspace()}>
        {workspace.paused ? '正在確認登入與校園…' : '開啟目前任務'}
      </button>
    </SiteShell>
  );
}
