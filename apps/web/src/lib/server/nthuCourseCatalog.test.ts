// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sourceUrl = 'https://www.ccxp.nthu.edu.tw/ccxp/INQUIRE/JH/OPENDATA/open_course_data.json';
// Public 115-1 records, retrieved 2026-11-06. The capacity and program-specific
// requirement text must not turn into remaining seats or general eligibility.
const chemistry = {
  科號: '11510AES 520300', 課程中文名稱: '環境化學', 課程英文名稱: 'Environment Chemistry', 學分數: '3',
  人限: '', 新生保留人數: '0', 通識對象: ' ', 通識類別: '', 授課語言: '英',
  備註: '本課程上150分鐘，其餘時間由教授視情形彈性運用。', 停開註記: '',
  教室與上課時間: 'BMES醫環618\tM3M4\nBMES醫環501\tF3F4\n',
  授課教師: '董瑞安\tDOONG, RUEY-AN\n', 擋修說明: '', 課程限制說明: '',
  第一二專長對應: '環境科技學程(第二專長)\t能源與環境(第一專長)', 學分學程對應: '', 不可加簽說明: '',
  必選修說明: '分環所115M  必修\t原科院學士班112B  必修\t',
};
const database = {
  ...chemistry, 科號: '11510CS  772000', 課程中文名稱: '資料庫系統專題二',
  課程英文名稱: 'Special Topics in Data Base Management Systems(II)', 學分數: '2', 人限: '0',
  授課語言: '中', 備註: '以加簽方式選課。', 第一二專長對應: '', 必選修說明: '資工系115D  選修\t資工系115M  選修\t',
  教室與上課時間: 'DELTA台達102\tW3W4\n', 授課教師: '陳宜欣\tCHEN, YI-SHIN\n',
};
const response = (rows: unknown = [chemistry, database], headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(rows), { headers: { 'Content-Type': 'text/plain', ...headers } });

describe('NTHU official public JSON catalog', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

  it('preserves padded identities and real room/time pairs while searching names, codes and bilingual teachers', async () => {
    const fetchSource = vi.fn().mockImplementation(() => Promise.resolve(response()));
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    vi.stubGlobal('fetch', fetchSource);
    const { searchNthuCourseCatalog } = await import('./nthuCourseCatalog');
    const chemistryResult = await searchNthuCourseCatalog('chemistry doong');
    expect(chemistryResult).toEqual({
      schoolId: 'nthu', sourceUrl, truncated: false, fetchedAt: expect.any(String),
      courses: [{
        code: '11510AES 520300', section: '00', title: '環境化學', department: 'AES',
        teacher: '董瑞安\tDOONG, RUEY-AN', time: 'M3M4\nF3F4', room: 'BMES醫環618\nBMES醫環501',
        semester: '1151', credits: '3',
        meetings: [{ room: 'BMES醫環618', time: 'M3M4' }, { room: 'BMES醫環501', time: 'F3F4' }],
      }],
    });
    for (const query of ['１１５１０ＣＳ７７２０００', 'CS 772000', '資料庫 陳宜欣', 'DELTA臺達102']) {
      expect((await searchNthuCourseCatalog(query)).courses.map(course => course.code)).toEqual(['11510CS  772000']);
    }
    expect((await searchNthuCourseCatalog('不存在的課')).courses).toEqual([]);
    expect(fetchSource.mock.calls).toEqual([[sourceUrl, expect.objectContaining({
      headers: { Accept: 'application/json, text/plain' }, credentials: 'omit', redirect: 'error', cache: 'no-store',
      signal: expect.any(AbortSignal),
    })]]);
    expect(timeout).toHaveBeenCalledWith(20_000);
  });

  it('retains empty schedules, room-only entries, bilingual staff and zero credits', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([
      { ...chemistry, 科號: '11510AES 510100', 課程中文名稱: '碩士班專題研究', 教室與上課時間: '', 授課教師: '指導教授\t\n' },
      { ...chemistry, 教室與上課時間: 'SINICA中  研院\t \n', 學分數: '0', 授課教師: '陳俊銘\tCHEN, CHUN-MING\n周秀專\tCHOU, HSIU-CHUAN\n' },
    ])));
    const { searchNthuCourseCatalog } = await import('./nthuCourseCatalog');
    const result = await searchNthuCourseCatalog('');
    expect(result.courses[0]).toMatchObject({ time: '', room: '', teacher: '指導教授', meetings: [] });
    expect(result.courses[1]).toMatchObject({
      time: '', room: 'SINICA中  研院', credits: '0',
      meetings: [{ room: 'SINICA中  研院', time: '' }],
      teacher: '陳俊銘\tCHEN, CHUN-MING\n周秀專\tCHOU, HSIU-CHUAN',
    });
  });

  it('searches the complete feed before limiting results and excludes explicitly cancelled courses', async () => {
    const rows = Array.from({ length: 70 }, (_, index) => ({ ...chemistry, 科號: '11510AES ' + String(index).padStart(6, '0') }));
    rows.push({ ...database, 停開註記: '停開' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(rows)));
    const { searchNthuCourseCatalog } = await import('./nthuCourseCatalog');
    expect(await searchNthuCourseCatalog('')).toMatchObject({ truncated: true, courses: expect.any(Array) });
    expect((await searchNthuCourseCatalog('')).courses).toHaveLength(50);
    expect(await searchNthuCourseCatalog('000069')).toMatchObject({ truncated: false, courses: [{ code: '11510AES 000069' }] });
    expect((await searchNthuCourseCatalog('資料庫')).courses).toEqual([]);
  });

  it('filters the complete feed before truncating while retaining all padded identities and meetings', async () => {
    const rows = Array.from({ length: 70 }, (_, index) => ({
      ...chemistry,
      科號: '11520AES ' + String(index).padStart(6, '0'),
      ...(index < 60 ? {} : { 學分數: '1.50', 教室與上課時間: '教室甲\tR3R4\n教室乙\tU1\n' }),
    }));
    const fetchSource = vi.fn().mockResolvedValue(response(rows));
    vi.stubGlobal('fetch', fetchSource);
    const { searchNthuCourseCatalog } = await import('./nthuCourseCatalog');
    const unfiltered = await searchNthuCourseCatalog('');
    expect(unfiltered.courses).toHaveLength(50);
    expect(unfiltered).not.toHaveProperty('filters');
    expect(unfiltered).not.toHaveProperty('unresolvedCount');
    const filtered = await searchNthuCourseCatalog('chemistry', { weekday: 4, credits: 1.5 });
    expect(filtered).toMatchObject({ filters: { weekday: 4, credits: 1.5 }, truncated: false, unresolvedCount: 0 });
    expect(filtered.courses.map(course => course.code)).toEqual(
      Array.from({ length: 10 }, (_, index) => '11520AES ' + String(index + 60).padStart(6, '0')),
    );
    expect(filtered.courses[0]).toMatchObject({
      semester: '1152', time: 'R3R4\nU1', credits: '1.50',
      meetings: [{ room: '教室甲', time: 'R3R4' }, { room: '教室乙', time: 'U1' }],
    });
    expect((await searchNthuCourseCatalog('', { weekday: 7 })).courses).toEqual(filtered.courses);
    const capped = await searchNthuCourseCatalog('', { weekday: 1 });
    expect(capped.courses).toHaveLength(50);
    expect(capped).toMatchObject({ truncated: true, unresolvedCount: 0, filters: { weekday: 1 } });
    expect(fetchSource).toHaveBeenCalledTimes(1);
  });

  it('counts only unresolved keyword matches and keeps unknown credits distinct from zero', async () => {
    const rows = [
      { ...chemistry, 科號: '11520AES 000001', 教室與上課時間: '教室\tR3R4\n', 學分數: '3.0' },
      { ...chemistry, 科號: '11520AES 000002', 教室與上課時間: '', 學分數: '3' },
      { ...chemistry, 科號: '11520AES 000003', 教室與上課時間: '教室\t未定\n', 學分數: '2' },
      { ...chemistry, 科號: '11520AES 000004', 教室與上課時間: '教室\tM3M4\n', 學分數: '' },
      { ...chemistry, 科號: '11520AES 000005', 教室與上課時間: '教室\tR3R4\n', 學分數: '' },
      { ...chemistry, 科號: '11520AES 000006', 教室與上課時間: '甲\tR3R4\n乙\t\n', 學分數: '3' },
      { ...chemistry, 科號: '11520AES 000007', 教室與上課時間: '', 學分數: '0' },
      { ...database, 科號: '11520CS  000008', 教室與上課時間: '', 學分數: '待確認' },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(rows)));
    const { searchNthuCourseCatalog } = await import('./nthuCourseCatalog');
    const filtered = await searchNthuCourseCatalog('chemistry', { weekday: 4, credits: 3 });
    expect(filtered).toMatchObject({ filters: { weekday: 4, credits: 3 }, unresolvedCount: 3, truncated: false });
    expect(filtered.courses.map(course => course.code)).toEqual(['11520AES 000001']);
    const zero = await searchNthuCourseCatalog('', { credits: 0 });
    expect(zero.courses.map(course => course.code)).toEqual(['11520AES 000007']);
    expect(zero.unresolvedCount).toBe(3);
    const unfiltered = await searchNthuCourseCatalog('');
    expect(unfiltered.courses).toHaveLength(8);
    expect(unfiltered.courses[5].meetings).toEqual([{ room: '甲', time: 'R3R4' }, { room: '乙', time: '' }]);
    expect(unfiltered.courses[7].credits).toBe('待確認');
    expect(unfiltered).not.toHaveProperty('unresolvedCount');
  });

  it.each([{ weekday: 0 }, { weekday: 1.5 }, { credits: -1 }, { credits: 40.01 }, { credits: 1.234 }])(
    'rejects invalid direct adapter filters %j before loading the source', async (filters) => {
      const fetchSource = vi.fn();
      vi.stubGlobal('fetch', fetchSource);
      const { searchNthuCourseCatalog } = await import('./nthuCourseCatalog');
      await expect(searchNthuCourseCatalog('', filters)).rejects.toThrow('Invalid course filters');
      expect(fetchSource).not.toHaveBeenCalled();
    },
  );

  it('coalesces simultaneous searches into one in-flight download', async () => {
    let finish!: (value: Response) => void;
    const fetchSource = vi.fn().mockReturnValue(new Promise<Response>(resolve => { finish = resolve; }));
    vi.stubGlobal('fetch', fetchSource);
    const { searchNthuCourseCatalog } = await import('./nthuCourseCatalog');
    const first = searchNthuCourseCatalog('化學');
    const second = searchNthuCourseCatalog('資料庫');
    expect(fetchSource).toHaveBeenCalledTimes(1);
    finish(response());
    expect((await first).courses[0].title).toBe('環境化學');
    expect((await second).courses[0].title).toBe('資料庫系統專題二');
  });

  it('backs off for 15 seconds after failure and refreshes the snapshot after 15 minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(0);
    const fetchSource = vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementation(() => Promise.resolve(response()));
    vi.stubGlobal('fetch', fetchSource);
    const { searchNthuCourseCatalog } = await import('./nthuCourseCatalog');
    await expect(searchNthuCourseCatalog('')).rejects.toThrow();
    vi.setSystemTime(14_999);
    await expect(searchNthuCourseCatalog('')).rejects.toThrow();
    expect(fetchSource).toHaveBeenCalledTimes(1);
    vi.setSystemTime(15_000);
    await expect(searchNthuCourseCatalog('')).resolves.toHaveProperty('schoolId', 'nthu');
    vi.setSystemTime(15_000 + 15 * 60_000 - 1);
    await searchNthuCourseCatalog('');
    expect(fetchSource).toHaveBeenCalledTimes(2);
    vi.setSystemTime(15_000 + 15 * 60_000);
    await searchNthuCourseCatalog('');
    expect(fetchSource).toHaveBeenCalledTimes(3);
  });

  it.each(['application/json; charset=utf-8', 'text/plain; charset=utf-8'])('accepts the official JSON with %s MIME', async contentType => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(undefined, { 'Content-Type': contentType })));
    const { searchNthuCourseCatalog } = await import('./nthuCourseCatalog');
    expect((await searchNthuCourseCatalog('')).courses).toHaveLength(2);
  });

  it.each([
    ['login HTML', () => new Response('<form>login</form>', { headers: { 'Content-Type': 'text/html' } })],
    ['JSON error object', () => response({ error: 'unavailable' })],
    ['empty feed', () => response([])],
    ['missing field', () => response([{ 科號: '11510AES 520300' }])],
    ['invalid identity', () => response([{ ...chemistry, 科號: '11510AES520300' }])],
    ['unpaired room/time data', () => response([{ ...chemistry, 教室與上課時間: 'BMES醫環618 M3M4' }])],
    ['unrecognized status', () => response([{ ...chemistry, 停開註記: 'unknown' }])],
    ['declared oversized body', () => response(undefined, { 'Content-Length': String(6 * 1024 * 1024 + 1) })],
    ['streamed oversized body', () => new Response('a'.repeat(6 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'text/plain' } })],
    ['invalid UTF-8', () => new Response(new Uint8Array([0xc3, 0x28]), { headers: { 'Content-Type': 'text/plain' } })],
    ['failed upstream', () => new Response('down', { status: 503 })],
  ])('rejects %s and caches the failure briefly', async (_, source) => {
    const fetchSource = vi.fn().mockImplementation(source);
    vi.stubGlobal('fetch', fetchSource);
    const { searchNthuCourseCatalog } = await import('./nthuCourseCatalog');
    await expect(searchNthuCourseCatalog('')).rejects.toThrow();
    await expect(searchNthuCourseCatalog('')).rejects.toThrow();
    expect(fetchSource).toHaveBeenCalledTimes(1);
  });

  it('cancels a body that stalls instead of retaining an unbounded in-flight read', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}), cancel });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { headers: { 'Content-Type': 'text/plain' } })));
    const { searchNthuCourseCatalog } = await import('./nthuCourseCatalog');
    const pending = expect(searchNthuCourseCatalog('')).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(20_001);
    await pending;
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
