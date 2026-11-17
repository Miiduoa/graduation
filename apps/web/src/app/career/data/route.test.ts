// @vitest-environment node
import { afterEach, beforeEach, it, expect, vi } from 'vitest';
const state = vi.hoisted(() => ({
  getSettings: vi.fn(),
  doc: vi.fn(),
  admin: vi.fn(),
}));
vi.mock('@/lib/server/firebaseAdmin', () => ({ getFirebaseAdmin: state.admin }));
beforeEach(() => {
  state.getSettings.mockReset().mockResolvedValue({ data: () => undefined });
  state.doc.mockReset().mockReturnValue({ get: state.getSettings });
  state.admin.mockReset().mockResolvedValue({ db: { doc: state.doc } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
it('caches and coalesces actual public route responses by canonical school without changing visitor access', async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(
        '<div class="d-txt"><a href="/p/406-1102-1.php">實習申請2026/12/8截止</a></div>',
      ),
  );
  vi.stubGlobal('fetch', fetcher);
  const { GET } = await import('./route');
  const responses = await Promise.all(
    ['pu', 'tw-pu', 'pu'].map((s) => GET(new Request(`https://nuni.tw/career/data?school=${s}`))),
  );
  expect(fetcher).toHaveBeenCalledTimes(3);
  const feeds = await Promise.all(responses.map((r) => r.json()));
  expect(feeds[0]).toEqual(feeds[1]);
  expect(responses[0].headers.get('Access-Control-Allow-Origin')).toBe('*');
  expect(responses[0].headers.get('Cache-Control')).toBe('public, max-age=30, s-maxage=30');
  const unknown = await GET(new Request('https://nuni.tw/career/data?school=other'));
  expect((await unknown.json()).supported).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it('applies saved school choices to cached upstream data and keeps aliases consistent', async () => {
  const fetcher = vi.fn(
    async (url: string) =>
      new Response(
        url.includes('taiwanjobs')
          ? '<DataList><Data><OCCU_DESC>測試職缺</OCCU_DESC><COMPNAME>測試公司</COMPNAME><URL_QUERY>https://job.taiwanjobs.gov.tw/job/1</URL_QUERY></Data></DataList>'
          : '<div class="d-txt"><a href="/p/406-1102-1.php">實習申請2099/12/8截止</a></div>',
      ),
  );
  vi.stubGlobal('fetch', fetcher);
  const { GET } = await import('./route');
  const request = (school = 'pu') =>
    GET(new Request(`https://nuni.tw/career/data?school=${school}`));
  const initial = await (await request()).json();
  expect(initial.announcements).toHaveLength(2);
  expect(initial.jobs).toHaveLength(1);
  state.getSettings.mockResolvedValue({
    data: () => ({ office: false, departments: true, taiwanjobs: false }),
  });
  const filtered = await (await request('tw-pu')).json();
  expect(filtered.announcements.map((a: { source: string }) => a.source)).toEqual(['資管系']);
  expect(filtered.timeline.map((a: { source: string }) => a.source)).toEqual(['資管系']);
  expect(filtered.jobs).toEqual([]);
  expect(filtered.jobsUnavailable).toBe(false);
  expect(filtered.supported).toBe(true);
  expect(state.doc).toHaveBeenLastCalledWith('schools/pu/settings/careerSources');
  state.getSettings.mockResolvedValue({
    data: () => ({ office: false, departments: false, taiwanjobs: false }),
  });
  const disabled = await (await request()).json();
  expect(disabled.announcements).toEqual([]);
  expect(disabled.timeline).toEqual([]);
  expect(disabled.announcementsUnavailable).toBe(false);
  state.getSettings.mockResolvedValue({ data: () => undefined });
  expect((await (await request()).json()).announcements).toHaveLength(2);
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it('does not silently enable sources when settings cannot be read or admin is unavailable', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('<div class="d-txt"></div>')),
  );
  const { GET } = await import('./route');
  state.getSettings.mockRejectedValueOnce(new Error('private database error'));
  const failed = await GET(new Request('https://nuni.tw/career/data?school=pu'));
  expect(failed.status).toBe(503);
  expect(failed.headers.get('Cache-Control')).toBe('no-store');
  expect(await failed.text()).not.toContain('private database error');
  state.admin.mockResolvedValueOnce(null);
  expect((await GET(new Request('https://nuni.tw/career/data?school=pu'))).status).toBe(503);
  state.doc.mockClear();
  const unknown = await GET(new Request('https://nuni.tw/career/data?school=../other'));
  expect((await unknown.json()).supported).toBe(false);
  expect(state.doc).not.toHaveBeenCalled();
});
