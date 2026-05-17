'use client';

/**
 * Teacher · Course · Attendance
 * TronClass parity 「點名」教師頁。
 * 使用 DEMO_STUDENTS 確保學生名單與成績簿、課表一致。
 */
import Link from 'next/link';
import { useState, type CSSProperties } from 'react';

import { SiteShell } from '@/components/SiteShell';
import { useDemoRole, getCapabilities } from '@/lib/demoRole';
import { DEMO_STUDENTS, getDemoCourseById } from '@/lib/demoData';
import { startAttendanceSession, endAttendanceSession } from '@/lib/demoStore';

type AttendStatus = 'present' | 'absent' | 'late';

interface SessionRow {
  id: string;
  startedAt: string;
  active: boolean;
  mode: 'qr' | 'tap' | 'manual';
  attendance: Record<string, AttendStatus>;
}

function buildDefaultSessions(): SessionRow[] {
  const s1: Record<string, AttendStatus> = {};
  const s2: Record<string, AttendStatus> = {};
  DEMO_STUDENTS.forEach((s, i) => {
    s1[s.uid] = i === 2 ? 'absent' : i === 6 ? 'late' : 'present';
    s2[s.uid] = i === 4 ? 'absent' : 'present';
  });
  return [
    { id: 'a1', startedAt: '2026-05-13 09:10', active: false, mode: 'qr', attendance: s1 },
    { id: 'a2', startedAt: '2026-05-06 09:10', active: false, mode: 'qr', attendance: s2 },
  ];
}

const STATUS_LABEL: Record<AttendStatus, string> = { present: '✅ 出席', absent: '❌ 缺席', late: '🟡 遲到' };
const STATUS_COLOR: Record<AttendStatus, string> = { present: '#16a34a', absent: '#dc2626', late: '#d97706' };

function countPresent(att: Record<string, AttendStatus>) {
  return Object.values(att).filter((v) => v === 'present').length;
}

export default function TeacherAttendancePage({ params }: { params: { courseId: string } }) {
  const [demoRole] = useDemoRole();
  const caps = getCapabilities(demoRole);
  const isTaView = demoRole === 'ta';
  const course = getDemoCourseById(params.courseId);

  const [running, setRunning] = useState(false);
  const [sessions, setSessions] = useState<SessionRow[]>(buildDefaultSessions);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [liveAtt, setLiveAtt] = useState<Record<string, AttendStatus>>({});

  const handleStart = () => {
    const init: Record<string, AttendStatus> = {};
    DEMO_STUDENTS.forEach((s) => { init[s.uid] = 'present'; });
    setLiveAtt(init);
    setRunning(true);
    // 寫入 demoStore → 學生課程頁出現「正在點名中」橫幅
    startAttendanceSession(params.courseId);
  };

  const handleEnd = () => {
    const now = new Date();
    const label = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const newSession: SessionRow = { id: `a-${Date.now()}`, startedAt: label, active: false, mode: 'qr', attendance: { ...liveAtt } };
    setSessions((prev) => [newSession, ...prev]);
    // 找出缺席學生 uid，寫入 demoStore → 缺席學生收到訊息
    const absentUids = Object.entries(liveAtt)
      .filter(([, v]) => v === 'absent')
      .map(([uid]) => uid);
    endAttendanceSession(
      params.courseId,
      course?.name ?? '課程',
      absentUids,
    );
    setRunning(false);
    setLiveAtt({});
  };

  const toggleLive = (uid: string) => {
    setLiveAtt((prev) => {
      const cur = prev[uid] ?? 'present';
      const next: AttendStatus = cur === 'present' ? 'late' : cur === 'late' ? 'absent' : 'present';
      return { ...prev, [uid]: next };
    });
  };

  return (
    <SiteShell>
      <main style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
        {!caps.canViewTeacherDashboard ? (
          <div className="card" style={{ padding: '24px 20px', textAlign: 'center', background: 'var(--danger-soft)', borderColor: 'var(--danger)' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🔒</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>教師工作台專用</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.7 }}>
              請從右上角「身份膠囊」切換為 🧑‍🏫 教師 或 🧑‍💻 助教 角色後再進入。
            </div>
            <Link href="/" className="btn">← 回首頁</Link>
          </div>
        ) : <>
        <nav style={{ fontSize: 14, color: '#6b7280', marginBottom: 12 }}>
          <Link href={`/teacher/course/${params.courseId}`}>← 回課程總覽</Link>
        </nav>
        <h1 style={{ fontSize: 28, fontWeight: 700 }}>
          點名管理{course ? ` — ${course.name}` : ''}
        </h1>
        <p style={{ color: '#6b7280', marginBottom: isTaView ? 12 : 24 }}>
          班級共 <strong>{course?.members ?? DEMO_STUDENTS.length}</strong> 位學生（示範顯示前 {DEMO_STUDENTS.length} 位）。
        </p>

        {isTaView && (
          <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(124,58,237,0.10)', border: '1px solid #7C3AED', fontSize: 13, color: '#5B21B6', marginBottom: 20 }}>
            🧑‍💻 <strong>助教 TA 視角</strong>：可查看出席記錄，但<strong>無法開啟或結束 QR 點名</strong>（授課教師專用）。
          </div>
        )}

        {/* 狀態列 */}
        <div style={{ padding: 24, border: '1px solid #e5e7eb', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>目前點名狀態</div>
            <div style={{ color: '#6b7280', fontSize: 14 }}>{running ? '🟢 點名進行中（QR）' : '⚪ 尚未開啟'}</div>
          </div>
          {isTaView ? (
            <button disabled title="TA 無法開啟點名" style={{ ...btnBase, background: '#e5e7eb', color: '#9ca3af', cursor: 'not-allowed' }}>🔒 開啟 QR（教師專用）</button>
          ) : running ? (
            <button style={{ ...btnBase, background: '#dc2626' }} onClick={handleEnd}>結束點名並儲存</button>
          ) : (
            <button style={{ ...btnBase, background: '#16a34a' }} onClick={handleStart}>🟢 開啟 QR 點名</button>
          )}
        </div>

        {/* 進行中名單 */}
        {running && (
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 10 }}>即時出席名單（點擊切換狀態）</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 8 }}>
              {DEMO_STUDENTS.map((s) => {
                const st = liveAtt[s.uid] ?? 'present';
                return (
                  <button key={s.uid} onClick={() => toggleLive(s.uid)} style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', background: st === 'present' ? 'rgba(22,163,74,0.08)' : st === 'late' ? 'rgba(217,119,6,0.08)' : 'rgba(220,38,38,0.08)', cursor: 'pointer', textAlign: 'left' }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{s.displayName}</div>
                    <div style={{ fontSize: 11, color: '#6b7280' }}>{s.studentId}</div>
                    <div style={{ fontSize: 12, color: STATUS_COLOR[st], marginTop: 2 }}>{STATUS_LABEL[st]}</div>
                  </button>
                );
              })}
            </div>
            <div style={{ marginTop: 10, fontSize: 13, color: '#6b7280' }}>
              出席 {countPresent(liveAtt)} · 遲到 {Object.values(liveAtt).filter(v => v === 'late').length} · 缺席 {Object.values(liveAtt).filter(v => v === 'absent').length}
            </div>
          </div>
        )}

        {/* 歷史 */}
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>歷史 Sessions</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sessions.map((s) => {
            const present = countPresent(s.attendance);
            const total = DEMO_STUDENTS.length;
            const pct = Math.round((present / total) * 100);
            const isExp = expandedId === s.id;

            return (
              <div key={s.id} style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ padding: '14px 18px', background: '#f9fafb', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{s.startedAt}</div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{s.mode.toUpperCase()} · 出席 {present}/{total}（{pct}%）</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setExpandedId(isExp ? null : s.id)} style={{ ...linkBtn, border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 12px', fontWeight: 600 }}>
                      {isExp ? '▲ 收合' : '👥 查看名單'}
                    </button>
                    <button
                      onClick={() => {
                        const rows = DEMO_STUDENTS.map((stu) => `${stu.studentId},${stu.displayName},${s.attendance[stu.uid] ?? 'present'}`).join('\n');
                        const csv = `學號,姓名,出席狀態\n${rows}`;
                        const a = document.createElement('a');
                        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
                        a.download = `attendance_${s.id}.csv`;
                        a.click();
                      }}
                      style={{ ...linkBtn, border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 12px' }}
                    >
                      📥 匯出 CSV
                    </button>
                    <a
                      href={`/ai-assistant?q=${encodeURIComponent(`資料結構（CS301）${s.startedAt} 的出席率 ${pct}%，幫我分析缺席原因與建議追蹤動作`)}`}
                      title="讓 AI 分析這場出勤"
                      style={{ ...linkBtn, border: '1px solid #5E6AD2', borderRadius: 6, padding: '6px 12px', color: '#5E6AD2', background: 'rgba(94,106,210,0.08)', textDecoration: 'none' }}
                    >
                      🤖
                    </a>
                  </div>
                </div>

                {isExp && (
                  <div style={{ padding: '14px 18px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 8 }}>
                      {DEMO_STUDENTS.map((stu) => {
                        const st = s.attendance[stu.uid] ?? 'present';
                        return (
                          <div key={stu.uid} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #e5e7eb', background: st === 'present' ? 'rgba(22,163,74,0.06)' : st === 'late' ? 'rgba(217,119,6,0.06)' : 'rgba(220,38,38,0.06)' }}>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{stu.displayName}</div>
                            <div style={{ fontSize: 11, color: '#6b7280' }}>{stu.studentId}</div>
                            <div style={{ fontSize: 12, color: STATUS_COLOR[st], marginTop: 2 }}>{STATUS_LABEL[st]}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── AI 出勤分析入口 ── */}
        <div
          style={{
            marginTop: 20,
            padding: '14px 18px',
            borderRadius: 12,
            background: isTaView ? 'rgba(124,58,237,0.08)' : 'rgba(15,139,141,0.08)',
            border: `1px solid ${isTaView ? '#7C3AED' : '#0F8B8D'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 14,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: isTaView ? '#7C3AED' : '#0F8B8D', marginBottom: 3 }}>
              🤖 AI 出勤分析
            </div>
            <div style={{ fontSize: 13, color: '#374151' }}>
              讓 AI 找出缺席率偏高的學生，並生成出勤警告通知草稿。
            </div>
          </div>
          <a
            href={`/ai-assistant?q=${encodeURIComponent(`幫我分析「${course?.name ?? '資料結構'}」近期出勤記錄，找出缺席率超過 20% 的學生，並草擬一封出勤提醒通知`)}`}
            className="btn"
            style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            問 AI →
          </a>
        </div>
        </>}
      </main>
    </SiteShell>
  );
}

const btnBase: CSSProperties = { padding: '10px 20px', borderRadius: 8, color: '#fff', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600 };
const linkBtn: CSSProperties = { background: 'transparent', color: '#374151', border: 'none', cursor: 'pointer', fontSize: 13 };
