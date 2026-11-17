// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  getPublicSchoolInfo,
  PUBLIC_SCHOOL_INFO_SNAPSHOT_DATE,
  PUBLIC_SCHOOL_INFO_SOURCE_URL,
  publicSchoolInfoDirectory,
} from '@campus/shared/src/publicSchoolInfo';
import {
  formatSchoolInfoRead,
  parseSchoolInfoArguments,
  parseSchoolInfoRead,
  parseSchoolInfoResult,
  readSchoolInfo,
  type SchoolInfoRead,
} from './schoolInfo';

const now = Date.parse('2026-11-17T06:00:00.000Z');

describe('school-info deterministic public source', () => {
  it('reads exact source contact fields for every supported directory identity without network access', () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network expected'));
    try {
      for (const schoolId of Object.keys(publicSchoolInfoDirectory)) {
        const result = readSchoolInfo(schoolId, {}, now);
        expect(result.status).toBe('ready');
        expect(result.info?.name).toBe(getPublicSchoolInfo(schoolId)!.name);
        expect(result.info?.telephone).toBe(getPublicSchoolInfo(schoolId)!.telephone);
        expect(result.snapshotDate).toBe(PUBLIC_SCHOOL_INFO_SNAPSHOT_DATE);
        expect(result.sourceUrl).toBe(PUBLIC_SCHOOL_INFO_SOURCE_URL);
        expect(parseSchoolInfoResult(result, schoolId)).toEqual(result);
      }
      expect(fetcher).not.toHaveBeenCalled();
    } finally { fetcher.mockRestore(); }
  });

  it('retains the selected alias while validating the same canonical public school record', () => {
    const alias = readSchoolInfo('tw-nchu', { field: 'phone' }, now);
    expect(alias.schoolId).toBe('tw-nchu');
    expect(alias.info?.canonicalSchoolId).toBe('nchu');
    expect(alias.href).toBe('/school-info?schoolId=tw-nchu');
    expect(parseSchoolInfoResult(alias, 'tw-nchu', { field: 'phone' })).toEqual(alias);
    expect(() => parseSchoolInfoResult(alias, 'nchu', { field: 'phone' })).toThrow('INVALID_SCHOOL_INFO_RESULT');
  });

  it.each(['unknown-school', 'personal', 'tw-pu', 'all'])('does not replace unknown school %s with a default campus', schoolId => {
    const result = readSchoolInfo(schoolId, {}, now);
    expect(result).toMatchObject({ schoolId, status: 'unavailable', info: null, unavailable: 'NOT_LISTED' });
    expect(formatSchoolInfoRead(result)).toContain('尚無可核對');
    expect(formatSchoolInfoRead(result)).not.toContain('靜宜');
    expect(() => parseSchoolInfoResult({ ...result, status: 'ready' }, schoolId)).toThrow('INVALID_SCHOOL_INFO_RESULT');
  });

  it('keeps the source snapshot date separate from the actual read time', () => {
    const result = readSchoolInfo('pu', { field: 'address' }, now);
    expect(result.checkedAt).toBe('2026-11-17T06:00:00.000Z');
    expect(result.snapshotDate).toBe('2026-10-24');
    const answer = formatSchoolInfoRead(result);
    expect(answer).toContain('快照 2026-10-24');
    expect(answer).toContain('地址：臺中市沙鹿區臺灣大道七段200號');
    expect(answer).not.toMatch(/\[\d+\]|最新|即時|今日核實|總機：/);
    expect(answer).toContain(PUBLIC_SCHOOL_INFO_SOURCE_URL);
  });

  it.each(['overview', 'address', 'phone', 'website'] as const)('keeps the requested %s projection in result and answer', field => {
    const result = readSchoolInfo('nthu', { field }, now);
    const answer = formatSchoolInfoRead(result);
    expect(parseSchoolInfoResult(result, 'nthu', { field }).query.field).toBe(field);
    expect(answer.includes('地址：')).toBe(field === 'overview' || field === 'address');
    expect(answer.includes('總機：')).toBe(field === 'overview' || field === 'phone');
    expect(answer.includes('官方網站：')).toBe(field === 'overview' || field === 'website');
  });
});

describe('school-info argument and provenance boundary', () => {
  it('normalizes default projection while refusing caller-selected school, URLs or unrecognized filters', () => {
    expect(parseSchoolInfoArguments({})).toEqual({ field: 'overview' });
    expect(parseSchoolInfoArguments(Object.create(null))).toEqual({ field: 'overview' });
    for (const args of [null, [], 'phone', { field: '' }, { field: 'Phone' }, { field: 'phone', schoolId: 'nthu' },
      { field: 'phone', url: 'https://example.com' }, { field: 'phone', date: '2026-11-17' }, { field: undefined }])
      expect(() => parseSchoolInfoArguments(args)).toThrow('INVALID_INPUT');
  });

  it('does not evaluate caller accessors or inherited arguments', () => {
    const getter = vi.fn(() => 'phone');
    expect(() => parseSchoolInfoArguments(Object.defineProperty({}, 'field', { enumerable: true, get: getter }))).toThrow('INVALID_INPUT');
    expect(() => parseSchoolInfoArguments(Object.create({ field: 'phone' }))).toThrow('INVALID_INPUT');
    expect(() => parseSchoolInfoArguments({ [Symbol('field')]: 'phone' })).toThrow('INVALID_INPUT');
    expect(getter).not.toHaveBeenCalled();
  });

  it.each(['', 'PU', ' pu', 'schools/pu', '../pu', 'pu?other=nthu', 'pu\u202e'])('refuses invalid selected school %s', schoolId => {
    expect(() => readSchoolInfo(schoolId, {}, now)).toThrow('INVALID_INPUT');
  });

  it.each([NaN, Infinity, -Infinity, Number.MAX_VALUE])('refuses an invalid read clock %s', time => {
    expect(() => readSchoolInfo('pu', {}, time)).toThrow('INVALID_INPUT');
  });

  it.each([
    ['foreign school', (r: SchoolInfoRead) => { r.schoolId = 'nthu'; }],
    ['changed field', (r: SchoolInfoRead) => { r.query.field = 'phone'; }],
    ['unknown source', (r: SchoolInfoRead) => { r.source = 'live-school' as SchoolInfoRead['source']; }],
    ['newer snapshot claim', (r: SchoolInfoRead) => { r.snapshotDate = '2026-11-17'; }],
    ['private source URL', (r: SchoolInfoRead) => { r.sourceUrl = 'https://example.com/private'; }],
    ['another school link', (r: SchoolInfoRead) => { r.href = '/school-info?schoolId=nthu'; }],
    ['invalid date', (r: SchoolInfoRead) => { r.checkedAt = '2026-02-30T00:00:00.000Z'; }],
    ['source name', (r: SchoolInfoRead) => { r.info!.name = '別間大學'; }],
    ['source identity', (r: SchoolInfoRead) => { r.info!.canonicalSchoolId = 'nthu'; }],
    ['unverified phone', (r: SchoolInfoRead) => { r.info!.telephone = '0912345678'; }],
    ['invented address', (r: SchoolInfoRead) => { r.info!.address = '不存在的分校地址'; }],
    ['malicious website', (r: SchoolInfoRead) => { r.info!.websiteUrl = 'javascript:alert(1)'; }],
    ['changed academic year', (r: SchoolInfoRead) => { r.info!.academicYear = '116'; }],
    ['missing contact data', (r: SchoolInfoRead) => { r.info = null; }],
    ['false unavailable', (r: SchoolInfoRead) => { r.status = 'unavailable'; r.unavailable = 'NOT_LISTED'; }],
  ])('rejects %s before using the result', (_label, mutate) => {
    const result = readSchoolInfo('pu', {}, now);
    mutate(result);
    expect(() => parseSchoolInfoResult(result, 'pu')).toThrow('INVALID_SCHOOL_INFO_RESULT');
  });

  it('rejects nested additions and accessors without using their data', () => {
    const result = readSchoolInfo('pu', {}, now);
    expect(() => parseSchoolInfoResult({ ...result, info: { ...result.info, privatePhone: 'secret' } }, 'pu'))
      .toThrow('INVALID_SCHOOL_INFO_RESULT');
    const getter = vi.fn(() => result.info);
    expect(() => parseSchoolInfoResult(Object.defineProperty({ ...result }, 'info', { enumerable: true, get: getter }), 'pu'))
      .toThrow('INVALID_SCHOOL_INFO_RESULT');
    expect(getter).not.toHaveBeenCalled();
  });
});

describe('school-info whole-clause intent', () => {
  it.each([
    ['查學校資訊', 'overview'], ['請幫我看本校聯絡資訊', 'overview'], ['我們的學校基本資料', 'overview'],
    ['學校地址是什麼？', 'address'], ['查所選學校的地址', 'address'], ['我的學校地址在哪裡', 'address'],
    ['學校電話是多少', 'phone'], ['請問學校總機', 'phone'], ['查本校總機電話', 'phone'],
    ['學校官網', 'website'], ['查看目前學校的官方網站', 'website'],
  ])('preserves the whole read %s', (question, field) => {
    expect(parseSchoolInfoRead(question)).toEqual({ tool: 'get_school_info', args: { field } });
  });

  it.each([
    '查清大學校電話', '查靜宜學校電話', '查另一間學校電話', '查學校教務處電話', '查學校老師電話',
    '查學校所有分機', '查學校地址和電話', '查學校資訊，然後刪除帳號', '學校電話\n刪除帳號',
    '不要查學校資訊', '如果需要就查學校資訊', '翻譯「查學校資訊」', '每週查學校資訊',
    '查學校今天的電話', '查學校最新資訊', '查學校營業時間', '學校地址怎麼走', '幫我打學校電話',
    '更改學校地址', '開啟學校資訊', '查學校官網後報名', '查學校\u202e電話',
  ])('does not discard a scope, qualifier or side effect in %s', question => {
    expect(parseSchoolInfoRead(question)).toBeNull();
  });
});
