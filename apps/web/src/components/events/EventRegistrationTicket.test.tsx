import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CampusEvent } from '@/lib/campusEvents';
import { EventRegistrationTicket } from './EventRegistrationTicket';

const event = (): CampusEvent => ({
  id: 'evt-1',
  schoolId: 'pu',
  title: '冬日校園音樂會',
  description: '',
  startsAt: '2026-12-18T10:30:00.000Z',
  endsAt: '2026-12-18T13:00:00.000Z',
  location: '靜宜大學任垣樓',
  organizer: '學生會',
  fee: 100,
  registeredCount: 38,
  appRegistrationConfigured: true,
  source: 'school-club-events',
});

describe('EventRegistrationTicket', () => {
  it('prints the event facts and registration status without inventing admission or payment data', () => {
    const activity = event();
    render(<EventRegistrationTicket event={activity} />);
    const ticket = screen.getByRole('region', { name: '報名票根' });
    expect(within(ticket).getByRole('heading', { name: activity.title })).toBeTruthy();
    expect(within(ticket).getByText('已報名')).toBeTruthy();
    expect(within(ticket).getByText('社團活動資料')).toBeTruthy();
    expect(within(ticket).getByText(activity.location!)).toBeTruthy();
    expect(within(ticket).getByText(activity.organizer!)).toBeTruthy();
    expect(ticket.querySelector('img, svg, canvas, button, a')).toBeNull();
    expect(ticket.textContent).not.toMatch(/票號|座位|QR|已付款|已報到|NT\$/);
    expect(ticket.textContent).not.toContain(activity.id);
  });

  it('uses Taipei time on both the ticket and date stub across the UTC year boundary', () => {
    const activity = {
      ...event(),
      startsAt: '2026-12-31T16:00:00.000Z',
      endsAt: '2026-12-31T18:00:00.000Z',
    };
    const view = render(<EventRegistrationTicket event={activity} />);
    const times = view.container.querySelectorAll('time');
    expect(times).toHaveLength(2);
    expect(times[0].dateTime).toBe(activity.startsAt);
    expect(times[0].textContent).toContain('2027/1/1');
    expect(times[1].dateTime).toBe(activity.endsAt);
    expect(times[1].textContent).toContain('2027/1/1');
    const stub = view.container.querySelector('[aria-hidden="true"]')!;
    expect(stub.textContent).toContain('2027 年 1 月');
    expect(stub.textContent).toContain('01');
    expect(stub.textContent).toContain('星期五');
    expect(screen.getByText('時間皆為臺灣時間（UTC+8）')).toBeTruthy();
  });

  it('keeps unavailable event details explicit and omits absent optional fields', () => {
    const view = render(
      <EventRegistrationTicket
        event={{ ...event(), startsAt: '', endsAt: undefined, location: ' ', organizer: undefined }}
      />,
    );
    expect(screen.getByText('時間待公告', { selector: 'dd' })).toBeTruthy();
    expect(screen.getByText('地點待公告')).toBeTruthy();
    expect(screen.queryByText('結束時間')).toBeNull();
    expect(screen.queryByText('主辦單位')).toBeNull();
    expect(view.container.querySelector('time')).toBeNull();
    expect(view.container.textContent).not.toContain('Invalid Date');
  });

  it('retains complete long Chinese and English event text', () => {
    const activity = {
      ...event(),
      title: '跨領域創作與校園生活音樂節'.repeat(12) + 'CampusArtsFestival'.repeat(10),
      location: '任垣樓多功能展演空間'.repeat(12),
      organizer: '學生會與校園藝術推廣團隊'.repeat(12),
    };
    render(<EventRegistrationTicket event={activity} />);
    expect(screen.getByRole('heading', { name: activity.title }).textContent).toBe(activity.title);
    expect(screen.getByText(activity.location).textContent).toBe(activity.location);
    expect(screen.getByText(activity.organizer).textContent).toBe(activity.organizer);
  });
});
