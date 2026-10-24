import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { EventDetail } from './EventDetail';
import type { CampusEvent } from '@/lib/campusEvents';

const loadCampusEvent = vi.hoisted(() => vi.fn());

vi.mock('@/lib/campusEvents', async () => {
  const actual = await vi.importActual<typeof import('@/lib/campusEvents')>('@/lib/campusEvents');
  return {
    ...actual,
    loadCampusEvent,
  };
});

vi.mock('./EventRegistrationPanel', () => ({
  EventRegistrationPanel: ({ event }: { event: CampusEvent }) => (
    <div data-testid="registration-panel">{event.source}:{event.id}</div>
  ),
}));

function event(partial: Partial<CampusEvent> & Pick<CampusEvent, 'id' | 'title' | 'source'>): CampusEvent {
  return {
    schoolId: 'nthu',
    description: '說明',
    startsAt: '2026-05-01T02:00:00.000Z',
    appRegistrationConfigured: partial.source === 'school-club-events',
    ...partial,
  };
}

beforeEach(() => {
  loadCampusEvent.mockReset();
});

it('rejects invalid source without probing collections by id alone', async () => {
  render(
    <EventDetail
      schoolId="nthu"
      schoolSearch="?schoolId=nthu&campus=nthu"
      eventId="same"
      sourceParam="made-up"
    />,
  );
  expect(await screen.findByRole('heading', { name: '無法開啟此活動' })).toBeTruthy();
  expect(loadCampusEvent).not.toHaveBeenCalled();
  expect(screen.getByRole('link', { name: '回到活動列表' }).getAttribute('href')).toBe(
    '/events?schoolId=nthu&campus=nthu',
  );
});

it('loads the exact source and never pairs noncanonical content to canonical registration by id', async () => {
  loadCampusEvent.mockResolvedValue(
    event({ id: 'same', title: '校園資料版', source: 'school-events' }),
  );
  render(
    <EventDetail
      schoolId="nthu"
      schoolSearch="?schoolId=nthu&campus=nthu"
      eventId="same"
      sourceParam="school-events"
    />,
  );
  expect(await screen.findByRole('heading', { name: '校園資料版' })).toBeTruthy();
  expect(loadCampusEvent).toHaveBeenCalledWith('nthu', 'same', 'school-events');
  expect(screen.getByTestId('registration-panel').textContent).toBe('school-events:same');
  expect(screen.getByText('校園活動資料')).toBeTruthy();
});

it('clears previous event immediately when identity changes', async () => {
  loadCampusEvent.mockImplementation(async (_schoolId: string, id: string, source: string) => {
    if (id === 'old' && source === 'school-club-events') {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return event({ id: 'old', title: '舊活動', source: 'school-club-events' });
    }
    return event({ id: 'new', title: '新活動', source: 'legacy-events' });
  });
  const view = render(
    <EventDetail
      schoolId="nthu"
      schoolSearch="?schoolId=nthu"
      eventId="old"
      sourceParam="school-club-events"
    />,
  );
  expect(screen.getByRole('status').textContent).toContain('正在讀取');
  view.rerender(
    <EventDetail
      schoolId="nthu"
      schoolSearch="?schoolId=nthu"
      eventId="new"
      sourceParam="legacy-events"
    />,
  );
  expect(screen.queryByText('舊活動')).toBeNull();
  expect(await screen.findByRole('heading', { name: '新活動' })).toBeTruthy();
  expect(screen.getByTestId('registration-panel').textContent).toBe('legacy-events:new');
});

it('keeps read failure distinct from missing event and preserves school on back link', async () => {
  loadCampusEvent.mockRejectedValueOnce(new Error('unavailable'));
  const view = render(
    <EventDetail
      schoolId="nthu"
      schoolSearch="?schoolId=nthu&campus=nthu"
      eventId="missing"
      sourceParam="school-club-events"
    />,
  );
  expect(await screen.findByRole('heading', { name: '無法讀取這場活動' })).toBeTruthy();
  loadCampusEvent.mockResolvedValueOnce(null);
  fireEvent.click(screen.getByRole('button', { name: '重新讀取' }));
  expect(await screen.findByRole('heading', { name: '找不到這場活動' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '回到活動列表' }).getAttribute('href')).toBe(
    '/events?schoolId=nthu&campus=nthu',
  );
  view.unmount();
});

it('copies a share URL that keeps school and source', async () => {
  loadCampusEvent.mockResolvedValue(
    event({ id: 'talk', title: '分享場', source: 'school-club-events' }),
  );
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  render(
    <EventDetail
      schoolId="nthu"
      schoolSearch="?schoolId=nthu&campus=nthu"
      eventId="talk"
      sourceParam="school-club-events"
    />,
  );
  await screen.findByRole('heading', { name: '分享場' });
  fireEvent.click(screen.getByRole('button', { name: '複製連結' }));
  await waitFor(() => expect(writeText).toHaveBeenCalled());
  expect(String(writeText.mock.calls[0]?.[0])).toContain(
    '/events/talk?schoolId=nthu&campus=nthu&source=school-club-events',
  );
});
