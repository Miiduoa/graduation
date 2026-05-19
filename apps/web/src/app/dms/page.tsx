/**
 * Web /dms — 私訊對話列表（DM 容器）
 *
 * 對應 mobile DmsScreen，schema 共用 demoStore.directThreads（id =
 * sortedUids.join('_')，與 conversationAccess.deriveDmConversationId 規則
 * 等價）。資料來源優先 demoStore，未來可加 Firestore conversations 即時訂閱。
 *
 * 角色守衛：guest / alumni 不能用私訊（與 messages/page.tsx DmTab 邏輯一致）。
 */
'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import { useDemoRole, getDemoRoleDefinition } from '@/lib/demoRole';
import {
  useDemoStore,
  listThreadsFor,
  countUnreadInThread,
  getOrCreateThread,
} from '@/lib/demoStore';
import { DEMO_USERS, getDemoUser, getDemoUserByUid } from '@/lib/demoData';
import { isConversationUnread } from '@/lib/conversationAccess';

function roleEmoji(role: string | undefined): string {
  switch (role) {
    case 'teacher': return '👨‍🏫';
    case 'ta': return '🧑‍💼';
    case 'club_officer': return '🎯';
    case 'department_head': return '🎓';
    case 'admin': return '🛡️';
    case 'alumni': return '🎓';
    case 'guest': return '👤';
    case 'student':
    default: return '👨‍🎓';
  }
}

function fmtRelative(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diff = Date.now() - t;
  if (diff < 60_000) return '剛剛';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分鐘前`;
  const d = new Date(t);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function DmsListPage(props: {
  searchParams?: { school?: string; schoolId?: string };
}) {
  const { schoolName } = resolveSchoolPageContext(props.searchParams);
  const [demoRole] = useDemoRole();
  const roleDef = getDemoRoleDefinition(demoRole);
  const store = useDemoStore();
  const [composeOpen, setComposeOpen] = useState(false);

  const selfUser = getDemoUser(demoRole);
  const selfUid = selfUser?.uid ?? '';

  const threads = useMemo(() => {
    if (!selfUid) return [];
    return listThreadsFor(selfUid, store);
  }, [selfUid, store]);

  const totalUnread = useMemo(() => {
    if (!selfUid) return 0;
    return threads.reduce((sum, t) => sum + countUnreadInThread(t, selfUid, store), 0);
  }, [threads, selfUid, store]);

  // 可開新對話的對象：所有 DEMO_USERS 排除自己 + 排除已有對話
  const existingPeers = new Set(
    threads.flatMap((t) => t.participantUids.filter((u) => u !== selfUid)),
  );
  const peersAvailable = DEMO_USERS.filter(
    (u) => u.uid !== selfUid && !existingPeers.has(u.uid),
  );

  // 角色守衛：guest / alumni 唯讀
  const dmDisabled = demoRole === 'guest' || demoRole === 'alumni';

  if (dmDisabled) {
    return (
      <SiteShell title="私訊" subtitle="私人對話" schoolName={schoolName}>
        <div
          style={{
            margin: '40px auto',
            maxWidth: 480,
            padding: 24,
            textAlign: 'center',
            background: 'rgba(142,142,147,0.10)',
            border: '1px solid #8E8E93',
            borderRadius: 12,
          }}
        >
          <div style={{ fontSize: 36, marginBottom: 10 }}>🎓</div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>
            {roleDef.label}身分僅可瀏覽
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            私訊功能限在校學生與教職員使用，{roleDef.label}帳號為唯讀身份。
          </div>
        </div>
      </SiteShell>
    );
  }

  return (
    <SiteShell
      title="私訊"
      subtitle={totalUnread > 0 ? `${totalUnread} 則未讀` : `${threads.length} 個對話`}
      schoolName={schoolName}
    >
      <div className="pageStack">
        {/* 動作列 */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            目前身分：<strong style={{ color: 'var(--text)' }}>{roleDef.label}</strong>
            （{selfUser?.displayName}）
          </div>
          <button
            type="button"
            onClick={() => setComposeOpen((v) => !v)}
            style={{
              padding: '8px 16px',
              borderRadius: 99,
              border: '1px solid var(--border)',
              background: composeOpen ? 'var(--brand)' : 'var(--panel)',
              color: composeOpen ? '#fff' : 'var(--brand)',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {composeOpen ? '取消' : '＋ 新對話'}
          </button>
        </div>

        {/* 新對話：可選對象列表 */}
        {composeOpen && (
          <div
            className="card"
            style={{
              padding: 16,
              marginBottom: 16,
              border: '1px dashed var(--brand)',
            }}
          >
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
              可開新對話的對象（已有對話會直接打開）：
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {DEMO_USERS.filter((u) => u.uid !== selfUid).map((u) => {
                const existing = existingPeers.has(u.uid);
                const thread = getOrCreateThread(selfUid, u.uid);
                return (
                  <Link
                    key={u.uid}
                    href={`/dms/${thread.id}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 12px',
                      borderRadius: 8,
                      background: 'var(--panel)',
                      border: '1px solid var(--border)',
                      textDecoration: 'none',
                      color: 'var(--text)',
                    }}
                  >
                    <div style={{ fontSize: 20 }}>{roleEmoji(u.role)}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{u.displayName}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                        {u.role}
                      </div>
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: existing ? 'var(--muted)' : 'var(--brand)',
                      }}
                    >
                      {existing ? '已有對話' : '開啟對話 →'}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* 對話列表 */}
        {threads.length === 0 ? (
          <div
            className="card"
            style={{
              padding: 40,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 36, marginBottom: 8 }}>💬</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>還沒有任何對話</div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              按右上「＋ 新對話」開始第一次對話
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {threads.map((t) => {
              const peerUid = t.participantUids.find((u) => u !== selfUid);
              const peer = peerUid ? getDemoUserByUid(peerUid) : undefined;
              const unread = countUnreadInThread(t, selfUid, store);
              const isUnread = isConversationUnread({
                uid: selfUid,
                lastMessageAt: t.lastSentAt,
                lastReadAt: t.readAt[selfUid],
                // demoStore 沒記 lastMessageSenderId，這邊以 unread > 0 為主
                lastMessageSenderId: null,
              }) && unread > 0;
              return (
                <Link
                  key={t.id}
                  href={`/dms/${t.id}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: 14,
                    borderRadius: 10,
                    background: 'var(--panel)',
                    border: `1px solid ${isUnread ? 'var(--brand)' : 'var(--border)'}`,
                    textDecoration: 'none',
                    color: 'var(--text)',
                  } as CSSProperties}
                >
                  <div style={{ fontSize: 24 }}>{roleEmoji(peer?.role)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: isUnread ? 700 : 600,
                        marginBottom: 2,
                      }}
                    >
                      {peer?.displayName ?? peerUid ?? '未知對象'}
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        color: isUnread ? 'var(--text)' : 'var(--muted)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {t.lastMessagePreview || '（尚未有訊息）'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                      {fmtRelative(t.lastSentAt)}
                    </div>
                    {unread > 0 && (
                      <div
                        style={{
                          minWidth: 18,
                          height: 18,
                          padding: '0 6px',
                          borderRadius: 9,
                          background: 'var(--brand)',
                          color: '#fff',
                          fontSize: 11,
                          fontWeight: 700,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {unread}
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        <div
          style={{
            marginTop: 24,
            padding: 12,
            borderRadius: 8,
            background: 'rgba(0,0,0,0.03)',
            fontSize: 11,
            color: 'var(--muted)',
            textAlign: 'center',
          }}
        >
          私訊功能與 mobile 共用 demoStore.directThreads schema · 切換右上角色可以看不同身分的對話
        </div>
      </div>
    </SiteShell>
  );
}
