import { expect, it, vi } from 'vitest';
import { subscribePreferredCollection } from './preferredCollection';
function setup() {
  const next = vi.fn(),
    fail = vi.fn();
  const callbacks: Array<{ next: (rows: string[]) => void; fail: (error: unknown) => void }> = [];
  const stops = [vi.fn(), vi.fn(), vi.fn()];
  const stop = subscribePreferredCollection<string>(
    stops.map((stop, index) => ({
      key: String(index),
      subscribe: (next, fail) => {
        callbacks.push({ next, fail });
        return stop;
      },
    })),
    next,
    fail,
  );
  return { next, fail, callbacks, stops, stop };
}
it('does not emit a fallback before the primary read completes', () => {
  const s = setup();
  s.callbacks[1].next(['legacy']);
  s.callbacks[2].next([]);
  expect(s.next).not.toHaveBeenCalled();
  s.callbacks[0].next(['canonical']);
  expect(s.next).toHaveBeenLastCalledWith(['canonical']);
});
it('uses fallback only after confirmed empty earlier sources', () => {
  const s = setup();
  s.callbacks[2].next(['legacy']);
  s.callbacks[0].next([]);
  expect(s.next).not.toHaveBeenCalled();
  s.callbacks[1].next([]);
  expect(s.next).toHaveBeenLastCalledWith(['legacy']);
});
it('does not turn a failed primary and empty fallbacks into a successful empty result', () => {
  const s = setup(),
    error = new Error('permission denied');
  s.callbacks[0].fail(error);
  s.callbacks[1].next([]);
  s.callbacks[2].next([]);
  expect(s.next).not.toHaveBeenCalled();
  expect(s.fail).toHaveBeenLastCalledWith(error);
});
it('invalidates previously confirmed primary data when its listener fails', () => {
  const s = setup(),
    error = new Error('revoked');
  s.callbacks[0].next(['private old row']);
  s.next.mockClear();
  s.callbacks[0].fail(error);
  s.callbacks[1].next(['new fallback']);
  expect(s.next).not.toHaveBeenCalled();
  expect(s.fail).toHaveBeenLastCalledWith(error);
});
it('does not let an unused fallback failure invalidate a valid primary, but remembers it if needed', () => {
  const s = setup(),
    error = new Error('unavailable fallback');
  s.callbacks[0].next(['current']);
  s.callbacks[1].fail(error);
  expect(s.fail).not.toHaveBeenCalled();
  s.callbacks[0].next([]);
  expect(s.fail).toHaveBeenLastCalledWith(error);
});
it('emits an empty result only after all sources are confirmed empty', () => {
  const s = setup();
  s.callbacks[0].next([]);
  s.callbacks[1].next([]);
  expect(s.next).not.toHaveBeenCalled();
  s.callbacks[2].next([]);
  expect(s.next).toHaveBeenLastCalledWith([]);
});
it('stops every source and ignores late success and failure callbacks', () => {
  const s = setup();
  s.stop();
  s.callbacks[0].next(['late']);
  s.callbacks[1].fail(new Error('late'));
  expect(s.next).not.toHaveBeenCalled();
  expect(s.fail).not.toHaveBeenCalled();
  s.stops.forEach((stop) => expect(stop).toHaveBeenCalledOnce());
});
