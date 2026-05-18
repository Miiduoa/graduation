'use client';

import { SiteShell } from '@/components/SiteShell';
import { useState, useMemo, useEffect, type CSSProperties } from 'react';
import Link from 'next/link';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import { getAuth, fetchGrades, fetchGPA, isFirebaseConfigured, type Grade } from '@/lib/firebase';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { DEMO_GRADES, DEMO_HISTORY_SEMESTERS, DEMO_STUDENTS, DEMO_COURSES } from '@/lib/demoData';
import { useDemoRole } from '@/lib/demoRole';
import { useDemoStore } from '@/lib/demoStore';

interface GradeDisplay {
  courseId?: string;
  code: string;
  name: string;
  credits: number;
  grade: string;
  score: number;
  gpa: number;
  instructor: string;
  rank?: string;
}

// 從 demoData 衍生成績清單，跟課表 courseId 一致
const DEFAULT_GRADES: GradeDisplay[] = DEMO_GRADES.map((g) => ({
  courseId: g.courseId,
  code: g.code,
  name: g.name,
  credits: g.credits,
  grade: g.grade,
  score: g.score,
  gpa: g.gpa,
  instructor: g.instructor,
  rank: g.rank,
}));

// 與 DEMO_HISTORY_SEMESTERS.semesterGpa 完全對齊（大一上→大二下）
const DEFAULT_GPA_HISTORY = [
  { semester: '111-1', gpa: 3.42 },
  { semester: '111-2', gpa: 3.58 },
  { semester: '112-1', gpa: 3.71 },
  { semester: '112-2', gpa: 3.82 },
];

// 生成最近 4 個學期清單
function generateSemesters(): string[] {
  const now = new Date();
  const year = now.getFullYear() - 1911;
  const month = now.getMonth() + 1;
  const currentSem = month >= 2 && month <= 7 ? 2 : 1;
  const sems: string[] = [];
  let y = year;
  let s = currentSem;
  for (let i = 0; i < 4; i++) {
    sems.push(`${y}-${s}`);
    s--;
    if (s < 1) {
      s = 2;
      y--;
    }
  }
  return sems;
}

function gradeToGpa(grade: string): number {
  const map: Record<string, number> = {
    'A+': 4.3,
    A: 4.0,
    'A-': 3.7,
    'B+': 3.3,
    B: 3.0,
    'B-': 2.7,
    'C+': 2.3,
    C: 2.0,
    'C-': 1.7,
    D: 1.0,
    F: 0,
  };
  return map[grade] ?? 0;
}

function mapFirebaseGrade(g: Grade): GradeDisplay {
  return {
    courseId: g.courseId,
    code: g.courseCode ?? g.id,
    name: g.courseName,
    credits: g.credits,
    grade: g.grade,
    score: g.score ?? 0,
    gpa: g.gpa ?? gradeToGpa(g.grade),
    instructor: g.instructor ?? '—',
    rank: g.rank != null && g.classSize != null ? `${g.rank}/${g.classSize}` : undefined,
  };
}

function gradeColor(grade: string): string {
  if (grade.startsWith('A')) return 'var(--success)';
  if (grade.startsWith('B')) return 'var(--info)';
  if (grade.startsWith('C')) return 'var(--warning)';
  if (grade.startsWith('D')) return '#FF9500';
  return 'var(--danger)';
}

function gradeBackground(grade: string): string {
  if (grade.startsWith('A')) return 'var(--success-soft)';
  if (grade.startsWith('B')) return 'var(--info-soft)';
  if (grade.startsWith('C')) return 'var(--warning-soft)';
  return 'var(--danger-soft)';
}

const SEMESTERS = generateSemesters();

export default function GradesPage(props: {
  searchParams?: { school?: string; schoolId?: string };
}) {
  const { schoolName, schoolSearch: q } = resolveSchoolPageContext(props.searchParams);
  const [demoRole] = useDemoRole();
  const store = useDemoStore();
  const [selectedSemester, setSelectedSemester] = useState(SEMESTERS[0]);
  const [sortBy, setSortBy] = useState<'name' | 'score' | 'gpa'>('score');
  const [user, setUser] = useState<User | null>(null);
  const [grades, setGrades] = useState<GradeDisplay[]>(DEFAULT_GRADES);
  const [gpaHistory, setGpaHistory] = useState(DEFAULT_GPA_HISTORY);
  const [loading, setLoading] = useState(false);
  const [, setUsingDemo] = useState(true);

  // 監聽 Auth 狀態
  useEffect(() => {
    const auth = getAuth();
    if (!auth) return;
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  // 依學期載入成績
  useEffect(() => {
    if (!user || !isFirebaseConfigured()) {
      if (demoRole === 'alumni') {
        // 校友：顯示歷史學期成績（最後一個學期）
        const lastSem = DEMO_HISTORY_SEMESTERS[DEMO_HISTORY_SEMESTERS.length - 1];
        setGrades(lastSem.courses.map((c) => ({
          code: c.code,
          name: c.name,
          credits: c.credits,
          grade: c.grade,
          score: c.score,
          gpa: c.gpa,
          instructor: c.instructor,
        })));
        setGpaHistory(DEMO_HISTORY_SEMESTERS.map((s) => ({ semester: s.semester, gpa: s.semesterGpa })));
      } else {
        setGrades(DEFAULT_GRADES);
      }
      setUsingDemo(true);
      return;
    }
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const [fbGrades, gpaData] = await Promise.all([
          fetchGrades(user!.uid, selectedSemester),
          fetchGPA(user!.uid),
        ]);
        if (!active) return;
        if (fbGrades.length > 0) {
          setGrades(fbGrades.map(mapFirebaseGrade));
          setUsingDemo(false);
        } else {
          setGrades(DEFAULT_GRADES);
          setUsingDemo(true);
        }
        if (gpaData?.semesters && gpaData.semesters.length > 0) {
          setGpaHistory(gpaData.semesters);
        }
      } catch {
        if (active) {
          setGrades(DEFAULT_GRADES);
          setUsingDemo(true);
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [user, selectedSemester, demoRole]);

  const sorted = useMemo(
    () =>
      [...grades].sort((a, b) => {
        if (sortBy === 'score') return b.score - a.score;
        if (sortBy === 'gpa') return b.gpa - a.gpa;
        return a.name.localeCompare(b.name, 'zh-TW');
      }),
    [grades, sortBy],
  );

  const semGpa = useMemo(() => {
    const total = grades.reduce((s, g) => s + g.credits, 0);
    if (total === 0) return 0;
    return +(grades.reduce((s, g) => s + g.gpa * g.credits, 0) / total).toFixed(2);
  }, [grades]);

  const totalCredits = useMemo(() => grades.reduce((s, g) => s + g.credits, 0), [grades]);
  const avgScore = useMemo(
    () =>
      grades.length > 0 ? Math.round(grades.reduce((s, g) => s + g.score, 0) / grades.length) : 0,
    [grades],
  );

  const maxGpa = gpaHistory.length > 0 ? Math.max(...gpaHistory.map((h) => h.gpa)) : 4.3;

  // ── 教師 / TA 班級成績統計 ─────────────────────────────────
  const classScores = useMemo(() => {
    return DEMO_STUDENTS.map((s) => Math.round(s.scores.hw * 0.3 + s.scores.mid * 0.3 + s.scores.final * 0.4));
  }, []);
  const classAvg = useMemo(() => Math.round(classScores.reduce((a, b) => a + b, 0) / classScores.length), [classScores]);
  const classMax = useMemo(() => Math.max(...classScores), [classScores]);
  const classMin = useMemo(() => Math.min(...classScores), [classScores]);
  const classPassing = useMemo(() => classScores.filter((s) => s >= 60).length, [classScores]);
  const classPassRate = useMemo(() => Math.round((classPassing / classScores.length) * 100), [classPassing, classScores]);

  // 系主任：全系各課程統計
  const deptCourseStats = useMemo(() => {
    return DEMO_COURSES.slice(0, 6).map((c) => {
      const avg = 70 + ((c.members * 3) % 20);
      const passing = Math.round(c.members * (0.85 + (c.id.charCodeAt(1) % 3) * 0.04));
      return { ...c, avg, passing, passRate: Math.round((passing / c.members) * 100) };
    });
  }, []);

  const isTeacherView = demoRole === 'teacher' || demoRole === 'ta';
  const isDeptHead = demoRole === 'department_head';
  const isAlumni = demoRole === 'alumni';
  const isGuest = demoRole === 'guest';

  // 訪客：直接顯示無權限
  if (isGuest) {
    return (
      <SiteShell title="成績" schoolName={schoolName}>
        <div className="pageStack">
          <div className="card" style={{ padding: '32px 24px', textAlign: 'center', background: 'rgba(0,122,255,0.06)', border: '1px solid #007AFF' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>需要登入</div>
            <div style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 20 }}>成績為個人隱私資料，訪客無法查看。請先登入。</div>
            <Link href={`/login${q}`} className="btn primary">前往登入 →</Link>
          </div>
        </div>
      </SiteShell>
    );
  }

  // 教師 / TA：顯示班級成績分布（不是個人成績）
  if (isTeacherView) {
    return (
      <SiteShell
        title={demoRole === 'ta' ? '成績冊（助教視角）' : '班級成績管理'}
        subtitle="資料結構（CS301）· 全班成績分布"
        schoolName={schoolName}
      >
        <div className="pageStack">
          {/* 角色說明 */}
          <div className="card" style={{ padding: '14px 16px', background: 'rgba(15,139,141,0.10)', border: '1px solid #0F8B8D' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 700, color: '#0F8B8D', marginBottom: 4 }}>
                  {demoRole === 'ta' ? '🧑‍💻 助教視角' : '🧑‍🏫 教師視角'} · 資料結構（CS301）
                </div>
                <div style={{ fontSize: 13, color: 'var(--text)' }}>
                  {demoRole === 'ta'
                    ? '你可以查看成績冊，但「發布成績」按鈕由王大明老師操作。'
                    : '這是你的班級成績概覽。點「開啟成績冊」可批改作業並發布成績。'}
                </div>
              </div>
              <Link href={`/teacher/course/c1/gradebook${q}`} className="btn primary" style={{ fontSize: 12 }}>
                開啟成績冊 →
              </Link>
            </div>
          </div>

          {/* 班級成績統計卡 */}
          <div className="metricGrid">
            {[
              { label: '班級平均', val: `${classAvg} 分`, tone: '#5E6AD2' },
              { label: '最高分', val: `${classMax} 分`, tone: '#34C759' },
              { label: '最低分', val: `${classMin} 分`, tone: '#FF3B30' },
              { label: '通過率', val: `${classPassRate}%`, tone: '#FF9500' },
            ].map((m) => (
              <div key={m.label} className="metricCard" style={{ '--tone': m.tone } as CSSProperties}>
                <div className="metricValue" style={{ color: m.tone }}>{m.val}</div>
                <div className="metricLabel">{m.label}</div>
              </div>
            ))}
          </div>

          {/* 分數分布 */}
          <div className="card">
            <h3 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 700 }}>📊 全班分數分布（{DEMO_STUDENTS.length} 位代表學生）</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { label: 'A（90-100）', count: classScores.filter((s) => s >= 90).length, color: 'var(--success)' },
                { label: 'B（80-89）', count: classScores.filter((s) => s >= 80 && s < 90).length, color: 'var(--info)' },
                { label: 'C（70-79）', count: classScores.filter((s) => s >= 70 && s < 80).length, color: 'var(--warning)' },
                { label: 'D（60-69）', count: classScores.filter((s) => s >= 60 && s < 70).length, color: '#FF9500' },
                { label: '不及格（< 60）', count: classScores.filter((s) => s < 60).length, color: 'var(--danger)' },
              ].map((row) => (
                <div key={row.label}>
                  <div className="progressMeta">
                    <span style={{ fontSize: 13 }}>{row.label}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: row.color }}>{row.count} 人</span>
                  </div>
                  <div className="progressTrack">
                    <div className="progressFill" style={{ '--progress-width': `${(row.count / DEMO_STUDENTS.length) * 100}%`, '--progress': `linear-gradient(90deg, ${row.color} 0%, ${row.color}80 100%)` } as CSSProperties} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* TA 視角：顯示被指派批改的範圍說明 */}
          {demoRole === 'ta' && (
            <div className="card" style={{ padding: '12px 14px', background: 'var(--panel)', border: '1px dashed var(--border)', fontSize: 12, color: 'var(--muted)' }}>
              ℹ️ TA 視角：僅顯示你被指派批改的學生（後半段 stu-007 ~ stu-012）。其他學生由王大明老師另指派 TA。
            </div>
          )}

          {/* 學生成績清單 */}
          <div className="sectionCard">
            <div className="homeSectionHeader">
              <h2 className="homeSectionTitle">👥 學生成績清單</h2>
              {demoRole === 'teacher' && (
                <Link href={`/teacher/course/c1/gradebook${q}`} className="btn" style={{ fontSize: 12 }}>發布成績</Link>
              )}
              {demoRole === 'ta' && (
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>唯讀 · 由教師發布</span>
              )}
            </div>
            <div className="insetGroup">
              {(demoRole === 'ta'
                ? DEMO_STUDENTS.filter((s) => s.c1Group === 'second-half')
                : DEMO_STUDENTS
              ).map((s, i) => {
                const finalScore = Math.round(s.scores.hw * 0.3 + s.scores.mid * 0.3 + s.scores.final * 0.4);
                const isAtRisk = finalScore < 70;
                return (
                  <div key={s.uid} className="insetGroupRow" style={{ borderTop: i === 0 ? 'none' : undefined }}>
                    <div className="insetGroupRowIcon" style={{ background: isAtRisk ? 'var(--danger-soft)' : 'var(--success-soft)', fontSize: 13, fontWeight: 700, color: isAtRisk ? 'var(--danger)' : 'var(--success)', width: 38, height: 38, borderRadius: 10 }}>
                      {finalScore}
                    </div>
                    <div className="insetGroupRowContent">
                      <div className="insetGroupRowTitle">
                        {s.displayName}
                        {isAtRisk && <span style={{ marginLeft: 8, fontSize: 11, background: 'var(--danger-soft)', color: 'var(--danger)', padding: '2px 6px', borderRadius: 4 }}>⚠️ 需關注</span>}
                      </div>
                      <div className="insetGroupRowMeta">{s.studentId} · 作業 {s.scores.hw} · 期中 {s.scores.mid} · 期末 {s.scores.final}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>加權分數</div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: isAtRisk ? 'var(--danger)' : 'var(--success)' }}>{finalScore}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* AI 班級分析入口 */}
          <div className="card" style={{ padding: '14px 18px', background: 'linear-gradient(135deg, rgba(15,139,141,0.10) 0%, rgba(0,200,200,0.06) 100%)', border: '1px solid rgba(15,139,141,0.28)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#0F8B8D', marginBottom: 3 }}>🤖 AI 班級分析</div>
              <div style={{ fontSize: 13, color: 'var(--text)' }}>班級平均 {classAvg} 分，{classScores.filter((s) => s < 70).length} 位學生需要關注。讓 AI 分析成績趨勢？</div>
            </div>
            <Link href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent('幫我分析資料結構班上成績，找出需要關注的學生')}`} className="btn" style={{ fontSize: 12 }}>問 AI →</Link>
          </div>
        </div>
      </SiteShell>
    );
  }

  // 系主任：全系成績統計視圖
  if (isDeptHead) {
    return (
      <SiteShell title="全系成績統計" subtitle="資訊管理系 · 本學期課程成績概覽" schoolName={schoolName}>
        <div className="pageStack">
          <div className="card" style={{ padding: '14px 16px', background: 'rgba(255,149,0,0.10)', border: '1px solid #FF9500' }}>
            <div style={{ fontWeight: 700, color: '#FF9500', marginBottom: 4 }}>🏛️ 系主任視角</div>
            <div style={{ fontSize: 13, color: 'var(--text)' }}>你可以查看全系各課程的成績統計，但不會看到個別學生的成績（須保護個人隱私）。</div>
          </div>

          {/* 全系統計卡 */}
          <div className="metricGrid">
            {[
              { label: '本學期課程', val: `${DEMO_COURSES.length + 8} 門`, tone: '#5E6AD2' },
              { label: '在學學生', val: '312 人', tone: '#0F8B8D' },
              { label: '全系平均分', val: '83.2 分', tone: '#34C759' },
              { label: '不及格率', val: '3.8%', tone: '#FF9500' },
            ].map((m) => (
              <div key={m.label} className="metricCard" style={{ '--tone': m.tone } as CSSProperties}>
                <div className="metricValue" style={{ color: m.tone }}>{m.val}</div>
                <div className="metricLabel">{m.label}</div>
              </div>
            ))}
          </div>

          {/* 各課程成績統計 */}
          <div className="sectionCard">
            <div className="homeSectionHeader">
              <h2 className="homeSectionTitle">📚 各課程成績摘要</h2>
              <span className="homeSectionNote">點課程進入教師工作台</span>
            </div>
            <div className="insetGroup">
              {deptCourseStats.map((c, i) => (
                <Link key={c.id} href={`/teacher/course/${c.id}${q}`} className="insetGroupRow" style={{ borderTop: i === 0 ? 'none' : undefined, color: 'inherit', textDecoration: 'none' }}>
                  <div className="insetGroupRowIcon" style={{ background: `${c.color}20`, fontSize: 18, width: 38, height: 38, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{c.icon}</div>
                  <div className="insetGroupRowContent">
                    <div className="insetGroupRowTitle">{c.name}</div>
                    <div className="insetGroupRowMeta">{c.code} · {c.instructor} · {c.members} 人</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: c.avg >= 80 ? 'var(--success)' : c.avg >= 70 ? 'var(--warning)' : 'var(--danger)' }}>{c.avg} 分</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>通過率 {c.passRate}%</div>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* AI 系所分析 */}
          <div className="card" style={{ padding: '14px 18px', background: 'linear-gradient(135deg, rgba(255,149,0,0.10) 0%, rgba(255,200,0,0.06) 100%)', border: '1px solid rgba(255,149,0,0.28)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#FF9500', marginBottom: 3 }}>🤖 AI 系所分析</div>
              <div style={{ fontSize: 13, color: 'var(--text)' }}>讓 AI 分析本學期各課程成績趨勢，找出需要關注的課程？</div>
            </div>
            <Link href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent('本學期各課程平均分數？哪些課程分數偏低需要關注？')}`} className="btn" style={{ fontSize: 12 }}>問 AI →</Link>
          </div>
        </div>
      </SiteShell>
    );
  }

  // 系統管理員：不適用個人成績
  if (demoRole === 'admin') {
    return (
      <SiteShell title="成績" schoolName={schoolName}>
        <div className="pageStack">
          <div className="card" style={{ padding: '32px 24px', textAlign: 'center', background: 'rgba(255,59,48,0.08)', border: '1px solid #FF3B30' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🛡️</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>系統管理員不適用個人成績頁</div>
            <div style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 20 }}>
              你目前以系統管理員身份瀏覽。成績頁面為個人學業用途，系統管理員請至管理後台查看全系成績統計。
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <a href={`/admin${q}`} className="btn primary">前往管理後台 →</a>
              <a href={`/search?type=student${q ? '&' + q.slice(1) : ''}`} className="btn">學生成績管理</a>
            </div>
          </div>
        </div>
      </SiteShell>
    );
  }

  return (
    <SiteShell
      title={isAlumni ? '在校成績（唯讀）' : '成績'}
      subtitle={isAlumni ? '校友身份 · 歷史成績查詢（唯讀）' : `${selectedSemester} 學期成績查詢`}
      schoolName={schoolName}
      schoolCode={selectedSemester}
    >
      <div className="pageStack">
        {/* 校友：唯讀提示 */}
        {isAlumni && (
          <div
            className="card"
            style={{
              padding: '14px 16px',
              background: 'rgba(142,142,147,0.10)',
              border: '1px solid #8E8E93',
              fontSize: 13,
            }}
          >
            🎓 <strong>校友身份</strong> · 以下顯示的是你在校期間的歷史成績，僅供查閱，無法申請重修或更改。
            如需申請正式成績單，請聯絡教務處。
          </div>
        )}

        {/* 教師剛發布成績：動態通知橫幅（學生專用） */}
        {demoRole === 'student' && store.publishedGrades.length > 0 && (
          <div
            className="card"
            style={{
              padding: '14px 18px',
              background: 'rgba(22,163,74,0.10)',
              border: '1px solid #16a34a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 14,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#16a34a', marginBottom: 3 }}>
                🎓 成績已更新！
              </div>
              <div style={{ fontSize: 13, color: 'var(--text)' }}>
                {store.publishedGrades[0].courseName} 的成績已由教師發布。
                你的成績：<strong>{store.publishedGrades[0].grade}（{store.publishedGrades[0].score} 分）</strong>
              </div>
            </div>
            <Link
              href={`/messages${q}`}
              className="btn"
              style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0, background: '#16a34a', color: '#fff', border: 'none' }}
            >
              查看訊息通知 →
            </Link>
          </div>
        )}

        {/* ── GPA Hero Card ── */}
        <div
          className="card"
          style={{
            background: 'linear-gradient(135deg, var(--brand) 0%, #8EA5FF 100%)',
            border: 'none',
            color: '#fff',
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 20,
              flexWrap: 'wrap',
            }}
          >
            <div>
              <p
                style={{
                  margin: '0 0 4px',
                  fontSize: 11,
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  opacity: 0.75,
                  fontWeight: 600,
                }}
              >
                {selectedSemester} 學期 · 學期 GPA
              </p>
              <div
                style={{ fontSize: 64, fontWeight: 900, letterSpacing: '-0.06em', lineHeight: 1 }}
              >
                {loading ? '…' : semGpa}
              </div>
              <p style={{ margin: '8px 0 0', fontSize: 14, opacity: 0.82 }}>
                修習 {totalCredits} 學分 · 平均分數 {avgScore} 分
              </p>
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {[
                { label: '課程數', val: grades.length },
                {
                  label: '最高分',
                  val: grades.length > 0 ? Math.max(...grades.map((g) => g.score)) : 0,
                },
                { label: 'A 以上', val: grades.filter((g) => g.grade.startsWith('A')).length },
              ].map((s) => (
                <div key={s.label} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.05em' }}>
                    {s.val}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── AI 成績分析入口（學生 / 教師） ── */}
        {(demoRole === 'student' || demoRole === 'alumni') && (
          <div
            className="card"
            style={{
              padding: '14px 18px',
              background: 'linear-gradient(135deg, rgba(94,106,210,0.10) 0%, rgba(142,186,255,0.07) 100%)',
              border: '1px solid rgba(94,106,210,0.22)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 14,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--brand)', marginBottom: 3 }}>
                🤖 AI 成績分析
              </div>
              <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>
                GPA 趨勢：{DEMO_HISTORY_SEMESTERS.map((s) => s.semesterGpa).join(' → ')}（逐學期上升 ✅）
                。想知道哪科要補強、選課策略怎麼調整？
              </div>
            </div>
            <Link
              href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent('根據我的歷史成績幫我分析強弱項，並建議下學期的選課策略')}`}
              className="btn"
              style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              問 AI →
            </Link>
          </div>
        )}

        {/* ── GPA Trend ── */}
        {gpaHistory.length > 0 && (
          <div className="card">
            <h3
              style={{
                margin: '0 0 14px',
                fontSize: 16,
                fontWeight: 700,
                letterSpacing: '-0.02em',
              }}
            >
              GPA 歷學期趨勢
            </h3>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
              {gpaHistory.slice(-6).map((h) => {
                const pct = (h.gpa / (maxGpa + 0.3)) * 100;
                const isLatest = h.semester === selectedSemester;
                return (
                  <div
                    key={h.semester}
                    style={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 800,
                        color: isLatest ? 'var(--brand)' : 'var(--text)',
                      }}
                    >
                      {h.gpa}
                    </div>
                    <div
                      style={{
                        width: '100%',
                        height: `${pct * 0.8}px`,
                        minHeight: 20,
                        borderRadius: 'var(--radius-xs)',
                        background: isLatest
                          ? 'linear-gradient(180deg, var(--brand) 0%, var(--brand2) 100%)'
                          : 'var(--panel2)',
                        boxShadow: isLatest ? 'var(--shadow-sm)' : 'var(--shadow-inset)',
                        transition: 'height 0.4s ease',
                      }}
                    />
                    <div
                      style={{
                        fontSize: 11,
                        color: isLatest ? 'var(--brand)' : 'var(--muted)',
                        fontWeight: isLatest ? 700 : 500,
                      }}
                    >
                      {h.semester}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Toolbar ── */}
        <div className="toolbarPanel">
          <div className="toolbarGrow">
            <select
              className="input"
              value={selectedSemester}
              onChange={(e) => setSelectedSemester(e.target.value)}
              style={{ minHeight: 40, fontSize: 13 }}
            >
              {SEMESTERS.map((s) => (
                <option key={s} value={s}>
                  {s} 學期
                </option>
              ))}
            </select>
          </div>
          <div className="toolbarActions">
            <div className="segmentedGroup">
              {[
                { key: 'score', label: '分數' },
                { key: 'gpa', label: 'GPA' },
                { key: 'name', label: '名稱' },
              ].map((s) => (
                <button
                  key={s.key}
                  className={sortBy === s.key ? 'active' : ''}
                  onClick={() => setSortBy(s.key as typeof sortBy)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Grades List ── */}
        <div className="sectionCard">
          <div
            style={{
              fontSize: 11,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--muted)',
              fontWeight: 600,
              padding: '0 4px',
            }}
          >
            {selectedSemester} 學期成績 · {grades.length} 門課程{loading ? ' · 載入中...' : ''}
          </div>
          <div className="insetGroup">
            {sorted.map((g, i) => {
              const rowStyle: CSSProperties = {
                borderTop: i === 0 ? 'none' : undefined,
                color: 'inherit',
                textDecoration: 'none',
                cursor: g.courseId ? 'pointer' : 'default',
              };
              const rowInner = (
                <>
                  <div
                    className="insetGroupRowIcon"
                    style={{
                      background: gradeBackground(g.grade),
                      fontSize: 15,
                      fontWeight: 800,
                      color: gradeColor(g.grade),
                      width: 38,
                      height: 38,
                      borderRadius: 10,
                    }}
                  >
                    {g.grade}
                  </div>
                  <div className="insetGroupRowContent">
                    <div className="insetGroupRowTitle">{g.name}</div>
                    <div className="insetGroupRowMeta">
                      {g.code} · {g.instructor} · {g.credits} 學分
                      {g.rank ? ` · 排名 ${g.rank}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <div style={{ textAlign: 'right' }}>
                      <div
                        style={{
                          fontSize: 18,
                          fontWeight: 800,
                          color: gradeColor(g.grade),
                          letterSpacing: '-0.04em',
                        }}
                      >
                        {g.score}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
                        GPA {g.gpa.toFixed(1)}
                      </div>
                    </div>
                    {demoRole === 'student' && (
                      <a
                        href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent(`【${g.name}】拿 ${g.score} 分，是不是有什麼地方可以改進？給我 3 個具體建議`)}`}
                        title="讓 AI 分析這科成績"
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          padding: '6px 10px',
                          borderRadius: 8,
                          border: '1px solid rgba(94,106,210,0.30)',
                          background: 'rgba(94,106,210,0.10)',
                          color: '#5E6AD2',
                          fontSize: 12,
                          fontWeight: 700,
                          textDecoration: 'none',
                        }}
                      >
                        🤖
                      </a>
                    )}
                  </div>
                </>
              );

              return g.courseId ? (
                <Link
                  key={g.code}
                  href={`/course/${g.courseId}${q}`}
                  className="insetGroupRow"
                  title={`查看 ${g.name} 課程詳情`}
                  style={rowStyle}
                >
                  {rowInner}
                </Link>
              ) : (
                <div key={g.code} className="insetGroupRow" style={rowStyle}>
                  {rowInner}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Score Distribution ── */}
        <div className="card">
          <h3 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 700 }}>分數分布</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              {
                label: 'A（90–100）',
                count: grades.filter((g) => g.score >= 90).length,
                color: 'var(--success)',
              },
              {
                label: 'B（80–89）',
                count: grades.filter((g) => g.score >= 80 && g.score < 90).length,
                color: 'var(--info)',
              },
              {
                label: 'C（70–79）',
                count: grades.filter((g) => g.score >= 70 && g.score < 80).length,
                color: 'var(--warning)',
              },
              {
                label: 'D（60–69）',
                count: grades.filter((g) => g.score >= 60 && g.score < 70).length,
                color: '#FF9500',
              },
            ].map((row) => (
              <div key={row.label}>
                <div className="progressMeta">
                  <span style={{ fontSize: 13, color: 'var(--text)' }}>{row.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: row.color }}>
                    {row.count} 門
                  </span>
                </div>
                <div className="progressTrack">
                  <div
                    className="progressFill"
                    style={
                      {
                        '--progress-width':
                          grades.length > 0 ? `${(row.count / grades.length) * 100}%` : '0%',
                        '--progress': `linear-gradient(90deg, ${row.color} 0%, ${row.color}80 100%)`,
                      } as CSSProperties
                    }
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Export ── */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {isAlumni ? (
            <div style={{ fontSize: 13, color: 'var(--muted)', padding: '8px 0' }}>
              🎓 校友成績僅供查閱 · 如需正式成績單請聯絡教務處（行政大樓 1 樓）
            </div>
          ) : (
            <button
              className="btn"
              style={{ fontSize: 13 }}
              onClick={() => {
                const csv = ['科目代碼,課程名稱,學分,成績,分數,GPA,任課教師']
                  .concat(
                    grades.map(
                      (g) =>
                        `${g.code},${g.name},${g.credits},${g.grade},${g.score},${g.gpa},${g.instructor}`,
                    ),
                  )
                  .join('\n');
                const a = document.createElement('a');
                a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
                a.download = `grades_${selectedSemester}.csv`;
                a.click();
              }}
            >
              📥 匯出 CSV
            </button>
          )}
        </div>
      </div>
    </SiteShell>
  );
}
