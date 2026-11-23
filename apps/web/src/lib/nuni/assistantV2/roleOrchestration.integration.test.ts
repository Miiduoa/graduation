// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseAssistantCalendarReceipt } from '@campus/shared/src/assistantExecution';
import { assistantServiceHref } from '@campus/shared/src/assistantServices';
import { parseAssistantTaskPlan } from '@campus/shared/src/assistantTaskPlan';
import { handleNuni } from '../api';
import { SESSION_COOKIE, sealCookie, sessionContext } from '../server';
import { issueRoute } from './actions';
import { createAdapter } from './adapter';
import { V2Error } from './contracts';
import { fixtureAdapter, FIXTURE_NOW as now, FIXTURE_SECRET as secret } from './fixtures';
import { readPublicSocial } from './publicSocialAdapter';

const model = vi.hoisted(() => vi.fn());
vi.mock('./adapter', async original => ({ ...(await original<typeof import('./adapter')>()), createAdapter: vi.fn() }));
vi.mock('./groq', async original => ({ ...(await original<typeof import('./groq')>()), createProviderModel: () => model }));

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(now);
  for (const [name, value] of Object.entries({ CAMPUS_BACKEND: 'nuni', CAMPUS_ASSISTANT_ENABLED: 'true',
    CAMPUS_ASSISTANT_V2_ENABLED: 'true', CAMPUS_ASSISTANT_V2_WRITES_ENABLED: 'true',
    BFF_SESSION_SECRET: secret, WEB_PUBLIC_ORIGIN: 'http://localhost:3000', FLY_MACHINE_ID: '' })) vi.stubEnv(name, value);
  vi.spyOn(console, 'info').mockImplementation(() => {});
  model.mockReset().mockRejectedValue(new Error('Explicit role workflows must not send data to a model'));
});
afterEach(() => {
  expect(model).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function setup(schoolId = 'fixture-school') {
  const fixture = fixtureAdapter();
  const session = { sessionHandle: 'ps_' + randomUUID().replaceAll('-', '').padEnd(43, 'x'), expiresAt: now + 3600000 };
  const binding = { account: 'pa_' + randomUUID(), session: sessionContext(session), conversationId: randomUUID(), schoolId };
  const { adapter } = fixture;
  adapter.publicCampus = vi.fn(async kind => ({ version: 1, kind, schoolId,
    source: kind === 'announcements' ? 'school-announcements' : 'school-events',
    sourcePath: `schools/${schoolId}/${kind}`, checkedAt: new Date(now).toISOString(),
    status: 'ready', items: [], partial: false, href: assistantServiceHref(kind, schoolId) }));
  adapter.publicSocial = vi.fn(args => readPublicSocial(schoolId, args,
    async () => ({ items: [], nextCursor: null }), now));
  const privateReads = [vi.spyOn(adapter, 'courses'), vi.spyOn(adapter, 'work'), vi.spyOn(adapter, 'orders'),
    vi.spyOn(adapter, 'order'), vi.spyOn(adapter, 'notifications')];
  const ledger = vi.spyOn(adapter, 'ledger');
  vi.mocked(createAdapter).mockReset().mockReturnValue({ adapter, apiCalls: () => 0,
    principal: async () => ({ platformAccountId: binding.account, isPlatformOperator: false }) });
  async function send(action: string, input: object, scope: Partial<typeof binding> = {}) {
    const effective = { ...binding, ...scope };
    const request = new NextRequest('http://localhost:3000/api/nuni/assistant/' + action, {
      method: 'POST', headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json',
        'X-Campus-Session': sessionContext(session), cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, session)}` },
      body: JSON.stringify({ schoolId: effective.schoolId, conversationId: effective.conversationId, ...input }),
    });
    return handleNuni(request, ['assistant', action]);
  }
  const ask = (taskProfile: string, question: string, consent = true) => send('ask', {
    taskProfile, question, history: [], consent, routeToken: issueRoute(binding, secret),
  });
  return { ...fixture, binding, privateReads, ledger, send, ask };
}

describe('role orchestration through the authenticated BFF', () => {
  it.each(['student', 'teacher', 'merchant', 'club', 'school', 'platform'] as const)(
    '%s can combine the actual common public readers without private sources', async profile => {
      const f = setup('pu');
      const response = await f.ask(profile, '查校園公告，查學校電話，查公開交流');
      expect(response.status).toBe(200);
      const reply = await response.json();
      expect(reply).not.toHaveProperty('roleGuide');
      const plan = parseAssistantTaskPlan(reply.taskPlan);
      expect(plan?.steps.map(step => [step.serviceId, step.status])).toEqual([
        ['announcements', 'completed'], ['school-info', 'completed'], ['public-social', 'completed'],
      ]);
      expect(f.adapter.publicCampus).toHaveBeenCalledOnce();
      expect(f.adapter.publicSocial).toHaveBeenCalledOnce();
      expect(f.ledger).not.toHaveBeenCalled();
      f.privateReads.forEach(read => expect(read).not.toHaveBeenCalled());
      expect(f.writes).toHaveLength(0);
      expect(reply.cards).toEqual([]);
    },
  );

  it.each([
    ['teacher', '備課'], ['merchant', '盤點'], ['club', '社團籌備'],
    ['school', '行政會議'], ['platform', '維護檢查'],
  ])('%s plans personal %s time, then confirms and reads back exactly once', async (profile, title) => {
    const f = setup();
    const response = await f.ask(profile, `幫我安排明天下午一小時${title}，查公車`);
    expect(response.status).toBe(200);
    const reply = await response.json();
    expect(reply).not.toHaveProperty('roleGuide');
    expect(reply).toMatchObject({ modelCalls: 0, dataRead: true });
    const plan = parseAssistantTaskPlan(reply.taskPlan);
    expect(plan).not.toBeNull();
    expect(plan!.steps.some(step => step.status === 'ready' && step.serviceId === 'calendar')).toBe(true);
    expect(plan!.steps.some(step => step.serviceId === 'bus' && step.status === 'completed')).toBe(true);
    expect(reply.cards).toHaveLength(1);
    const card = reply.cards[0];
    expect(card.args).toMatchObject({ title, date: '2026-11-05', startTime: '13:00', endTime: '14:00' });
    expect(f.writes).toHaveLength(0);
    f.privateReads.forEach(read => expect(read).not.toHaveBeenCalled());
    const first = await f.send('confirm', { token: card.token, args: card.args });
    expect(first.status).toBe(200);
    const receipt = await first.json();
    const expected = { schoolId: f.binding.schoolId, mutationId: card.mutationId, event: card.args, storage: 'synced' as const };
    expect(parseAssistantCalendarReceipt(receipt, expected)).toMatchObject({ status: 'verified', replay: false });
    const replay = await f.send('confirm', { token: card.token, args: card.args });
    expect(replay.status).toBe(200);
    expect(parseAssistantCalendarReceipt(await replay.json(), expected)).toMatchObject({ status: 'verified', replay: true });
    expect(f.writes).toHaveLength(1);
    expect(f.snapshot().records.filter(row => row.kind === 'events' && row.title === title)).toHaveLength(1);
    expect(f.orderCalls).toHaveLength(0);
  });

  it('keeps finding a work slot read-only', async () => {
    const f = setup();
    const response = await f.ask('teacher', '幫我找明天下午一小時空檔備課，查公車');
    expect(response.status).toBe(200);
    const reply = await response.json();
    expect(reply).not.toHaveProperty('roleGuide');
    expect(reply.cards).toEqual([]);
    expect(reply.taskPlan.steps.every((step: { status: string }) => step.status === 'completed')).toBe(true);
    expect(f.writes).toHaveLength(0);
  });

  it.each([
    ['teacher', '安排明天13:00到18:00半小時盤點'],
    ['merchant', '安排明天13:00到18:00一小時備課'],
    ['teacher', '查公車，找明天下午半小時空檔盤點'],
  ])('keeps %s work context distinct for %s', async (profile, question) => {
    const f = setup();
    const response = await f.ask(profile, question);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ roleGuide: profile, cards: [], modelCalls: 0 });
    expect(f.ledger).not.toHaveBeenCalled();
    f.privateReads.forEach(read => expect(read).not.toHaveBeenCalled());
    expect(f.writes).toHaveLength(0);
  });

  it('rechecks revoked write permission after preparing a work session', async () => {
    const f = setup();
    const response = await f.ask('merchant', '幫我安排明天下午半小時盤點');
    expect(response.status).toBe(200);
    const reply = await response.json();
    expect(reply.cards).toHaveLength(1);
    f.adapter.permissions = async () => ({ createPersonalEvent: false, prepareFoodOrder: true });
    const denied = await f.send('confirm', { token: reply.cards[0].token, args: reply.cards[0].args });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: 'ASSISTANT_PERMISSION_DENIED' });
    expect(f.writes).toHaveLength(0);
  });

  it('does not let selecting a professional context authorize a source or hide its failure', async () => {
    const f = setup();
    f.adapter.teachingOverview = vi.fn(async () => { throw new V2Error(403, 'COURSE_ACCESS_DENIED'); });
    const response = await f.ask('teacher', '查我的授課概況，幫我安排明天下午一小時備課，查公車');
    expect(response.status).toBe(200);
    const reply = await response.json();
    expect(reply.cards).toEqual([]);
    expect(reply.taskPlan.steps.some((step: { serviceId: string; status: string }) => step.serviceId === 'classroom' && step.status === 'blocked')).toBe(true);
    expect(reply.taskPlan.steps.some((step: { serviceId: string; status: string }) => step.serviceId === 'bus' && step.status === 'completed')).toBe(true);
    f.privateReads.forEach(read => expect(read).not.toHaveBeenCalled());
    expect(f.writes).toHaveLength(0);
  });

  it.each(['teacher', 'merchant', 'club', 'school', 'platform'])(
    '%s retains consent checks before entering the new public workflow', async profile => {
      const f = setup('pu');
      const response = await f.ask(profile, '查校園公告，查學校電話，查公開交流', false);
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ error: 'CONSENT_REQUIRED' });
      expect(f.adapter.publicCampus).not.toHaveBeenCalled();
      expect(f.adapter.publicSocial).not.toHaveBeenCalled();
      expect(f.ledger).not.toHaveBeenCalled();
      expect(f.writes).toHaveLength(0);
    },
  );
});
