/**
 * Web /dms/[conversationId] — 私訊對話內容
 *
 * 對應 mobile ChatScreen。
 *
 * 路由 conversationId = sortedUids.join('_')（與
 * conversationAccess.deriveDmConversationId 同規則）。
 *
 * 規則：
 *   1. 解析 conversationId 兩端 uid。
 *   2. 用 isConversationMember 檢查：自己必須是其中一方，否則 403。
 *   3. 列出該 thread 的所有訊息（時間正序）。
 *   4. compose 區送出 → sendDirectMessage。
 *   5. 進頁後立即 markThreadRead 清未讀。
 *
 * 角色守衛：guest / alumni 唯讀（同 /dms list 頁）。
 */
'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import { useDemoRole, getDemoRoleDefinition } from '@/lib/demoRole';
import {
  useDemoStore,
  listMessagesInThread,
  sendDirectMessage,
  markThreadRead,
  type StoreDirectMessage,
} from '@/lib/demoStore';
import { getDemoUser, getDemoUserByUid } from '@/lib/demoData';
import { isConversationMember } from '@/lib/conversationAccess';

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

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

/**
 * 從 conversationId 拆出兩個 uid。
 * 因為 demoStore 的 thread id = sortedUids.join('__')（雙底線分隔，避免與 uid 中的
 * 單底線或 '-' 衝突），而 conversationAccess.deriveDmConversationId 是
 * `dm_{schoolId}_{a}_{b}`，兩種 id 格式都得認。
 */
function parseConvoId(convoId: string): [string, string] | null {
  // dm_<schoolId>_<a>_<b>（Firestore 格式）
  if (convoId.startsWith('dm_')) {
    const parts = convoId.split('_');
    if (parts.length < 4) return null;
    // school id 可能含 '-'（如 tw-pu）；最後兩段是 uid
    const a = parts[parts.length - 2];
    const b = parts[parts.length - 1];
    if (!a || !b) return null;
    return [a, b];
  }
  // demoStore 格式：<a>__<b>（雙底線，buildThreadId 產生）
  // uid 格式如 stu-001、demo-teacher-1，其中包含 '-' 和數字但不含 '__'
  if (convoId.includes('__')) {
    const parts = convoId.split('__');
    if (parts.length === 2 && parts[0] && parts[1]) {
      return [parts[0], parts[1]];
    }
    return null;
  }
  // 相容舊格式：純 <a>_<b>（uid 不含 '_' 時才有意義）
  const parts = convoId.split('_');
  if (parts.length !== 2) return null;
  return [parts[0], parts[1]];
}

export default function DmChatPage(props: {
  params: { conversationId: string };
  searchParams?: { school?: string; schoolId?: string };
}) {
  const { schoolName } = resolveSchoolPageContext(props.searchParams);
  const [demoRole] = useDemoRole();
  const roleDef = getDemoRoleDefinition(demoRole);
  const store = useDemoStore();
  const [composeText, setComposeText] = useState('');
  const composeRef = useRef<HTMLTextAreaElement>(null);
  const listEndRef = useRef<HTMLDivElement>(null);

  const selfUser = getDemoUser(demoRole);
  const selfUid = selfUser?.uid ?? '';
  const convoId = props.params.conversationId;

  const memberPair = useMemo(() => parseConvoId(convoId), [convoId]);
  const memberIds = memberPair ?? [];
  const peerUid = memberPair?.find((u) => u !== selfUid);
  const peer = peerUid ? getDemoUserByUid(peerUid) : undefined;

  const isMember = isConversationMember(selfUid, memberIds);
  const dmDisabled = demoRole === 'guest' || demoRole === 'alumni';

  const messages = useMemo(
    () => listMessagesInThread(convoId, store),
    [convoId, store],
  );

  // 進頁 + 收到新訊息時：scroll 到底
  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  // 進頁 markThreadRead 清未讀
  useEffect(() => {
    if (isMember && selfUid) {
      markThreadRead(convoId, selfUid);
    }
  }, [convoId, selfUid, isMember]);

  function handleSend() {
    if (!composeText.trim() || !peerUid || !selfUid) return;
    sendDirectMessage({
      fromUid: selfUid,
      toUid: peerUid,
      body: composeText,
    });
    setComposeText('');
    composeRef.current?.focus();
  }

  // 角色守衛：guest / alumni
  if (dmDisabled) {
    return (
      <SiteShell title="私訊" subtitle="唯讀身份" schoolName={schoolName}>
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
          <Link href="/dms" style={{ fontSize: 13, color: 'var(--brand)' }}>
            ← 回對話列表
          </Link>
        </div>
      </SiteShell>
    );
  }

  // 非成員：403 守衛
  if (!isMember) {
    return (
      <SiteShell title="私訊" subtitle="無權限" schoolName={schoolName}>
        <div
          style={{
            margin: '40px auto',
            maxWidth: 480,
            padding: 24,
            textAlign: 'center',
            background: 'rgba(255,59,48,0.08)',
            border: '1px solid rgba(255,59,48,0.30)',
            borderRadius: 12,
          }}
        >
          <div style={{ fontSize: 36, marginBottom: 10 }}>🔒</div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>
            這場對話不是你的
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
            目前身分（{roleDef.label}）不是這場對話的成員，無法開啟。
          </div>
          <Link href="/dms" style={{ fontSize: 13, color: 'var(--brand)' }}>
            ← 回對話列表
          </Link>
        </div>
      </SiteShell>
    );
  }

  return (
    <SiteShell
      title={peer?.displayName ?? peerUid ?? '對話'}
      subtitle={peer ? `${peer.role}` : '私訊'}
      schoolName={schoolName}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: 'calc(100vh - 220px)',
          minHeight: 480,
          gap: 12,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 12px',
            background: 'var(--panel)',
            borderRadius: 8,
            border: '1px solid var(--border)',
          }}
        >
          <Link href="/dms" style={{ fontSize: 14, color: 'var(--brand)', textDecoration: 'none' }}>
            ← 回對話列表
          </Link>
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 24 }}>{roleEmoji(peer?.role)}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>
              {peer?.displayName ?? peerUid}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
              {peer?.email ?? peerUid}
            </div>
          </div>
        </div>

        {/* 訊息列 */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: 12,
            background: 'rgba(0,0,0,0.02)',
            borderRadius: 8,
            border: '1px solid var(--border)',
          }}
        >
          {messages.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)' }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>💬</div>
              <div style={{ fontSize: 13 }}>還沒有訊息</div>
              <div style={{ fontSize: 11, marginTop: 4 }}>
                說聲嗨，開始與 {peer?.displayName ?? peerUid} 的對話
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {messages.map((m: StoreDirectMessage) => {
                const mine = m.fromUid === selfUid;
                return (
                  <div
                    key={m.id}
                    style={{
                      display: 'flex',
                      flexDirection: mine ? 'row-reverse' : 'row',
                      alignItems: 'flex-end',
                      gap: 8,
                    } as CSSProperties}
                  >
                    <div style={{ fontSize: 20 }}>
                      {mine ? roleEmoji(selfUser?.role) : roleEmoji(peer?.role)}
                    </div>
                    <div
                      style={{
                        maxWidth: '70%',
                        padding: '10px 14px',
                        borderRadius: 14,
                        background: mine ? 'var(--brand)' : 'var(--panel)',
                        color: mine ? '#fff' : 'var(--text)',
                        border: mine ? 'none' : '1px solid var(--border)',
                      }}
                    >
                      <div style={{ fontSize: 14, lineHeight: 1.4 }}>{m.body}</div>
                      <div
                        style={{
                          fontSize: 10,
                          marginTop: 4,
                          opacity: 0.7,
                          textAlign: mine ? 'right' : 'left',
                        }}
                      >
                        {fmtTime(m.sentAt)}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={listEndRef} />
            </div>
          )}
        </div>

        {/* compose */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            padding: 8,
            background: 'var(--panel)',
            borderRadius: 8,
            border: '1px solid var(--border)',
          }}
        >
          <textarea
            ref={composeRef}
            value={composeText}
            onChange={(e) => setComposeText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                handleSend();
              }
            }}
            rows={2}
            placeholder={`傳訊息給 ${peer?.displayName ?? peerUid}…（⌘/Ctrl + Enter 送出）`}
            style={{
              flex: 1,
              padding: 10,
              border: '1px solid var(--border)',
              borderRadius: 6,
              resize: 'none',
              fontFamily: 'inherit',
              fontSize: 14,
              background: 'var(--bg)',
              color: 'var(--text)',
            }}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!composeText.trim()}
            style={{
              padding: '0 20px',
              borderRadius: 6,
              border: 'none',
              background: composeText.trim() ? 'var(--brand)' : 'var(--muted)',
              color: '#fff',
              fontWeight: 700,
              cursor: composeText.trim() ? 'pointer' : 'not-allowed',
              opacity: composeText.trim() ? 1 : 0.5,
            }}
          >
            送出
          </button>
        </div>
      </div>
    </SiteShell>
  );
}
