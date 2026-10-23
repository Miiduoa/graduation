'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { buildPersonalToday, type PersonalImportRecord } from '@campus/shared';
import { usePersonalImportScope, usePersonalImports } from '@/lib/usePersonalImports';
import { useAuth } from '@/components/AuthGuard';
import { SchoolSelector } from '@/components/SchoolSelector';
import { useOptionalSelectedSchool } from '@/components/SelectedSchoolProvider';
import { useOptionalNuniSession } from '@/features/nuni/Session';
import { loadPersonalTimetable, type StoredTimetable } from '@/lib/timetable/store';
import home from '@/app/home.module.css';
import styles from './TodayTimetable.module.css';

function manualRecords(timetable: StoredTimetable): PersonalImportRecord[] {
  return timetable.courses.map((course) => ({
    id: `manual:${course.id}`,
    kind: 'timetable',
    title: course.name,
    schoolId: timetable.schoolId,
    academicYear: timetable.meta.year || '未填',
    semester: timetable.meta.semester || '未填',
    dayOfWeek: course.day,
    startPeriod: course.start,
    endPeriod: course.end,
    teacher: course.teacher,
    location: course.room,
    batchId: 'manual',
    importedAt: timetable.updatedAt,
    source: { type: 'paste', line: 0, rawText: '' },
  }));
}

function usePersonalTodayRecords() {
  const context = usePersonalImportScope();
  const { user } = useAuth();
  const imported = usePersonalImports(context.scope);
  const [manual, setManual] = useState<PersonalImportRecord[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const { owner, schoolId } = context.scope;
  const uid = user?.uid ?? null;
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    let generation = 0;
    const refresh = async () => {
      const request = ++generation;
      try {
        const data = await loadPersonalTimetable(uid, schoolId, owner);
        if (active && request === generation) {
          setManual(manualRecords(data));
          setLoadError('');
        }
      } catch {
        if (active && request === generation) {
          setManual(null);
          setLoadError('手動課表暫時讀不到，請保留瀏覽器資料後重試。');
        }
      }
    };
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    void refresh();
    window.addEventListener('focus', visible);
    window.addEventListener('storage', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false;
      window.removeEventListener('focus', visible);
      window.removeEventListener('storage', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [uid, owner, schoolId, attempt]);
  const loaded = !imported.loading && (manual !== null || !!loadError);
  const error = imported.error || loadError;
  return { context, imported, manual, retry, loaded, error, schoolId };
}

export function TodayTimetable({ now }: { now: Date | null }) {
  const context = usePersonalImportScope();
  const school = useOptionalSelectedSchool();
  const nuni = useOptionalNuniSession();
  const { user } = useAuth();
  if (context.loading || !now || nuni?.pendingLogout || nuni?.error) return null;
  if (context.scope.schoolId === 'personal')
    return (
      <section className={styles.panel} aria-label="今天的課表">
        <h2>今天去哪上課？</h2>
        <p>先選校園，就能匯入或手動排課。不用學校帳號，資料存在這台瀏覽器。</p>
        {school && <SchoolSelector compact />}
      </section>
    );
  return <Schedule key={`${context.scopeKey}:${user?.uid ?? ''}`} now={now} />;
}

export function NextClassCard({ now }: { now: Date | null }) {
  const context = usePersonalImportScope();
  const nuni = useOptionalNuniSession();
  if (context.loading || !now || nuni?.pendingLogout || nuni?.error) return null;
  if (context.scope.schoolId === 'personal') return null;
  return <NextClassStrip key={context.scopeKey} now={now} />;
}

function NextClassStrip({ now }: { now: Date }) {
  const { imported, manual, loaded, error, schoolId } = usePersonalTodayRecords();
  if (!loaded || error || manual === null) return null;
  const schedule = buildPersonalToday([...imported.records, ...manual], {
    schoolId,
    now,
  });
  const next = schedule.today.find((entry) => entry.row.id === schedule.nextId);
  if (!next) return null;
  const room = next.row.location?.trim();
  return (
    <aside className={home.nextClass} data-testid="home-next-class" aria-label="下一堂課">
      <strong>下一堂課</strong>
      <span className={home.nextClassBody}>
        {next.row.title}
        {room ? ` · ${room}` : ''}
        <small>{next.startTime}</small>
      </span>
    </aside>
  );
}

function Schedule({ now }: { now: Date }) {
  const { context, imported, manual, retry, loaded, error, schoolId } = usePersonalTodayRecords();
  const [term, setTerm] = useState('');
  const schedule = buildPersonalToday([...imported.records, ...(manual ?? [])], {
    schoolId,
    termKey: term,
    now,
  });
  const termLabel = (year: string, semester: string) =>
    year === '未填' && semester === '未填'
      ? '手動課表（未填學期）'
      : `${year} 學年度 · ${semester} 學期`;
  const selected = schedule.terms.find((item) => item.key === schedule.termKey);
  const query = `campus=${encodeURIComponent(schoolId)}`;
  const manualOnly =
    selected &&
    !imported.records.some(
      (row) => row.kind === 'timetable' && `${row.academicYear}|${row.semester}` === selected.key,
    );
  const timetableHref = `/timetable?${query}${selected ? `&term=${encodeURIComponent(manualOnly ? 'manual' : selected.key)}` : ''}`;
  return (
    <section className={styles.panel} aria-labelledby="today-timetable-title">
      <div className={styles.heading}>
        <h2 id="today-timetable-title">今天的課表</h2>
        <Link href={timetableHref}>完整課表</Link>
      </div>
      <p className={styles.note}>{context.schoolName} · 個人整理的週課表</p>
      {!loaded && <p role="status">正在讀取課表…</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => {
              retry();
              window.dispatchEvent(new Event('campus-personal-imports-change'));
            }}
          >
            重新讀取課表
          </button>
        </div>
      )}
      {loaded && !error && !selected && (
        <>
          <p>把課表帶進來，這裡就會顯示今天的時間與教室。</p>
          <div className={styles.actions}>
            <Link className="btn primary" href={`/import?kind=timetable&${query}`}>
              匯入我的課表
            </Link>
            <Link href={`/timetable?${query}`}>手動排課</Link>
          </div>
        </>
      )}
      {loaded && !error && selected && (
        <>
          <label className={styles.term}>
            查看學期
            <select value={schedule.termKey} onChange={(event) => setTerm(event.target.value)}>
              {schedule.terms.map((item) => (
                <option key={item.key} value={item.key}>
                  {termLabel(item.academicYear, item.semester)}
                </option>
              ))}
            </select>
          </label>
          <p className={styles.note}>
            依每週課表顯示，時間為台灣時間。請確認學期；停課、補課以學校通知為準。
          </p>
          {schedule.unplacedCount > 0 && (
            <p className={styles.warning}>
              有 {schedule.unplacedCount} 筆課程的星期或時間還沒確認，未列入今天。
              <Link href={timetableHref}>補齊課程時間</Link>
            </p>
          )}
          {schedule.today.length ? (
            <ol className={styles.list}>
              {schedule.today.map((entry) => (
                <li
                  key={entry.row.id}
                  className={entry.status === 'ended' ? styles.ended : undefined}
                >
                  <div className={styles.time}>
                    {entry.startTime}
                    <span>–{entry.endTime}</span>
                  </div>
                  <div className={styles.course}>
                    <strong>{entry.row.title}</strong>
                    <span>
                      {entry.row.location || '教室未填'}
                      {entry.row.teacher ? ` · ${entry.row.teacher}` : ''}
                    </span>
                    {entry.conflict && <span className={styles.warning}>時段重疊，請核對課表</span>}
                  </div>
                  <span className={styles.status}>
                    {entry.status === 'ongoing'
                      ? '上課時段'
                      : entry.status === 'ended'
                        ? '已過下課時間'
                        : entry.row.id === schedule.nextId
                          ? '下一堂'
                          : '稍後'}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p>
              {schedule.unplacedCount
                ? '已確認時間的課程中，今天沒有排課。'
                : '這份週課表今天沒有排課。'}
            </p>
          )}
          <div className={styles.actions}>
            <Link href={`/map?${query}`}>查校園地圖</Link>
            <Link href={`/import?kind=timetable&${query}`}>核對匯入紀錄</Link>
          </div>
        </>
      )}
    </section>
  );
}
