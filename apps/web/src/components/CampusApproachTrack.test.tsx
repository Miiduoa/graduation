import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { campusApproachModel, type CampusNextRow, type RouteStopSequence, type TransitArrival } from '@/lib/transit';
import { CampusApproachTrack } from './CampusApproachTrack';
import css from './transit.module.css';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const now = Date.parse('2026-10-19T14:40:00.000Z');
const arrival = (overrides: Partial<TransitArrival> = {}): TransitArrival => ({
  id: 'a', route: '162', direction: 1, destination: '沙鹿火車站', status: 0, seconds: 180,
  updatedAt: new Date(now).toISOString(), stopName: '靜宜大學(英才路)', ...overrides,
});
const row = (next: Partial<TransitArrival> = {}): CampusNextRow => ({
  route: '162', heading: '沙鹿火車站', arrival: arrival(next),
});
const sequence: RouteStopSequence = {
  routeUid: 'TXG162', subRouteUid: 'TXG162', routeName: '162', direction: 1,
  stops: [
    { id: 'SHA', name: '沙鹿車站' },
    { id: 'YING', name: '靜宜大學(英才路)' },
    { id: 'GATE', name: '靜宜大學(校門)' },
  ],
};

afterEach(() => cleanup());

it('renders the live bus on the stop line and speaks remaining stops', () => {
  const model = campusApproachModel(row({ seconds: 180 }), now, [sequence]);
  render(<CampusApproachTrack model={model!} />);
  const track = screen.getByTestId('campus-approach');
  expect(track.getAttribute('data-status')).toBe('soon');
  expect(track.getAttribute('aria-label')).toBe('162 號公車，往 沙鹿火車站，還有 2 站，約 3 分，依到站預估示意');
  expect(screen.getByText('快到')).toBeTruthy();
  expect(screen.getByText('候車站')).toBeTruthy();
  expect(screen.getByText('英才路')).toBeTruthy();
  expect(screen.getByText('依到站預估示意')).toBeTruthy();
  expect(screen.getByTestId('campus-approach-bus')).toBeTruthy();
  expect(track.getAttribute('data-sticky-cover')).toBe('true');
});

it('calls arriving buses 進站中 and keeps the icon on the waiting stop', () => {
  const model = campusApproachModel(row({ seconds: 40 }), now, [sequence]);
  render(<CampusApproachTrack model={model!} />);
  expect(screen.getByTestId('campus-approach').getAttribute('data-status')).toBe('arriving');
  expect(screen.getByTestId('campus-approach').getAttribute('aria-label')).toContain('進站中');
  expect(screen.getByTestId('campus-approach').getAttribute('aria-label')).toContain('依到站預估示意');
  expect(screen.getByText('進站中')).toBeTruthy();
  expect(screen.getByTestId('campus-approach-bus')).toBeTruthy();
});

it('does not draw a live bus for timetable-only arrivals', () => {
  const model = campusApproachModel(row({
    seconds: null, scheduledAt: new Date(now + 12 * 60_000).toISOString(),
  }), now, [sequence]);
  render(<CampusApproachTrack model={model!} />);
  expect(screen.getByTestId('campus-approach').getAttribute('data-status')).toBe('scheduled');
  expect(screen.getByText('表定')).toBeTruthy();
  expect(screen.getByText('沒有即時位置')).toBeTruthy();
  expect(screen.queryByTestId('campus-approach-bus')).toBeNull();
  expect(screen.queryByText('依到站預估示意')).toBeNull();
  expect(screen.getByTestId('campus-approach').getAttribute('aria-label')).toMatch(/沒有即時位置/);
  expect(screen.getByTestId('campus-approach').getAttribute('aria-label')).toBe(model!.a11y);
});

it('keeps the bus still when source updates are unavailable', () => {
  const model = campusApproachModel(row({ seconds: 180 }), now, [sequence]);
  render(<CampusApproachTrack model={model!} animateUpdates={false} />);
  expect(screen.getByTestId('campus-approach-bus').classList.contains(css.approachBusReady)).toBe(false);
});

it('enables short motion only after both user and system preferences allow it', () => {
  const source = readFileSync(path.join(process.cwd(), 'src/components/transit.module.css'), 'utf8');
  expect(source).toMatch(/\.approachBusReady, \.boardListEnter, \.etaNumberChanged, \.physicalArrival \.rowPanel, \.destinationSign \{[^}]*animation: none;[^}]*transition: none;[^}]*animation-delay: 0s;[^}]*transition-delay: 0s;/);
  expect(source).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*:global\(:root\[data-reduced-motion='false'\]\) \.approachBusReady \{ transition: left/);
  for (const name of ['boardListEnter', 'etaNumberChanged', 'destinationSign']) {
    expect(source).toContain(`:global(:root[data-reduced-motion='false']) .${name} { animation:`);
  }
  expect(source).not.toContain('infinite');
  expect(source).toMatch(/@media \(min-width: 900px\) \{\n  \.approach /);
  expect(source).toMatch(/\.approachStops li strong \{[^}]*text-overflow: ellipsis;/);
});
