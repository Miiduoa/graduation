import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { TodaySensePanel } from './TodaySensePanel';
import {
  AGENT_DECLINE_ACTION,
  AGENT_DOWNLOAD_ACTION,
  AGENT_DOWNLOAD_NOTE,
  AGENT_PLAN_TITLE,
} from '@campus/shared/src/todaySenseAgent';
import { type SenseInputItem } from '@campus/shared/src/todaySense';

const now = new Date('2026-10-19T05:00:00.000Z');

const items: SenseInputItem[] = [
  {
    id: 'live-1',
    kind: 'live',
    courseId: 'calc-a',
    courseName: '微積分甲',
    title: '課堂點名',
    href: '/course/calc-a#live-live-1',
  },
  {
    id: 'quiz-1',
    kind: 'quiz',
    courseId: 'phys-lab',
    courseName: '普通物理實驗',
    title: '第一次小考',
    dueAt: '2026-10-19T07:00:00.000Z',
    href: '/course/phys-lab#quiz-quiz-1',
  },
  {
    id: 'poem',
    kind: 'assignment',
    courseId: 'zh-tw',
    courseName: '國文（臺灣文學）',
    title: '繳交「臺灣」現代詩習作',
    dueAt: '2026-10-18T16:00:00.000Z',
    href: '/course/zh-tw#assignment-poem',
  },
];

it('does not show download when the device cannot run the model', async () => {
  render(
    <TodaySensePanel
      ownerId="alice"
      items={items}
      now={now}
      phase="ready"
      gpu={null}
      inferAgent={vi.fn(async () => null)}
    />,
  );
  expect(await screen.findByText('課堂點名')).toBeTruthy();
  expect(screen.queryByText(AGENT_DOWNLOAD_NOTE)).toBeNull();
  expect(screen.getByText(/依據課程「微積分甲」進行中的點名時段/)).toBeTruthy();
});

it('only downloads after consent, and refuse keeps the rule cards', async () => {
  const inferAgent = vi.fn(async () => null);
  render(
    <TodaySensePanel
      ownerId="alice"
      items={items}
      now={now}
      phase="ready"
      gpu={{}}
      inferAgent={inferAgent}
    />,
  );
  expect(await screen.findByText(AGENT_DOWNLOAD_NOTE)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: AGENT_DECLINE_ACTION }));
  expect(screen.queryByText(AGENT_DOWNLOAD_NOTE)).toBeNull();
  expect(screen.getByText('課堂點名')).toBeTruthy();
  expect(screen.getByText(/依據課程「微積分甲」進行中的點名時段/)).toBeTruthy();
  expect(inferAgent).not.toHaveBeenCalled();
});

it('keeps rule cards when model output does not validate', async () => {
  const inferAgent = vi.fn(async () => null);
  render(
    <TodaySensePanel
      ownerId="alice"
      items={items}
      now={now}
      phase="ready"
      gpu={{}}
      inferAgent={inferAgent}
    />,
  );
  expect(await screen.findByText(AGENT_DOWNLOAD_NOTE)).toBeTruthy();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: AGENT_DOWNLOAD_ACTION }));
  });
  await waitFor(() => expect(inferAgent).toHaveBeenCalled());
  expect(screen.queryByText(AGENT_PLAN_TITLE)).toBeNull();
  expect(screen.getByText(/依據課程「微積分甲」進行中的點名時段/)).toBeTruthy();
});

it('shows locked course names when judgement validates', async () => {
  const inferAgent = vi.fn(async (cards: { id: string; kind: string }[]) => {
    const live = cards.find((card) => card.kind === 'live_now');
    const rest = cards.filter((card) => card.id !== live?.id).map((card) => card.id);
    return live ? { order: [live.id, ...rest], steps: [] } : null;
  });
  render(
    <TodaySensePanel
      ownerId="alice"
      items={items}
      now={now}
      phase="ready"
      gpu={{}}
      inferAgent={inferAgent}
    />,
  );
  expect(await screen.findByText(AGENT_DOWNLOAD_NOTE)).toBeTruthy();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: AGENT_DOWNLOAD_ACTION }));
  });
  expect(await screen.findByText(AGENT_PLAN_TITLE)).toBeTruthy();
  expect(screen.getByText('課堂點名 · 微積分甲')).toBeTruthy();
  expect(screen.getByText('第一次小考 · 普通物理實驗')).toBeTruthy();
  expect(screen.getByText(/依據課程「微積分甲」進行中的點名時段/)).toBeTruthy();
});
