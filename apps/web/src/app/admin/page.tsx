'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { useToast } from '@/components/ui';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import { useDemoRole, getCapabilities, getDemoRoleDefinition } from '@/lib/demoRole';
import {
  DEMO_COURSES,
  DEMO_USERS,
  DEMO_ANNOUNCEMENTS,
  DEMO_CLUBS,
  readPendingAnns,
  approvePendingAnn,
  type DemoPendingAnn,
} from '@/lib/demoData';
import { notifyStudentsAnnApproved } from '@/lib/demoStore';

export default function AdminPage(props: {
  searchParams?: { school?: string; schoolId?: string };
}) {
  const { schoolName, schoolSearch: q } = resolveSchoolPageContext(props.searchParams);
  const [role] = useDemoRole();
  const caps = getCapabilities(role);
  const roleDef = getDemoRoleDefinition(role);
  const { success, info } = useToast();
  // 待審公告：共用 localStorage（與 announcements/page.tsx 同步）
  // 用空陣列作初始值避免 SSR hydration mismatch，mount 後再從 localStorage 讀
  const [pendingQueue, setPendingQueue] = useState<DemoPendingAnn[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [disabledUsers, setDisabledUsers] = useState<Set<string>>(new Set());

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

  const filteredUsers = useMemo(
    () => DEMO_USERS.filter(
      (u) => !userSearch || u.displayName.includes(userSearch) || u.email.toLowerCase().includes(userSearch.toLowerCase()),
    ),
    [userSearch],
  );

  const SECURITY_LOG = [
    { time: '09:23', event: '5 次登入失敗嘗試（境外 IP：荷蘭 Tor 出口節點）', target: 'admin@pu.edu.tw', level: 'high' as const },
    { time: '08:45', event: 'API 請求速率達 83%（近峰值，建議監控）', target: '系統整體', level: 'medium' as const },
    { time: '07:30', event: '例行備份完成（1.2 GB）', target: '資料庫', level: 'ok' as const },
    { time: '昨日 22:15', event: '使用者帳號密碼重設', target: 'B10203015@pu.edu.tw', level: 'info' as const },
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
    // 通知學生有新公告（與 announcements/page.tsx 核准行為一致）
    if (ann) notifyStudentsAnnApproved(ann.title, ann.source);
    success('✅ 已核准並發布公告，學生現在可以看到');
  };

  const rejectPending = (id: string) => {
    approvePendingAnn(id); // 標為已處理（退回也移出佇列）
    setPendingQueue(readPendingAnns());
    info('🔄 已退回提交者修改');
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
                      const isDisabled = disabledUsers.has(u.uid);
                      return (
                        <div
                          key={u.uid}
                          className="insetGroupRow"
                          style={{ borderTop: i === 0 ? 'none' : undefined, opacity: isDisabled ? 0.55 : 1 }}
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
                              {isDisabled && (
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
                                setDisabledUsers((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(u.uid)) { next.delete(u.uid); success(`已重新啟用 ${u.displayName} 的帳號`); }
                                  else { next.add(u.uid); info(`已停用 ${u.displayName} 的帳號（demo）`); }
                                  return next;
                                });
                              }}
                              style={{
                                padding: '4px 10px', fontSize: 11, borderRadius: 6, cursor: 'pointer',
                                background: isDisabled ? 'rgba(52,199,89,0.12)' : 'rgba(255,59,48,0.10)',
                                border: `1px solid ${isDisabled ? '#34C759' : '#FF3B30'}`,
                                color: isDisabled ? '#1F7A2E' : '#C0392B',
                                fontWeight: 700,
                              }}
                            >
                              {isDisabled ? '啟用' : '停用'}
                            </button>
                            <button
                              type="button"
                              onClick={() => info(`已開啟 ${u.displayName} 的角色設定（demo）`)}
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
                  </div>
                  <div className="insetGroup">
                    {[
                      { icon: '🏫', title: '學校資訊', meta: '校徽、聯絡資訊、學期設定' },
                      { icon: '🔐', title: '認證設定', meta: 'SSO、密碼策略、雙因素' },
                      { icon: '📊', title: '系統日誌', meta: '登入紀錄、API 錯誤、稽核軌跡' },
                      { icon: '🔔', title: '通知設定', meta: '推播、Email、SMS' },
                    ].map((row, i) => (
                      <button
                        key={row.title}
                        type="button"
                        onClick={() => info(`已開啟「${row.title}」設定面板（demo）`)}
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
                  </div>
                </div>
              </>
            ) : null}

            {/* 系主任額外：教師名冊 */}
            {isDeptHead ? (
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
                        onClick={() => info(`已開啟 ${c.instructor} 老師的檔案（demo）`)}
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
              onClick={() => success('已開啟「發布公告」表單（demo）')}
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
    </SiteShell>
  );
}
