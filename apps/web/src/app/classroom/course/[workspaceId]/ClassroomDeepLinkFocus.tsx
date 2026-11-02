'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  CLASSROOM_ASSIGNMENT_LOADING,
  CLASSROOM_ASSIGNMENT_MISSING,
  classroomAssignmentHash,
  classroomAssignmentsPanelReady,
  ensureTeacherSubmissionLinks,
  openClassroomSubmissionButton,
  parseClassroomDeepLink,
} from '../../classroomDeepLink';

type FocusStatus = 'idle' | 'loading' | 'missing';

/**
 * 讀取通知／老師入口留下的 assignmentId、submissions 參數：
 * - 同步 hash 讓既有作業卡捲動展開
 * - 老師畫面在「查看／更新繳交內容」旁掛直達繳交列表連結（不改角色判斷）
 * - submissions=1 時等作業卡掛載後再自動點開既有繳交列表
 * - 作業資料仍在載入時顯示載入中；載入完成後找不到才提示
 */
export function ClassroomDeepLinkFocus() {
  const params = useParams<{ workspaceId?: string }>();
  const workspaceId =
    typeof params?.workspaceId === 'string' ? params.workspaceId : '';
  const [status, setStatus] = useState<FocusStatus>('idle');
  const opened = useRef('');
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const apply = () => {
      const { assignmentId, openSubmissions } = parseClassroomDeepLink(window.location.search);
      if (workspaceId) {
        ensureTeacherSubmissionLinks(document, workspaceId, window.location.search);
      }
      if (!assignmentId) {
        setStatus('idle');
        return;
      }
      const expectedHash = classroomAssignmentHash(assignmentId);
      if (window.location.hash !== expectedHash) {
        const url = new URL(window.location.href);
        url.hash = expectedHash.slice(1);
        window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      }
      const card = document.getElementById(`assignment-${assignmentId}`);
      if (card) {
        setStatus('idle');
        if (openSubmissions && opened.current !== assignmentId) {
          if (openClassroomSubmissionButton(document, assignmentId)) {
            opened.current = assignmentId;
          }
        }
        return;
      }
      if (classroomAssignmentsPanelReady(document)) {
        setStatus('missing');
        return;
      }
      setStatus('loading');
    };

    const scheduleApply = () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        debounceTimer.current = null;
        apply();
      }, 50);
    };

    apply();
    const panel = document.getElementById('panel-assignments');
    const observer = new MutationObserver(scheduleApply);
    observer.observe(panel ?? document.body, { childList: true, subtree: true });
    window.addEventListener('popstate', scheduleApply);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      observer.disconnect();
      window.removeEventListener('popstate', scheduleApply);
    };
  }, [workspaceId]);

  if (status === 'idle') return null;
  if (status === 'loading') {
    return (
      <p role="status" style={{ margin: '12px 16px', color: 'var(--muted)' }}>
        {CLASSROOM_ASSIGNMENT_LOADING}
      </p>
    );
  }
  return (
    <p role="status" style={{ margin: '12px 16px', color: 'var(--muted)' }}>
      {CLASSROOM_ASSIGNMENT_MISSING}
    </p>
  );
}
