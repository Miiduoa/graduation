'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { useToast } from '@/components/ui';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import { useDemoRole, getCapabilities, getDemoRoleDefinition } from '@/lib/demoRole';
import { DEMO_COURSES, DEMO_GRADES, DEMO_STUDENTS } from '@/lib/demoData';

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
}

// 從 DEMO_STUDENTS 衍生 StudentInfo，保持與其他頁面（成績冊、課程）資料一致
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
    enrolledCourses: ['c1', 'c2', 'c3'],
    totalCredits: 60 + (parseInt(s.studentId.slice(-3), 10) % 20),
    gpa: Math.min(gpa, 4.3),
  };
});

export default function StudentDetailPage(props: {
  params: { id: string };
  searchParams?: { school?: string; schoolId?: string };
}) {
  const { schoolName, schoolSearch: q } = resolveSchoolPageContext(props.searchParams);
  const [demoRole] = useDemoRole();
  const caps = getCapabilities(demoRole);
  const roleDef = getDemoRoleDefinition(demoRole);
  const { info } = useToast();

  // 教師 / TA / 系主任 / 管理員 才能進
  const canView = caps.canViewTeacherDashboard || caps.canViewAdminDashboard;

  const student = useMemo(
    () => MOCK_STUDENTS.find((s) => s.uid === props.params.id || s.studentId === props.params.id),
    [props.params.id],
  );

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

        {/* 教師 / 管理動作 */}
        <div className="card" style={{ padding: '16px 20px' }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>🛠️ 管理動作</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => info('已開啟「寄信給學生」面板（demo）')}
              className="btn"
              style={{ fontSize: 13 }}
            >
              ✉️ 寄信
            </button>
            <button
              type="button"
              onClick={() => info('已開啟「出席紀錄」（demo）')}
              className="btn"
              style={{ fontSize: 13 }}
            >
              ✅ 出席紀錄
            </button>
            <button
              type="button"
              onClick={() => info('已開啟「畢業審查」（demo）')}
              className="btn"
              style={{ fontSize: 13 }}
            >
              🎯 畢業審查
            </button>
            {caps.canManageUsers && (
              <button
                type="button"
                onClick={() => info('已開啟「帳號設定」（demo）')}
                className="btn"
                style={{ fontSize: 13, color: 'var(--danger)' }}
              >
                🛡️ 帳號設定
              </button>
            )}
          </div>
        </div>
      </div>
    </SiteShell>
  );
}
