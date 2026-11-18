import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AssistantThread } from './AssistantThread';

type Props = ComponentProps<typeof AssistantThread>;
vi.mock('@/components/VoiceDictationButton', () => ({ VoiceDictationButton: () => null }));
vi.mock('@/components/SpokenReply', () => ({
  SpokenReply: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
const noop = () => {};
const first = { question: '先前問題', reply: { answer: '先前回答', steps: [], cards: [] } };
const next = { question: '新的問題', reply: { answer: '新的回答', steps: [], cards: [] } };
const base: Props = {
  inline: true, schoolId: 'pu', ready: true, fallback: false, consent: true,
  onConsent: noop, question: '', onQuestion: noop, turns: [first], states: {},
  pending: false, asking: false, onStopAsk: noop, error: '',
  recoverableQuestion: '', onRecoverQuestion: noop, onAsk: noop,
  onConfirm: noop, onCancel: noop,
};

beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { vi.restoreAllMocks(); });

function scrollArea() {
  const node = screen.getByRole('log', { name: '對話紀錄' });
  let total = 1400;
  let top = 0;
  Object.defineProperties(node, {
    clientHeight: { configurable: true, get: () => 300 },
    scrollHeight: { configurable: true, get: () => total },
    scrollTop: {
      configurable: true, get: () => top,
      set: (value: number) => { top = Math.max(0, Math.min(total - 300, value)); },
    },
  });
  return {
    node,
    move(value: number) { node.scrollTop = value; fireEvent.scroll(node); },
    grow() { total += 300; },
    bottom: () => total - 300,
  };
}

it('keeps inline reading position across pending, error and new reply updates', () => {
  const view = render(<AssistantThread {...base} />);
  const area = scrollArea();
  area.move(120);
  expect(screen.getByRole('button', { name: '回到最新回覆' })).toBeTruthy();
  view.rerender(<AssistantThread {...base} pending />);
  expect(area.node.scrollTop).toBe(120);
  view.rerender(<AssistantThread {...base} error="查詢未完成" />);
  expect(area.node.scrollTop).toBe(120);
  area.grow();
  view.rerender(<AssistantThread {...base} turns={[first, next]} />);
  expect(area.node.scrollTop).toBe(120);
  expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
});

it('jumps only within the inline thread and leaves keyboard focus on the persistent log', () => {
  render(<AssistantThread {...base} />);
  const area = scrollArea();
  area.move(120);
  const focus = vi.spyOn(area.node, 'focus');
  fireEvent.click(screen.getByRole('button', { name: '回到最新回覆' }));
  expect(area.node.scrollTop).toBe(area.bottom());
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  expect(document.activeElement).toBe(area.node);
  expect(area.node.tabIndex).toBe(0);
  expect(screen.queryByRole('button', { name: '回到最新回覆' })).toBeNull();
  expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
});

it('resumes following after the reader manually returns near the inline bottom', () => {
  const view = render(<AssistantThread {...base} />);
  const area = scrollArea();
  area.move(120);
  area.move(area.bottom() - 0.5);
  expect(screen.queryByRole('button', { name: '回到最新回覆' })).toBeNull();
  area.grow();
  view.rerender(<AssistantThread {...base} turns={[first, next]} />);
  expect(area.node.scrollTop).toBe(area.bottom());
});

it('ignores outer window scroll events when the inline thread is following its bottom', () => {
  const view = render(<AssistantThread {...base} />);
  const area = scrollArea();
  area.move(area.bottom());
  const end = view.container.querySelector('[class*="logEnd"]') as HTMLElement;
  vi.spyOn(end, 'getBoundingClientRect').mockReturnValue({ top: window.innerHeight + 1000 } as DOMRect);
  fireEvent.scroll(window);
  area.grow();
  view.rerender(<AssistantThread {...base} turns={[first, next]} />);
  expect(area.node.scrollTop).toBe(area.bottom());
  expect(screen.queryByRole('button', { name: '回到最新回覆' })).toBeNull();
});

it('accepted submission resumes following without scrolling the surrounding page', () => {
  const onAsk = vi.fn();
  const props = { ...base, question: '幫我排作業', onAsk };
  const view = render(<AssistantThread {...props} />);
  const area = scrollArea();
  area.move(120);
  fireEvent.keyDown(screen.getByLabelText('問題'), { key: 'Enter' });
  expect(onAsk).toHaveBeenCalledTimes(1);
  area.grow();
  view.rerender(<AssistantThread {...props} pending />);
  expect(area.node.scrollTop).toBe(area.bottom());
  expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
});

it.each([
  { pending: true }, { consent: false }, { ready: false }, { question: '  ' }, { onStop: noop },
])('rejected submission preserves inline reading position: %j', (overrides) => {
  const onAsk = vi.fn();
  const props = { ...base, question: '幫我排作業', ...overrides, onAsk };
  const view = render(<AssistantThread {...props} />);
  const area = scrollArea();
  area.move(120);
  fireEvent.keyDown(screen.getByLabelText('問題'), { key: 'Enter' });
  fireEvent.submit(screen.getByRole('form', { name: '傳送問題' }));
  expect(onAsk).not.toHaveBeenCalled();
  area.grow();
  view.rerender(<AssistantThread {...props} turns={[first, next]} />);
  expect(area.node.scrollTop).toBe(120);
  expect(screen.getByRole('button', { name: '回到最新回覆' })).toBeTruthy();
});

it('removes the inline scroll listener when unmounted', () => {
  const add = vi.spyOn(HTMLElement.prototype, 'addEventListener');
  const remove = vi.spyOn(HTMLElement.prototype, 'removeEventListener');
  const view = render(<AssistantThread {...base} />);
  const node = screen.getByRole('log', { name: '對話紀錄' });
  const registration = add.mock.calls.findIndex((args, index) =>
    add.mock.contexts[index] === node && args[0] === 'scroll' &&
    typeof args[2] === 'object' && args[2]?.passive === true);
  expect(registration).toBeGreaterThanOrEqual(0);
  const listener = add.mock.calls[registration][1];
  view.unmount();
  expect(remove).toHaveBeenCalledWith('scroll', listener);
});

it('keeps the standalone window-scroll behavior and does not create a nested tab stop', () => {
  const view = render(<AssistantThread {...base} inline={false} />);
  const end = view.container.querySelector('[class*="logEnd"]') as HTMLElement;
  vi.spyOn(end, 'getBoundingClientRect').mockReturnValue({ top: window.innerHeight + 500 } as DOMRect);
  const scroll = vi.mocked(Element.prototype.scrollIntoView);
  scroll.mockClear();
  fireEvent.scroll(window);
  view.rerender(<AssistantThread {...base} inline={false} turns={[first, next]} />);
  expect(scroll).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '回到最新回覆' }));
  expect(scroll).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('log', { name: '對話紀錄' }).hasAttribute('tabindex')).toBe(false);
});
