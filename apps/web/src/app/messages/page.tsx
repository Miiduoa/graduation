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
  decideLeave,
  setDormRepairStatus,
  updateOrderStatus,
  replyHelpRequest,
  approveClubMember,
  rejectClubMember,
  sendMessage,
  notifyStudentsAnnApproved,
  rejectAnnouncementWithReason,
  type AnyMessage,
  type StoreDynamicMessage,
} from '@/lib/demoStore';
import { getDemoUser } from '@/lib/demoData';

const TYPE_COLOR: Record<DemoMessage['type'], string> = {
  info: '#5E6AD2',
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
    const me = getDemoUser(demoRole);
    const dyn = selected as StoreDynamicMessage & { _dynamic?: boolean };
    // 對動態訊息：真實送訊息回原寄件人；對靜態訊息：toast 模擬
    if (dyn._dynamic && dyn.senderRole) {
      sendMessage({
        fromName: me?.displayName ?? roleDef.label,
        fromAvatar: roleDef.icon,
        subject: `Re: ${selected.subject}`,
        body: replyText.trim(),
        sentAt: '剛剛',
        isRead: false,
        type: 'info',
        senderRole: demoRole,
        inReplyTo: selected.id,
        relatedCourseId: 'relatedCourseId' in dyn ? dyn.relatedCourseId : undefined,
        relatedClubId: 'relatedClubId' in dyn ? dyn.relatedClubId : undefined,
        recipientRoles: [dyn.senderRole],
      });
      success(`✅ 已回覆給 ${selected.fromName}`, '對方會在訊息收件匣看到');
    } else {
      info('回覆已送出（demo 範圍：靜態訊息僅模擬）');
    }
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
              background: 'linear-gradient(135deg, rgba(94,106,210,0.10) 0%, rgba(142,186,255,0.07) 100%)',
              border: '1px solid rgba(94,106,210,0.22)',
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
                        ? 'rgba(94,106,210,0.08)'
                        : isUnread
                          ? 'var(--accent-soft, rgba(94,106,210,0.05))'
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

              {/* ── 跨角色動作面板（依訊息附帶 id 顯示對應操作）── */}
              <CrossRoleActionPanel
                msg={selected}
                roleLabel={`${roleDef.icon} ${roleDef.label}`}
                demoRole={demoRole}
                onDone={(label) => {
                  success(label);
                  setSelectedId(null);
                }}
              />

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

// ─────────────────────────────────────────────────────────────
// 跨角色動作面板：根據訊息附帶的 id（leave / dormRepair / order / help）
// 顯示對應按鈕，直接寫回 demoStore 並通知對方角色
// ─────────────────────────────────────────────────────────────
function CrossRoleActionPanel({
  msg,
  roleLabel,
  demoRole,
  onDone,
}: {
  msg: AnyMessage;
  roleLabel: string;
  demoRole: string;
  onDone: (label: string) => void;
}) {
  const dyn = msg as StoreDynamicMessage & { _dynamic?: boolean };
  if (!dyn._dynamic) return null;

  // ── 請假申請：教師 / 系主任 才看得到核准按鈕 ──
  if (dyn.relatedLeaveId && (demoRole === 'teacher' || demoRole === 'department_head')) {
    return (
      <ActionPanel
        title="📅 請假審核"
        helper="點下按鈕後，學生會收到核准 / 退回通知，store 也會更新請假狀態"
        buttons={[
          {
            label: '✅ 核准請假',
            kind: 'primary',
            onClick: () => {
              decideLeave({ leaveId: dyn.relatedLeaveId!, decision: 'approved', decidedBy: roleLabel });
              onDone('已核准請假，學生會收到通知');
            },
          },
          {
            label: '❌ 退回',
            kind: 'danger',
            onClick: () => {
              decideLeave({
                leaveId: dyn.relatedLeaveId!,
                decision: 'rejected',
                decidedBy: roleLabel,
                note: '請補充病假證明後重新申請',
              });
              onDone('已退回請假，學生會收到通知');
            },
          },
        ]}
      />
    );
  }

  // ── 宿舍報修：admin 推進狀態 ──
  if (dyn.relatedDormRepairId && demoRole === 'admin') {
    return (
      <ActionPanel
        title="🔧 報修派工"
        helper="派工 / 完工後，學生會即時收到狀態變更通知"
        buttons={[
          {
            label: '🔧 派工中',
            kind: 'primary',
            onClick: () => {
              setDormRepairStatus(dyn.relatedDormRepairId!, 'dispatched');
              onDone('已派工，學生會收到通知');
            },
          },
          {
            label: '✅ 完工',
            kind: 'primary',
            onClick: () => {
              setDormRepairStatus(dyn.relatedDormRepairId!, 'resolved');
              onDone('已完工，學生會收到通知');
            },
          },
        ]}
      />
    );
  }

  // ── 訂單推進：admin（代表 vendor 後台）── 學生不能對自己訂單推進
  if (dyn.relatedOrderId && demoRole === 'admin') {
    return (
      <ActionPanel
        title="🍱 訂單推進"
        helper="推進訂單狀態後，學生會收到對應通知"
        buttons={[
          {
            label: '🍳 準備中',
            kind: 'primary',
            onClick: () => {
              updateOrderStatus(dyn.relatedOrderId!, 'processing');
              onDone('訂單已標記為準備中');
            },
          },
          {
            label: '🛎️ 已備好',
            kind: 'primary',
            onClick: () => {
              updateOrderStatus(dyn.relatedOrderId!, 'ready');
              onDone('訂單已備好，學生會收到取餐通知');
            },
          },
          {
            label: '❌ 取消',
            kind: 'danger',
            onClick: () => {
              updateOrderStatus(dyn.relatedOrderId!, 'cancelled');
              onDone('訂單已取消');
            },
          },
        ]}
      />
    );
  }

  // ── 求助快速回覆：TA / 教師 ──
  if (dyn.relatedHelpId && (demoRole === 'ta' || demoRole === 'teacher')) {
    return (
      <QuickReplyPanel
        title="🙋 求助快速回覆"
        helper="回覆內容會以訊息送回學生，求助狀態變更為「已回覆」"
        onSubmit={(reply) => {
          replyHelpRequest({ helpId: dyn.relatedHelpId!, reply, replierName: roleLabel });
          onDone('已回覆，學生會收到通知');
        }}
      />
    );
  }

  // ── 公告審核：系主任 ──
  if (dyn.relatedPendingAnnId && demoRole === 'department_head') {
    return (
      <ActionPanel
        title="📣 公告審核"
        helper="核准後全校學生收到公告通知；退回會把原因送回提交者"
        buttons={[
          {
            label: '✅ 核准發布',
            kind: 'primary',
            onClick: () => {
              // 標記為已處理
              try {
                const raw = window.localStorage.getItem('demoApprovedAnn');
                const approved: string[] = raw ? (JSON.parse(raw) as string[]) : [];
                if (!approved.includes(dyn.relatedPendingAnnId!)) {
                  approved.push(dyn.relatedPendingAnnId!);
                  window.localStorage.setItem('demoApprovedAnn', JSON.stringify(approved));
                  window.dispatchEvent(new CustomEvent('demoPendingAnnChange'));
                }
              } catch { /* ignore */ }
              const title = msg.subject.replace(/^【待審核公告】/, '');
              notifyStudentsAnnApproved(title, msg.fromName);
              onDone('已核准，全校學生會收到通知');
            },
          },
          {
            label: '❌ 退回',
            kind: 'danger',
            onClick: () => {
              const title = msg.subject.replace(/^【待審核公告】/, '');
              rejectAnnouncementWithReason({
                pendingId: dyn.relatedPendingAnnId!,
                title,
                reason: '請補充內容與引用來源後重新提交',
                submitterRole: dyn.senderRole ?? 'teacher',
                reviewedByLabel: roleLabel,
              });
              onDone('已退回，原提交者會收到通知與退回原因');
            },
          },
        ]}
      />
    );
  }

  // ── 社員申請審核：club_officer ──
  if (dyn.relatedClubMembershipId && demoRole === 'club_officer') {
    return (
      <ActionPanel
        title="📨 社員申請"
        helper="核准 / 拒絕後，學生會在收件匣看到結果"
        buttons={[
          {
            label: '✅ 核准',
            kind: 'primary',
            onClick: () => {
              approveClubMember(dyn.relatedClubMembershipId!, { officerName: roleLabel });
              onDone('已核准，學生會收到通知');
            },
          },
          {
            label: '❌ 拒絕',
            kind: 'danger',
            onClick: () => {
              rejectClubMember(dyn.relatedClubMembershipId!);
              onDone('已拒絕，學生會收到通知');
            },
          },
        ]}
      />
    );
  }

  // ── 作業繳交：教師 / TA 看到「學生繳交」時，提供前往成績簿 deep-link ──
  if (dyn.relatedAssignmentId && (demoRole === 'teacher' || demoRole === 'ta')) {
    const courseId = dyn.relatedCourseId ?? 'c1';
    return (
      <div
        style={{
          padding: '12px 14px',
          background: 'var(--accent-soft, rgba(94,106,210,0.06))',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700 }}>📝 作業批改入口</div>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
          點下方按鈕直接到該課程的成績簿，可看到此學生的繳交紀錄
        </div>
        <div>
          <Link
            href={`/teacher/course/${courseId}/gradebook`}
            className="btn primary"
            style={{ fontSize: 13 }}
          >
            前往成績簿批改 →
          </Link>
        </div>
      </div>
    );
  }

  return null;
}

function ActionPanel({
  title,
  helper,
  buttons,
}: {
  title: string;
  helper: string;
  buttons: { label: string; kind: 'primary' | 'danger'; onClick: () => void }[];
}) {
  return (
    <div
      style={{
        padding: '12px 14px',
        background: 'var(--accent-soft, rgba(94,106,210,0.06))',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700 }}>{title}</div>
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{helper}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {buttons.map((b) => (
          <button
            key={b.label}
            type="button"
            className={`btn ${b.kind === 'primary' ? 'primary' : ''}`}
            onClick={b.onClick}
            style={{
              fontSize: 13,
              ...(b.kind === 'danger'
                ? { background: 'rgba(255,59,48,0.12)', color: '#FF3B30', borderColor: '#FF3B30' }
                : {}),
            }}
          >
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function QuickReplyPanel({
  title,
  helper,
  onSubmit,
}: {
  title: string;
  helper: string;
  onSubmit: (reply: string) => void;
}) {
  const [text, setText] = useState('');
  return (
    <div
      style={{
        padding: '12px 14px',
        background: 'var(--accent-soft, rgba(94,106,210,0.06))',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700 }}>{title}</div>
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{helper}</div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="輸入回覆內容..."
        rows={2}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '8px 10px',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border)',
          background: 'var(--bg)',
          color: 'var(--text)',
          fontSize: 13,
          fontFamily: 'inherit',
          resize: 'vertical',
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="btn primary"
          disabled={!text.trim()}
          onClick={() => {
            const t = text.trim();
            if (!t) return;
            onSubmit(t);
            setText('');
          }}
          style={{ fontSize: 13 }}
        >
          送出回覆 →
        </button>
      </div>
    </div>
  );
}
