import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openModalSession } from './modalSession';

let frames: Map<number, FrameRequestCallback>;
let frameId: number;
const releases: Array<() => void> = [];

beforeEach(() => {
  frames = new Map();
  frameId = 0;
  vi.stubGlobal('innerHeight', 740);
  vi.stubGlobal('visualViewport', null);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});

afterEach(() => {
  while (releases.length) releases.pop()!();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function nextFrame() {
  const current = [...frames.values()];
  frames.clear();
  current.forEach((callback) => callback(16));
}

function fixture({ top = 617, height = 240, scroll = 0, scrollHeight = 1600 } = {}) {
  const container = document.createElement('section');
  const dialog = document.createElement('dialog');
  const previous = document.createElement('button');
  const field = document.createElement('textarea');
  const following = document.createElement('button');
  field.value = '帶上筆記與上次的討論紀錄';
  field.style.cssText = 'font-size:34px;line-height:54.4px;padding:10px 14px;border:1px solid';
  dialog.append(previous, field, following);
  container.append(dialog);
  document.body.append(container);
  container.scrollTop = 80;
  dialog.scrollTop = scroll;
  field.scrollTop = 24;
  Object.defineProperties(dialog, {
    clientTop: { value: 1 },
    clientHeight: { value: 706 },
    scrollHeight: { value: scrollHeight },
  });
  vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue(new DOMRect(16, 16, 288, 708));
  vi.spyOn(field, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(36, top + scroll - dialog.scrollTop, 248, height),
  );
  dialog.showModal = () => {
    dialog.open = true;
  };
  dialog.close = () => {
    dialog.open = false;
  };
  const release = openModalSession(dialog);
  releases.push(() => {
    release();
    container.remove();
  });
  previous.focus();
  function tabToField(shiftKey = false) {
    // Geometry and lifecycle regression; real native Tab remains in browser QA.
    previous.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true }));
    field.focus();
  }
  function visibleHeight() {
    const bounds = field.getBoundingClientRect();
    const visual = window.visualViewport;
    const top = Math.max(17, visual?.offsetTop ?? 0);
    const bottom = Math.min(723, visual ? visual.offsetTop + visual.height : 740);
    return Math.max(0, Math.min(bounds.bottom, bottom) - Math.max(bounds.top, top));
  }
  return { dialog, previous, field, following, container, release, tabToField, visibleHeight };
}

it('reveals at least two text lines after native Tab without moving the caret or outer page', () => {
  const view = fixture();
  view.field.setSelectionRange(4, 8);
  expect(view.visibleHeight()).toBe(106);
  view.tabToField();
  expect(view.dialog.scrollTop).toBe(0);
  nextFrame();
  expect(view.visibleHeight()).toBeGreaterThanOrEqual(130.8);
  expect(view.dialog.scrollTop).toBeCloseTo(32.8);
  expect(view.container.scrollTop).toBe(80);
  expect(view.field.scrollTop).toBe(24);
  expect([view.field.selectionStart, view.field.selectionEnd]).toEqual([4, 8]);
  expect(document.activeElement).toBe(view.field);
  expect(view.dialog.open).toBe(true);
});

it('reveals a clipped upper edge on reverse Tab without aligning the entire textarea', () => {
  const view = fixture({ top: -110, scroll: 200 });
  view.tabToField(true);
  nextFrame();
  expect(view.visibleHeight()).toBeGreaterThanOrEqual(130.8);
  expect(view.dialog.scrollTop).toBeCloseTo(174.2);
  expect(view.field.getBoundingClientRect().top).toBeLessThan(17);
});

it.each([{ top: 100 }, { top: 580 }, { top: -200, height: 1000 }])(
  'does not shift a multiline field that already has enough reading space: %j',
  (layout) => {
    const view = fixture(layout);
    view.tabToField();
    nextFrame();
    expect(view.dialog.scrollTop).toBe(0);
  },
);

it('uses the current visual viewport when a virtual keyboard covers the dialog bottom', () => {
  const view = fixture({ top: 440 });
  vi.stubGlobal('visualViewport', { offsetTop: 100, height: 380 });
  view.tabToField();
  nextFrame();
  expect(view.visibleHeight()).toBeGreaterThanOrEqual(130.8);
  expect(view.dialog.scrollTop).toBeCloseTo(98.8);
  expect(view.container.scrollTop).toBe(80);
});

it('bounds the adjustment to available viewport and dialog scroll range', () => {
  const view = fixture({ top: 617, scrollHeight: 740 });
  vi.stubGlobal('visualViewport', { offsetTop: 100, height: 80 });
  view.tabToField();
  nextFrame();
  expect(view.dialog.scrollTop).toBe(34);
  expect(view.container.scrollTop).toBe(80);
});

it('does not interfere with pointer, programmatic or text-entry focus', () => {
  const view = fixture();
  view.field.focus();
  nextFrame();
  expect(view.dialog.scrollTop).toBe(0);
  view.previous.focus();
  view.previous.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  view.field.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  view.field.focus();
  nextFrame();
  expect(view.dialog.scrollTop).toBe(0);
  view.previous.focus();
  view.tabToField();
  view.field.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
  nextFrame();
  expect(view.dialog.scrollTop).toBe(0);
});

it('cancels the adjustment when focus moves or a pointer chooses a caret before the next frame', () => {
  const view = fixture();
  view.tabToField();
  view.following.focus();
  nextFrame();
  expect(view.dialog.scrollTop).toBe(0);
  view.previous.focus();
  view.tabToField();
  view.field.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  nextFrame();
  expect(view.dialog.scrollTop).toBe(0);
});

it('expires a cancelled Tab intent before later programmatic focus', () => {
  const view = fixture();
  view.previous.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  nextFrame();
  view.field.focus();
  nextFrame();
  expect(view.dialog.scrollTop).toBe(0);
});

it('does not adjust single-line inputs or modified/composing Tab events', () => {
  const view = fixture();
  const input = document.createElement('input');
  view.dialog.append(input);
  view.previous.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  input.focus();
  nextFrame();
  expect(view.dialog.scrollTop).toBe(0);
  for (const modifiers of [
    { altKey: true },
    { ctrlKey: true },
    { metaKey: true },
    { isComposing: true },
  ]) {
    view.previous.focus();
    view.previous.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, ...modifiers }),
    );
    view.field.focus();
    nextFrame();
    expect(view.dialog.scrollTop).toBe(0);
  }
});

it('releases pending work and listeners with the native modal session', () => {
  const view = fixture();
  view.tabToField();
  expect(frames.size).toBe(1);
  view.release();
  expect(frames.size).toBe(0);
  nextFrame();
  expect(view.dialog.scrollTop).toBe(0);
  expect(view.dialog.open).toBe(false);
  view.previous.focus();
  view.tabToField();
  expect(frames.size).toBe(0);
});
