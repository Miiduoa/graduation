/**
 * useProactiveAIAgentLoop — 啟動主動式 AI Agent 後台掃描
 *
 * 這個 hook 把 proactiveAIAgent.ts 的「每 15 分鐘掃描」綁到 user lifecycle：
 *  - 登入後啟動
 *  - 登出 / unmount 時清掉 interval
 *  - 切角色時 reset 並重啟（避免 student loop 跑 vendor 邏輯）
 *
 * UI 端可在 AIAgentObservatoryScreen 看到最新一輪結果。
 */
import { useEffect } from 'react';

import { useAuth } from '../state/auth';
import { startProactiveBackgroundLoop, type ProactiveScanInput } from '../services/proactiveAIAgent';

function resolveAgentRole(profile: ReturnType<typeof useAuth>['profile'], uid: string): ProactiveScanInput['role'] {
  if (!profile) return 'student';
  // demo uid prefix 優先
  if (uid.startsWith('demo_teacher')) return 'teacher';
  if (uid.startsWith('demo_admin')) return 'department';
  if (uid.startsWith('demo_cafeteria') || uid.startsWith('demo_vendor')) return 'vendor';
  if (uid.startsWith('demo_ta')) return 'ta';
  // 再看 role
  switch (profile.role) {
    case 'teacher': return 'teacher';
    case 'admin': return 'department';
    case 'staff':
      return uid.startsWith('demo_cafeteria') ? 'vendor' : 'ta';
    default:
      return 'student';
  }
}

export function useProactiveAIAgentLoop() {
  const auth = useAuth();
  const uid = auth.user?.uid ?? null;
  const role = auth.profile?.role;
  const schoolId = auth.profile?.schoolId ?? null;

  useEffect(() => {
    if (!uid) return;
    const agentRole = resolveAgentRole(auth.profile, uid);
    const stop = startProactiveBackgroundLoop({
      uid,
      role: agentRole,
      schoolId,
      // demo 階段每 5 分鐘掃一次（正式版可 15）
      intervalMinutes: 5,
      onSuggestion: (s) => {
        // 留 hook 給未來 push notification；目前 demo 只在 AIAgentObservatory 顯示
        // eslint-disable-next-line no-console
        console.log('[proactiveAIAgent] new suggestion:', s.id, s.title);
      },
    });
    return () => {
      try { stop(); } catch { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, role, schoolId]);
}
