import { it, expect, vi } from 'vitest';
import { internshipRecord } from '@campus/shared/testFixtures/careerInternship';
import {
  internshipCalendarItem,
  internshipDeadlineState,
  internshipProgress,
  createInternshipCallableTransport,
} from '@campus/shared/src/careerInternship';
import { internshipPersonalEvent } from '@campus/shared/src/careerInternshipCalendar';
import { createCareerInternshipPorts } from './careerInternshipPorts';
import { readPersonalImports } from '@/lib/personalImports';
it('separates logged and verified hours, caps the progress bar and selects next document', () => {
  const r = internshipRecord();
  r.hours = [{ id: 'a', date: '2026-11-13', hours: 80, note: 'test', verified: false }];
  expect(internshipProgress(r)).toMatchObject({
    required: 60,
    logged: 80,
    verified: 0,
    percent: 100,
    next: 0,
  });
  r.documents.forEach((d) => {
    d.verified = true;
  });
  r.hours[0].verified = true;
  expect(internshipProgress(r).step).toBe(4);
  r.confirmed = true;
  expect(internshipProgress(r).step).toBe(5);
  expect(internshipDeadlineState('2026-12-01T09:00:00.000Z', Date.parse('2026-11-30'))).toBe(
    '七天內到期',
  );
  expect(internshipDeadlineState('2026-12-01T09:00:00.000Z', Date.parse('2026-12-02'))).toBe(
    '已逾期',
  );
});
it('writes a deduplicated Taiwan-time deadline into the real existing calendar ledger', async () => {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: async (_name: string, callback: () => unknown) => callback() },
  });
  localStorage.clear();
  const scope = { schoolId: 'pu', owner: 'internship-test' };
  const ports = createCareerInternshipPorts({
    schoolId: 'pu',
    scope,
    active: () => true,
    transport: async () => ({}),
  });
  const item = internshipCalendarItem(internshipRecord(), 0);
  await ports.onAddCalendar(item);
  await ports.onAddCalendar(item);
  const rows = readPersonalImports(scope);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    id: item.id,
    date: '2026-12-01',
    startTime: '17:00',
    endTime: '17:30',
    kind: 'events',
  });
  expect(rows[0].source.rawText).toContain('交給：系辦');
  await expect(
    createCareerInternshipPorts({
      schoolId: 'pu',
      scope,
      active: () => false,
      transport: async () => ({}),
    }).onAddCalendar(item),
  ).rejects.toThrow();
  expect(() =>
    createCareerInternshipPorts({
      schoolId: 'other',
      scope,
      active: () => true,
      transport: async () => ({}),
    }),
  ).toThrow();
  localStorage.clear();
});
it('keeps midnight deadlines on correct Taiwan date', () => {
  const item = internshipCalendarItem(internshipRecord(), 0);
  item.startsAt = '2026-11-30T15:50:00.000Z';
  item.endsAt = '2026-11-30T16:20:00.000Z';
  expect(internshipPersonalEvent(item, 'pu')).toMatchObject({
    date: '2026-11-30',
    startTime: '23:50',
    endDate: '2026-12-01',
    endTime: '00:20',
  });
});
it('uses the existing authenticated callable envelope and preserves errors', async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(input).toBe('/approved-only');
    expect(init?.method).toBe('POST');
    return Response.json({ result: { id: 'receipt' } });
  });
  const transport = createInternshipCallableTransport({
    endpoint: '/approved-only',
    authHeaders: async () => ({ 'X-Test': 'fixture' }),
    fetcher,
  });
  expect(await transport('pu', { action: 'list', audience: 'student' })).toEqual({ id: 'receipt' });
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
    data: { schoolId: 'pu', action: 'list', audience: 'student' },
  });
  const failed = createInternshipCallableTransport({
    endpoint: '/approved-only',
    authHeaders: async () => ({}),
    fetcher: async () => Response.json({ error: { message: '請重新整理' } }, { status: 409 }),
  });
  await expect(failed('pu', { action: 'list', audience: 'student' })).rejects.toThrow('請重新整理');
});
