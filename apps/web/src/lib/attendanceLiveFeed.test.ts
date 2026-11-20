import { describe, expect, it, vi } from 'vitest';
import { startAttendanceFeed, type AttendanceFeedSource } from './attendanceLiveFeed';

type Session = { id: string; count: number };
type Receipt = { status: string | null };
function setup(includeReceipts = true) {
  let sessions!: (value: Session[] | null) => void;
  let failed!: () => void;
  const listeners: { id: string; next: (value: Receipt | null) => void; error: () => void; stop: ReturnType<typeof vi.fn> }[] = [];
  const stopSessions = vi.fn();
  const source: AttendanceFeedSource<Session, Receipt> = {
    sessions: (next, error) => { sessions = next; failed = error; return stopSessions; },
    receipt: (id, next, error) => {
      const stop = vi.fn(); listeners.push({ id, next, error, stop }); return stop;
    },
  };
  const onChange = vi.fn();
  const onState = vi.fn();
  const stop = startAttendanceFeed({ source, includeReceipts, onChange, onState });
  return { sessions: (value: Session[] | null) => sessions(value), failed: () => failed(), listeners, stopSessions, onChange, onState, stop };
}
const session = (id: string, count = 0) => ({ id, count });

describe('verified classroom feed', () => {
  it('does not interpret cached sessions or a cached receipt as saved attendance', () => {
    const feed = setup();
    feed.sessions(null);
    expect(feed.onChange).not.toHaveBeenCalled();
    feed.sessions([session('a')]);
    feed.listeners[0].next(null);
    expect(feed.onChange).not.toHaveBeenCalled();
    feed.listeners[0].next({ status: null });
    expect(feed.onChange).toHaveBeenLastCalledWith([{ session: session('a'), receipt: { status: null } }]);
    expect(feed.onState).toHaveBeenLastCalledWith('live');
  });
  it('waits for every displayed personal receipt before enabling interaction', () => {
    const feed = setup();
    feed.sessions([session('a'), session('b')]);
    feed.listeners[0].next({ status: 'present' });
    expect(feed.onChange).not.toHaveBeenCalled();
    feed.listeners[1].next({ status: 'excused' });
    expect(feed.onChange.mock.calls[0][0]).toHaveLength(2);
  });
  it('updates class counts without creating more receipt listeners or reloading every document', () => {
    const feed = setup();
    feed.sessions([session('a')]); feed.listeners[0].next({ status: null });
    for (let count = 1; count <= 100; count += 1) feed.sessions([session('a', count)]);
    expect(feed.listeners).toHaveLength(1);
    expect(feed.onChange.mock.lastCall?.[0][0].session.count).toBe(100);
  });
  it('updates a teacher without subscribing to any student receipt', () => {
    const feed = setup(false);
    feed.sessions([session('a', 3)]);
    expect(feed.listeners).toHaveLength(0);
    expect(feed.onChange).toHaveBeenLastCalledWith([{ session: session('a', 3), receipt: null }]);
  });
  it('shows a remotely corrected personal status without reloading the class', () => {
    const feed = setup();
    feed.sessions([session('a')]);
    feed.listeners[0].next({ status: 'present' });
    feed.listeners[0].next({ status: 'absent' });
    expect(feed.onChange.mock.lastCall?.[0][0].receipt.status).toBe('absent');
  });
  it('detaches removed sessions and ignores their late responses and errors', () => {
    const feed = setup();
    feed.sessions([session('a')]); const old = feed.listeners[0]; old.next({ status: 'present' });
    feed.sessions([session('b')]);
    expect(old.stop).toHaveBeenCalledTimes(1);
    old.next({ status: 'absent' }); old.error();
    expect(feed.onState).toHaveBeenLastCalledWith('connecting');
    feed.listeners[1].next({ status: null });
    expect(feed.onChange.mock.lastCall?.[0][0].session.id).toBe('b');
  });
  it('does not accept an old listener when the same session ID is removed and restored', () => {
    const feed = setup();
    feed.sessions([session('a')]); const old = feed.listeners[0];
    feed.sessions([]); feed.sessions([session('a')]);
    old.next({ status: 'present' });
    expect(feed.onState).toHaveBeenLastCalledWith('connecting');
    feed.listeners[1].next({ status: 'late' });
    expect(feed.onChange.mock.lastCall?.[0][0].receipt.status).toBe('late');
  });
  it('suspends existing data when a receipt becomes cache-only', () => {
    const feed = setup(); feed.sessions([session('a')]);
    feed.listeners[0].next({ status: 'present' }); const count = feed.onChange.mock.calls.length;
    feed.listeners[0].next(null); feed.sessions([session('a', 2)]);
    expect(feed.onState).toHaveBeenLastCalledWith('connecting');
    expect(feed.onChange).toHaveBeenCalledTimes(count);
  });
  it('releases every subscription exactly once after disposal and ignores queued data', () => {
    const feed = setup(); feed.sessions([session('a'), session('b')]); feed.stop(); feed.stop();
    feed.listeners[0].next({ status: 'present' }); feed.sessions([session('c')]);
    expect(feed.stopSessions).toHaveBeenCalledTimes(1);
    expect(feed.listeners.every((item) => item.stop.mock.calls.length === 1)).toBe(true);
    expect(feed.onChange).not.toHaveBeenCalled();
  });
  it.each(['query', 'receipt'])('fails closed and detaches listeners on %s errors', (kind) => {
    const feed = setup(); feed.sessions([session('a')]);
    if (kind === 'query') feed.failed(); else feed.listeners[0].error();
    expect(feed.onState).toHaveBeenLastCalledWith('error');
    expect(feed.stopSessions).toHaveBeenCalledTimes(1);
    expect(feed.listeners[0].stop).toHaveBeenCalledTimes(1);
    feed.listeners[0].next({ status: 'present' }); expect(feed.onChange).not.toHaveBeenCalled();
  });
  it.each([[Array.from({ length: 51 }, (_, index) => session(String(index)))], [[session('a'), session('a')]]])(
    'rejects excessive or duplicate session lists', (rows) => {
      const feed = setup(); feed.sessions(rows);
      expect(feed.onState).toHaveBeenLastCalledWith('error');
      expect(feed.listeners).toHaveLength(0);
    },
  );
  it('does not leak an unsubscribe function returned after synchronous registration failure', () => {
    const stop = vi.fn(); const onChange = vi.fn(); const onState = vi.fn();
    startAttendanceFeed({ source: {
      sessions: (_next, fail) => { fail(); return stop; }, receipt: () => () => {},
    }, includeReceipts: true, onChange, onState });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(onState).toHaveBeenLastCalledWith('error');
  });
});
