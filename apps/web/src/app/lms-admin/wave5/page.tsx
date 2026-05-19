'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { RequireAdmin } from '@/components/RequireAdmin';
import { getBrowserSupabase } from '@/lib/supabase-browser';

type CourseRow = { id: string; title: string };
type CalendarEvent = {
  id: string;
  course_id: string | null;
  scope: string;
  title: string;
  starts_at: string;
  source_kind: string | null;
};
type Survey = { id: string; title: string; is_anonymous: boolean; open_at: string; closes_at: string | null };
type Group = { id: string; name: string; max_members: number | null; is_self_signup: boolean };
type Badge = { id: string; name: string; description: string; criteria: Record<string, unknown> };

type Tab = 'calendar' | 'surveys' | 'groups' | 'badges';

export default function Wave5Page() {
  const [tab, setTab] = useState<Tab>('calendar');
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [courseId, setCourseId] = useState('');
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadCourses = useCallback(async () => {
    const supabase = getBrowserSupabase();
    const { data, error: qErr } = await supabase
      .from('courses')
      .select('id, title')
      .order('created_at', { ascending: false })
      .limit(200);
    if (qErr) {
      setError(qErr.message);
      return;
    }
    setCourses((data ?? []) as CourseRow[]);
  }, []);

  useEffect(() => {
    void loadCourses();
  }, [loadCourses]);

  const reload = useCallback(async () => {
    if (!courseId) return;
    const supabase = getBrowserSupabase();

    if (tab === 'calendar') {
      const { data } = await supabase.rpc('my_calendar_events', {
        p_from: new Date(Date.now() - 30 * 86400_000).toISOString(),
        p_to: new Date(Date.now() + 90 * 86400_000).toISOString(),
      });
      setEvents(((data ?? []) as CalendarEvent[]).filter((e) => e.course_id === courseId || e.scope === 'platform'));
    } else if (tab === 'surveys') {
      const { data } = await supabase
        .from('surveys')
        .select('id, title, is_anonymous, open_at, closes_at')
        .eq('course_id', courseId)
        .order('created_at', { ascending: false });
      setSurveys((data ?? []) as Survey[]);
    } else if (tab === 'groups') {
      const { data } = await supabase
        .from('course_groups')
        .select('id, name, max_members, is_self_signup')
        .eq('course_id', courseId)
        .order('name');
      setGroups((data ?? []) as Group[]);
    } else if (tab === 'badges') {
      const { data } = await supabase
        .from('course_badges')
        .select('id, name, description, criteria')
        .eq('course_id', courseId)
        .order('name');
      setBadges((data ?? []) as Badge[]);
    }
  }, [courseId, tab]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function createCalendarEvent() {
    const title = window.prompt('行事曆事件標題');
    if (!title) return;
    const when = window.prompt('日期時間（ISO 格式，例 2026-06-01T10:00:00+08:00）');
    if (!when) return;
    setBusy(true);
    const supabase = getBrowserSupabase();
    const { error: ie } = await supabase.from('calendar_events').insert({
      course_id: courseId, scope: 'course', title, starts_at: when, source_kind: 'manual',
    });
    setBusy(false);
    if (ie) { window.alert(ie.message); return; }
    setInfo('建立成功');
    void reload();
  }

  async function createSurvey() {
    const title = window.prompt('問卷標題');
    if (!title) return;
    setBusy(true);
    const supabase = getBrowserSupabase();
    const { error: ie } = await supabase.from('surveys').insert({
      course_id: courseId, title, is_anonymous: true,
    });
    setBusy(false);
    if (ie) { window.alert(ie.message); return; }
    setInfo('問卷已建立');
    void reload();
  }

  async function autoAssignGroups() {
    const cntStr = window.prompt('要分多少組？');
    const cnt = Number(cntStr);
    if (!cnt || cnt <= 0) return;
    setBusy(true);
    const supabase = getBrowserSupabase();
    const { data, error: re } = await supabase.rpc('auto_assign_course_groups', {
      p_course_id: courseId, p_target_group_count: cnt,
    });
    setBusy(false);
    if (re) { window.alert(re.message); return; }
    setInfo(`已分派 ${data ?? 0} 個成員至 ${cnt} 組`);
    void reload();
  }

  async function createBadge() {
    const name = window.prompt('徽章名稱（例：A+ 學員）');
    if (!name) return;
    const thr = window.prompt('自動授徽門檻 weighted_percent（例 80）；空白則純手動');
    const criteria: Record<string, unknown> = {};
    if (thr && Number(thr) > 0) criteria.min_weighted_percent = Number(thr);
    setBusy(true);
    const supabase = getBrowserSupabase();
    const { error: ie } = await supabase.from('course_badges').insert({
      course_id: courseId, name, description: '', criteria,
    });
    setBusy(false);
    if (ie) { window.alert(ie.message); return; }
    setInfo('徽章已建立');
    void reload();
  }

  async function autoAwardBadges() {
    setBusy(true);
    const supabase = getBrowserSupabase();
    const { data, error: re } = await supabase.rpc('maybe_auto_award_badges', { p_course_id: courseId });
    setBusy(false);
    if (re) { window.alert(re.message); return; }
    setInfo(`自動授徽：寫入 ${data ?? 0} 筆（含重複略過）`);
    void reload();
  }

  const subtitle = useMemo(() => courses.find((c) => c.id === courseId)?.title ?? '', [courses, courseId]);

  return (
    <RequireAdmin>
      <h1 style={{ marginTop: 0 }}>商用核心模組（Wave 5）</h1>
      <p style={{ color: '#3C3C43', lineHeight: 1.6 }}>
        行事曆／問卷／分組／徽章；對應 migration 20260520130000–130200。請先選課程。
      </p>
      {error ? <p style={{ color: '#FF3B30' }}>{error}</p> : null}
      {info ? <p style={{ color: '#34C759' }}>{info}</p> : null}

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>課程</span>
          <select
            value={courseId}
            onChange={(e) => setCourseId(e.target.value)}
            style={selectStyle}>
            <option value="">請選課…</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </select>
        </label>

        <div style={{ display: 'flex', gap: 6 }}>
          {(['calendar', 'surveys', 'groups', 'badges'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              style={{
                ...tabBtn,
                background: tab === t ? '#5856D6' : '#fff',
                color: tab === t ? '#fff' : '#1C1C1E',
              }}>
              {labelOf(t)}
            </button>
          ))}
        </div>
      </div>

      {subtitle ? <p style={{ marginTop: 12, fontWeight: 600 }}>{subtitle}</p> : null}

      {!courseId ? (
        <p style={{ color: '#8E8E93' }}>請先選課。</p>
      ) : (
        <div style={{ marginTop: 16, background: '#fff', border: '1px solid #E5E5EA', borderRadius: 12, padding: 16 }}>
          {tab === 'calendar' ? (
            <>
              <button type="button" onClick={() => void createCalendarEvent()} disabled={busy} style={primaryBtn}>
                新增事件
              </button>
              <ul style={{ marginTop: 12, padding: 0, listStyle: 'none' }}>
                {events.map((e) => (
                  <li key={e.id} style={listItem}>
                    <strong>{e.title}</strong>
                    <div style={{ color: '#8E8E93', fontSize: 12 }}>
                      {new Date(e.starts_at).toLocaleString()}
                      {e.source_kind ? `｜來源：${e.source_kind}` : ''}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : tab === 'surveys' ? (
            <>
              <button type="button" onClick={() => void createSurvey()} disabled={busy} style={primaryBtn}>
                新增問卷
              </button>
              <ul style={{ marginTop: 12, padding: 0, listStyle: 'none' }}>
                {surveys.map((s) => (
                  <li key={s.id} style={listItem}>
                    <strong>{s.title}</strong>
                    <div style={{ color: '#8E8E93', fontSize: 12 }}>
                      匿名：{s.is_anonymous ? '是' : '否'}｜開放：{new Date(s.open_at).toLocaleString()}
                      {s.closes_at ? `｜關閉：${new Date(s.closes_at).toLocaleString()}` : ''}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : tab === 'groups' ? (
            <>
              <button type="button" onClick={() => void autoAssignGroups()} disabled={busy} style={primaryBtn}>
                自動隨機分組
              </button>
              <ul style={{ marginTop: 12, padding: 0, listStyle: 'none' }}>
                {groups.map((g) => (
                  <li key={g.id} style={listItem}>
                    <strong>{g.name}</strong>
                    <div style={{ color: '#8E8E93', fontSize: 12 }}>
                      上限：{g.max_members ?? '∞'}｜自選：{g.is_self_signup ? '是' : '否'}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => void createBadge()} disabled={busy} style={primaryBtn}>
                  新增徽章
                </button>
                <button type="button" onClick={() => void autoAwardBadges()} disabled={busy} style={primaryBtn}>
                  自動授徽
                </button>
              </div>
              <ul style={{ marginTop: 12, padding: 0, listStyle: 'none' }}>
                {badges.map((b) => (
                  <li key={b.id} style={listItem}>
                    <strong>{b.name}</strong>
                    <div style={{ color: '#8E8E93', fontSize: 12 }}>{b.description || '—'}</div>
                    <div style={{ color: '#8E8E93', fontSize: 11, fontFamily: 'monospace' }}>
                      {JSON.stringify(b.criteria)}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </RequireAdmin>
  );
}

function labelOf(t: Tab): string {
  if (t === 'calendar') return '行事曆';
  if (t === 'surveys') return '問卷';
  if (t === 'groups') return '小組';
  return '徽章';
}

const selectStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid #d1d5db',
  fontSize: 14,
  minWidth: 220,
};
const tabBtn: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: 8,
  border: '1px solid #d1d5db',
  fontWeight: 700,
  cursor: 'pointer',
};
const primaryBtn: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 10,
  border: '1px solid #5856D6',
  background: '#5856D6',
  color: '#fff',
  fontWeight: 700,
  cursor: 'pointer',
};
const listItem: React.CSSProperties = {
  padding: 12,
  border: '1px solid #E5E5EA',
  borderRadius: 8,
  marginBottom: 8,
};
