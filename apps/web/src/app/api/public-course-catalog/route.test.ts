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

  it('rejects ambiguous campuses and oversized searches before accessing the source', async () => {
    const fetchSource = vi.fn();
    vi.stubGlobal('fetch', fetchSource);
    const { GET } = await import('./route');
    for (const params of ['q=x', 'schoolId=pu', 'schoolId=all', 'schoolId=ncnu&schoolId=pu', 'schoolId=ncnu&q=x&q=y', 'schoolId=ncnu&q=' + 'a'.repeat(81)]) {
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
