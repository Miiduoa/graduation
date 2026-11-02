'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  CLASSROOM_ASSIGNMENT_MISSING,
  classroomAssignmentHash,
  ensureTeacherSubmissionLinks,
  openClassroomSubmissionButton,
  parseClassroomDeepLink,
} from '../../classroomDeepLink';

/**
 * 讀取通知／老師入口留下的 assignmentId、submissions 參數：
 * - 同步 hash 讓既有作業卡捲動展開
 * - 老師畫面在「查看繳交內容」旁掛直達繳交列表連結（不改角色判斷）
 * - submissions=1 時自動點開既有繳交列表
 * - 找不到作業時給友善提示，不壞頁
 */
export function ClassroomDeepLinkFocus() {
  const params = useParams<{ workspaceId?: string }>();
  const workspaceId =
    typeof params?.workspaceId === 'string' ? params.workspaceId : '';
  const [missing, setMissing] = useState(false);
  const opened = useRef('');

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const apply = () => {
      const { assignmentId, openSubmissions } = parseClassroomDeepLink(window.location.search);
      if (workspaceId) {
        ensureTeacherSubmissionLinks(document, workspaceId, window.location.search);
      }
      if (!assignmentId) {
        setMissing(false);
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
      if (!card) {
        setMissing(true);
        return;
      }
      setMissing(false);
      if (openSubmissions && opened.current !== assignmentId) {
        if (openClassroomSubmissionButton(document, assignmentId)) {
          opened.current = assignmentId;
        }
      }
    };

    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('popstate', apply);
    return () => {
      observer.disconnect();
      window.removeEventListener('popstate', apply);
    };
  }, [workspaceId]);

  if (!missing) return null;
  return (
    <p role="status" style={{ margin: '12px 16px', color: 'var(--muted)' }}>
      {CLASSROOM_ASSIGNMENT_MISSING}
    </p>
  );
}
