import { describe, expect, it } from 'vitest';
import type { PersonalImportRecord } from '@campus/shared/src/imports/types';
import {
  buildCampusRecommendations,
  CAMPUS_GOAL_OPTIONS,
  CAMPUS_STAGE_OPTIONS,
  createDefaultCampusPreferences,
  normalizeCampusPreferences,
  type CampusPersonalizationPreferences,
} from '@campus/shared/src/campusPersonalization';

const SCHOOL = 'providence-university';
const NOW = new Date('2026-11-13T12:00:00+08:00');
const preferences = (change: Partial<CampusPersonalizationPreferences> = {}) => ({
  ...createDefaultCampusPreferences(),
  configured: true,
  ...change,
});
const exam = (change: Partial<PersonalImportRecord> = {}): PersonalImportRecord => ({
  id: 'exam-database',
  kind: 'events',
  title: '資料庫期中考',
  schoolId: SCHOOL,
  academicYear: '115',
  semester: '1',
  date: '2026-11-20',
  startTime: '10:00',
  endTime: '12:00',
  source: { type: 'paste', line: 1, rawText: '' },
  batchId: 'batch-1',
  importedAt: '2026-11-10T00:00:00Z',
  ...change,
});
const build = (
  changes: Partial<CampusPersonalizationPreferences> = {},
  events: readonly PersonalImportRecord[] = [],
  now = NOW,
  schoolId: string | null = SCHOOL,
) => buildCampusRecommendations({ preferences: preferences(changes), events, now, schoolId });

describe('campus preferences are self-described, versioned data', () => {
  it('returns separate defaults and rejects absent or unknown versions', () => {
    const first = createDefaultCampusPreferences();
    first.goals.push('career');
    expect(createDefaultCampusPreferences().goals).toEqual([]);
    for (const value of [
      null,
      [],
      'student',
      { stage: 'year-4' },
      { version: 2, stage: 'year-4' },
    ]) {
      expect(normalizeCampusPreferences(value)).toEqual(createDefaultCampusPreferences());
    }
  });

  it('projects only allowed fields and never carries role, access or arbitrary links', () => {
    const result = normalizeCampusPreferences({
      version: 1,
      stage: 'admin',
      focus: 'operator',
      living: 'owner',
      goals: ['career', 'career', 'invalid', 'project', 'internship', 'campus-life'],
      configured: 'true',
      role: 'admin',
      verified: true,
      href: 'javascript:alert(1)',
    });
    expect(result).toEqual({
      ...createDefaultCampusPreferences(),
      goals: ['career', 'project', 'internship'],
    });
    expect(Object.keys(result)).not.toContain('role');
  });

  it('does not mutate input arrays or nested periods', () => {
    const raw = preferences({
      goals: ['career'],
      phaseOverride: { kind: 'finals', startDate: '2026-12-01', endDate: '2026-12-10' },
    });
    const result = normalizeCampusPreferences(raw);
    result.goals.push('project');
    result.phaseOverride!.endDate = '2027-01-01';
    expect(raw.goals).toEqual(['career']);
    expect(raw.phaseOverride!.endDate).toBe('2026-12-10');
  });

  it.each([
    { kind: 'finals', startDate: '2026-02-29', endDate: '2026-03-02' },
    { kind: 'finals', startDate: '2026-02-30', endDate: '2026-03-02' },
    { kind: 'finals', startDate: '2026-04-31', endDate: '2026-05-02' },
    { kind: 'finals', startDate: '2026-01-01', endDate: '2026-04-01' },
    { kind: 'finals', startDate: '2026-11-20', endDate: '2026-11-19' },
    { kind: 'finals', startDate: '2026-11-13T00:00:00Z', endDate: '2026-11-20' },
    { kind: 'exams', startDate: '2026-11-13', endDate: '2026-11-20' },
    { kind: 'finals', startDate: 1794499200, endDate: '2026-11-20' },
    { kind: 'finals', startDate: '2200-12-30', endDate: '2201-01-02' },
    { kind: 'finals', startDate: '1899-12-30', endDate: '1900-01-02' },
  ])('rejects invalid or overlong manual periods: %j', (period) => {
    expect(
      normalizeCampusPreferences({ ...preferences(), phaseOverride: period }).phaseOverride,
    ).toBeNull();
  });

  it('accepts leap day and at most ninety inclusive dates', () => {
    const leap = { kind: 'finals', startDate: '2028-02-29', endDate: '2028-02-29' } as const;
    const ninety = { kind: 'break', startDate: '2026-01-01', endDate: '2026-03-31' } as const;
    expect(normalizeCampusPreferences(preferences({ phaseOverride: leap })).phaseOverride).toEqual(
      leap,
    );
    expect(
      normalizeCampusPreferences(preferences({ phaseOverride: ninety })).phaseOverride,
    ).toEqual(ninety);
    const yearLimit = { kind: 'break', startDate: '2200-12-30', endDate: '2200-12-31' } as const;
    expect(
      normalizeCampusPreferences(preferences({ phaseOverride: yearLimit })).phaseOverride,
    ).toEqual(yearLimit);
  });
});

describe('phase changes use explicit Taipei dates, not school-calendar guesses', () => {
  it.each(['2026-01-05', '2026-06-05', '2026-11-13'])(
    'does not infer an exam from month %s',
    (day) => {
      expect(build({}, [], new Date(`${day}T12:00:00+08:00`)).phase.kind).toBe('regular');
    },
  );

  it('uses a manual period only from its first Taipei day through its inclusive last day', () => {
    const settings = {
      phaseOverride: { kind: 'finals', startDate: '2026-11-13', endDate: '2026-11-14' },
    } as const;
    expect(build(settings, [], new Date('2026-11-12T15:59:59Z')).phase.kind).toBe('regular');
    expect(build(settings, [], new Date('2026-11-12T16:00:00Z')).phase).toMatchObject({
      kind: 'finals',
      source: 'manual',
    });
    expect(build(settings, [], new Date('2026-11-14T15:59:59Z')).phase.kind).toBe('finals');
    expect(build(settings, [], new Date('2026-11-14T16:00:00Z')).phase.kind).toBe('regular');
  });

  it('honors explicit current preference and resumes event-based preparation after expiry', () => {
    const settings = {
      phaseOverride: { kind: 'break', startDate: '2026-11-13', endDate: '2026-11-13' },
    } as const;
    expect(build(settings, [exam()]).phase).toMatchObject({ kind: 'break', source: 'manual' });
    expect(build(settings, [exam()], new Date('2026-11-14T00:00:00+08:00')).phase).toMatchObject({
      kind: 'midterms',
      source: 'event',
    });
  });

  it('starts preparation fourteen Taipei calendar days before a dated personal exam', () => {
    const row = exam({ date: '2026-11-27', startTime: '23:00', endTime: '23:30' });
    expect(build({}, [row]).phase).toMatchObject({ kind: 'midterms', source: 'event' });
    expect(build({}, [row], new Date('2026-11-12T23:59:59+08:00')).phase.kind).toBe('regular');
    expect(build({}, [row]).phase.reason).toContain('你的行程');
    expect(build({}, [row]).phase.reason).toContain('2026-11-27');
    expect(build({}, [row]).phase.reason).not.toContain('全校');
  });

  it('stops a timed exam exactly at its actual end', () => {
    const row = exam({ date: '2026-11-13' });
    expect(build({}, [row], new Date('2026-11-13T11:59:59+08:00')).phase.reason).toContain(
      '正在進行',
    );
    expect(build({}, [row], new Date('2026-11-13T12:00:00+08:00')).phase.kind).toBe('regular');
  });

  it('honors exclusive all-day endDate and a missing endDate as one day', () => {
    const range = exam({
      date: '2026-11-11',
      endDate: '2026-11-14',
      allDay: true,
      startTime: undefined,
      endTime: undefined,
    });
    expect(build({}, [range], new Date('2026-11-13T23:59:59+08:00')).phase.kind).toBe('midterms');
    expect(build({}, [range], new Date('2026-11-14T00:00:00+08:00')).phase.kind).toBe('regular');
    const oneDay = { ...range, date: '2026-11-13', endDate: undefined };
    expect(build({}, [oneDay]).phase.kind).toBe('midterms');
    expect(build({}, [oneDay], new Date('2026-11-14T00:00:00+08:00')).phase.kind).toBe('regular');
  });

  it('keeps overnight timed events active only until the following day end time', () => {
    const row = exam({
      date: '2026-11-12',
      endDate: '2026-11-13',
      startTime: '23:00',
      endTime: '01:00',
    });
    expect(build({}, [row], new Date('2026-11-13T00:30:00+08:00')).phase.kind).toBe('midterms');
    expect(build({}, [row], new Date('2026-11-13T01:00:00+08:00')).phase.kind).toBe('regular');
  });

  it('rejects missing, impossible, reversed and contradictory event date/time values', () => {
    const invalid = [
      exam({ date: '2026-02-30' }),
      exam({ endDate: '2026-11-19' }),
      exam({ startTime: '25:00' }),
      exam({ endTime: undefined }),
      exam({ startTime: '12:00', endTime: '10:00' }),
      exam({ allDay: true }),
      exam({ allDay: true, startTime: undefined, endTime: undefined, endDate: '2026-11-20' }),
      exam({ allDay: 'true' as unknown as boolean }),
      exam({ kind: 'timetable' }),
    ];
    for (const row of invalid) expect(build({}, [row]).phase.kind).toBe('regular');
  });

  it.each([
    '期中考複習',
    '期末考報告',
    '期中考取消',
    '期末考注意事項',
    '期末考不用考',
    '期中與期末考試說明',
    'Midterm review',
    'Prepare for final exam',
    'Final exam cancelled',
    'No final exam',
    'Midterm project',
    'Final report',
  ])('does not interpret preparation or announcements as an exam: %s', (title) => {
    expect(build({}, [exam({ title })]).phase.kind).toBe('regular');
  });

  it.each([
    ['演算法期末考', 'finals'],
    ['資料庫期中測驗', 'midterms'],
    ['Database midterm', 'midterms'],
    ['Math final exam', 'finals'],
  ])('recognizes a narrow dated exam title: %s', (title, kind) => {
    expect(build({}, [exam({ title })]).phase).toMatchObject({ kind, source: 'event' });
  });

  it('only uses records from the selected campus; no campus means personal records', () => {
    const foreign = exam({ schoolId: 'another-school', title: '他校期末考' });
    expect(build({}, [foreign]).phase.kind).toBe('regular');
    expect(build({}, [exam()], NOW, null).phase.kind).toBe('regular');
    expect(build({}, [exam({ schoolId: 'personal' })], NOW, null).phase.kind).toBe('midterms');
  });

  it('chooses the nearest ongoing or upcoming exam regardless of array order', () => {
    const later = exam({ id: 'later', title: '期末考', date: '2026-11-22' });
    expect(build({}, [later, exam()]).phase.kind).toBe('midterms');
    expect(build({}, [exam(), later]).phase).toEqual(build({}, [later, exam()]).phase);
  });

  it('returns a safe default phase for invalid time without throwing', () => {
    const settings = {
      phaseOverride: { kind: 'finals', startDate: '2026-11-13', endDate: '2026-11-20' },
    } as const;
    expect(build(settings, [exam()], new Date('invalid')).phase).toMatchObject({
      kind: 'regular',
      source: 'default',
    });
  });
});

describe('recommendations reflect explicit needs and keep real destinations', () => {
  it('changes useful actions across student stages without asserting verified identity', () => {
    expect(build({ stage: 'year-1' }).recommendations[0].id).toBe('map');
    expect(build({ stage: 'year-3' }).recommendations[0]).toMatchObject({
      id: 'calendar',
      title: '拆解專題里程碑',
    });
    expect(build({ stage: 'year-4' }).recommendations[0].id).toBe('credits');
    expect(build({ stage: 'graduate' }).recommendations[0].id).toBe('library');
    expect(build({ stage: 'year-4' }).recommendations[0].reason).toContain('你設定');
  });

  it('allows explicit goals to take priority over stage defaults', () => {
    const result = build({ stage: 'year-1', goals: ['graduate-study'] });
    expect(result.recommendations[0]).toMatchObject({
      id: 'calendar',
      title: '整理報名、面試與備審日期',
    });
    expect(result.recommendations[0].reason).toContain('準備升學');
  });

  it('offers personal project and career preparation without requiring school-only collaboration access', () => {
    const project = build({ goals: ['project'] }).recommendations[0];
    expect(project).toMatchObject({ id: 'calendar', title: '拆解專題里程碑' });
    expect(new URL(project.href, 'https://nuni.tw').pathname).toBe('/calendar');
    const career = build({ goals: ['career'] }).recommendations[0];
    expect(career).toMatchObject({ id: 'calendar', title: '安排履歷與作品準備' });
    expect(new URL(career.href, 'https://nuni.tw').pathname).toBe('/calendar');
    expect(
      build({ stage: 'year-3' }).recommendations.map(
        (item) => new URL(item.href, 'https://nuni.tw').pathname,
      ),
    ).toEqual(['/calendar', '/school-info', '/credit-planner']);
    for (const stage of CAMPUS_STAGE_OPTIONS) {
      for (const goal of CAMPUS_GOAL_OPTIONS) {
        expect(
          build({ stage: stage.value, goals: [goal.value] }).recommendations.some((item) =>
            ['/groups', '/community/me'].includes(new URL(item.href, 'https://nuni.tw').pathname),
          ),
        ).toBe(false);
      }
    }
  });

  it('merges calendar actions and keeps the most specific highest-priority reason', () => {
    const result = build({ stage: 'year-3', goals: ['career', 'project', 'graduate-study'] });
    expect(result.recommendations[0]).toMatchObject({
      id: 'calendar',
      title: '安排履歷與作品準備',
    });
    expect(result.recommendations[0].reason).toContain('準備求職');
    expect(
      result.recommendations.filter(
        (item) => new URL(item.href, 'https://nuni.tw').pathname === '/calendar',
      ),
    ).toHaveLength(1);
    const withExam = build({ stage: 'year-3', goals: ['career', 'project', 'graduate-study'] }, [
      exam(),
    ]);
    expect(withExam.recommendations[0]).toMatchObject({
      id: 'calendar',
      title: '排出考前複習時間',
    });
    expect(withExam.recommendations[0].reason).toContain('資料庫期中考');
    expect(new Set(withExam.recommendations.map((item) => item.href)).size).toBe(
      withExam.recommendations.length,
    );
  });

  it('responds to living arrangement and focus without dropping exam preparation', () => {
    expect(build({ stage: 'year-1', living: 'commute', focus: 'life' }).recommendations[0].id).toBe(
      'bus',
    );
    expect(build({ living: 'dorm' }).recommendations[0].id).toBe('dormitory');
    const result = build({ living: 'commute', focus: 'life', goals: ['campus-life'] }, [exam()]);
    expect(result.recommendations[0].id).toBe('calendar');
    expect(result.recommendations[1].id).toBe('coursework');
  });

  it('uses Taipei lunch hours for life recommendations without forcing a food action', () => {
    const lunch = build(
      { focus: 'life', goals: ['campus-life'] },
      [],
      new Date('2026-11-13T04:00:00Z'),
    );
    const night = build(
      { focus: 'life', goals: ['campus-life'] },
      [],
      new Date('2026-11-13T16:00:00Z'),
    );
    expect(lunch.recommendations.find((item) => item.id === 'food')?.reason).toContain('用餐時段');
    expect(night.recommendations.find((item) => item.id === 'food')?.reason).not.toContain(
      '用餐時段',
    );
  });

  it('returns at most three unique actions and no internal scores or authority fields', () => {
    const result = build(
      { stage: 'year-4', goals: ['coursework', 'graduate-study', 'career'], living: 'commute' },
      [exam()],
    );
    expect(result.recommendations).toHaveLength(3);
    expect(new Set(result.recommendations.map((item) => item.id)).size).toBe(3);
    for (const item of result.recommendations) {
      expect(item).not.toHaveProperty('score');
      expect(item).not.toHaveProperty('role');
      expect(item.reason).not.toBe('');
    }
  });

  it('preserves campus scope in generated links and encodes hostile identifier text', () => {
    const schoolId = 'school&redirect=https://example.org/#a';
    const result = build({ stage: 'year-1' }, [], NOW, schoolId);
    for (const item of result.recommendations) {
      const url = new URL(item.href, 'https://nuni.tw');
      expect(url.origin).toBe('https://nuni.tw');
      expect(url.searchParams.get('campus')).toBe(schoolId);
      expect(url.searchParams.get('schoolId')).toBe(schoolId);
      expect(url.searchParams.has('redirect')).toBe(false);
    }
    expect(
      build({}, [], NOW, null).recommendations.every((item) => item.href.includes('campus=all')),
    ).toBe(true);
  });
});
