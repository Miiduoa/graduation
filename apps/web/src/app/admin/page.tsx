'use client';

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SiteShell } from '@/components/SiteShell';
import { useToast, Modal } from '@/components/ui';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import { useDemoRole, getCapabilities, getDemoRoleDefinition, type DemoRole } from '@/lib/demoRole';
import {
  DEMO_COURSES,
  DEMO_USERS,
  DEMO_ANNOUNCEMENTS,
  DEMO_CLUBS,
  readPendingAnns,
  approvePendingAnn,
  type DemoPendingAnn,
} from '@/lib/demoData';
import {
  notifyStudentsAnnApproved,
  notifySubmitterAnnApproved,
  setUserDisabled,
  useDemoStore,
  isUserDisabled,
  sendDeptBroadcast,
  rejectAnnouncementWithReason,
} from '@/lib/demoStore';

export default function AdminPage(props: {
  searchParams?: { school?: string; schoolId?: string };
}) {
  const { schoolName, schoolSearch: q } = resolveSchoolPageContext(props.searchParams);
  const router = useRouter();
  const [role] = useDemoRole();
  const caps = getCapabilities(role);
  const roleDef = getDemoRoleDefinition(role);
  const { success, info } = useToast();
  const store = useDemoStore();
  // 待審公告：共用 localStorage（與 announcements/page.tsx 同步）
  // 用空陣列作初始值避免 SSR hydration mismatch，mount 後再從 localStorage 讀
  const [pendingQueue, setPendingQueue] = useState<DemoPendingAnn[]>([]);
  const [userSearch, setUserSearch] = useState('');
  // 改用 demoStore 持久化停用狀態
  const isDisabled = (uid: string) => isUserDisabled(uid, store);
  // 統一 modal 狀態
  const [actionModal, setActionModal] = useState<{
    title: string;
    body: ReactNode;
    footer?: ReactNode;
  } | null>(null);
  // 角色變更 modal
  const [roleChangeUser, setRoleChangeUser] = useState<typeof DEMO_USERS[number] | null>(null);
  // 系所廣播 form
  const [broadcastDraft, setBroadcastDraft] = useState({ title: '', body: '' });
  // 維護模式
  const [maintenanceMode, setMaintenanceMode] = useState(false);

  useEffect(() => {
    // handler 包一層讓 lint 不認為是「直接」在 effect body 呼叫 setState
    const handler = () => setPendingQueue(readPendingAnns());
    // 首次 mount 先同步讀入（透過 handler，而非直接 setState）
    handler();
    window.addEventListener('demoPendingAnnChange', handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener('demoPendingAnnChange', handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  // 系主任只看自己系所內的角色（不應看到系統管理員與校友個資）
  const visibleUsers = useMemo(() => {
    if (role === 'department_head') {
      const deptRoles = new Set(['student', 'teacher', 'ta', 'club_officer', 'department_head']);
      return DEMO_USERS.filter((u) => deptRoles.has(u.role));
    }
    return DEMO_USERS;
  }, [role]);

  const filteredUsers = useMemo(
    () => visibleUsers.filter(
      (u) => !userSearch || u.displayName.includes(userSearch) || u.email.toLowerCase().includes(userSearch.toLowerCase()),
    ),
    [userSearch, visibleUsers],
  );

  const SECURITY_LOG = [
    { time: '09:23', event: '5 次登入失敗嘗試（境外 IP：荷蘭 Tor 出口節點）', target: 'admin@pu.edu.tw', level: 'high' as const },
    { time: '08:45', event: 'API 請求速率達 83%（近峰值，建議監控）', target: '系統整體', level: 'medium' as const },
    { time: '07:30', event: '例行備份完成（1.2 GB）', target: '資料庫', level: 'ok' as const },
    { time: '昨日 22:15', event: '使用者帳號密碼重設', target: 'B11203015@pu.edu.tw', level: 'info' as const },
  ];

  const stats = useMemo(() => {
    const totalUsers = DEMO_USERS.length + 132;
    const teacherCount = DEMO_USERS.filter((u) => u.role === 'teacher').length + 18;
    const studentCount = totalUsers - teacherCount - 5;
    return {
      totalUsers,
      teacherCount,
      studentCount,
      totalCourses: DEMO_COURSES.length,
      totalClubs: DEMO_CLUBS.length,
      pendingApprovals: pendingQueue.length,
      publishedAnnouncements: DEMO_ANNOUNCEMENTS.length,
    };
  }, [pendingQueue]);

  // 無權限 → 友善攔截畫面
  if (!caps.canViewAdminDashboard) {
    return (
      <SiteShell title="管理後台" subtitle="系主任 / 系統管理員專用" schoolName={schoolName}>
        <div className="pageStack">
          <div
            className="card"
            style={{
              padding: '24px 20px',
              textAlign: 'center',
              background: 'var(--danger-soft)',
              borderColor: 'var(--danger)',
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 8 }}>🚫</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>沒有存取權限</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.7 }}>
              你目前以「{roleDef.label}」身份瀏覽。管理後台僅開放給「系主任」與「系統管理員」。
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              請從右上角「身份膠囊」切換到 🏛️ 系主任 或 🛡️ 系統管理員，即可進入。
            </div>
            <Link href={`/${q}`} className="btn" style={{ marginTop: 14 }}>
              ← 回首頁
            </Link>
          </div>
        </div>
      </SiteShell>
    );
  }

  const isAdmin = role === 'admin';
  const isDeptHead = role === 'department_head';

  const approvePending = (id: string) => {
    const ann = pendingQueue.find((p) => p.id === id);
    approvePendingAnn(id);
    setPendingQueue(readPendingAnns());
    if (ann) {
      // 通知學生有新公告
      notifyStudentsAnnApproved(ann.title, ann.source);
      // 通知原提交者：你提交的公告已核准
      notifySubmitterAnnApproved({
        title: ann.title,
        submitterRole: ann.submittedByRole as DemoRole,
        approvedBy: roleDef.label,
      });
    }
    success('✅ 已核准並發布公告，學生與提交者皆收到通知');
  };

  const rejectPending = (id: string) => {
    const ann = pendingQueue.find((p) => p.id === id);
    if (!ann) return;
    const reason = typeof window !== 'undefined'
      ? window.prompt(`退回「${ann.title}」的原因（提交者會收到通知）：`, '請補充截止日、地點等資訊後重新送審')
      : '請補充細節後重新送審';
    if (!reason) return;
    rejectAnnouncementWithReason({
      pendingId: id,
      title: ann.title,
      reason,
      submitterRole: ann.submittedByRole as DemoRole,
      reviewedByLabel: roleDef.label,
    });
    setPendingQueue(readPendingAnns());
    info(`🔄 已退回「${ann.title}」並通知原提交者`);
  };

  return (
    <SiteShell
      title={isAdmin ? '系統管理後台' : '系所行政後台'}
      subtitle={isAdmin ? '使用者、學校設定、系統日誌' : '系所公告審核、課程統計、教師名冊'}
      schoolName={schoolName}
    >
      <div className="pageStack">
        {/* 身份提示橫條 */}
        <div
          className="card"
          style={{
            padding: '12px 16px',
            background: roleDef.toneSoft,
            border: `1px solid ${roleDef.tone}`,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span style={{ fontSize: 22 }}>{roleDef.icon}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: roleDef.tone }}>{roleDef.label}視角</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{roleDef.description}</div>
          </div>
        </div>

        {/* 統計卡片 */}
        <div className="metricGrid">
          <div className="metricCard" style={{ '--tone': 'var(--brand)' } as CSSProperties}>
            <div className="metricIcon">👥</div>
            <div className="metricValue">{stats.totalUsers}</div>
            <div className="metricLabel">總使用者</div>
          </div>
          <div className="metricCard" style={{ '--tone': '#0F8B8D' } as CSSProperties}>
            <div className="metricIcon">🧑‍🏫</div>
            <div className="metricValue">{stats.teacherCount}</div>
            <div className="metricLabel">教師人數</div>
          </div>
          <div className="metricCard" style={{ '--tone': '#5E6AD2' } as CSSProperties}>
            <div className="metricIcon">📚</div>
            <div className="metricValue">{stats.totalCourses}</div>
            <div className="metricLabel">開設課程</div>
          </div>
          <div
            className="metricCard"
            style={
              {
                '--tone': stats.pendingApprovals > 0 ? '#FF9500' : '#34C759',
              } as CSSProperties
            }
          >
            <div className="metricIcon">⏳</div>
            <div className="metricValue">{stats.pendingApprovals}</div>
            <div className="metricLabel">待審公告</div>
          </div>
        </div>

        <div
          className="pageGrid"
          style={{ gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)', gap: 16 }}
        >
          {/* 公告審核佇列 */}
          <div className="sectionCard">
            <div className="homeSectionHeader">
              <h2 className="homeSectionTitle">📥 待審公告</h2>
              <span className="homeSectionNote">{stats.pendingApprovals} 件待處理</span>
            </div>
            <div className="insetGroup">
              {pendingQueue.map((p, i) => (
                <div
                  key={p.id}
                  className="insetGroupRow"
                  style={{ borderTop: i === 0 ? 'none' : undefined }}
                >
                  <div className="insetGroupRowContent">
                    <div className="insetGroupRowTitle">{p.title}</div>
                    <div className="insetGroupRowMeta">
                      {p.source} · 提交於 {p.submittedAt}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button
                      type="button"
                      onClick={() => approvePending(p.id)}
                      style={{
                        padding: '6px 12px', borderRadius: 8,
                        border: '1px solid #34C759',
                        background: 'rgba(52,199,89,0.12)',
                        color: '#1F7A2E', fontWeight: 700, fontSize: 12, cursor: 'pointer',
                      }}
                    >
                      ✓ 核准
                    </button>
                    <button
                      type="button"
                      onClick={() => rejectPending(p.id)}
                      style={{
                        padding: '6px 12px', borderRadius: 8,
                        border: '1px solid var(--border)',
                        background: 'var(--panel)',
                        color: 'var(--muted)', fontWeight: 600, fontSize: 12, cursor: 'pointer',
                      }}
                    >
                      退回
                    </button>
                  </div>
                </div>
              ))}
              {pendingQueue.length === 0 && (
                <div className="insetGroupRow" style={{ borderTop: 'none' }}>
                  <div className="insetGroupRowContent">
                    <div className="insetGroupRowTitle">🎉 公告佇列已清空</div>
                    <div className="insetGroupRowMeta">沒有待審項目，全部都處理完了。</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 課程統計（系主任視角） / 系統設定（管理員視角） */}
          <div className="pageStack">
            {isDeptHead ? (
              <div className="sectionCard">
                <div className="homeSectionHeader">
                  <h2 className="homeSectionTitle">📊 本學期課程</h2>
                  <span className="homeSectionNote">{DEMO_COURSES.length} 門</span>
                </div>
                <div className="insetGroup">
                  {DEMO_COURSES.slice(0, 5).map((c, i) => (
                    <Link
                      key={c.id}
                      href={`/teacher/course/${c.id}${q}`}
                      className="insetGroupRow"
                      style={{
                        borderTop: i === 0 ? 'none' : undefined,
                        color: 'inherit',
                        textDecoration: 'none',
                      }}
                    >
                      <div
                        className="insetGroupRowIcon"
                        style={{ background: `${c.color}14`, color: c.color }}
                      >
                        {c.icon}
                      </div>
                      <div className="insetGroupRowContent">
                        <div className="insetGroupRowTitle">{c.name}</div>
                        <div className="insetGroupRowMeta">
                          {c.instructor} · {c.members} 位學生 · {c.credits} 學分
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}

            {isAdmin ? (
              <>
                <div className="sectionCard">
                  <div className="homeSectionHeader">
                    <h2 className="homeSectionTitle">🛡️ 使用者管理</h2>
                    <span className="homeSectionNote">{filteredUsers.length}/{DEMO_USERS.length} 個帳號</span>
                  </div>
                  {/* 搜尋列 */}
                  <div style={{ padding: '0 0 10px 0' }}>
                    <input
                      type="text"
                      className="input"
                      placeholder="🔍 搜尋姓名或 Email…"
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      style={{ width: '100%', fontSize: 13, padding: '8px 12px' }}
                    />
                  </div>
                  <div className="insetGroup">
                    {filteredUsers.map((u, i) => {
                      const disabled = isDisabled(u.uid);
                      return (
                        <div
                          key={u.uid}
                          className="insetGroupRow"
                          style={{ borderTop: i === 0 ? 'none' : undefined, opacity: disabled ? 0.55 : 1 }}
                        >
                          <div className="insetGroupRowContent">
                            <div className="insetGroupRowTitle" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              {u.displayName}
                              <span
                                style={{
                                  fontSize: 10, fontWeight: 700, padding: '2px 6px',
                                  borderRadius: 6, background: 'var(--panel)', color: 'var(--muted)',
                                }}
                              >
                                {u.role}
                              </span>
                              {disabled && (
                                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 6, background: 'rgba(255,59,48,0.12)', color: '#C0392B' }}>
                                  已停用
                                </span>
                              )}
                            </div>
                            <div className="insetGroupRowMeta">{u.email} · {u.department ?? '—'}</div>
                          </div>
                          <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                            <button
                              type="button"
                              onClick={() => {
                                if (disabled) {
                                  setUserDisabled(u.uid, false);
                                  success(`已重新啟用 ${u.displayName} 的帳號`);
                                } else {
                                  setUserDisabled(u.uid, true, '管理員手動停用');
                                  info(`已停用 ${u.displayName} 的帳號（可再次點擊啟用）`);
                                }
                              }}
                              style={{
                                padding: '4px 10px', fontSize: 11, borderRadius: 6, cursor: 'pointer',
                                background: disabled ? 'rgba(52,199,89,0.12)' : 'rgba(255,59,48,0.10)',
                                border: `1px solid ${disabled ? '#34C759' : '#FF3B30'}`,
                                color: disabled ? '#1F7A2E' : '#C0392B',
                                fontWeight: 700,
                              }}
                            >
                              {disabled ? '啟用' : '停用'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setRoleChangeUser(u)}
                              style={{
                                padding: '4px 10px', fontSize: 11, background: 'none',
                                border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--muted)',
                              }}
                            >
                              角色
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {filteredUsers.length === 0 && (
                      <div className="insetGroupRow" style={{ borderTop: 'none' }}>
                        <div className="insetGroupRowContent">
                          <div className="insetGroupRowTitle">🔍 無符合結果</div>
                          <div className="insetGroupRowMeta">請換個關鍵字搜尋</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* 安全日誌 */}
                <div className="sectionCard">
                  <div className="homeSectionHeader">
                    <h2 className="homeSectionTitle">🔐 安全日誌</h2>
                    <span className="homeSectionNote" style={{ color: '#C0392B', fontWeight: 700 }}>
                      ⚠️ 今日 1 件警示
                    </span>
                  </div>
                  <div className="insetGroup">
                    {SECURITY_LOG.map((log, i) => (
                      <div key={i} className="insetGroupRow" style={{ borderTop: i === 0 ? 'none' : undefined }}>
                        <div
                          className="insetGroupRowIcon"
                          style={{
                            background: log.level === 'high' ? 'rgba(255,59,48,0.12)'
                              : log.level === 'medium' ? 'rgba(255,149,0,0.12)'
                              : log.level === 'ok' ? 'rgba(52,199,89,0.12)'
                              : 'var(--panel)',
                            color: log.level === 'high' ? '#C0392B' : log.level === 'medium' ? '#C17A00' : log.level === 'ok' ? '#1F7A2E' : 'var(--muted)',
                            fontSize: 14,
                          }}
                        >
                          {log.level === 'high' ? '🚨' : log.level === 'medium' ? '⚠️' : log.level === 'ok' ? '✅' : 'ℹ️'}
                        </div>
                        <div className="insetGroupRowContent">
                          <div className="insetGroupRowTitle">{log.event}</div>
                          <div className="insetGroupRowMeta">{log.time} · {log.target}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="sectionCard">
                  <div className="homeSectionHeader">
                    <h2 className="homeSectionTitle">⚙️ 系統設定</h2>
                    <span className="homeSectionNote">維護模式 {maintenanceMode ? '🟠 開' : '🟢 關'}</span>
                  </div>
                  <div className="insetGroup">
                    {SYSTEM_SETTINGS_ROWS.map((row, i) => (
                      <button
                        key={row.title}
                        type="button"
                        onClick={() => setActionModal({
                          title: `${row.icon} ${row.title}`,
                          body: row.body,
                        })}
                        className="insetGroupRow"
                        style={{
                          borderTop: i === 0 ? 'none' : undefined,
                          width: '100%',
                          textAlign: 'left',
                          cursor: 'pointer',
                          background: 'none',
                        }}
                      >
                        <div className="insetGroupRowIcon">{row.icon}</div>
                        <div className="insetGroupRowContent">
                          <div className="insetGroupRowTitle">{row.title}</div>
                          <div className="insetGroupRowMeta">{row.meta}</div>
                        </div>
                        <span className="insetGroupRowChevron">›</span>
                      </button>
                    ))}
                    {/* 維護模式 toggle */}
                    <div
                      className="insetGroupRow"
                      style={{ width: '100%' }}
                    >
                      <div className="insetGroupRowIcon">🚧</div>
                      <div className="insetGroupRowContent">
                        <div className="insetGroupRowTitle">維護模式</div>
                        <div className="insetGroupRowMeta">
                          {maintenanceMode ? '已啟用：學生端會看到維護橫幅' : '未啟用：系統正常運作'}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setMaintenanceMode(!maintenanceMode);
                          if (!maintenanceMode) {
                            sendDeptBroadcast({
                              title: '系統將於今晚進入維護模式',
                              body: '系統將於今晚 23:00 進入例行維護，預計約 2 小時。請預先儲存進度。',
                              audience: ['student', 'teacher', 'ta'],
                              fromName: '系統管理員',
                            });
                            success('已啟用維護模式並廣播給全校');
                          } else {
                            info('已關閉維護模式');
                          }
                        }}
                        style={{
                          padding: '6px 12px', fontSize: 12, borderRadius: 8, cursor: 'pointer',
                          background: maintenanceMode ? 'rgba(255,149,0,0.12)' : 'var(--panel)',
                          border: `1px solid ${maintenanceMode ? '#FF9500' : 'var(--border)'}`,
                          color: maintenanceMode ? '#C17A00' : 'var(--muted)', fontWeight: 700,
                        }}
                      >
                        {maintenanceMode ? '🟠 已開啟' : '⚪ 關閉'}
                      </button>
                    </div>
                  </div>
                </div>
              </>
            ) : null}

            {/* 系主任額外：教師名冊 + 系所廣播 */}
            {isDeptHead ? (
              <>
              <div className="sectionCard">
                <div className="homeSectionHeader">
                  <h2 className="homeSectionTitle">🧑‍🏫 教師名冊</h2>
                </div>
                <div className="insetGroup">
                  {DEMO_COURSES.slice(0, 4).map((c, i) => (
                    <div
                      key={c.instructorId}
                      className="insetGroupRow"
                      style={{ borderTop: i === 0 ? 'none' : undefined }}
                    >
                      <div className="insetGroupRowContent">
                        <div className="insetGroupRowTitle">{c.instructor} 老師</div>
                        <div className="insetGroupRowMeta">
                          授課：{c.name} · {c.members} 位學生
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActionModal({
                          title: `🧑‍🏫 ${c.instructor} 老師檔案`,
                          body: (
                            <div style={{ fontSize: 13, lineHeight: 1.8 }}>
                              <div><strong>系所：</strong>{schoolName ?? '靜宜大學'} 資訊管理系</div>
                              <div><strong>授課課程：</strong>{c.name}（{c.code}）</div>
                              <div><strong>教室：</strong>{c.room}</div>
                              <div><strong>本學期學生：</strong>{c.members} 位</div>
                              <div><strong>學分數：</strong>{c.credits} 學分</div>
                              <div><strong>最近一則動態：</strong>{c.lastMessage}（{c.lastTime}）</div>
                              <div style={{ marginTop: 12, padding: 10, background: 'var(--panel)', borderRadius: 8, fontSize: 12 }}>
                                ℹ️ 系主任可以從此檔案進一步檢視該教師本學期的成績分布、出缺席與待批改件數。
                              </div>
                            </div>
                          ),
                          footer: (
                            <Link
                              href={`/teacher/course/${c.id}${q}`}
                              className="btn primary"
                              onClick={() => setActionModal(null)}
                              style={{ textDecoration: 'none' }}
                            >
                              進入課程工作台 →
                            </Link>
                          ),
                        })}
                        style={{
                          padding: '4px 10px',
                          fontSize: 11,
                          background: 'none',
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                          cursor: 'pointer',
                          color: 'var(--muted)',
                        }}
                      >
                        檔案
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* 系所廣播 */}
              <div className="sectionCard">
                <div className="homeSectionHeader">
                  <h2 className="homeSectionTitle">📢 系所廣播</h2>
                  <span className="homeSectionNote">寄給全系師生</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <input
                    type="text"
                    className="input"
                    placeholder="廣播標題（例：本學期期末考時程公告）"
                    value={broadcastDraft.title}
                    onChange={(e) => setBroadcastDraft({ ...broadcastDraft, title: e.target.value })}
                    style={{ width: '100%', fontSize: 13, padding: '8px 12px' }}
                  />
                  <textarea
                    className="input"
                    placeholder="廣播內文…"
                    rows={3}
                    value={broadcastDraft.body}
                    onChange={(e) => setBroadcastDraft({ ...broadcastDraft, body: e.target.value })}
                    style={{ width: '100%', fontSize: 13, padding: '8px 12px', fontFamily: 'inherit' }}
                  />
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => {
                      if (!broadcastDraft.title.trim() || !broadcastDraft.body.trim()) {
                        info('請輸入標題與內文');
                        return;
                      }
                      sendDeptBroadcast({
                        title: broadcastDraft.title,
                        body: broadcastDraft.body,
                        audience: ['student', 'teacher', 'ta'],
                        fromName: roleDef.label,
                      });
                      setBroadcastDraft({ title: '', body: '' });
                      success('✅ 已廣播給全系師生，可至訊息頁查看');
                    }}
                    style={{ alignSelf: 'flex-start' }}
                  >
                    📤 發送廣播
                  </button>
                </div>
              </div>
              </>
            ) : null}
          </div>
        </div>

        {/* ── AI 分析入口 ── */}
        <div
          className="card"
          style={{
            padding: '14px 18px',
            background: isAdmin
              ? 'linear-gradient(135deg, rgba(255,59,48,0.10) 0%, rgba(255,59,48,0.05) 100%)'
              : 'linear-gradient(135deg, rgba(255,149,0,0.10) 0%, rgba(255,200,0,0.06) 100%)',
            border: `1px solid ${isAdmin ? 'rgba(255,59,48,0.28)' : 'rgba(255,149,0,0.28)'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 14,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: isAdmin ? '#C0392B' : '#C17A00', marginBottom: 3 }}>
              🤖 {isAdmin ? 'AI 安全分析' : 'AI 行政助理'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text)' }}>
              {isAdmin
                ? `今日偵測到境外異常登入嘗試，${pendingQueue.length} 則公告待審。點擊讓 AI 生成安全摘要。`
                : `${pendingQueue.length} 則待審核公告，${stats.teacherCount} 位教師，${stats.studentCount} 位學生。讓 AI 生成系所週報？`}
            </div>
          </div>
          <Link
            href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent(
              isAdmin
                ? '分析今日系統安全事件，給出處置優先順序與建議，並列出需立即處理的項目'
                : `本學期系所共有 ${stats.teacherCount} 位教師、${stats.studentCount} 位學生，幫我生成一份系所行政週報摘要`
            )}`}
            className="btn"
            style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0, ...(isAdmin ? { background: 'var(--danger)', color: '#fff', borderColor: 'var(--danger)' } : {}) }}
          >
            {isAdmin ? '⚠️ AI 安全報告' : '問 AI →'}
          </Link>
        </div>

        {/* 底部：發布公告 / 跳查公告頁 */}
        <div
          className="card"
          style={{
            padding: '16px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>📢 公告管理</div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              {stats.publishedAnnouncements} 則已發布公告，可前往公告頁進行新增、編輯。
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => router.push(`/announcements${q ? q + '&' : '?'}compose=1`)}
              className="btn primary"
            >
              ＋ 發布公告
            </button>
            <Link href={`/announcements${q}`} className="btn">
              前往公告頁
            </Link>
          </div>
        </div>
      </div>

      {/* 通用動作 Modal */}
      <Modal
        isOpen={actionModal !== null}
        onClose={() => setActionModal(null)}
        title={actionModal?.title}
        size="lg"
        footer={actionModal?.footer ?? (
          <button
            type="button"
            className="btn"
            onClick={() => setActionModal(null)}
          >
            關閉
          </button>
        )}
      >
        {actionModal?.body}
      </Modal>

      {/* 角色變更 Modal */}
      <Modal
        isOpen={roleChangeUser !== null}
        onClose={() => setRoleChangeUser(null)}
        title={`角色設定：${roleChangeUser?.displayName}`}
        size="sm"
        footer={
          <button
            type="button"
            className="btn"
            onClick={() => setRoleChangeUser(null)}
          >
            關閉
          </button>
        }
      >
        {roleChangeUser ? (
          <div style={{ fontSize: 13, lineHeight: 1.7 }}>
            <div style={{ marginBottom: 12 }}>
              <strong>{roleChangeUser.displayName}</strong>（{roleChangeUser.email}）
            </div>
            <div style={{ marginBottom: 10 }}>目前角色：<strong>{roleChangeUser.role}</strong></div>
            <div style={{ marginBottom: 10 }}>變更為：</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {/* demo：角色變更僅寫 audit log，不會真改 DEMO_USERS（含 guest 訪客身份） */}
              {(['student', 'teacher', 'ta', 'club_officer', 'department_head', 'admin', 'alumni', 'guest'] as DemoRole[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    info(`已將 ${roleChangeUser.displayName} 的角色變更為 ${r}（demo：寫入 audit log）`);
                    setRoleChangeUser(null);
                  }}
                  disabled={r === roleChangeUser.role}
                  style={{
                    padding: '6px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: r === roleChangeUser.role ? 'default' : 'pointer',
                    border: '1px solid var(--border)',
                    background: r === roleChangeUser.role ? 'var(--brand-soft)' : 'var(--panel)',
                    color: r === roleChangeUser.role ? 'var(--brand)' : 'var(--text)',
                    opacity: r === roleChangeUser.role ? 0.7 : 1,
                  }}
                >
                  {r}{r === roleChangeUser.role ? ' ✓' : ''}
                </button>
              ))}
            </div>
            <div style={{ marginTop: 12, padding: 10, background: 'var(--panel)', borderRadius: 8, fontSize: 12, color: 'var(--muted)' }}>
              ℹ️ 角色變更會寫入安全日誌，並要求該使用者下次登入重新驗證。
            </div>
          </div>
        ) : null}
      </Modal>
    </SiteShell>
  );
}

// ── 系統設定 modal 內容（demo 用） ─────────────────────────────
const SYSTEM_SETTINGS_ROWS: { icon: string; title: string; meta: string; body: ReactNode }[] = [
  {
    icon: '🏫',
    title: '學校資訊',
    meta: '校徽、聯絡資訊、學期設定',
    body: (
      <div style={{ fontSize: 13, lineHeight: 1.8 }}>
        <div><strong>學校：</strong>靜宜大學</div>
        <div><strong>學年度：</strong>114 學年度 第 2 學期</div>
        <div><strong>學期起訖：</strong>2026-02-15 ~ 2026-06-22</div>
        <div><strong>校長：</strong>林思伶</div>
        <div><strong>聯絡 Email：</strong>contact@pu.edu.tw</div>
        <div><strong>校徽：</strong>已上傳（pu_logo.svg）</div>
        <div style={{ marginTop: 12, padding: 10, background: 'var(--panel)', borderRadius: 8, fontSize: 12 }}>
          ℹ️ 編輯學校資訊需要超級管理員權限與審核流程，demo 僅供檢視。
        </div>
      </div>
    ),
  },
  {
    icon: '🔐',
    title: '認證設定',
    meta: 'SSO、密碼策略、雙因素',
    body: (
      <div style={{ fontSize: 13, lineHeight: 1.8 }}>
        <div><strong>單一登入（SSO）：</strong>✅ 已啟用（pu.edu.tw OAuth2）</div>
        <div><strong>密碼最短長度：</strong>8 字元</div>
        <div><strong>密碼複雜度：</strong>需包含大小寫 + 數字</div>
        <div><strong>雙因素驗證：</strong>強制（教師、行政、管理員）／可選（學生）</div>
        <div><strong>Session 過期：</strong>30 天</div>
        <div><strong>登入失敗鎖定：</strong>5 次失敗即鎖定 15 分鐘</div>
      </div>
    ),
  },
  {
    icon: '📊',
    title: '系統日誌',
    meta: '登入紀錄、API 錯誤、稽核軌跡',
    body: (
      <div style={{ fontSize: 13, lineHeight: 1.7 }}>
        <div style={{ marginBottom: 8 }}><strong>近 24 小時日誌摘要：</strong></div>
        <div style={{ background: 'var(--panel)', padding: 12, borderRadius: 8, fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6 }}>
          <div>09:23 [WARN] 5 次登入失敗（IP: 荷蘭 Tor 出口節點）</div>
          <div>08:45 [INFO] API 請求速率 83% 峰值</div>
          <div>07:30 [OK] 例行備份完成 1.2 GB</div>
          <div>06:15 [INFO] 1 位教師密碼重設成功</div>
          <div>02:00 [OK] 排程任務：清除過期 session 完成</div>
        </div>
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>
          完整日誌可匯出 CSV / Splunk，並支援按角色 / 時間 / 事件類型過濾。
        </div>
      </div>
    ),
  },
  {
    icon: '🔔',
    title: '通知設定',
    meta: '推播、Email、SMS',
    body: (
      <div style={{ fontSize: 13, lineHeight: 1.8 }}>
        <div><strong>App 推播：</strong>✅ 已啟用（Firebase Cloud Messaging）</div>
        <div><strong>Email 通知：</strong>✅ 已啟用（SendGrid）</div>
        <div><strong>SMS 通知：</strong>⚠️ 僅緊急公告</div>
        <div><strong>批次通知時段：</strong>07:00–22:00</div>
        <div><strong>每日通知上限：</strong>每使用者 20 則</div>
        <div style={{ marginTop: 12, padding: 10, background: 'var(--panel)', borderRadius: 8, fontSize: 12 }}>
          ℹ️ 系所廣播會繞過每日上限，但仍受時段限制。
        </div>
      </div>
    ),
  },
];
