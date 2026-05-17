'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SiteShell } from '@/components/SiteShell';
import { useToast, Modal } from '@/components/ui';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import { useDemoRole, getCapabilities, getDemoRoleDefinition } from '@/lib/demoRole';
import { DEMO_COURSES, DEMO_GRADES, DEMO_STUDENTS } from '@/lib/demoData';
import { useDemoStore, setUserDisabled, isUserDisabled, sendMessage } from '@/lib/demoStore';

interface StudentInfo {
  uid: string;
  studentId: string;
  name: string;
  email: string;
  department: string;
  grade: string;
  enrolledCourses: string[];
  totalCredits: number;
  gpa: number;
  riskLevel: 'high' | 'mid' | 'low';
}

// 從 DEMO_STUDENTS 衍生 StudentInfo，保持與其他頁面（成績冊、課程）資料一致
// 每位學生的 enrolledCourses 來自 DEMO_STUDENTS 本身（不再硬寫 ['c1','c2','c3']）
const MOCK_STUDENTS: StudentInfo[] = DEMO_STUDENTS.map((s) => {
  const score = Math.round(s.scores.hw * 0.3 + s.scores.mid * 0.3 + s.scores.final * 0.4);
  const gpa = +(score >= 90 ? 4.0 + (score - 90) * 0.03 : score >= 80 ? 3.0 + (score - 80) * 0.1 : score >= 70 ? 2.0 + (score - 70) * 0.1 : score >= 60 ? 1.0 + (score - 60) * 0.1 : 0).toFixed(2);
  return {
    uid: s.uid,
    studentId: s.studentId,
    name: s.displayName,
    email: s.email,
    department: '資管系三年級',
    grade: '大三',
    enrolledCourses: s.enrolledCourses,
    totalCredits: 60 + (parseInt(s.studentId.slice(-3), 10) % 20),
    gpa: Math.min(gpa, 4.3),
    riskLevel: s.riskLevel,
  };
});

export default function StudentDetailPage(props: {
  params: { id: string };
  searchParams?: { school?: string; schoolId?: string };
}) {
  const { schoolName, schoolSearch: q } = resolveSchoolPageContext(props.searchParams);
  const router = useRouter();
  const [demoRole] = useDemoRole();
  const caps = getCapabilities(demoRole);
  const roleDef = getDemoRoleDefinition(demoRole);
  const { info, success } = useToast();
  const store = useDemoStore();
  const [composing, setComposing] = useState(false);
  const [emailDraft, setEmailDraft] = useState({ subject: '', body: '' });

  // 教師 / TA / 系主任 / 管理員 才能進
  const canView = caps.canViewTeacherDashboard || caps.canViewAdminDashboard;

  const student = useMemo(
    () => MOCK_STUDENTS.find((s) => s.uid === props.params.id || s.studentId === props.params.id),
    [props.params.id],
  );

  const isAccountDisabled = student ? isUserDisabled(student.uid, store) : false;

  if (!canView) {
    return (
      <SiteShell title="學生檔案" schoolName={schoolName}>
        <div className="pageStack">
          <div
            className="card"
            style={{
              padding: '32px 24px',
              textAlign: 'center',
              background: 'var(--danger-soft)',
              border: '1px solid var(--danger)',
            }}
          >
            <div style={{ fontSize: 56, marginBottom: 12 }}>🚫</div>
            <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 800 }}>沒有存取權限</h2>
            <p style={{ margin: '0 0 20px', color: 'var(--muted)' }}>
              你目前以「{roleDef.label}」身份瀏覽。學生個人檔案僅開放給教師 / 助教 / 系主任 / 管理員。
            </p>
            <Link href={`/${q}`} className="btn primary">
              ← 回首頁
            </Link>
          </div>
        </div>
      </SiteShell>
    );
  }

  if (!student) {
    return (
      <SiteShell title="學生檔案" schoolName={schoolName}>
        <div className="pageStack">
          <div className="card" style={{ padding: '32px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 56, marginBottom: 12 }}>👤</div>
            <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 800 }}>找不到此學生</h2>
            <p style={{ margin: '0 0 20px', color: 'var(--muted)' }}>
              學號 / UID「{props.params.id}」不存在於示範資料中。
            </p>
            <Link href={`/search${q}`} className="btn primary">
              ← 回搜尋
            </Link>
          </div>
        </div>
      </SiteShell>
    );
  }

  const enrolledCoursesDetails = DEMO_COURSES.filter((c) => student.enrolledCourses.includes(c.id));
  const studentGrades = DEMO_GRADES.filter((g) => student.enrolledCourses.includes(g.courseId));

  return (
    <SiteShell title={`學生檔案 · ${student.name}`} schoolName={schoolName}>
      <div className="pageStack">
        <nav style={{ fontSize: 13, color: 'var(--muted)' }}>
          <Link href={`/search${q}`} style={{ color: 'var(--muted)' }}>
            ← 回搜尋
          </Link>
          {' / '}
          <Link href={`/admin${q}`} style={{ color: 'var(--muted)' }}>
            管理後台
          </Link>
        </nav>

        {/* 學生卡片 */}
        <div
          className="card"
          style={{
            background: 'linear-gradient(135deg, var(--brand) 0%, #8EA5FF 100%)',
            color: '#fff',
            padding: '28px 24px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: 22,
                background: 'rgba(255,255,255,0.22)',
                display: 'grid',
                placeItems: 'center',
                fontSize: 36,
                border: '1px solid rgba(255,255,255,0.3)',
              }}
            >
              👤
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 22, fontWeight: 800 }}>{student.name}</div>
              <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>
                {student.studentId} · {student.department}
              </div>
              <div style={{ fontSize: 13, opacity: 0.85 }}>{student.email}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 28, fontWeight: 900 }}>{student.gpa.toFixed(2)}</div>
              <div style={{ fontSize: 11, opacity: 0.85 }}>GPA</div>
            </div>
          </div>
        </div>

        {/* 修課列表 */}
        <div className="sectionCard">
          <div className="homeSectionHeader">
            <h2 className="homeSectionTitle">📚 修課列表</h2>
            <span className="homeSectionNote">{enrolledCoursesDetails.length} 門</span>
          </div>
          <div className="insetGroup">
            {enrolledCoursesDetails.map((c, i) => {
              const grade = studentGrades.find((g) => g.courseId === c.id);
              return (
                <Link
                  key={c.id}
                  href={`/teacher/course/${c.id}/gradebook${q}`}
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
                      {c.instructor} · {c.credits} 學分
                    </div>
                  </div>
                  {grade ? (
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 16, fontWeight: 800, color: c.color }}>
                        {grade.grade}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{grade.score} 分</div>
                    </div>
                  ) : (
                    <span className="pill subtle">修課中</span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>

        {/* AI 學生洞察（教師最常用的場景） */}
        <div
          className="card"
          style={{
            padding: '14px 18px',
            background: student.riskLevel === 'high'
              ? 'linear-gradient(135deg, rgba(255,59,48,0.10) 0%, rgba(255,59,48,0.04) 100%)'
              : student.riskLevel === 'mid'
              ? 'linear-gradient(135deg, rgba(255,149,0,0.10) 0%, rgba(255,149,0,0.04) 100%)'
              : 'linear-gradient(135deg, rgba(52,199,89,0.10) 0%, rgba(52,199,89,0.04) 100%)',
            border: `1px solid ${student.riskLevel === 'high' ? '#FF3B30' : student.riskLevel === 'mid' ? '#FF9500' : '#34C759'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 14,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: student.riskLevel === 'high' ? '#C0392B' : student.riskLevel === 'mid' ? '#C17A00' : '#1F7A2E', marginBottom: 3 }}>
              🤖 AI 學生洞察 · {student.riskLevel === 'high' ? '⚠️ 需積極關注' : student.riskLevel === 'mid' ? '👀 持續觀察' : '✅ 狀況良好'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>
              {student.riskLevel === 'high'
                ? `${student.name} 的加權成績偏低、近期出席率下降。建議：（1）主動寄信關心（2）推薦輔導資源（3）下次點名後立即追蹤。`
                : student.riskLevel === 'mid'
                ? `${student.name} 表現中等，部分作業準時繳交但成績起伏較大。建議提供加分機會或學長姊伴讀。`
                : `${student.name} 學業表現穩定優秀，可考慮邀請擔任課程助教或推薦競賽。`}
            </div>
          </div>
          <Link
            href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent(`幫我分析 ${student.name}（${student.studentId}）這位學生的學習狀況，並建議下一步的輔導行動`)}`}
            className="btn"
            style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            問 AI →
          </Link>
        </div>

        {/* 教師 / 管理動作 */}
        <div className="card" style={{ padding: '16px 20px' }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>🛠️ 管理動作</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => {
                setEmailDraft({
                  subject: `關於你的學習狀況 · ${student.name}`,
                  body: `${student.name} 同學你好，\n\n（教師可在此寫信給學生，內容會送進該學生的訊息收件匣。）\n\n祝學習順利！`,
                });
                setComposing(true);
              }}
              className="btn"
              style={{ fontSize: 13 }}
            >
              ✉️ 寄信
            </button>
            <button
              type="button"
              onClick={() => router.push(`/teacher/course/c1/attendance${q}`)}
              className="btn"
              style={{ fontSize: 13 }}
            >
              ✅ 出席紀錄
            </button>
            <button
              type="button"
              onClick={() => router.push(`/credit-planner${q}`)}
              className="btn"
              style={{ fontSize: 13 }}
            >
              🎯 畢業審查
            </button>
            {caps.canManageUsers && (
              <button
                type="button"
                onClick={() => {
                  if (isAccountDisabled) {
                    setUserDisabled(student.uid, false);
                    success(`✅ 已重新啟用 ${student.name} 的帳號`);
                  } else {
                    setUserDisabled(student.uid, true, '管理員手動停用（學生檔案頁）');
                    info(`已停用 ${student.name} 的帳號`);
                  }
                }}
                className="btn"
                style={{ fontSize: 13, color: isAccountDisabled ? 'var(--success)' : 'var(--danger)' }}
              >
                {isAccountDisabled ? '🟢 啟用帳號' : '🛡️ 停用帳號'}
              </button>
            )}
          </div>
          {isAccountDisabled && (
            <div style={{ marginTop: 10, padding: 10, background: 'var(--danger-soft)', borderRadius: 8, fontSize: 12, color: 'var(--danger)' }}>
              ⚠️ 此帳號已停用：學生將無法登入或收新訊息。
            </div>
          )}
        </div>
      </div>

      {/* 寄信 Modal */}
      <Modal
        isOpen={composing}
        onClose={() => setComposing(false)}
        title={`✉️ 寄信給 ${student.name}`}
        size="lg"
        footer={
          <>
            <button className="btn" onClick={() => setComposing(false)}>取消</button>
            <button
              className="btn primary"
              onClick={() => {
                if (!emailDraft.subject.trim() || !emailDraft.body.trim()) {
                  info('請填寫主旨與內文');
                  return;
                }
                sendMessage({
                  fromName: `${roleDef.label}（${schoolName ?? '校園系統'}）`,
                  fromAvatar: roleDef.icon,
                  subject: emailDraft.subject,
                  body: emailDraft.body,
                  sentAt: '剛剛',
                  isRead: false,
                  type: 'action',
                  recipientRoles: ['student'],
                });
                setComposing(false);
                setEmailDraft({ subject: '', body: '' });
                success(`✅ 已寄出給 ${student.name}（學生會在訊息收件匣看到）`);
              }}
            >
              送出
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
          <label>
            <div style={{ marginBottom: 4, fontWeight: 600 }}>主旨</div>
            <input
              className="input"
              value={emailDraft.subject}
              onChange={(e) => setEmailDraft({ ...emailDraft, subject: e.target.value })}
              style={{ width: '100%', padding: '8px 12px', fontSize: 13 }}
            />
          </label>
          <label>
            <div style={{ marginBottom: 4, fontWeight: 600 }}>內文</div>
            <textarea
              className="input"
              value={emailDraft.body}
              onChange={(e) => setEmailDraft({ ...emailDraft, body: e.target.value })}
              rows={8}
              style={{ width: '100%', padding: '8px 12px', fontSize: 13, fontFamily: 'inherit' }}
            />
          </label>
          <div style={{ padding: 10, background: 'var(--accent-soft)', borderRadius: 8, fontSize: 12, color: 'var(--brand)' }}>
            🤖 <strong>AI 提示</strong>：可請 AI 助理為「{student.riskLevel === 'high' ? '需關注學生' : '一般學生'}」起草溫和有建設性的關心信。
          </div>
        </div>
      </Modal>
    </SiteShell>
  );
}
