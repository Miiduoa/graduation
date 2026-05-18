'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { useToast } from '@/components/ui';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import { useDemoRole, getDemoRoleDefinition, getCapabilities } from '@/lib/demoRole';
import {
  getDemoCourseById,
  getDemoClubById,
  type DemoMessage,
} from '@/lib/demoData';
import {
  useDemoStore,
  getAllMessagesForRole,
  markDynamicMessageRead,
  type AnyMessage,
} from '@/lib/demoStore';

const TYPE_COLOR: Record<DemoMessage['type'], string> = {
  info: '#007AFF',
  warning: '#FF9500',
  action: '#FF3B30',
  success: '#34C759',
};

const TYPE_LABEL: Record<DemoMessage['type'], string> = {
  info: '通知',
  warning: '提醒',
  action: '待辦',
  success: '完成',
};

function formatSentAt(s: string) {
  return s;
}

export default function MessagesPage(props: {
  searchParams?: { school?: string; schoolId?: string };
}) {
  const { schoolName, schoolSearch: q } = resolveSchoolPageContext(props.searchParams);
  const [demoRole] = useDemoRole();
  const roleDef = getDemoRoleDefinition(demoRole);
  const caps = getCapabilities(demoRole);
  const { success, info } = useToast();
  const store = useDemoStore();

  // 讀取當前角色訊息：靜態 DEMO_MESSAGES + demoStore 動態訊息合併
  const messages = useMemo(
    () => getAllMessagesForRole(demoRole, store),
    [demoRole, store],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [replyText, setReplyText] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread' | 'action'>('all');

  // 角色切換時：selected 會自動 reset（messages 是 useMemo，
  // 新角色的 messages 裡找不到舊 selectedId，selected 就是 null）
  // readIds 跨角色不衝突（id 命名空間不同），不需額外重置

  const selected: AnyMessage | null = messages.find((m) => m.id === selectedId) ?? null;

  const filteredMessages = messages.filter((m) => {
    if (filter === 'unread') return !m.isRead && !readIds.has(m.id) && !store.readMessageIds.includes(m.id);
    if (filter === 'action') return m.type === 'action' || m.type === 'warning';
    return true;
  });

  const unreadCount = messages.filter(
    (m) => !m.isRead && !readIds.has(m.id) && !store.readMessageIds.includes(m.id),
  ).length;

  function handleSelect(msg: AnyMessage) {
    setSelectedId(msg.id);
    if (!msg.isRead && !readIds.has(msg.id)) {
      setReadIds((prev) => new Set([...prev, msg.id]));
      // 動態訊息：持久化已讀狀態到 localStorage，避免跨頁導航後重新顯示未讀
      if (msg._dynamic) markDynamicMessageRead(msg.id);
    }
  }

  function handleReply() {
    if (!replyText.trim() || !selected) return;
    success(`✅ 已回覆給 ${selected.fromName}`);
    setReplyText('');
  }

  // 訪客不能看訊息
  if (demoRole === 'guest') {
    return (
      <SiteShell title="訊息" schoolName={schoolName}>
        <div className="pageStack">
          <div
            className="card"
            style={{
              padding: '32px 24px',
              textAlign: 'center',
              background: 'rgba(0,122,255,0.06)',
              border: '1px solid #007AFF',
            }}
          >
            <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>請先登入</div>
            <div style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 20 }}>
              訪客身份無法查看個人訊息，請登入後使用。
            </div>
            <Link href={`/login${q}`} className="btn primary">
              前往登入 →
            </Link>
          </div>
        </div>
      </SiteShell>
    );
  }

  return (
    <SiteShell
      title="訊息"
      subtitle={`${roleDef.icon} ${roleDef.label} 收件匣 · ${unreadCount} 則未讀`}
      schoolName={schoolName}
    >
      <div className="pageStack">
        {/* ── AI 訊息整理入口 ── */}
        {unreadCount > 0 && (
          <div
            className="card"
            style={{
              padding: '12px 16px',
              background: 'linear-gradient(135deg, rgba(0,122,255,0.10) 0%, rgba(90,200,250,0.07) 100%)',
              border: '1px solid rgba(0,122,255,0.22)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 14,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ flex: 1, fontSize: 13, color: 'var(--text)' }}>
              🤖 <strong>AI 摘要</strong>：你有 <strong>{unreadCount} 則未讀訊息</strong>
              {messages.find((m) => !m.isRead && !readIds.has(m.id) && !store.readMessageIds.includes(m.id) && m.type === 'warning') && (
                <>
                  ，其中 1 則是重要提醒：「
                  {messages.find((m) => !m.isRead && !readIds.has(m.id) && !store.readMessageIds.includes(m.id) && m.type === 'warning')?.subject?.slice(0, 20)}
                  …」
                </>
              )}
            </div>
            <Link
              href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent('請幫我整理今日重要訊息，哪些需要我馬上處理？')}`}
              className="btn"
              style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              讓 AI 整理 →
            </Link>
          </div>
        )}

        {/* ── 篩選 tabs ── */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(
            [
              { key: 'all', label: `全部（${messages.length}）` },
              { key: 'unread', label: `未讀（${unreadCount}）` },
              { key: 'action', label: '待辦 / 提醒' },
            ] as const
          ).map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              style={{
                padding: '6px 14px',
                borderRadius: 99,
                border: '1px solid var(--border)',
                background: filter === f.key ? 'var(--brand)' : 'var(--panel)',
                color: filter === f.key ? '#fff' : 'var(--text)',
                fontSize: 13,
                cursor: 'pointer',
                fontWeight: filter === f.key ? 700 : 400,
                transition: 'all 0.15s',
              }}
            >
              {f.label}
            </button>
          ))}
          <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center' }}>
            {roleDef.icon} {roleDef.label} 身份
          </div>
        </div>

        {/* ── 主要內容：左側清單 + 右側詳情 ── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: selected ? 'minmax(0, 1fr) minmax(0, 1.4fr)' : '1fr',
            gap: 16,
            alignItems: 'start',
          }}
        >
          {/* 訊息列表 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {filteredMessages.length === 0 ? (
              <div
                className="card"
                style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--muted)' }}
              >
                <div style={{ fontSize: 36, marginBottom: 10 }}>📭</div>
                <div style={{ fontSize: 14 }}>
                  {filter === 'unread' ? '沒有未讀訊息' : '目前沒有訊息'}
                </div>
              </div>
            ) : (
              filteredMessages.map((msg) => {
                const isUnread = !msg.isRead && !readIds.has(msg.id) && !store.readMessageIds.includes(msg.id);
                const isSelected = selectedId === msg.id;
                return (
                  <div
                    key={msg.id}
                    onClick={() => handleSelect(msg)}
                    style={{
                      padding: '12px 16px',
                      borderRadius: 'var(--radius)',
                      border: `1px solid ${isSelected ? 'var(--brand)' : 'var(--border)'}`,
                      background: isSelected
                        ? 'rgba(0,122,255,0.08)'
                        : isUnread
                          ? 'var(--accent-soft, rgba(0,122,255,0.05))'
                          : 'var(--surface)',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                      display: 'flex',
                      gap: 12,
                      alignItems: 'flex-start',
                    }}
                  >
                    {/* 頭像 */}
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 12,
                        background: `${TYPE_COLOR[msg.type]}20`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 20,
                        flexShrink: 0,
                      }}
                    >
                      {msg.fromAvatar}
                    </div>

                    {/* 內容 */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                          marginBottom: 3,
                        }}
                      >
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: isUnread ? 700 : 500,
                            color: 'var(--text)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {msg.fromName}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: 'var(--muted)',
                            whiteSpace: 'nowrap',
                            flexShrink: 0,
                          }}
                        >
                          {formatSentAt(msg.sentAt)}
                        </div>
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: isUnread ? 700 : 500,
                          color: isUnread ? 'var(--text)' : 'var(--muted)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          marginBottom: 3,
                        }}
                      >
                        {isUnread && (
                          <span
                            style={{
                              display: 'inline-block',
                              width: 6,
                              height: 6,
                              borderRadius: '50%',
                              background: TYPE_COLOR[msg.type],
                              marginRight: 6,
                              verticalAlign: 'middle',
                            }}
                          />
                        )}
                        {msg.subject}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: 'var(--muted)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {msg.body.split('\n')[0]}
                      </div>
                    </div>

                    {/* 類型 badge */}
                    <div
                      style={{
                        padding: '2px 7px',
                        borderRadius: 99,
                        background: `${TYPE_COLOR[msg.type]}20`,
                        color: TYPE_COLOR[msg.type],
                        fontSize: 10,
                        fontWeight: 700,
                        flexShrink: 0,
                        alignSelf: 'center',
                      }}
                    >
                      {TYPE_LABEL[msg.type]}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* 訊息詳情（選中後顯示） */}
          {selected && (
            <div
              className="card"
              style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}
            >
              {/* 標題列 */}
              <div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 8,
                  }}
                >
                  <div
                    style={{
                      padding: '3px 9px',
                      borderRadius: 99,
                      background: `${TYPE_COLOR[selected.type]}20`,
                      color: TYPE_COLOR[selected.type],
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {TYPE_LABEL[selected.type]}
                  </div>
                  <button
                    onClick={() => setSelectedId(null)}
                    style={{
                      background: 'none',
                      border: 'none',
                      fontSize: 18,
                      cursor: 'pointer',
                      color: 'var(--muted)',
                      padding: '0 4px',
                    }}
                    title="關閉"
                  >
                    ✕
                  </button>
                </div>
                <h2 style={{ margin: '0 0 10px', fontSize: 16, fontWeight: 800, lineHeight: 1.4 }}>
                  {selected.subject}
                </h2>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    fontSize: 13,
                    color: 'var(--muted)',
                  }}
                >
                  <span style={{ fontSize: 20 }}>{selected.fromAvatar}</span>
                  <span>
                    <strong style={{ color: 'var(--text)' }}>{selected.fromName}</strong>
                    {' '}· {formatSentAt(selected.sentAt)}
                  </span>
                </div>
              </div>

              {/* 內文 */}
              <div
                style={{
                  fontSize: 14,
                  lineHeight: 1.8,
                  color: 'var(--text)',
                  whiteSpace: 'pre-wrap',
                  padding: '14px 16px',
                  background: 'var(--panel2)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                }}
              >
                {selected.body}
              </div>

              {/* 相關連結 */}
              {(selected.relatedCourseId || selected.relatedClubId || ('relatedAnnouncementId' in selected && selected.relatedAnnouncementId)) && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {selected.relatedCourseId && getDemoCourseById(selected.relatedCourseId) && (
                    <Link
                      href={`${(demoRole === 'teacher' || demoRole === 'ta' || demoRole === 'admin' || demoRole === 'department_head') ? '/teacher' : ''}/course/${selected.relatedCourseId}${q}`}
                      className="btn primary"
                      style={{ fontSize: 13 }}
                    >
                      📚 前往課程：{getDemoCourseById(selected.relatedCourseId)?.name} →
                    </Link>
                  )}
                  {selected.relatedClubId && getDemoClubById(selected.relatedClubId) && (
                    <Link
                      href={`/clubs${q}`}
                      className="btn"
                      style={{ fontSize: 13 }}
                    >
                      🎯 前往社團：{getDemoClubById(selected.relatedClubId)?.name} →
                    </Link>
                  )}
                  {'relatedAnnouncementId' in selected && selected.relatedAnnouncementId && (
                    <Link
                      href={
                        caps.canApproveAnnouncements
                          ? `/admin${q}`
                          : `/announcements/${selected.relatedAnnouncementId}${q}`
                      }
                      className="btn"
                      style={{ fontSize: 13 }}
                    >
                      {caps.canApproveAnnouncements
                        ? '📥 前往公告審核佇列 →'
                        : '📢 查看公告詳情 →'}
                    </Link>
                  )}
                </div>
              )}

              {/* 回覆區（guest 已在頁面頂部攔截，此處只需排除 alumni） */}
              {demoRole !== 'alumni' && (
                <div
                  style={{
                    borderTop: '1px solid var(--border)',
                    paddingTop: 14,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>
                      ↩ 回覆給 {selected.fromName}
                    </div>
                    <Link
                      href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent(`幫我回覆這則訊息：${selected.subject}`)}`}
                      className="btn"
                      style={{ fontSize: 12, padding: '4px 10px' }}
                    >
                      🤖 AI 起草
                    </Link>
                  </div>
                  <textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="輸入回覆內容..."
                    rows={3}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '10px 12px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border)',
                      background: 'var(--bg)',
                      color: 'var(--text)',
                      fontSize: 13,
                      resize: 'vertical',
                      lineHeight: 1.6,
                      fontFamily: 'inherit',
                      outline: 'none',
                    }}
                  />
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button
                      className="btn"
                      onClick={() => {
                        info('草稿已儲存');
                        setReplyText('');
                      }}
                      style={{ fontSize: 13 }}
                    >
                      儲存草稿
                    </button>
                    <button
                      className="btn primary"
                      onClick={handleReply}
                      disabled={!replyText.trim()}
                      style={{ fontSize: 13 }}
                    >
                      ✉️ 送出回覆
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 無訊息時的提示 */}
        {messages.length === 0 && (
          <div
            className="card"
            style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--muted)' }}
          >
            <div style={{ fontSize: 48, marginBottom: 12 }}>📬</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>收件匣是空的</div>
            <div style={{ fontSize: 14 }}>目前沒有任何訊息</div>
          </div>
        )}
      </div>
    </SiteShell>
  );
}
