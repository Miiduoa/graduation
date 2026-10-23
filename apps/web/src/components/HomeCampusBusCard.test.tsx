import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { HomeCampusBusCard } from './HomeCampusBusCard';
import { queryTransit } from '@/lib/transit';

vi.mock('@/lib/transit', async (original) => {
  const actual = await original<typeof import('@/lib/transit')>();
  return {
    ...actual,
    queryTransit: vi.fn(),
  };
});

beforeEach(() => {
  vi.mocked(queryTransit).mockReset();
});

it('hides the home bus row when there is no next arrival to show', async () => {
  vi.mocked(queryTransit).mockResolvedValue({
    status: 'unavailable',
    reason: 'not-configured',
  });
  const { container } = render(<HomeCampusBusCard schoolId="pu" />);
  await waitFor(() => expect(queryTransit).toHaveBeenCalled());
  expect(container.textContent).toBe('');
  expect(screen.queryByText('看全部')).toBeNull();
  expect(screen.queryByText('正在查看…')).toBeNull();
});

it('shows the real next campus-gate bus and does not invent a destination', async () => {
  const now = new Date().toISOString();
  vi.mocked(queryTransit).mockResolvedValue({
    status: 'ready',
    kind: 'arrivals',
    fetchedAt: now,
    arrivals: [
      {
        id: '162',
        route: '162',
        direction: 1,
        destination: '沙鹿火車站',
        status: 0,
        seconds: 180,
        updatedAt: now,
        stopName: '靜宜大學(英才路)',
      },
    ],
  });
  render(<HomeCampusBusCard schoolId="pu" />);
  const link = await screen.findByRole('link', { name: /下一班公車/ });
  expect(link.getAttribute('href')).toBe('/bus');
  expect(screen.getByText(/162 往沙鹿 3 分/)).toBeTruthy();
});
