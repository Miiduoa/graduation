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
  vi.useRealTimers();
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
  expect(state.getSettings).toHaveBeenCalledTimes(1);
  const feeds = await Promise.all(responses.map((r) => r.json()));
  expect(feeds[0]).toEqual(feeds[1]);
  expect(responses[0].headers.get('Access-Control-Allow-Origin')).toBe('*');
  expect(responses[0].headers.get('Cache-Control')).toBe('public, max-age=30, s-maxage=30');
  await GET(new Request('https://nuni.tw/career/data?school=tw-pu'));
  expect(state.getSettings).toHaveBeenCalledTimes(1);
  const unknown = await GET(new Request('https://nuni.tw/career/data?school=other'));
  expect((await unknown.json()).supported).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it('applies saved school choices after settings expiry and keeps aliases consistent', async () => {
  vi.useFakeTimers();
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
  vi.advanceTimersByTime(30000);
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
  vi.advanceTimersByTime(30000);
  const disabled = await (await request()).json();
  expect(disabled.announcements).toEqual([]);
  expect(disabled.timeline).toEqual([]);
  expect(disabled.announcementsUnavailable).toBe(false);
  state.getSettings.mockResolvedValue({ data: () => undefined });
  vi.advanceTimersByTime(30000);
  expect((await (await request()).json()).announcements).toHaveLength(2);
  expect(fetcher).toHaveBeenCalledTimes(12);
});

it('does not silently enable sources when settings cannot be read or admin is unavailable', async () => {
  vi.useFakeTimers();
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
  expect((await GET(new Request('https://nuni.tw/career/data?school=pu'))).status).toBe(503);
  expect(state.admin).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(30000);
  state.admin.mockResolvedValueOnce(null);
  expect((await GET(new Request('https://nuni.tw/career/data?school=pu'))).status).toBe(503);
  expect(state.getSettings).toHaveBeenCalledTimes(1);
  expect(state.admin).toHaveBeenCalledTimes(2);
  state.doc.mockClear();
  const unknown = await GET(new Request('https://nuni.tw/career/data?school=../other'));
  expect((await unknown.json()).supported).toBe(false);
  expect(state.doc).not.toHaveBeenCalled();
});

it('uses last known choices during an outage, bounds stale use, and coalesces retries and recovery', async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          '<div class="d-txt"><a href="/p/406-1102-1.php">實習申請2099/12/8截止</a></div>',
        ),
    ),
  );
  state.getSettings.mockResolvedValue({
    data: () => ({ office: false, departments: true, taiwanjobs: false }),
  });
  const { GET } = await import('./route');
  const request = (school = 'pu') =>
    GET(new Request(`https://nuni.tw/career/data?school=${school}`));
  await request();
  vi.advanceTimersByTime(30000);
  state.getSettings.mockRejectedValue(new Error('database down'));
  const responses = await Promise.all([request(), request('tw-pu'), request()]);
  for (const response of responses) {
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const feed = await response.json();
    expect(feed.sourceSettingsStale).toBe(true);
    expect(feed.announcements.map((a: { source: string }) => a.source)).toEqual(['資管系']);
    expect(feed.jobs).toEqual([]);
  }
  await request();
  expect(state.getSettings).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(270000);
  expect((await request()).status).toBe(503);
  await request();
  expect(state.getSettings).toHaveBeenCalledTimes(3);
  vi.advanceTimersByTime(30000);
  state.getSettings.mockResolvedValue({
    data: () => ({ office: false, departments: false, taiwanjobs: false }),
  });
  const recovered = await (await request()).json();
  expect(recovered.sourceSettingsStale).toBe(false);
  expect(recovered.announcements).toEqual([]);
});

it.each(['cold', 'expiring'])(
  'returns 503 after a hung settings read with %s cache',
  async (cache) => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => new Response('<div class="d-txt"></div>'));
    vi.stubGlobal('fetch', fetcher);
    const { GET } = await import('./route');
    const request = () => GET(new Request('https://nuni.tw/career/data?school=pu'));
    if (cache === 'expiring') {
      expect((await request()).status).toBe(200);
      vi.advanceTimersByTime(297000);
    }
    fetcher.mockClear();
    state.getSettings.mockClear().mockReturnValue(new Promise(() => {}));
    const response = request();
    await vi.advanceTimersByTimeAsync(5000);
    const failed = await response;
    expect(failed.status).toBe(503);
    expect(failed.headers.get('Cache-Control')).toBe('no-store');
    expect(await failed.json()).toEqual({ error: '暫時無法讀取職涯資料來源設定，請稍後再試。' });
    expect((await request()).status).toBe(503);
    expect(state.getSettings).toHaveBeenCalledTimes(1);
    expect(fetcher).not.toHaveBeenCalled();
  },
);

it('times out coalesced reads, preserves recent choices, and ignores late results after recovery', async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('<div class="d-txt"></div>')),
  );
  state.getSettings.mockResolvedValue({
    data: () => ({ office: false, departments: false, taiwanjobs: false }),
  });
  const { GET } = await import('./route');
  const request = (school = 'pu') =>
    GET(new Request(`https://nuni.tw/career/data?school=${school}`));
  await request();
  vi.advanceTimersByTime(30000);
  let resolveLate!: (value: { data: () => undefined }) => void;
  state.getSettings.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveLate = resolve;
    }),
  );
  const responses = Promise.all([request(), request('tw-pu'), request()]);
  await vi.advanceTimersByTimeAsync(5000);
  for (const response of await responses) {
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({
      sourceSettingsStale: true,
      announcements: [],
      jobs: [],
      announcementsUnavailable: false,
      jobsUnavailable: false,
    });
  }
  await request();
  expect(state.getSettings).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(30000);
  const recovered = await request();
  expect(recovered.status).toBe(200);
  expect((await recovered.json()).sourceSettingsStale).toBe(false);
  expect(state.getSettings).toHaveBeenCalledTimes(3);
  // The timed-out read would enable all sources if its late result were cached.
  resolveLate({ data: () => undefined });
  await vi.advanceTimersByTimeAsync(0);
  const afterLateRead = await (await request()).json();
  expect(afterLateRead.announcementsUnavailable).toBe(false);
  expect(afterLateRead.jobsUnavailable).toBe(false);
  expect(state.getSettings).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
});
