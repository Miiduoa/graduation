// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isPublicCourseCatalog } from '@campus/shared/src/publicCourseCatalog';

const sources = {
  ncnu: 'https://ccweb6.ncnu.edu.tw/student/current_semester_opened_listlist.php?cmd=resetall',
  nthu: 'https://www.ccxp.nthu.edu.tw/ccxp/INQUIRE/JH/OPENDATA/open_course_data.json',
} as const;

function response(schoolId: keyof typeof sources) {
  return {
    schoolId,
    sourceUrl: sources[schoolId],
    fetchedAt: '2026-11-07T08:00:00.000Z',
    operation: {
      id: schoolId + '.courses.search',
      version: 1,
      responseSchemaVersion: 1,
      access: 'anonymous-public',
    },
    courses: [
      {
        code: '001',
        section: '0',
        title: '測試課程',
        department: '',
        teacher: '',
        time: '',
        room: '',
        semester: '1151',
        credits: '0',
      },
    ],
    truncated: false,
  };
}

describe.each(['ncnu', 'nthu'] as const)('%s public course provenance', (schoolId) => {
  it('accepts its reviewed operation and remains compatible with older servers', () => {
    const body = response(schoolId);
    expect(isPublicCourseCatalog(body, schoolId)).toBe(true);
    expect(isPublicCourseCatalog({ ...body, operation: undefined }, schoolId)).toBe(true);
    expect(
      isPublicCourseCatalog({ ...body, operation: undefined, fetchedAt: undefined }, schoolId),
    ).toBe(true);
  });

  it('rejects other schools, unreviewed endpoints, redirects and credential-bearing URLs', () => {
    const body = response(schoolId);
    const other = schoolId === 'nthu' ? 'ncnu' : 'nthu';
    for (const sourceUrl of [
      sources[other],
      'https://example.test/courses',
      sources[schoolId] + '&token=secret',
      sources[schoolId].replace('https://', 'http://'),
      sources[schoolId].replace('https://', 'https://user:secret@'),
      sources[schoolId].replace('.edu.tw/', '.edu.tw.example.test/'),
      sources[schoolId] + '#new',
    ]) {
      expect(isPublicCourseCatalog({ ...body, sourceUrl }, schoolId)).toBe(false);
    }
    expect(isPublicCourseCatalog(body, other)).toBe(false);
  });

  it('rejects stale, mismatched or expanded operation declarations', () => {
    const body = response(schoolId);
    for (const operation of [
      null,
      [],
      {},
      { ...body.operation, id: 'constructor' },
      { ...body.operation, id: (schoolId === 'nthu' ? 'ncnu' : 'nthu') + '.courses.search' },
      { ...body.operation, version: 2 },
      { ...body.operation, responseSchemaVersion: 2 },
      { ...body.operation, access: 'private' },
      { ...body.operation, headers: { Cookie: 'secret' } },
    ]) {
      expect(isPublicCourseCatalog({ ...body, operation }, schoolId)).toBe(false);
    }
  });

  it('requires a valid source fetch time for versioned results without inventing one', () => {
    const body = response(schoolId);
    for (const fetchedAt of [
      undefined,
      null,
      '',
      '2026-02-30T08:00:00.000Z',
      '2026-11-07T16:00:00+08:00',
      123,
    ]) {
      expect(isPublicCourseCatalog({ ...body, fetchedAt }, schoolId)).toBe(false);
    }
  });
});
