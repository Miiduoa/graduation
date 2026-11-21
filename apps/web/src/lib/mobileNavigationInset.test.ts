import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { observeMobileNavigationInset } from './mobileNavigationInset';

const PROPERTY = '--mobile-nav-measured-offset';
const cleanups: Array<() => void> = [];
let mobile = true;
let media: MediaQueryList;
let resizeCallbacks: Array<() => void>;
let observe: ReturnType<typeof vi.fn>;
let disconnect: ReturnType<typeof vi.fn>;

function measuredNavigation(initialHeight: number) {
  const element = document.createElement('nav');
  document.body.append(element);
  let height = initialHeight;
  vi.spyOn(element, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(0, 0, 320, height),
  );
  return {
    element,
    resize: (value: number) => {
      height = value;
    },
  };
}

function start(element: HTMLElement) {
  const release = observeMobileNavigationInset(element);
  cleanups.push(release);
  return release;
}

function value() {
  return document.documentElement.style.getPropertyValue(PROPERTY);
}

beforeEach(() => {
  mobile = true;
  resizeCallbacks = [];
  observe = vi.fn();
  disconnect = vi.fn();
  const events = new EventTarget();
  media = {
    get matches() {
      return mobile;
    },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  } as MediaQueryList;
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => media),
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resizeCallbacks.push(callback);
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
});

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  document.body.replaceChildren();
  document.documentElement.style.removeProperty(PROPERTY);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('mobile navigation inset', () => {
  it('reserves the complete border box once and follows enlarged or wrapped labels', () => {
    const nav = measuredNavigation(106.25);
    start(nav.element);
    expect(observe).toHaveBeenCalledWith(nav.element, { box: 'border-box' });
    expect(value()).toBe('107px');

    nav.resize(144);
    resizeCallbacks[0]();
    expect(value()).toBe('144px');
    nav.resize(106.25);
    resizeCallbacks[0]();
    expect(value()).toBe('107px');
  });

  it('releases the mobile inset on desktop and remeasures when the breakpoint changes back', () => {
    const nav = measuredNavigation(90);
    start(nav.element);
    mobile = false;
    media.dispatchEvent(new Event('change'));
    expect(value()).toBe('');

    nav.resize(124);
    mobile = true;
    media.dispatchEvent(new Event('change'));
    expect(value()).toBe('124px');
  });

  it('does not publish desktop geometry before entering the mobile breakpoint', () => {
    mobile = false;
    const nav = measuredNavigation(44);
    start(nav.element);
    expect(value()).toBe('');
    nav.resize(104);
    mobile = true;
    window.dispatchEvent(new Event('resize'));
    expect(value()).toBe('104px');
  });

  it('restores the previous inline value and priority on release', () => {
    document.documentElement.style.setProperty(PROPERTY, '88px', 'important');
    const nav = measuredNavigation(112);
    const release = start(nav.element);
    expect(value()).toBe('112px');
    release();
    expect(value()).toBe('88px');
    expect(document.documentElement.style.getPropertyPriority(PROPERTY)).toBe('important');
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('keeps the remaining shell inset when overlapping observers release out of order', () => {
    const first = measuredNavigation(92);
    const second = measuredNavigation(112);
    const releaseFirst = start(first.element);
    const releaseSecond = start(second.element);
    expect(value()).toBe('112px');
    releaseFirst();
    expect(value()).toBe('112px');
    releaseSecond();
    expect(value()).toBe('');
  });

  it('returns to the smaller remaining bar without restoring another observer stale value', () => {
    const first = measuredNavigation(92);
    const second = measuredNavigation(112);
    start(first.element);
    const releaseSecond = start(second.element);
    releaseSecond();
    expect(value()).toBe('92px');
    first.resize(124);
    resizeCallbacks[0]();
    expect(value()).toBe('124px');
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'falls back instead of reserving invalid geometry %s',
    (height) => {
      const nav = measuredNavigation(104);
      start(nav.element);
      nav.resize(height);
      resizeCallbacks[0]();
      expect(value()).toBe('');
      nav.resize(120);
      resizeCallbacks[0]();
      expect(value()).toBe('120px');
    },
  );

  it('does not measure a detached navigation and releases it after removal', () => {
    const nav = measuredNavigation(100);
    nav.element.remove();
    start(nav.element);
    expect(value()).toBe('');
    document.body.append(nav.element);
    resizeCallbacks[0]();
    expect(value()).toBe('100px');
    nav.element.remove();
    resizeCallbacks[0]();
    expect(value()).toBe('');
  });

  it('falls back to resize events when ResizeObserver is unavailable', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const nav = measuredNavigation(100);
    const release = start(nav.element);
    nav.resize(128);
    window.dispatchEvent(new Event('resize'));
    expect(value()).toBe('128px');
    release();
    nav.resize(144);
    window.dispatchEvent(new Event('resize'));
    expect(value()).toBe('');
  });

  it('uses the same inclusive breakpoint when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    vi.stubGlobal('innerWidth', 760);
    const nav = measuredNavigation(100);
    start(nav.element);
    expect(value()).toBe('100px');
    vi.stubGlobal('innerWidth', 761);
    window.dispatchEvent(new Event('resize'));
    expect(value()).toBe('');
  });

  it('ignores queued resize and media events after release', () => {
    const nav = measuredNavigation(100);
    const release = start(nav.element);
    release();
    nav.resize(144);
    resizeCallbacks[0]();
    media.dispatchEvent(new Event('change'));
    window.dispatchEvent(new Event('resize'));
    expect(value()).toBe('');
  });

  it('does not clear an inline value replaced by another owner', () => {
    const nav = measuredNavigation(100);
    const release = start(nav.element);
    document.documentElement.style.setProperty(PROPERTY, '132px');
    release();
    expect(value()).toBe('132px');
  });
});
