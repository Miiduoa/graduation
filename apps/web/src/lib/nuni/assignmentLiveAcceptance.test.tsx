import { useEffect, useState } from 'react';
import { act, render, screen } from '@testing-library/react';
import { CourseAssignments } from '../../features/nuni/CourseAssignments';
import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createNuniClasses, type NuniAssignment } from '@campus/shared/src/nuni';
import { startAssignmentLive } from '@campus/shared/src/assignmentLive';
import { handleNuni } from './api';
import { SESSION_COOKIE, sealCookie, sessionContext } from './server';

vi.mock('../../features/nuni/Session', () => ({
  browserRequest: vi.fn(),
  useNuniSession: () => ({ session: { context: 'synthetic', platformAccountId: accountId }, refresh: vi.fn() }),
}));

const workspaceId = 'cw_11111111-1111-4111-8111-111111111111';
const accountId = 'pa_22222222-2222-4222-8222-222222222222';
const base = `class-workspaces/${workspaceId}`;
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('以完整授權路由驗收十個學生十分鐘合成負載與發布延遲', async () => {
  vi.useFakeTimers();
  vi.stubEnv('NUNI_CLASSROOM_ENABLED', 'true');
  vi.stubEnv('NUNI_API_BASE_URL', 'https://synthetic.invalid');
  vi.stubEnv('WEB_PUBLIC_ORIGIN', 'https://synthetic.invalid');
  vi.stubEnv('BFF_SESSION_SECRET', 'synthetic-session-secret-longer-than-32');
  vi.stubEnv('ASSIGNMENT_FILE_DATABASE_URL', '');
  vi.stubEnv('ASSIGNMENT_FILE_STORE_DIR', '');
  vi.stubEnv('SUPABASE_URL', '');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
  const assignments: NuniAssignment[] = Array.from({ length: 100 }, (_, index) => ({
    id: `cwa_33333333-3333-4333-8333-${String(index).padStart(12, '0')}`,
    workspaceId, title: `作業 ${index}`, instructions: '合成內容', state: 'open',
    createdAt: '2026-01-01T00:00:00.000Z', closedAt: null, dueAt: null,
    unitId: null, unitTitle: null, submissionCount: 100, mySubmission: null,
  }));
  const published = new Map<string, number>();
  const latencies: number[] = [];
  let upstreamReads = 0;
  let bytes = 0;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (!String(url).startsWith('https://synthetic.invalid/')) throw new Error('禁止外部連線');
    await wait(100);
    let value: unknown;
    if (url.endsWith('/sessions/current')) {
      value = { authenticated: true, platformAccountId: accountId, isPlatformOperator: false };
    } else if (url.endsWith(`/${base}`)) {
      value = { id: workspaceId, title: '合成課程', state: 'active', memberRole: 'owner-teacher' };
    } else if (url.endsWith('/assignments')) {
      if (init?.method === 'POST') {
        assignments[0] = { ...assignments[0]!, ...JSON.parse(String(init.body)) };
        value = assignments[0];
      } else value = { assignments };
    } else throw new Error(`未定義的合成路徑 ${url}`);
    if (init?.method === 'GET') upstreamReads += 1;
    return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetcher);
  const session = { sessionHandle: `ps_${'s'.repeat(43)}`, expiresAt: Date.now() + 3600000 };
  const transport = async (path: string, input?: Record<string, unknown>) => {
    const response = await handleNuni(new NextRequest(`https://synthetic.invalid/api/nuni/${path}`, {
      method: input ? 'POST' : 'GET',
      headers: { Cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, session)}`,
        'X-Campus-Session': sessionContext(session), Origin: 'https://synthetic.invalid',
        ...(input ? { 'Content-Type': 'application/json' } : {}) },
      ...(input ? { body: JSON.stringify(input) } : {}),
    }), path.split('/'));
    expect(response.status).toBe(input ? 201 : 200);
    const text = await response.text();
    if (!input) bytes += Buffer.byteLength(text);
    return JSON.parse(text);
  };
  const classes = createNuniClasses(transport, accountId);
  const counts = Array<number>(10).fill(0);
  const stops = counts.map((_, client) => {
    const seen = new Set<string>();
    return startAssignmentLive({
      read: () => { counts[client] += 1; return classes.assignments(workspaceId); },
      receive: (items) => {
        const title = items[0]!.title;
        const started = published.get(title);
        if (started !== undefined && !seen.has(title)) {
          seen.add(title);
          latencies.push(Date.now() - started);
        }
      }, clear: () => {}, status: () => {}, active: () => true, online: () => true,
      subscribe: () => () => {},
    });
  });
  try {
    for (let index = 0; index < 40; index += 1) {
      await vi.advanceTimersByTimeAsync(index === 0 ? 1000 : 14000);
      const title = `發布 ${index}`;
      published.set(title, Date.now());
      const writing = classes.createAssignment(workspaceId, {
        title, instructions: '合成發布', dueAt: null, idempotencyKey: `synthetic-${index}`,
      });
      await vi.advanceTimersByTimeAsync(1000);
      await writing;
    }
    await vi.advanceTimersByTimeAsync(13000);
    stops.forEach((stop) => stop());
    latencies.sort((a, b) => a - b);
    const p95 = latencies[Math.ceil(latencies.length * 0.95) - 1]!;
    expect(latencies).toHaveLength(400);
    expect(p95).toBeLessThanOrEqual(5000);
    expect(counts.every((count) => count === counts[0])).toBe(true);
    expect(counts.every((count) => count <= 241)).toBe(true);
    expect(upstreamReads).toBeLessThanOrEqual(7230);
    process.stdout.write(JSON.stringify({ clients: 10, durationMs: 600000, counts, upstreamReads,
      bytes, samples: latencies.length, p95, max: latencies.at(-1) }) + '\n');
  } finally { stops.forEach((stop) => stop()); }
}, 60000);

it('發布請求、合成儲存、授權路由、排程與真實學生元件的全鏈路不超過五秒', async () => {
  vi.useFakeTimers();
  vi.stubEnv('NUNI_CLASSROOM_ENABLED', 'true');
  vi.stubEnv('NUNI_API_BASE_URL', 'https://synthetic.invalid');
  vi.stubEnv('WEB_PUBLIC_ORIGIN', 'https://synthetic.invalid');
  vi.stubEnv('BFF_SESSION_SECRET', 'synthetic-session-secret-longer-than-32');
  vi.stubEnv('ASSIGNMENT_FILE_DATABASE_URL', '');
  vi.stubEnv('ASSIGNMENT_FILE_STORE_DIR', '');
  vi.stubEnv('SUPABASE_URL', '');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
  const workspace = { id: workspaceId, title: '合成課程', state: 'active' as const, memberRole: 'student' as const };
  let stored: NuniAssignment[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (!String(url).startsWith('https://synthetic.invalid/')) throw new Error('禁止外部連線');
    await wait(100);
    let value: unknown;
    if (url.endsWith('/sessions/current'))
      value = { authenticated: true, platformAccountId: accountId, isPlatformOperator: false };
    else if (url.endsWith(`/${base}`)) value = workspace;
    else if (url.endsWith('/assignments')) {
      if (init?.method === 'POST') {
        stored = [{ ...JSON.parse(String(init.body)),
          id: 'cwa_33333333-3333-4333-8333-333333333333', workspaceId,
          state: 'open', createdAt: '2026-01-01T00:00:00.000Z', closedAt: null,
          unitId: null, unitTitle: null, submissionCount: 0, mySubmission: null }];
        value = stored[0];
      } else value = { assignments: stored };
    } else throw new Error(`未定義的合成路徑 ${url}`);
    return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
  }));
  const session = { sessionHandle: `ps_${'s'.repeat(43)}`, expiresAt: Date.now() + 3600000 };
  const classes = createNuniClasses(async (path, input) => {
    const response = await handleNuni(new NextRequest(`https://synthetic.invalid/api/nuni/${path}`, {
      method: input ? 'POST' : 'GET',
      headers: { Cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, session)}`,
        'X-Campus-Session': sessionContext(session), Origin: 'https://synthetic.invalid',
        ...(input ? { 'Content-Type': 'application/json' } : {}) },
      ...(input ? { body: JSON.stringify(input) } : {}),
    }), path.split('/'));
    expect(response.status).toBe(input ? 201 : 200);
    return response.json();
  }, accountId);
  function Student() {
    const [items, receive] = useState<NuniAssignment[]>([]);
    useEffect(() => startAssignmentLive({ read: () => classes.assignments(workspaceId), receive,
      clear: () => receive([]), status: () => {}, active: () => true, online: () => true,
      subscribe: () => () => {} }), []);
    return <CourseAssignments assignments={items} workspace={workspace} reload={() => {}} onConfirmed={() => {}} />;
  }
  const view = render(<Student />);
  try {
    await act(async () => { await vi.advanceTimersByTimeAsync(301); });
    const visibleLatencies: number[] = [];
    for (let index = 0; index < 40; index += 1) {
      const title = `全鏈路合成發布 ${index}`;
      const started = Date.now();
      const publishing = classes.createAssignment(workspaceId, { title, instructions: '合成內容',
        dueAt: null, idempotencyKey: `synthetic-full-publication-${index}` });
      for (let elapsed = 0; elapsed < 5000 && !screen.queryByRole('article', { name: title }); elapsed += 50)
        await act(async () => { await vi.advanceTimersByTimeAsync(50); });
      await publishing;
      expect(screen.getByRole('article', { name: title })).toBeTruthy();
      visibleLatencies.push(Date.now() - started);
    }
    visibleLatencies.sort((a, b) => a - b);
    expect(visibleLatencies).toHaveLength(40);
    expect(visibleLatencies[37]).toBeLessThanOrEqual(5000);
    process.stdout.write(JSON.stringify({ visibleSamples: visibleLatencies.length,
      visibleP95: visibleLatencies[37], visibleMax: visibleLatencies.at(-1) }) + '\n');
  } finally { view.unmount(); }
});
