'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { useToast } from '@/components/ui';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import {
  useDemoRole,
  getDemoRoleDefinition,
  getCapabilities,
  type DemoRole,
} from '@/lib/demoRole';
import {
  DEMO_USERS,
  DEMO_STUDENTS,
  getDemoCourseById,
  getDemoClubById,
  type DemoMessage,
} from '@/lib/demoData';
import {
  useDemoStore,
  getAllMessagesForRole,
  markDynamicMessageRead,
  // Friends + DM
  seedFriendsIfNeeded,
  listThreadsFor,
  listMessagesInThread,
  countUnreadInThread,
  listFriendUids,
  listIncomingFriendRequests,
  listOutgoingFriendRequests,
  getFriendshipStatus,
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  removeFriend,
  sendDirectMessage,
  markThreadRead,
  buildThreadId,
  getOrCreateThread,
  type AnyMessage,
  type StoreDirectThread,
} from '@/lib/demoStore';

// ──────────────────────────────────────────────────────────────
// Person directory（合併 DEMO_USERS + DEMO_STUDENTS）
// ──────────────────────────────────────────────────────────────
interface DirEntry {
  uid: string;
  name: string;
  subtitle: string;
  avatar: string;
}

const ROLE_AVATAR: Record<string, string> = {
  student: '👩‍🎓',
  teacher: '🧑‍🏫',
  ta: '🧑‍💻',
  club_officer: '🎯',
  department_head: '🏛️',
  admin: '🛡️',
  alumni: '🎓',
};

function buildDirectory(): DirEntry[] {
  const usersFromRoles: DirEntry[] = DEMO_USERS.map((u) => ({
    uid: u.uid,
    name: u.displayName,
    subtitle: u.department ?? u.affiliation ?? '',
    avatar: ROLE_AVATAR[u.role] ?? '👤',
  }));
  const usersFromStudents: DirEntry[] = DEMO_STUDENTS.map((s) => ({
    uid: s.uid,
    name: s.displayName,
    subtitle: `${s.studentId}・資管系`,
    avatar: '👩‍🎓',
  }));
  // 防呆：剔除可能重複的 uid（demo-student-1 與 stu-001 是不同實體，沒有交集；
  // 但若未來有衝突就以 demo-* 優先）
  const seen = new Set<string>();
  const merged: DirEntry[] = [];
  for (const e of [...usersFromRoles, ...usersFromStudents]) {
    if (seen.has(e.uid)) continue;
    seen.add(e.uid);
    merged.push(e);
  }
  return merged;
}

function lookupPerson(uid: string, dir: DirEntry[]): DirEntry {
  return (
    dir.find((d) => d.uid === uid) ?? {
      uid,
      name: uid,
      subtitle: '',
      avatar: '👤',
    }
  );
}

function roleToUid(role: DemoRole): string {
  return getDemoRoleDefinition(role).demoUserUid;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return '剛剛';
  if (m < 60) return `${m} 分前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小時前`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days} 天前`;
  return d.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' });
}

// ──────────────────────────────────────────────────────────────
// Inbox 系統通知（保留原本行為）
// ──────────────────────────────────────────────────────────────
const TYPE_COLOR: Record<DemoMessage['type'], string> = {
  info: '#5856D6',
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

// ──────────────────────────────────────────────────────────────
// Main page
// ──────────────────────────────────────────────────────────────
export default function MessagesPage(props: {
  searchParams?: { school?: string; schoolId?: string };
}) {
  const { schoolName, schoolSearch: q } = resolveSchoolPageContext(props.searchParams);
  const [demoRole] = useDemoRole();
  const roleDef = getDemoRoleDefinition(demoRole);
  const caps = getCapabilities(demoRole);
  const { success, info, error } = useToast();
  const store = useDemoStore();

  // Seed once on client mount
  useEffect(() => {
    seedFriendsIfNeeded();
  }, []);

  const dir = useMemo(() => buildDirectory(), []);
  const selfUid = roleToUid(demoRole);

  const [tab, setTab] = useState<'dm' | 'inbox' | 'friends'>('dm');
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [composeText, setComposeText] = useState('');
  const [friendSearch, setFriendSearch] = useState('');
  // System inbox state
  const messages = useMemo(
    () => getAllMessagesForRole(demoRole, store),
    [demoRole, store],
  );
  const [selectedSysId, setSelectedSysId] = useState<string | null>(null);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [replyText, setReplyText] = useState('');
  const [sysFilter, setSysFilter] = useState<'all' | 'unread' | 'action'>('all');

  const threads = useMemo(() => listThreadsFor(selfUid, store), [selfUid, store]);
  const dmTotalUnread = useMemo(
    () => threads.reduce((sum, t) => sum + countUnreadInThread(t, selfUid, store), 0),
    [threads, selfUid, store],
  );

  const friendUids = useMemo(() => listFriendUids(selfUid, store), [selfUid, store]);
  const incoming = useMemo(() => listIncomingFriendRequests(selfUid, store), [selfUid, store]);
  const outgoing = useMemo(() => listOutgoingFriendRequests(selfUid, store), [selfUid, store]);

  const selectedThread = useMemo(
    () => threads.find((t) => t.id === selectedThreadId) ?? null,
    [threads, selectedThreadId],
  );
  const dmList = useMemo(
    () => (selectedThread ? listMessagesInThread(selectedThread.id, store) : []),
    [selectedThread, store],
  );

  // Mark thread as read when selected
  useEffect(() => {
    if (selectedThread && selfUid) {
      markThreadRead(selectedThread.id, selfUid);
    }
  }, [selectedThread, selfUid]);

  // Auto-scroll DM viewer to bottom on new messages
  const dmListRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (dmListRef.current) {
      dmListRef.current.scrollTop = dmListRef.current.scrollHeight;
    }
  }, [dmList.length, selectedThreadId]);

  const selectedSys: AnyMessage | null =
    messages.find((m) => m.id === selectedSysId) ?? null;

  const filteredMessages = messages.filter((m) => {
    if (sysFilter === 'unread')
      return !m.isRead && !readIds.has(m.id) && !store.readMessageIds.includes(m.id);
    if (sysFilter === 'action') return m.type === 'action' || m.type === 'warning';
    return true;
  });

  const sysUnread = messages.filter(
    (m) => !m.isRead && !readIds.has(m.id) && !store.readMessageIds.includes(m.id),
  ).length;

  function handleSelectSys(msg: AnyMessage) {
    setSelectedSysId(msg.id);
    if (!msg.isRead && !readIds.has(msg.id)) {
      setReadIds((prev) => new Set([...prev, msg.id]));
      if (msg._dynamic) markDynamicMessageRead(msg.id);
    }
  }

  function handleReplySys() {
    if (!replyText.trim() || !selectedSys) return;
    success(`✅ 已回覆給 ${selectedSys.fromName}`);
    setReplyText('');
  }

  function handleSendDm() {
    if (!composeText.trim() || !selectedThread) return;
    const otherUid = selectedThread.participantUids.find((u) => u !== selfUid);
    if (!otherUid) return;
    sendDirectMessage({ fromUid: selfUid, toUid: otherUid, body: composeText });
    setComposeText('');
  }

  function handleOpenThreadWith(otherUid: string) {
    if (!selfUid) return;
    getOrCreateThread(selfUid, otherUid);
    setTab('dm');
    setSelectedThreadId(buildThreadId(selfUid, otherUid));
  }

  // 訪客攔截
  if (demoRole === 'guest') {
    return (
      <SiteShell title="訊息" schoolName={schoolName}>
        <div className="pageStack">
          <div
            className="card"
            style={{
              padding: '32px 24px',
              textAlign: 'center',
              background: 'rgba(88,86,214,0.06)',
              border: '1px solid #5856D6',
            }}
          >
            <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>請先登入</div>
            <div style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 20 }}>
              訪客身份無法收發私訊或查看通知,請選一個角色登入。
            </div>
            <Link href={`/login${q}`} className="btn primary">
              前往登入 →
            </Link>
          </div>
        </div>
      </SiteShell>
    );
  }

  // 校友：可瀏覽通知但不能私訊（限制示範）
  const dmDisabled = demoRole === 'alumni';

  return (
    <SiteShell
      title="訊息"
      subtitle={`${roleDef.icon} ${roleDef.label} · ${dmTotalUnread} 則私訊未讀 / ${sysUnread} 則通知未讀`}
      schoolName={schoolName}
    >
      <div className="pageStack">
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {(
            [
              { key: 'dm', label: `💬 私訊`, badge: dmTotalUnread },
              { key: 'inbox', label: `🔔 系統通知`, badge: sysUnread },
              { key: 'friends', label: `👥 好友`, badge: incoming.length },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              style={{
                padding: '8px 16px',
                borderRadius: 99,
                border: '1px solid var(--border)',
                background: tab === t.key ? 'var(--brand)' : 'var(--panel)',
                color: tab === t.key ? '#fff' : 'var(--text)',
                fontSize: 13,
                fontWeight: tab === t.key ? 700 : 500,
                cursor: 'pointer',
                position: 'relative',
              }}
            >
              {t.label}
              {t.badge > 0 && (
                <span
                  style={{
                    marginLeft: 8,
                    padding: '1px 7px',
                    background: tab === t.key ? '#fff' : '#FF3B30',
                    color: tab === t.key ? 'var(--brand)' : '#fff',
                    borderRadius: 99,
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {tab === 'dm' && (
          <DmTab
            selfUid={selfUid}
            threads={threads}
            selectedThread={selectedThread}
            dmList={dmList}
            dmListRef={dmListRef}
            composeText={composeText}
            setComposeText={setComposeText}
            handleSendDm={handleSendDm}
            handleOpenThreadWith={handleOpenThreadWith}
            setSelectedThreadId={setSelectedThreadId}
            dir={dir}
            store={store}
            dmDisabled={dmDisabled}
            friendUids={friendUids}
            setTab={setTab}
          />
        )}

        {tab === 'friends' && (
          <FriendsTab
            selfUid={selfUid}
            friendUids={friendUids}
            incoming={incoming}
            outgoing={outgoing}
            dir={dir}
            store={store}
            search={friendSearch}
            setSearch={setFriendSearch}
            onMessage={handleOpenThreadWith}
            success={success}
            info={info}
            error={error}
            dmDisabled={dmDisabled}
          />
        )}

        {tab === 'inbox' && (
          <InboxTab
            messages={messages}
            filteredMessages={filteredMessages}
            sysUnread={sysUnread}
            filter={sysFilter}
            setFilter={setSysFilter}
            selected={selectedSys}
            setSelectedId={setSelectedSysId}
            handleSelect={handleSelectSys}
            readIds={readIds}
            store={store}
            replyText={replyText}
            setReplyText={setReplyText}
            handleReply={handleReplySys}
            roleDef={roleDef}
            demoRole={demoRole}
            caps={caps}
            q={q}
          />
        )}
      </div>
    </SiteShell>
  );
}

// ──────────────────────────────────────────────────────────────
// DM Tab
// ──────────────────────────────────────────────────────────────
function DmTab(props: {
  selfUid: string;
  threads: StoreDirectThread[];
  selectedThread: StoreDirectThread | null;
  dmList: ReturnType<typeof listMessagesInThread>;
  dmListRef: React.RefObject<HTMLDivElement | null>;
  composeText: string;
  setComposeText: (s: string) => void;
  handleSendDm: () => void;
  handleOpenThreadWith: (uid: string) => void;
  setSelectedThreadId: (id: string | null) => void;
  dir: DirEntry[];
  store: ReturnType<typeof useDemoStore>;
  dmDisabled: boolean;
  friendUids: string[];
  setTab: (t: 'dm' | 'inbox' | 'friends') => void;
}) {
  const {
    selfUid,
    threads,
    selectedThread,
    dmList,
    dmListRef,
    composeText,
    setComposeText,
    handleSendDm,
    handleOpenThreadWith,
    setSelectedThreadId,
    dir,
    store,
    dmDisabled,
    friendUids,
    setTab,
  } = props;

  if (dmDisabled) {
    return (
      <div
        className="card"
        style={{
          padding: 24,
          textAlign: 'center',
          background: 'rgba(142,142,147,0.10)',
          border: '1px solid #8E8E93',
        }}
      >
        <div style={{ fontSize: 36, marginBottom: 10 }}>🎓</div>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>校友身份僅可瀏覽</div>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
          私訊功能限在校學生與教職員使用,校友帳號為唯讀身份。
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 320px) minmax(0, 1fr)',
        gap: 16,
        alignItems: 'start',
        minHeight: 480,
      }}
    >
      {/* Thread list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>
            對話 ({threads.length})
          </div>
          <button
            type="button"
            onClick={() => setTab('friends')}
            style={{
              padding: '4px 10px',
              borderRadius: 99,
              border: '1px solid var(--border)',
              background: 'var(--panel)',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              color: 'var(--brand)',
            }}
          >
            + 加好友
          </button>
        </div>

        {threads.length === 0 ? (
          <div
            className="card"
            style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}
          >
            <div style={{ fontSize: 32, marginBottom: 8 }}>💬</div>
            <div style={{ fontSize: 13, marginBottom: 12 }}>還沒有任何對話</div>
            <button
              type="button"
              onClick={() => setTab('friends')}
              className="btn primary"
              style={{ fontSize: 12 }}
            >
              去找好友開始聊天 →
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {threads.map((t) => {
              const otherUid = t.participantUids.find((u) => u !== selfUid) ?? '';
              const other = lookupPerson(otherUid, dir);
              const unread = countUnreadInThread(t, selfUid, store);
              const isSel = selectedThread?.id === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectedThreadId(t.id)}
                  style={{
                    padding: '12px 14px',
                    borderRadius: 'var(--radius)',
                    border: `1px solid ${isSel ? 'var(--brand)' : 'var(--border)'}`,
                    background: isSel
                      ? 'rgba(88,86,214,0.08)'
                      : unread > 0
                        ? 'rgba(88,86,214,0.04)'
                        : 'var(--surface)',
                    cursor: 'pointer',
                    display: 'flex',
                    gap: 10,
                    alignItems: 'center',
                    textAlign: 'left',
                    transition: 'all 0.15s',
                  }}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 12,
                      background: 'rgba(88,86,214,0.10)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 20,
                      flexShrink: 0,
                    }}
                  >
                    {other.avatar}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 8,
                        marginBottom: 2,
                      }}
                    >
                      <span
                        style={{
                          fontWeight: unread > 0 ? 700 : 600,
                          fontSize: 13,
                          color: 'var(--text)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {other.name}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          color: 'var(--muted)',
                          whiteSpace: 'nowrap',
                          flexShrink: 0,
                        }}
                      >
                        {t.lastSentAt ? formatTime(t.lastSentAt) : ''}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: unread > 0 ? 'var(--text)' : 'var(--muted)',
                        fontWeight: unread > 0 ? 600 : 400,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {t.lastMessagePreview || '（尚無訊息）'}
                    </div>
                  </div>
                  {unread > 0 && (
                    <span
                      style={{
                        background: '#FF3B30',
                        color: '#fff',
                        borderRadius: 99,
                        padding: '1px 7px',
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      {unread}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Quick start: pick friend to message */}
        {friendUids.length > 0 && threads.length < 6 && (
          <div
            style={{
              marginTop: 8,
              padding: 10,
              borderRadius: 'var(--radius-sm)',
              border: '1px dashed var(--border)',
              background: 'var(--panel2)',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>
              開始新對話
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {friendUids.slice(0, 6).map((uid) => {
                const p = lookupPerson(uid, dir);
                return (
                  <button
                    key={uid}
                    type="button"
                    onClick={() => handleOpenThreadWith(uid)}
                    title={`與 ${p.name} 私訊`}
                    style={{
                      padding: '4px 9px',
                      borderRadius: 99,
                      border: '1px solid var(--border)',
                      background: 'var(--panel)',
                      cursor: 'pointer',
                      fontSize: 11,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <span style={{ fontSize: 13 }}>{p.avatar}</span>
                    {p.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Thread viewer */}
      <div
        className="card"
        style={{
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 480,
          overflow: 'hidden',
        }}
      >
        {!selectedThread ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--muted)',
              padding: 40,
            }}
          >
            <div style={{ fontSize: 56, marginBottom: 12 }}>✉️</div>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
              選擇一段對話開始私訊
            </div>
            <div style={{ fontSize: 13 }}>或先到「好友」分頁加新朋友</div>
          </div>
        ) : (
          <>
            {/* Thread header */}
            <div
              style={{
                padding: '12px 16px',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                background: 'var(--panel)',
              }}
            >
              {(() => {
                const otherUid = selectedThread.participantUids.find((u) => u !== selfUid) ?? '';
                const other = lookupPerson(otherUid, dir);
                return (
                  <>
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 12,
                        background: 'rgba(88,86,214,0.10)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 20,
                      }}
                    >
                      {other.avatar}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{other.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{other.subtitle}</div>
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Messages */}
            <div
              ref={dmListRef}
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: 16,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                background: 'var(--bg)',
                minHeight: 320,
                maxHeight: 480,
              }}
            >
              {dmList.length === 0 && (
                <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: 24 }}>
                  還沒有訊息,寄出第一則打招呼吧 👋
                </div>
              )}
              {dmList.map((m, i) => {
                const isMe = m.fromUid === selfUid;
                const sender = lookupPerson(m.fromUid, dir);
                const prev = dmList[i - 1];
                const showAvatar = !isMe && (!prev || prev.fromUid !== m.fromUid);
                return (
                  <div
                    key={m.id}
                    style={{
                      display: 'flex',
                      flexDirection: isMe ? 'row-reverse' : 'row',
                      gap: 8,
                      alignItems: 'flex-end',
                    }}
                  >
                    {!isMe && (
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 10,
                          background: 'rgba(88,86,214,0.10)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 14,
                          flexShrink: 0,
                          visibility: showAvatar ? 'visible' : 'hidden',
                        }}
                      >
                        {sender.avatar}
                      </div>
                    )}
                    <div
                      style={{
                        maxWidth: '70%',
                        background: isMe ? '#5856D6' : 'var(--panel)',
                        color: isMe ? '#fff' : 'var(--text)',
                        padding: '8px 12px',
                        borderRadius: 14,
                        borderTopLeftRadius: !isMe && !showAvatar ? 4 : 14,
                        borderTopRightRadius: isMe ? 14 : 14,
                        fontSize: 14,
                        lineHeight: 1.5,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                      }}
                    >
                      {m.body}
                      <div
                        style={{
                          fontSize: 10,
                          marginTop: 4,
                          opacity: 0.7,
                          textAlign: isMe ? 'right' : 'left',
                        }}
                      >
                        {formatTime(m.sentAt)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Composer */}
            <div
              style={{
                padding: 12,
                borderTop: '1px solid var(--border)',
                background: 'var(--panel)',
                display: 'flex',
                gap: 8,
                alignItems: 'flex-end',
              }}
            >
              <textarea
                value={composeText}
                onChange={(e) => setComposeText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleSendDm();
                  }
                }}
                placeholder="輸入訊息... (⌘+Enter 送出)"
                rows={2}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                  background: 'var(--bg)',
                  color: 'var(--text)',
                  fontSize: 13,
                  resize: 'none',
                  lineHeight: 1.5,
                  fontFamily: 'inherit',
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={handleSendDm}
                disabled={!composeText.trim()}
                className="btn primary"
                style={{ fontSize: 13, flexShrink: 0, opacity: composeText.trim() ? 1 : 0.5 }}
              >
                ✉ 送出
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Friends Tab
// ──────────────────────────────────────────────────────────────
function FriendsTab(props: {
  selfUid: string;
  friendUids: string[];
  incoming: ReturnType<typeof listIncomingFriendRequests>;
  outgoing: ReturnType<typeof listOutgoingFriendRequests>;
  dir: DirEntry[];
  store: ReturnType<typeof useDemoStore>;
  search: string;
  setSearch: (s: string) => void;
  onMessage: (uid: string) => void;
  success: (m: string) => void;
  info: (m: string) => void;
  error: (m: string) => void;
  dmDisabled: boolean;
}) {
  const {
    selfUid,
    friendUids,
    incoming,
    outgoing,
    dir,
    store,
    search,
    setSearch,
    onMessage,
    success,
    info,
    error,
    dmDisabled,
  } = props;

  const searchResults = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return [] as DirEntry[];
    return dir
      .filter((p) => p.uid !== selfUid)
      .filter((p) => {
        return (
          p.name.toLowerCase().includes(term) ||
          p.uid.toLowerCase().includes(term) ||
          p.subtitle.toLowerCase().includes(term)
        );
      })
      .slice(0, 12);
  }, [dir, search, selfUid]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Add friend search */}
      <div
        className="card"
        style={{
          padding: 16,
          background: 'linear-gradient(135deg, rgba(88,86,214,0.06) 0%, rgba(90,200,250,0.04) 100%)',
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>🔍 加好友</div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="輸入姓名 / 學號 / 系所搜尋（例：王小明、M11302、資管系）"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '10px 14px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border)',
            background: 'var(--bg)',
            color: 'var(--text)',
            fontSize: 13,
            outline: 'none',
          }}
        />
        {searchResults.length > 0 && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {searchResults.map((p) => {
              const status = getFriendshipStatus(selfUid, p.uid, store);
              return (
                <div
                  key={p.uid}
                  style={{
                    padding: 10,
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)',
                    background: 'var(--surface)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 12,
                      background: 'rgba(88,86,214,0.10)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 18,
                    }}
                  >
                    {p.avatar}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{p.subtitle}</div>
                  </div>
                  {status === 'none' && (
                    <button
                      type="button"
                      className="btn primary"
                      style={{ fontSize: 12 }}
                      onClick={() => {
                        const res = sendFriendRequest(selfUid, p.uid);
                        if (res.ok) success(`已送出好友邀請給 ${p.name}`);
                        else error(res.reason ?? '無法送出邀請');
                      }}
                    >
                      + 加好友
                    </button>
                  )}
                  {status === 'pending_outgoing' && (
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>已邀請,待回覆</span>
                  )}
                  {status === 'pending_incoming' && (
                    <button
                      type="button"
                      className="btn"
                      style={{ fontSize: 12 }}
                      onClick={() => {
                        acceptFriendRequest(p.uid, selfUid);
                        success(`已成為好友:${p.name}`);
                      }}
                    >
                      接受邀請
                    </button>
                  )}
                  {status === 'accepted' && !dmDisabled && (
                    <button
                      type="button"
                      className="btn"
                      style={{ fontSize: 12 }}
                      onClick={() => onMessage(p.uid)}
                    >
                      💬 私訊
                    </button>
                  )}
                  {status === 'accepted' && dmDisabled && (
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>已是好友</span>
                  )}
                  {status === 'blocked' && (
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>已封鎖</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {search.trim() && searchResults.length === 0 && (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>沒有符合的對象</div>
        )}
      </div>

      {/* Incoming requests */}
      {incoming.length > 0 && (
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
            📩 待回覆的好友邀請 ({incoming.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {incoming.map((f) => {
              const p = lookupPerson(f.fromUid, dir);
              return (
                <div
                  key={`${f.fromUid}_${f.toUid}`}
                  style={{
                    padding: 10,
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)',
                    background: 'var(--surface)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 12,
                      background: 'rgba(88,86,214,0.10)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 18,
                    }}
                  >
                    {p.avatar}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{p.subtitle}</div>
                  </div>
                  <button
                    type="button"
                    className="btn primary"
                    style={{ fontSize: 12 }}
                    onClick={() => {
                      acceptFriendRequest(f.fromUid, f.toUid);
                      success(`已成為好友:${p.name}`);
                    }}
                  >
                    ✓ 接受
                  </button>
                  <button
                    type="button"
                    className="btn"
                    style={{ fontSize: 12 }}
                    onClick={() => {
                      rejectFriendRequest(f.fromUid, f.toUid);
                      info(`已拒絕 ${p.name} 的邀請`);
                    }}
                  >
                    拒絕
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Friends list */}
      <div className="card" style={{ padding: 16 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 10,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700 }}>👥 我的好友 ({friendUids.length})</div>
          {outgoing.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
              已送出 {outgoing.length} 則邀請等待回覆
            </div>
          )}
        </div>
        {friendUids.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', padding: 24 }}>
            還沒有好友,試試上方搜尋同學或老師。
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 8,
            }}
          >
            {friendUids.map((uid) => {
              const p = lookupPerson(uid, dir);
              return (
                <div
                  key={uid}
                  style={{
                    padding: 12,
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)',
                    background: 'var(--surface)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 12,
                      background: 'rgba(88,86,214,0.10)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 20,
                    }}
                  >
                    {p.avatar}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: 13,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {p.name}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: 'var(--muted)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {p.subtitle}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {!dmDisabled && (
                      <button
                        type="button"
                        onClick={() => onMessage(uid)}
                        title="私訊"
                        style={{
                          padding: '4px 8px',
                          borderRadius: 8,
                          border: '1px solid var(--brand)',
                          background: 'rgba(88,86,214,0.10)',
                          color: 'var(--brand)',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        💬
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`確定要移除好友 ${p.name}?`)) {
                          removeFriend(selfUid, uid);
                          info(`已移除好友 ${p.name}`);
                        }
                      }}
                      title="移除好友"
                      style={{
                        padding: '4px 8px',
                        borderRadius: 8,
                        border: '1px solid var(--border)',
                        background: 'var(--panel)',
                        color: 'var(--muted)',
                        fontSize: 11,
                        cursor: 'pointer',
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Inbox (system notifications) Tab — 保留既有體驗
// ──────────────────────────────────────────────────────────────
function InboxTab(props: {
  messages: AnyMessage[];
  filteredMessages: AnyMessage[];
  sysUnread: number;
  filter: 'all' | 'unread' | 'action';
  setFilter: (f: 'all' | 'unread' | 'action') => void;
  selected: AnyMessage | null;
  setSelectedId: (id: string | null) => void;
  handleSelect: (m: AnyMessage) => void;
  readIds: Set<string>;
  store: ReturnType<typeof useDemoStore>;
  replyText: string;
  setReplyText: (s: string) => void;
  handleReply: () => void;
  roleDef: ReturnType<typeof getDemoRoleDefinition>;
  demoRole: DemoRole;
  caps: ReturnType<typeof getCapabilities>;
  q: string;
}) {
  const {
    messages,
    filteredMessages,
    sysUnread,
    filter,
    setFilter,
    selected,
    setSelectedId,
    handleSelect,
    readIds,
    store,
    replyText,
    setReplyText,
    handleReply,
    roleDef,
    demoRole,
    caps,
    q,
  } = props;

  return (
    <div className="pageStack">
      {sysUnread > 0 && (
        <div
          className="card"
          style={{
            padding: '12px 16px',
            background:
              'linear-gradient(135deg, rgba(88,86,214,0.10) 0%, rgba(90,200,250,0.07) 100%)',
            border: '1px solid rgba(88,86,214,0.22)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 14,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ flex: 1, fontSize: 13, color: 'var(--text)' }}>
            🤖 <strong>AI 摘要</strong>:你有 <strong>{sysUnread} 則未讀通知</strong>
          </div>
          <Link
            href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent('請幫我整理今日重要訊息,哪些需要我馬上處理?')}`}
            className="btn"
            style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            讓 AI 整理 →
          </Link>
        </div>
      )}

      {/* 篩選 */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {(
          [
            { key: 'all', label: `全部 (${messages.length})` },
            { key: 'unread', label: `未讀 (${sysUnread})` },
            { key: 'action', label: '待辦 / 提醒' },
          ] as const
        ).map((f) => (
          <button
            key={f.key}
            type="button"
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
            }}
          >
            {f.label}
          </button>
        ))}
        <div
          style={{
            marginLeft: 'auto',
            fontSize: 12,
            color: 'var(--muted)',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {roleDef.icon} {roleDef.label} 身份
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: selected ? 'minmax(0, 1fr) minmax(0, 1.4fr)' : '1fr',
          gap: 16,
          alignItems: 'start',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {filteredMessages.length === 0 ? (
            <div
              className="card"
              style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--muted)' }}
            >
              <div style={{ fontSize: 36, marginBottom: 10 }}>📭</div>
              <div style={{ fontSize: 14 }}>
                {filter === 'unread' ? '沒有未讀通知' : '目前沒有通知'}
              </div>
            </div>
          ) : (
            filteredMessages.map((msg) => {
              const isUnread =
                !msg.isRead && !readIds.has(msg.id) && !store.readMessageIds.includes(msg.id);
              const isSel = selected?.id === msg.id;
              return (
                <div
                  key={msg.id}
                  onClick={() => handleSelect(msg)}
                  style={{
                    padding: '12px 16px',
                    borderRadius: 'var(--radius)',
                    border: `1px solid ${isSel ? 'var(--brand)' : 'var(--border)'}`,
                    background: isSel
                      ? 'rgba(88,86,214,0.08)'
                      : isUnread
                        ? 'var(--accent-soft, rgba(88,86,214,0.05))'
                        : 'var(--surface)',
                    cursor: 'pointer',
                    display: 'flex',
                    gap: 12,
                    alignItems: 'flex-start',
                  }}
                >
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
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 8,
                        marginBottom: 3,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: isUnread ? 700 : 500,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {msg.fromName}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>
                        {msg.sentAt}
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

        {selected && (
          <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
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
                  type="button"
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
              <h2 style={{ margin: '0 0 10px', fontSize: 16, fontWeight: 700, lineHeight: 1.4 }}>
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
                  {' '}· {selected.sentAt}
                </span>
              </div>
            </div>

            <div
              style={{
                fontSize: 14,
                lineHeight: 1.8,
                whiteSpace: 'pre-wrap',
                padding: '14px 16px',
                background: 'var(--panel2)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)',
              }}
            >
              {selected.body}
            </div>

            {(selected.relatedCourseId ||
              selected.relatedClubId ||
              ('relatedAnnouncementId' in selected && selected.relatedAnnouncementId)) && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {selected.relatedCourseId && getDemoCourseById(selected.relatedCourseId) && (
                  <Link
                    href={`${
                      demoRole === 'teacher' ||
                      demoRole === 'ta' ||
                      demoRole === 'admin' ||
                      demoRole === 'department_head'
                        ? '/teacher'
                        : ''
                    }/course/${selected.relatedCourseId}${q}`}
                    className="btn primary"
                    style={{ fontSize: 13 }}
                  >
                    📚 前往課程:{getDemoCourseById(selected.relatedCourseId)?.name} →
                  </Link>
                )}
                {selected.relatedClubId && getDemoClubById(selected.relatedClubId) && (
                  <Link href={`/clubs${q}`} className="btn" style={{ fontSize: 13 }}>
                    🎯 前往社團:{getDemoClubById(selected.relatedClubId)?.name} →
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
                    {caps.canApproveAnnouncements ? '📥 前往公告審核佇列 →' : '📢 查看公告詳情 →'}
                  </Link>
                )}
              </div>
            )}

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
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>
                    ↩ 回覆給 {selected.fromName}
                  </div>
                  <Link
                    href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent(`幫我回覆這則訊息:${selected.subject}`)}`}
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
                    type="button"
                    className="btn"
                    onClick={() => {
                      setReplyText('');
                    }}
                    style={{ fontSize: 13 }}
                  >
                    清除
                  </button>
                  <button
                    type="button"
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
    </div>
  );
}
