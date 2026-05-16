'use client';

import { useMemo, useState, type CSSProperties } from 'react';
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
} from '@/lib/demoData';

interface PendingAnnouncement {
  id: string;
  title: string;
  source: string;
  submittedAt: string;
}

const PENDING_QUEUE: PendingAnnouncement[] = [
  {
    id: 'pa-1',
    title: '【系主任審核】資管系畢業專題評分標準調整',
    source: '系所辦公室',
    submittedAt: '2 小時前',
  },
  {
    id: 'pa-2',
    title: '【系主任審核】2025 暑期實習合作廠商說明會',
    source: '產學合作中心',
    submittedAt: '4 小時前',
  },
  {
    id: 'pa-3',
    title: '【系主任審核】系友回娘家活動',
    source: '系學會',
    submittedAt: '昨天',
  },
];

export default function AdminPage(props: {
  searchParams?: { school?: string; schoolId?: string };
}) {
  const { schoolName, schoolSearch: q } = resolveSchoolPageContext(props.searchParams);
  const [role] = useDemoRole();
  const caps = getCapabilities(role);
  const roleDef = getDemoRoleDefinition(role);
  const { success, info } = useToast();
  const [approvedIds, setApprovedIds] = useState<Set<string>>(new Set());

  const stats = useMemo(() => {
    const totalUsers = DEMO_USERS.length + 132; // 加偽造的學生人數
    const teacherCount = DEMO_USERS.filter((u) => u.role === 'teacher').length + 18;
    const studentCount = totalUsers - teacherCount - 5;
    return {
      totalUsers,
      teacherCount,
      studentCount,
      totalCourses: DEMO_COURSES.length,
      totalClubs: DEMO_CLUBS.length,
      pendingApprovals: PENDING_QUEUE.length - approvedIds.size,
      publishedAnnouncements: DEMO_ANNOUNCEMENTS.length,
    };
  }, [approvedIds]);

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
    setApprovedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    success('已核准並發布公告');
  };

  const rejectPending = (id: string) => {
    setApprovedIds((prev) => {
      const next = new Set(prev);
      next.add(id); // 一樣標為處理過
      return next;
    });
    info('已退回提交者修改');
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
              {PENDING_QUEUE.map((p, i) => {
                const isProcessed = approvedIds.has(p.id);
                return (
                  <div
                    key={p.id}
                    className="insetGroupRow"
                    style={{
                      borderTop: i === 0 ? 'none' : undefined,
                      opacity: isProcessed ? 0.5 : 1,
                    }}
                  >
                    <div className="insetGroupRowContent">
                      <div className="insetGroupRowTitle">{p.title}</div>
                      <div className="insetGroupRowMeta">
                        {p.source} · 提交於 {p.submittedAt}
                      </div>
                    </div>
                    {!isProcessed ? (
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        <button
                          type="button"
                          onClick={() => approvePending(p.id)}
                          style={{
                            padding: '6px 12px',
                            borderRadius: 8,
                            border: '1px solid #34C759',
                            background: 'rgba(52,199,89,0.12)',
                            color: '#1F7A2E',
                            fontWeight: 700,
                            fontSize: 12,
                            cursor: 'pointer',
                          }}
                        >
                          ✓ 核准
                        </button>
                        <button
                          type="button"
                          onClick={() => rejectPending(p.id)}
                          style={{
                            padding: '6px 12px',
                            borderRadius: 8,
                            border: '1px solid var(--border)',
                            background: 'var(--panel)',
                            color: 'var(--muted)',
                            fontWeight: 600,
                            fontSize: 12,
                            cursor: 'pointer',
                          }}
                        >
                          退回
                        </button>
                      </div>
                    ) : (
                      <span style={{ color: 'var(--success)', fontSize: 12, fontWeight: 700 }}>
                        ✓ 已處理
                      </span>
                    )}
                  </div>
                );
              })}
              {stats.pendingApprovals === 0 && (
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
                    <span className="homeSectionNote">{DEMO_USERS.length} 個示範帳號</span>
                  </div>
                  <div className="insetGroup">
                    {DEMO_USERS.map((u, i) => (
                      <div
                        key={u.uid}
                        className="insetGroupRow"
                        style={{ borderTop: i === 0 ? 'none' : undefined }}
                      >
                        <div className="insetGroupRowContent">
                          <div className="insetGroupRowTitle">
                            {u.displayName}
                            <span
                              style={{
                                marginLeft: 8,
                                fontSize: 10,
                                fontWeight: 700,
                                padding: '2px 6px',
                                borderRadius: 6,
                                background: 'var(--panel)',
                                color: 'var(--muted)',
                              }}
                            >
                              {u.role}
                            </span>
                          </div>
                          <div className="insetGroupRowMeta">
                            {u.email} · {u.department ?? '—'}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => info(`已開啟 ${u.displayName} 的帳號設定（demo）`)}
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
                          管理
                        </button>
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
