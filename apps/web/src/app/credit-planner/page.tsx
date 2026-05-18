'use client';

import { SiteShell } from '@/components/SiteShell';
import { useState, useMemo } from 'react';
import Link from 'next/link';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import { useDemoRole } from '@/lib/demoRole';
import {
  DEMO_HISTORY_SEMESTERS,
  CURRENT_SEMESTER,
  NEXT_SEM_COURSES,
  GRADUATION_REQUIREMENTS,
  CREDIT_CATEGORIES,
  computeEarnedCredits,
  type CreditCategory,
} from '@/lib/demoData';

// ── 顏色映射 ──────────────────────────────────────────────────
const CATEGORY_COLORS: Record<CreditCategory, string> = {
  required: '#5856D6',
  elective: '#34C759',
  general: '#FF9500',
  pe: '#FF3B30',
  other: '#8E8E93',
};

const CATEGORY_BG: Record<CreditCategory, string> = {
  required: 'rgba(88,86,214,0.12)',
  elective: 'rgba(52,199,89,0.12)',
  general: 'rgba(255,149,0,0.12)',
  pe: 'rgba(255,59,48,0.12)',
  other: 'rgba(142,142,147,0.12)',
};

function gradeColor(grade: string): string {
  if (grade.startsWith('A')) return 'var(--success)';
  if (grade.startsWith('B')) return 'var(--info)';
  if (grade.startsWith('C')) return 'var(--warning)';
  if (grade === '修習中') return 'var(--brand)';
  return 'var(--muted)';
}

function ProgressBar({
  done,
  inProgress,
  total,
  color,
}: {
  done: number;
  inProgress: number;
  total: number;
  color: string;
}) {
  const donePct = Math.min(100, (done / total) * 100);
  const inPct = Math.min(100 - donePct, (inProgress / total) * 100);
  return (
    <div
      style={{
        height: 8,
        borderRadius: 4,
        background: 'var(--panel2)',
        overflow: 'hidden',
        display: 'flex',
        boxShadow: 'var(--shadow-inset)',
      }}
    >
      <div
        style={{
          width: `${donePct}%`,
          background: color,
          transition: 'width 0.5s ease',
          borderRadius: donePct + inPct >= 100 ? 4 : '4px 0 0 4px',
        }}
      />
      <div
        style={{
          width: `${inPct}%`,
          background: `${color}55`,
          transition: 'width 0.5s ease',
        }}
      />
    </div>
  );
}

export default function CreditPlannerPage(props: {
  searchParams?: { school?: string; schoolId?: string };
}) {
  const { schoolName, schoolSearch: q } = resolveSchoolPageContext(props.searchParams);
  const [demoRole] = useDemoRole();

  // 角色守衛：只有「學生型」角色（在校學生本人 + 社團幹部）可以使用學分試算。
  // 教師、TA、系主任、管理員、校友、訪客全部攔截 — 學分試算是個人選課與畢業進度規劃工具，
  // 不屬於其他角色的工作範圍（教師有教師工作台，系主任/管理員有後台儀表板）。
  const isStudentLike = demoRole === 'student' || demoRole === 'club_officer';

  // 歷史學期展開狀態
  const [expandedSems, setExpandedSems] = useState<Set<string>>(new Set(['112-2']));
  const toggleSem = (sem: string) =>
    setExpandedSems((prev) => {
      const next = new Set(prev);
      if (next.has(sem)) next.delete(sem);
      else next.add(sem);
      return next;
    });

  // 選課模擬：下學期勾選
  const [simSelected, setSimSelected] = useState<Set<string>>(new Set());
  const toggleSim = (id: string) =>
    setSimSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // 基礎學分計算
  const earned = useMemo(() => computeEarnedCredits(), []);
  const req = GRADUATION_REQUIREMENTS;

  // 模擬選課後的計算
  const simCourses = useMemo(
    () => NEXT_SEM_COURSES.filter((c) => simSelected.has(c.id)),
    [simSelected],
  );

  const simByCategory = useMemo(() => {
    const acc: Record<CreditCategory, number> = {
      required: 0, elective: 0, general: 0, pe: 0, other: 0,
    };
    for (const c of simCourses) acc[c.category] += c.credits;
    return acc;
  }, [simCourses]);

  const simTotalCredits = simCourses.reduce((s, c) => s + c.credits, 0);

  // 衝堂偵測
  const conflictIds = useMemo(() => {
    const conflicts = new Set<string>();
    for (const c of simCourses) {
      if (c.conflictsWith && simSelected.has(c.conflictsWith)) {
        conflicts.add(c.id);
        conflicts.add(c.conflictsWith);
      }
    }
    return conflicts;
  }, [simCourses, simSelected]);

  // 模擬後總學分
  const totalAfterSim = earned.historicalTotal + earned.currentSemesterTotal + simTotalCredits;
  const remainingAfterSim = Math.max(0, req.totalRequired - totalAfterSim);

  // 各類別進度（含模擬）
  const categoryProgress = useMemo(
    () =>
      (Object.keys(req.breakdown) as CreditCategory[]).map((cat) => {
        const need = req.breakdown[cat];
        const done = earned.byCategory[cat];
        const current = CURRENT_SEMESTER.courses
          .filter((c) => c.category === cat)
          .reduce((s, c) => s + c.credits, 0);
        const sim = simByCategory[cat];
        const total = done + current + sim;
        const pct = Math.min(100, Math.round((total / need) * 100));
        return { cat, need, done, current, sim, total, pct };
      }),
    [earned, simByCategory, req.breakdown],
  );

  // 非「學生型」角色直接攔截
  if (!isStudentLike) {
    const roleLabel =
      demoRole === 'teacher'
        ? '教師'
        : demoRole === 'ta'
          ? '助教'
          : demoRole === 'department_head'
            ? '系主任'
            : demoRole === 'admin'
              ? '系統管理員'
              : demoRole === 'alumni'
                ? '校友'
                : '訪客';
    const altPath =
      demoRole === 'teacher' || demoRole === 'ta'
        ? '/teacher/course/c1'
        : demoRole === 'admin' || demoRole === 'department_head'
          ? '/admin'
          : '/';
    const altLabel =
      demoRole === 'teacher' || demoRole === 'ta'
        ? '前往教師工作台'
        : demoRole === 'admin' || demoRole === 'department_head'
          ? '前往管理後台'
          : '回首頁';
    return (
      <SiteShell title="學分試算" subtitle="僅限在校學生使用" schoolName={schoolName}>
        <div className="pageStack">
          <div
            className="card"
            style={{
              padding: '32px 28px',
              textAlign: 'center',
              background: 'rgba(88,86,214,0.06)',
              border: '1px solid #5856D6',
              maxWidth: 560,
              margin: '32px auto',
            }}
          >
            <div style={{ fontSize: 48, marginBottom: 12 }}>📊</div>
            <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 800 }}>
              學分試算僅限在校學生使用
            </h2>
            <p style={{ margin: '0 0 20px', fontSize: 14, color: 'var(--muted)', lineHeight: 1.7 }}>
              目前身份為 <strong style={{ color: 'var(--text)' }}>{roleLabel}</strong>。
              學分試算是學生個人選課與畢業進度規劃工具,屬於學生專屬功能,
              {demoRole === 'teacher' || demoRole === 'ta'
                ? '教師端請使用「教師工作台」管理課程與學生表現'
                : demoRole === 'admin' || demoRole === 'department_head'
                  ? '系主任/管理員可至「管理後台」查看全系學生學分統計'
                  : demoRole === 'alumni'
                    ? '校友身份僅可瀏覽公開內容,如需查詢歷年成績請至教務處系友服務'
                    : '請先以學生身份登入'}
              。
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Link href={`${altPath}${q}`} className="btn primary">
                {altLabel} →
              </Link>
              {demoRole === 'guest' && (
                <Link href={`/login${q}`} className="btn">
                  以學生身份登入
                </Link>
              )}
            </div>
          </div>
        </div>
      </SiteShell>
    );
  }

  return (
    <SiteShell
      title="學分試算"
      subtitle={`${req.department} · 大三（113-1 學期）`}
      schoolName={schoolName}
    >
      <div className="pageStack">
        {/* ── 社團幹部:同為學生但有額外身份標示 ── */}
        {demoRole === 'club_officer' && (
          <div
            className="card"
            style={{
              padding: '12px 16px',
              background: 'rgba(52,199,89,0.10)',
              border: '1px solid #34C759',
              fontSize: 13,
            }}
          >
            🎯 <strong>社團幹部身份</strong> · 此為你的個人學分試算（社團幹部本身也是在校學生）。
          </div>
        )}

        {/* ── Hero 學分總覽 ── */}
        <div
          className="card"
          style={{
            background: 'linear-gradient(135deg, var(--brand) 0%, #8EA5FF 100%)',
            border: 'none',
            color: '#fff',
            boxShadow: '6px 6px 16px rgba(88,86,214,0.36)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
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
                {req.department} · 畢業學分進度
              </p>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <div
                  style={{
                    fontSize: 64,
                    fontWeight: 700,
                    letterSpacing: '-0.06em',
                    lineHeight: 1,
                  }}
                >
                  {earned.historicalTotal + earned.currentSemesterTotal}
                </div>
                <div style={{ fontSize: 20, opacity: 0.8 }}>/ {req.totalRequired}</div>
              </div>
              <p style={{ margin: '8px 0 0', fontSize: 14, opacity: 0.82 }}>
                已修 {earned.historicalTotal} 學分 · 本學期修習中 {earned.currentSemesterTotal} 學分
              </p>
            </div>

            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              {[
                {
                  label: '還差',
                  val: Math.max(
                    0,
                    req.totalRequired - earned.historicalTotal - earned.currentSemesterTotal,
                  ),
                  unit: '學分',
                },
                {
                  label: '完成率',
                  val: `${Math.round(((earned.historicalTotal + earned.currentSemesterTotal) / req.totalRequired) * 100)}%`,
                  unit: '',
                },
                {
                  label: '預計畢業',
                  val: '大四下',
                  unit: '',
                },
              ].map((s) => (
                <div key={s.label} style={{ textAlign: 'center' }}>
                  <div
                    style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.05em' }}
                  >
                    {s.val}
                    {s.unit && (
                      <span style={{ fontSize: 14, marginLeft: 2, opacity: 0.8 }}>{s.unit}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 整體進度條 */}
          <div style={{ marginTop: 16 }}>
            <div
              style={{
                height: 10,
                borderRadius: 5,
                background: 'rgba(255,255,255,0.25)',
                overflow: 'hidden',
                display: 'flex',
              }}
            >
              <div
                style={{
                  width: `${(earned.historicalTotal / req.totalRequired) * 100}%`,
                  background: '#fff',
                  borderRadius: '5px 0 0 5px',
                  transition: 'width 0.5s ease',
                }}
              />
              <div
                style={{
                  width: `${(earned.currentSemesterTotal / req.totalRequired) * 100}%`,
                  background: 'rgba(255,255,255,0.5)',
                  transition: 'width 0.5s ease',
                }}
              />
              {simTotalCredits > 0 && (
                <div
                  style={{
                    width: `${(simTotalCredits / req.totalRequired) * 100}%`,
                    background: 'rgba(255,255,255,0.25)',
                    borderStyle: 'dashed',
                    transition: 'width 0.5s ease',
                  }}
                />
              )}
            </div>
            <div
              style={{
                display: 'flex',
                gap: 16,
                marginTop: 8,
                fontSize: 11,
                opacity: 0.8,
              }}
            >
              <span>■ 已修</span>
              <span>▪ 修習中</span>
              {simTotalCredits > 0 && <span>░ 模擬選課 +{simTotalCredits}</span>}
            </div>
          </div>
        </div>

        {/* ── 各類別學分進度條 ── */}
        <div className="card">
          <h3
            style={{
              margin: '0 0 14px',
              fontSize: 16,
              fontWeight: 700,
              letterSpacing: '-0.02em',
            }}
          >
            各類別學分進度
            {simTotalCredits > 0 && (
              <span
                style={{
                  marginLeft: 8,
                  fontSize: 12,
                  color: 'var(--brand)',
                  fontWeight: 500,
                  background: 'var(--brand-soft)',
                  padding: '2px 8px',
                  borderRadius: 99,
                }}
              >
                含模擬選課 +{simTotalCredits} 學分
              </span>
            )}
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {categoryProgress.map(({ cat, need, done, current, sim, total, pct }) => {
              const color = CATEGORY_COLORS[cat];
              const left = Math.max(0, need - total);
              return (
                <div key={cat}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 6,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        style={{
                          display: 'inline-block',
                          width: 10,
                          height: 10,
                          borderRadius: 3,
                          background: color,
                        }}
                      />
                      <span style={{ fontSize: 14, fontWeight: 600 }}>
                        {CREDIT_CATEGORIES[cat]}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'right' }}>
                      <span style={{ fontWeight: 700, color: pct >= 100 ? 'var(--success)' : color }}>
                        {total}
                      </span>
                      <span style={{ opacity: 0.6 }}>
                        {' '}/ {need} 學分
                        {left > 0 ? `（還差 ${left}）` : ' ✓'}
                      </span>
                    </div>
                  </div>
                  <ProgressBar done={done} inProgress={current + sim} total={need} color={color} />
                  <div
                    style={{
                      display: 'flex',
                      gap: 12,
                      marginTop: 4,
                      fontSize: 11,
                      color: 'var(--muted)',
                    }}
                  >
                    <span>已修 {done}</span>
                    {current > 0 && <span style={{ color: `${color}99` }}>修習中 {current}</span>}
                    {sim > 0 && (
                      <span style={{ color: color, fontWeight: 600 }}>模擬 +{sim}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── 選課模擬：下學期 ── */}
        <div className="sectionCard">
          <div style={{ padding: '16px 16px 0' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 11,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: 'var(--muted)',
                    fontWeight: 600,
                  }}
                >
                  選課模擬
                </div>
                <h3
                  style={{
                    margin: '4px 0 0',
                    fontSize: 16,
                    fontWeight: 700,
                    letterSpacing: '-0.02em',
                  }}
                >
                  下學期可選課程
                </h3>
              </div>
              <div style={{ textAlign: 'right' }}>
                {simSelected.size > 0 ? (
                  <div>
                    <div
                      style={{
                        fontSize: 22,
                        fontWeight: 700,
                        color: 'var(--brand)',
                        letterSpacing: '-0.04em',
                      }}
                    >
                      +{simTotalCredits} 學分
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                      還差 {remainingAfterSim} 學分
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>勾選課程進行試算</div>
                )}
              </div>
            </div>
            {conflictIds.size > 0 && (
              <div
                style={{
                  marginTop: 10,
                  padding: '8px 12px',
                  background: 'var(--danger-soft)',
                  border: '1px solid var(--danger)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 13,
                  color: 'var(--danger)',
                  fontWeight: 600,
                }}
              >
                ⚠️ 選課衝堂警告：以紅框標示的課程時段重疊，請重新選擇！
              </div>
            )}
          </div>

          <div className="insetGroup" style={{ margin: '12px 0 0' }}>
            {NEXT_SEM_COURSES.map((course, i) => {
              const isSelected = simSelected.has(course.id);
              const isConflict = conflictIds.has(course.id);
              const days = ['', '週一', '週二', '週三', '週四', '週五'];
              const catColor = CATEGORY_COLORS[course.category];

              return (
                <div
                  key={course.id}
                  className="insetGroupRow"
                  style={{
                    borderTop: i === 0 ? 'none' : undefined,
                    cursor: 'pointer',
                    background: isConflict
                      ? 'var(--danger-soft)'
                      : isSelected
                      ? 'var(--brand-soft)'
                      : undefined,
                    border: isConflict ? '1px solid var(--danger)' : undefined,
                    borderRadius: isConflict ? 'var(--radius-sm)' : undefined,
                  }}
                  onClick={() => toggleSim(course.id)}
                >
                  {/* Checkbox */}
                  <div
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 6,
                      border: `2px solid ${isConflict ? 'var(--danger)' : isSelected ? 'var(--brand)' : 'var(--border)'}`,
                      background: isSelected ? 'var(--brand)' : 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      transition: 'all 0.15s',
                    }}
                  >
                    {isSelected && (
                      <span style={{ color: '#fff', fontSize: 13, lineHeight: 1 }}>✓</span>
                    )}
                  </div>

                  <div className="insetGroupRowContent" style={{ marginLeft: 10 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        flexWrap: 'wrap',
                      }}
                    >
                      <span
                        className="insetGroupRowTitle"
                        style={{ color: isConflict ? 'var(--danger)' : undefined }}
                      >
                        {course.name}
                      </span>
                      {course.recommended && (
                        <span
                          style={{
                            fontSize: 10,
                            padding: '1px 6px',
                            borderRadius: 99,
                            background: 'rgba(88,86,214,0.15)',
                            color: 'var(--brand)',
                            fontWeight: 700,
                          }}
                        >
                          ⭐ AI 推薦
                        </span>
                      )}
                      {isConflict && (
                        <span
                          style={{
                            fontSize: 10,
                            padding: '1px 6px',
                            borderRadius: 99,
                            background: 'var(--danger-soft)',
                            color: 'var(--danger)',
                            fontWeight: 700,
                          }}
                        >
                          ⚠️ 衝堂
                        </span>
                      )}
                    </div>
                    <div className="insetGroupRowMeta">
                      {course.code} · {days[course.dayOfWeek]} 第 {course.startPeriod}-
                      {course.endPeriod} 節 · {course.instructor} 老師 ·{' '}
                      <span style={{ color: catColor, fontWeight: 600 }}>
                        {CREDIT_CATEGORIES[course.category]}
                      </span>
                    </div>
                  </div>

                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div
                      style={{
                        fontSize: 18,
                        fontWeight: 700,
                        color: isSelected ? 'var(--brand)' : 'var(--text)',
                        letterSpacing: '-0.04em',
                      }}
                    >
                      {course.credits}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>學分</div>
                  </div>
                </div>
              );
            })}
          </div>

          {simSelected.size > 0 && (
            <div
              style={{
                padding: '12px 16px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderTop: '1px solid var(--border)',
              }}
            >
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                已選 {simSelected.size} 門，共 {simTotalCredits} 學分
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn"
                  style={{ fontSize: 12, padding: '6px 14px', background: 'var(--panel2)' }}
                  onClick={() => setSimSelected(new Set())}
                >
                  清除選擇
                </button>
                <Link
                  href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent(`我已勾選下學期課程試算，共 ${simTotalCredits} 學分。請幫我評估這個選課組合是否合理？有沒有衝堂或學分缺口問題？`)}`}
                  className="btn"
                  style={{ fontSize: 12, padding: '6px 14px' }}
                >
                  🤖 讓 AI 幫我評估
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* ── 歷史修課紀錄 ── */}
        <div className="sectionCard">
          <div
            style={{
              padding: '16px 16px 8px',
              fontSize: 11,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--muted)',
              fontWeight: 600,
            }}
          >
            歷史修課紀錄
          </div>

          {/* 本學期（修習中） */}
          <div style={{ padding: '0 16px' }}>
            <button
              style={{
                width: '100%',
                background: 'var(--brand-soft)',
                border: '1px solid var(--brand)',
                borderRadius: 'var(--radius-sm)',
                padding: '10px 12px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                cursor: 'pointer',
                marginBottom: 8,
              }}
              onClick={() => toggleSem('current')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    background: 'var(--brand)',
                    color: '#fff',
                    padding: '2px 7px',
                    borderRadius: 99,
                  }}
                >
                  本學期
                </span>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{CURRENT_SEMESTER.label}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>
                  {earned.currentSemesterTotal} 學分 · {CURRENT_SEMESTER.courses.length} 門 · 修習中
                </span>
                <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                  {expandedSems.has('current') ? '▲' : '▼'}
                </span>
              </div>
            </button>

            {expandedSems.has('current') && (
              <div
                className="insetGroup"
                style={{ marginBottom: 12, border: '1px solid var(--border)' }}
              >
                {CURRENT_SEMESTER.courses.map((course, i) => (
                  <div
                    key={course.code}
                    className="insetGroupRow"
                    style={{ borderTop: i === 0 ? 'none' : undefined }}
                  >
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 8,
                        background: CATEGORY_BG[course.category],
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 11,
                        fontWeight: 700,
                        color: CATEGORY_COLORS[course.category],
                        flexShrink: 0,
                      }}
                    >
                      修
                    </div>
                    <div className="insetGroupRowContent">
                      <div className="insetGroupRowTitle">{course.name}</div>
                      <div className="insetGroupRowMeta">
                        {course.code} · {CREDIT_CATEGORIES[course.category]} · {course.instructor}{' '}
                        老師
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div
                        style={{
                          fontSize: 16,
                          fontWeight: 700,
                          color: 'var(--brand)',
                          letterSpacing: '-0.04em',
                        }}
                      >
                        {course.credits}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>學分</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 歷史學期 */}
          <div style={{ padding: '0 16px 16px' }}>
            {[...DEMO_HISTORY_SEMESTERS].reverse().map((sem) => {
              const semCredits = sem.courses.reduce((s, c) => s + c.credits, 0);
              const isOpen = expandedSems.has(sem.semester);
              return (
                <div key={sem.semester} style={{ marginBottom: 8 }}>
                  <button
                    style={{
                      width: '100%',
                      background: 'var(--panel)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '10px 12px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      cursor: 'pointer',
                    }}
                    onClick={() => toggleSem(sem.semester)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: 'var(--muted)',
                          background: 'var(--panel2)',
                          padding: '2px 7px',
                          borderRadius: 99,
                        }}
                      >
                        {sem.semester}
                      </span>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{sem.label}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ fontSize: 13, color: 'var(--muted)' }}>
                        {semCredits} 學分 · GPA {sem.semesterGpa}
                      </span>
                      <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                        {isOpen ? '▲' : '▼'}
                      </span>
                    </div>
                  </button>

                  {isOpen && (
                    <div
                      className="insetGroup"
                      style={{ marginTop: 4, border: '1px solid var(--border)' }}
                    >
                      {sem.courses.map((course, i) => (
                        <div
                          key={course.code}
                          className="insetGroupRow"
                          style={{ borderTop: i === 0 ? 'none' : undefined }}
                        >
                          <div
                            style={{
                              width: 36,
                              height: 36,
                              borderRadius: 8,
                              background: CATEGORY_BG[course.category],
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 11,
                              fontWeight: 700,
                              color: CATEGORY_COLORS[course.category],
                              flexShrink: 0,
                            }}
                          >
                            {course.grade}
                          </div>
                          <div className="insetGroupRowContent">
                            <div className="insetGroupRowTitle">{course.name}</div>
                            <div className="insetGroupRowMeta">
                              {course.code} · {CREDIT_CATEGORIES[course.category]} ·{' '}
                              {course.instructor} 老師
                            </div>
                          </div>
                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            <div
                              style={{
                                fontSize: 16,
                                fontWeight: 700,
                                color: gradeColor(course.grade),
                                letterSpacing: '-0.04em',
                              }}
                            >
                              {course.score > 0 ? course.score : course.grade}
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                              {course.credits} 學分
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── AI 助理入口 ── */}
        <div
          className="card"
          style={{
            background: 'linear-gradient(135deg, #5856D6 0%, #8EA5FF 100%)',
            border: 'none',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
            }}
          >
            <div>
              <div style={{ fontSize: 28, marginBottom: 4 }}>🤖</div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>
                AI 選課助理
              </h3>
              <p style={{ margin: '6px 0 0', fontSize: 14, opacity: 0.85 }}>
                根據你的學分缺口、歷史成績、社團時間，AI 幫你規劃最佳選課組合
              </p>
            </div>
            <Link
              href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent('幫我看學分缺口：哪幾類學分還差多少？下學期應該優先選哪些課補齊？')}`}
              className="btn"
              style={{
                background: '#fff',
                color: 'var(--brand)',
                fontWeight: 700,
                flexShrink: 0,
                padding: '10px 18px',
              }}
            >
              開始對話 →
            </Link>
          </div>
        </div>
      </div>
    </SiteShell>
  );
}
