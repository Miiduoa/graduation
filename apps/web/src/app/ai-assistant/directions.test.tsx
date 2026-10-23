import { createRequire } from 'node:module';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import AssistantPage from './page';
import { AgentCardList } from './AgentCards';
import { callCampusAssistant } from '@/lib/campusAssistantClient';
import { readOnlyAssistantCards } from '@/lib/assistantPresentation';

const { buildCardsFromToolTrace } = createRequire(import.meta.url)('../../../../../backend/functions/agent/cardBuilders.js');
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => ({ user: { uid: 'alice' }, loading: false, error: null }) }));
vi.mock('@/components/SiteShell', () => ({ SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('@/lib/campusAssistantClient', async original => ({ ...await original<typeof import('@/lib/campusAssistantClient')>(), callCampusAssistant: vi.fn() }));

const navigationUrl = 'https://www.google.com/maps/dir/?api=1&origin=24.1%2C120.1&destination=24.2%2C120.2&travelmode=walking';
const output = {
  success: true, schoolId: 'pu',
  from: { id: 'gate', name: '正式校門', schoolId: 'pu', lat: 24.1, lng: 120.1 },
  to: { id: 'library', name: '正式圖書館', schoolId: 'pu', lat: 24.2, lng: 120.2 },
  navigationUrl,
};
const card = (patch = {}) => buildCardsFromToolTrace([{ name: 'planCampusRoute', output: { ...output, ...patch } }]);
beforeEach(() => { vi.clearAllMocks(); });

it('renders the actual backend card through the conversation adapter as a clickable verified Google walking link', async () => {
  vi.mocked(callCampusAssistant).mockResolvedValue({ content: '請開啟地圖查看步行路線。', cards: card(), run: { status: 'completed' } });
  render(<AssistantPage />);
  fireEvent.change(screen.getByLabelText('你的問題'), { target: { value: '從校門走到圖書館' } });
  fireEvent.submit(screen.getByRole('form', { name: '傳送問題' }));
  const link = await screen.findByRole('link', { name: '開啟 Google 步行導航 ↗' });
  expect(link.getAttribute('href')).toBe(navigationUrl);
  expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  expect(screen.getByText('正式校門 → 正式圖書館')).toBeTruthy();
  expect(screen.getByLabelText('步行導航').textContent).not.toMatch(/undefined|NaN|\d+ 分鐘|\d+ m/);
});

it.each([
  'javascript:alert(1)',
  navigationUrl.replace('www.google.com', 'www.google.com.evil.example'),
  navigationUrl.replace('https:', 'http:'),
  navigationUrl.replace('www.google.com', 'user:password@www.google.com'),
  navigationUrl.replace('www.google.com', 'www.google.com:444'),
  navigationUrl.replace('/maps/dir/', '/url'),
  navigationUrl + '&redirect=https://evil.example',
  navigationUrl + '&api=1',
  navigationUrl + '#untrusted',
  navigationUrl.replace('walking', 'driving'),
  navigationUrl.replace('24.1%2C120.1', '0%2C0'),
])('rejects a supplied destination URL outside the exact walking contract: %s', url => {
  expect(readOnlyAssistantCards(card({ navigationUrl: url }), 'pu')).toEqual([]);
});

it('rejects another school, inconsistent point school and invalid coordinates', () => {
  expect(readOnlyAssistantCards(card(), 'nthu')).toEqual([]);
  expect(readOnlyAssistantCards(card({ from: { ...output.from, schoolId: 'nthu' } }), 'pu')).toEqual([]);
  expect(readOnlyAssistantCards(card({ from: { ...output.from, lat: NaN } }), 'pu')).toEqual([]);
  expect(readOnlyAssistantCards(card({ schoolId: undefined }), 'pu')).toEqual([]);
});

it('shows a source location without coordinates as information instead of a broken map link', () => {
  const cards = buildCardsFromToolTrace([{ name: 'findCampusPoi', output: {
    success: true, schoolId: 'pu', pois: [{ id: 'unlocated', schoolId: 'pu', name: '尚未定位的辦公室', lat: null, lng: null, openNow: null }],
  } }]);
  render(<AgentCardList cards={readOnlyAssistantCards(cards, 'pu')} schoolId="pu" />);
  expect(screen.getByText('尚未定位的辦公室')).toBeTruthy();
  expect(screen.getByText('尚未提供座標，暫時無法導航。')).toBeTruthy();
  expect(screen.queryByRole('link')).toBeNull();
  expect(readOnlyAssistantCards(cards, 'nthu')).toEqual([]);
});

it('renders scoped cafeteria source hours without an invented live status or seating count', () => {
  const cards = buildCardsFromToolTrace([{ name: 'listCafeterias', output: {
    success: true, schoolId: 'nthu', cafeterias: [{ id: 'jingyuan', schoolId: 'nthu', name: '正式餐廳', openingHours: '平日 11:00–14:00', openNow: null, seats: null }],
  } }]);
  render(<AgentCardList cards={readOnlyAssistantCards(cards, 'nthu')} schoolId="nthu" />);
  expect(screen.getByText('正式餐廳')).toBeTruthy();
  expect(screen.getByText('平日 11:00–14:00')).toBeTruthy();
  expect(screen.queryByText(/營業中|座位/)).toBeNull();
  expect(readOnlyAssistantCards(cards, 'pu')).toEqual([]);
});
