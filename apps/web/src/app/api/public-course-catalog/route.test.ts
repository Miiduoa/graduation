// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Excerpt of the public 1151 export. The two internship sections share one course code.
const header = '"學期","課號","班別","中文課名","開課系所代碼","開課系所","部別","系統可選年級","開課教師","地點","全英語授課","非無障礙教室","英文課名","時間","學分數","人數上限","選修人數","剩餘名額"';
const lines = [
  '"1151","000001","0","普通心理學","00, 諮人系","諮人系","學士班","1","夏榕文","A104","","","General Psychology","3bcd","3.0","999","49","950"',
  '"1151","005076","a","專業實習（一）","00, 諮人系","諮人系","碩士班","g3","林妙容","A307系會議室","","","Internship (1)","5bcd","3.0","999","29","970"',
  '"1151","005076","b","專業實習（一）","00, 諮人系","諮人系","碩士班","g3","沈慶鴻","A309研討室","","","Internship (1)","5bcd","3.0","999","10","989"',
];
const csv = (body = [header, ...lines].join('\r\n'), headers: Record<string, string> = {}) =>
  new Response('\uFEFF' + body, { headers: { 'Content-Type': 'text/csv; charset=utf-8', ...headers } });
const request = (params: string) => new Request('https://example.test/api/public-course-catalog?' + params, {
  headers: { Cookie: 'campus_session=secret', Authorization: 'Bearer secret' },
});

describe('NCNU public guest catalog', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

  it('searches all sections by course number, department and teacher, without forwarding the search or credentials', async () => {
    const fetchSource = vi.fn().mockResolvedValue(csv());
    vi.stubGlobal('fetch', fetchSource);
    const { GET } = await import('./route');
    const [a, b] = await Promise.all([
      GET(request('schoolId=ncnu&q=００５０７６')), GET(request('schoolId=ncnu&q=諮人系+夏榕文')),
    ]);
    const first = await a.json();
    expect(first.operation).toEqual({
      id: 'ncnu.courses.search', version: 1, responseSchemaVersion: 1, access: 'anonymous-public',
    });
    expect(first.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(first.courses.map((row: { section: string }) => row.section)).toEqual(['a', 'b']);
    expect(first.truncated).toBe(false);
    const second = await b.json();
    expect(second.courses).toEqual([{
      semester: '1151', code: '000001', section: '0', title: '普通心理學', department: '諮人系',
      teacher: '夏榕文', time: '3bcd', room: 'A104', credits: '3.0',
    }]);
    expect(fetchSource.mock.calls).toEqual([[
      'https://ccweb6.ncnu.edu.tw/student/current_semester_opened_listlist.php?export=csv',
      expect.objectContaining({ credentials: 'omit', redirect: 'error', headers: { Accept: 'text/csv' } }),
    ]]);
    expect((await (await GET(request('schoolId=ncnu&q=不存在的課'))).json()).courses).toEqual([]);
  });

  it('caps the response after searching all official rows', async () => {
    const many = Array.from({ length: 70 }, (_, i) => lines[0].replace('000001', String(i).padStart(6, '0')));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(csv([header, ...many].join('\r\n'))));
    const { GET } = await import('./route');
    const all = await (await GET(request('schoolId=ncnu'))).json();
    expect(all.courses).toHaveLength(50);
    expect(all.truncated).toBe(true);
    const last = await (await GET(request('schoolId=ncnu&q=000069'))).json();
    expect(last.courses[0].code).toBe('000069');
    expect(last.truncated).toBe(false);
  });

  it('applies weekday and decimal credits across the whole snapshot before the 50-course cap', async () => {
    const many = Array.from({ length: 70 }, (_, index) => {
      const row = lines[0].replace('000001', String(index).padStart(6, '0'));
      return index < 60 ? row : row.replace('3bcd', '5bcd').replace('3.0', '1.50');
    });
    const fetchSource = vi.fn().mockResolvedValue(csv([header, ...many].join('\r\n')));
    vi.stubGlobal('fetch', fetchSource);
    const { GET } = await import('./route');
    const legacy = await (await GET(request('schoolId=ncnu&q=普通'))).json();
    expect(legacy.operation).toEqual({
      id: 'ncnu.courses.search', version: 1, responseSchemaVersion: 1, access: 'anonymous-public',
    });
    expect(legacy).not.toHaveProperty('filters');
    expect(legacy).not.toHaveProperty('unresolvedCount');
    expect(legacy.courses).toHaveLength(50);

    const response = await GET(request('schoolId=ncnu&q=普通&weekday=5&credits=1.50'));
    expect(response.status).toBe(200);
    const filtered = await response.json();
    expect(filtered).toMatchObject({
      filters: { weekday: 5, credits: 1.5 }, unresolvedCount: 0, truncated: false,
      operation: { id: 'ncnu.courses.search', version: 2, responseSchemaVersion: 2, access: 'anonymous-public' },
    });
    expect(filtered.courses.map((course: { code: string }) => course.code)).toEqual(
      Array.from({ length: 10 }, (_, index) => String(index + 60).padStart(6, '0')),
    );
    expect(filtered.courses.every((course: { credits: string }) => course.credits === '1.50')).toBe(true);
    const capped = await (await GET(request('schoolId=ncnu&weekday=3'))).json();
    expect(capped.courses).toHaveLength(50);
    expect(capped).toMatchObject({ truncated: true, unresolvedCount: 0, filters: { weekday: 3 } });
    expect(fetchSource).toHaveBeenCalledTimes(1);
  });

  it('keeps unknown source values separate from matches and known exclusions, including unverified terms', async () => {
    const makeRow = (code: string, time: string, credits: string, title = '普通心理學') => lines[0]
      .replace('000001', code).replace('1151', '1152').replace('3bcd', time).replace('3.0', credits)
      .replace('普通心理學', title);
    const rows = [
      makeRow('000010', '5bcd', '3.0'),
      makeRow('000011', '', '3'),
      makeRow('000012', '未定', '2'),
      makeRow('000013', '3bcd', ''),
      makeRow('000014', '5bcd', ''),
      makeRow('000015', '', '待確認'),
      makeRow('000016', '5bcd', '0'),
      makeRow('000017', '', '', '無關課名'),
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(csv([header, ...rows].join('\r\n'))));
    const { GET } = await import('./route');
    const response = await GET(request('schoolId=ncnu&q=普通&weekday=5&credits=3'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ filters: { weekday: 5, credits: 3 }, unresolvedCount: 3, truncated: false });
    expect(body.courses).toEqual([expect.objectContaining({ code: '000010', semester: '1152', time: '5bcd', credits: '3.0' })]);
    const zero = await (await GET(request('schoolId=ncnu&credits=0'))).json();
    expect(zero.courses.map((course: { code: string }) => course.code)).toEqual(['000016']);
    expect(zero.unresolvedCount).toBe(4);
    const legacy = await (await GET(request('schoolId=ncnu&q=普通'))).json();
    expect(legacy.courses).toHaveLength(7);
    expect(legacy.courses.find((course: { code: string }) => course.code === '000015').credits).toBe('待確認');
    expect(legacy).not.toHaveProperty('unresolvedCount');
  });

  it.each([
    'weekday=', 'weekday=0', 'weekday=8', 'weekday=1.5', 'weekday=01', 'weekday=一',
    'weekday=1&weekday=1', 'credits=', 'credits=-1', 'credits=40.01', 'credits=Infinity',
    'credits=NaN', 'credits=1.234', 'credits=3學分', 'credits=1e0', 'credits=03',
    'credits=3&credits=3', 'weekday=3&credits=3&version=2', 'weekday=3&extra=1',
  ])('rejects malformed or repeated filter parameters %s before fetching any source', async (filters) => {
    const fetchSource = vi.fn();
    vi.stubGlobal('fetch', fetchSource);
    const { GET } = await import('./route');
    for (const schoolId of ['ncnu', 'nthu']) {
      const response = await GET(request('schoolId=' + schoolId + '&' + filters));
      expect(response.status).toBe(400);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
    expect(fetchSource).not.toHaveBeenCalled();
  });

  it('rejects ambiguous campuses and oversized searches before accessing the source', async () => {
    const fetchSource = vi.fn();
    vi.stubGlobal('fetch', fetchSource);
    const { GET } = await import('./route');
    for (const params of ['q=x', 'schoolId=pu', 'schoolId=all', 'schoolId=constructor', 'schoolId=ncnu&schoolId=pu',
      'schoolId=nthu&schoolId=ncnu', 'schoolId=nthu&q=x&q=y', 'schoolId=nthu&q=' + 'a'.repeat(81),
      'schoolId=ncnu&q=x&q=y', 'schoolId=ncnu&q=' + 'a'.repeat(81),
      'schoolId=nthu&url=https://example.test', 'schoolId=ncnu&headers=Cookie',
      'schoolId=nthu&operationId=ncnu.courses.search', 'schoolId=ncnu&__proto__=x']) {
      expect((await GET(request(params))).status).toBe(400);
    }
    expect(fetchSource).not.toHaveBeenCalled();
  });

  it('backs off after an outage, retries, and refreshes successful data after 15 minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(0);
    const fetchSource = vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementation(() => Promise.resolve(csv()));
    vi.stubGlobal('fetch', fetchSource);
    const { GET } = await import('./route');
    expect((await GET(request('schoolId=ncnu'))).status).toBe(502);
    vi.setSystemTime(10_000);
    expect((await GET(request('schoolId=ncnu'))).status).toBe(502);
    expect(fetchSource).toHaveBeenCalledTimes(1);
    vi.setSystemTime(16_000);
    expect((await GET(request('schoolId=ncnu'))).status).toBe(200);
    vi.setSystemTime(16_000 + 15 * 60_000);
    expect((await GET(request('schoolId=ncnu'))).status).toBe(200);
    expect(fetchSource).toHaveBeenCalledTimes(3);
  });

  it('counts supplementary characters using the published JSON Schema limit', async () => {
    const fetchSource = vi.fn().mockResolvedValue(csv());
    vi.stubGlobal('fetch', fetchSource);
    const { GET } = await import('./route');
    expect((await GET(request('schoolId=ncnu&q=' + encodeURIComponent('𠮷'.repeat(81))))).status).toBe(400);
    expect(fetchSource).not.toHaveBeenCalled();
    expect((await GET(request('schoolId=ncnu&q=' + encodeURIComponent('𠮷'.repeat(80))))).status).toBe(200);
    expect(fetchSource).toHaveBeenCalledTimes(1);
  });

  it('executes a discovered operation through its published endpoint and parameter mapping', async () => {
    const fetchSource = vi.fn().mockResolvedValue(csv());
    vi.stubGlobal('fetch', fetchSource);
    const { GET: discover } = await import('./operations/route');
    const { GET } = await import('./route');
    const directory = await (await discover()).json();
    expect(fetchSource).not.toHaveBeenCalled();
    const operation = directory.operations.find((item: { id: string }) => item.id === 'ncnu.courses.search');
    const url = new URL(operation.endpoint.path, 'https://example.test');
    for (const [key, value] of Object.entries(operation.endpoint.fixedQuery)) url.searchParams.set(key, String(value));
    url.searchParams.set(operation.endpoint.inputQuery.query, '005076');
    const result = await GET(new Request(url));
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.operation.id).toBe(operation.id);
    expect(body.operation.version).toBe(operation.version);
    expect(body.sourceUrl).toBe(operation.sourceUrl);
    expect(body.courses.map((course: { section: string }) => course.section)).toEqual(['a', 'b']);
    expect(fetchSource).toHaveBeenCalledTimes(1);
  });

  it('executes a v2 operation exactly through its discovered optional filter mapping', async () => {
    const fetchSource = vi.fn().mockResolvedValue(csv());
    vi.stubGlobal('fetch', fetchSource);
    const { GET: discover } = await import('./operations/route');
    const { GET } = await import('./route');
    const directory = await (await discover(new Request('https://example.test/api/public-course-catalog/operations?version=2'))).json();
    const operation = directory.operations.find((item: { id: string }) => item.id === 'ncnu.courses.search');
    expect(fetchSource).not.toHaveBeenCalled();
    expect(operation.inputSchema.anyOf).toEqual([{ required: ['weekday'] }, { required: ['credits'] }]);
    for (const filters of [{ weekday: 5 }, { credits: 3 }, { weekday: 5, credits: 3 }]) {
      const url = new URL(operation.endpoint.path, 'https://example.test');
      for (const [key, value] of Object.entries(operation.endpoint.fixedQuery)) url.searchParams.set(key, String(value));
      url.searchParams.set(operation.endpoint.inputQuery.query, '005076');
      for (const [key, value] of Object.entries(filters)) url.searchParams.set(operation.endpoint.inputQuery[key], String(value));
      const response = await GET(new Request(url));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.operation).toEqual({ id: operation.id, version: operation.version, responseSchemaVersion: operation.responseSchemaVersion, access: operation.access });
      expect(body.filters).toEqual(filters);
      expect(body.unresolvedCount).toBe(0);
      expect(body.courses.map((course: { section: string }) => course.section)).toEqual(['a', 'b']);
    }
    expect(fetchSource).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['login HTML', () => new Response('<form>login</form>', { headers: { 'Content-Type': 'text/html' } })],
    ['missing columns', () => csv('學期,課號\n1151,000001')],
    ['broken row', () => csv(header + '\n"1151","unclosed')],
    ['oversized declared length', () => csv(header, { 'Content-Length': '9900000' })],
    ['oversized streamed body', () => csv('a'.repeat(2 * 1024 * 1024))],
    ['failed upstream', () => new Response('down', { status: 503 })],
  ])('reports %s as unavailable without issuing a false result or hammering the source', async (_, source) => {
    const fetchSource = vi.fn().mockImplementation(source);
    vi.stubGlobal('fetch', fetchSource);
    const { GET } = await import('./route');
    for (let i = 0; i < 2; i++) {
      const response = await GET(request('schoolId=ncnu'));
      expect(response.status).toBe(502);
      expect(await response.json()).not.toHaveProperty('courses');
    }
    expect(fetchSource).toHaveBeenCalledTimes(1);
  });
});

describe('school-scoped public course catalog dispatch', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('keeps NCNU and NTHU results and caches separate, with no caller credentials in upstream requests', async () => {
    const nthu = [{
      科號: '11510AES 520300', 課程中文名稱: '環境化學', 課程英文名稱: 'Environment Chemistry', 學分數: '3',
      授課教師: '董瑞安\tDOONG, RUEY-AN\n', 教室與上課時間: 'BMES醫環618\tM3M4\nBMES醫環501\tF3F4\n', 停開註記: '',
    }];
    const fetchSource = vi.fn().mockImplementation((url: string) => url.endsWith('.json')
      ? new Response(JSON.stringify(nthu), { headers: { 'Content-Type': 'text/plain' } }) : csv());
    vi.stubGlobal('fetch', fetchSource);
    const { GET } = await import('./route');
    for (const schoolId of ['nthu', 'ncnu', 'nthu']) {
      const result = await GET(request('schoolId=' + schoolId));
      expect(result.status).toBe(200);
      expect(result.headers.get('Cache-Control')).toBe('no-store');
      const body = await result.json();
      expect(body.schoolId).toBe(schoolId);
      expect(body.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(body.operation).toEqual({ id: schoolId + '.courses.search', version: 1, responseSchemaVersion: 1, access: 'anonymous-public' });
      expect(body.courses[0].title).toBe(schoolId === 'nthu' ? '環境化學' : '普通心理學');
    }
    expect(fetchSource).toHaveBeenCalledTimes(2);
    for (const [, options] of fetchSource.mock.calls) {
      expect(options).toMatchObject({ credentials: 'omit', redirect: 'error' });
      expect(Object.keys(options.headers)).toEqual(['Accept']);
    }
  });

  it('reports the correct school when one source fails while the other remains available', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('.json')) throw new Error('offline');
      return csv();
    }));
    const { GET } = await import('./route');
    const nthu = await GET(request('schoolId=nthu&q=資料庫'));
    expect(nthu.status).toBe(502);
    expect(nthu.headers.get('Cache-Control')).toBe('no-store');
    expect(await nthu.json()).toEqual({ error: '暫時無法讀取清華大學課程資料，請稍後再試。' });
    const ncnu = await GET(request('schoolId=ncnu&q=000001'));
    expect(ncnu.status).toBe(200);
    expect((await ncnu.json()).schoolId).toBe('ncnu');
  });
});
