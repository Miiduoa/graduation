import { describe, it, expect, vi, afterEach } from 'vitest';
import { startAssignmentLive } from '@campus/shared/src/assignmentLive';
afterEach(() => vi.useRealTimers());
describe('作業同步', () => {
  it('伺服器確認後同步，前景補讀，離線保留時間並清除排程', async () => {
    vi.useFakeTimers();
    let active = true;
    let online = true;
    let changed = () => {};
    const receive = vi.fn();
    const status = vi.fn();
    const read = vi.fn().mockResolvedValue(['已批改']);
    const unsubscribe = vi.fn();
    const stop = startAssignmentLive({
      read,
      receive,
      status,
      clear: vi.fn(),
      active: () => active,
      online: () => online,
      subscribe: (next) => {
        changed = next;
        return unsubscribe;
      },
    });
    expect(receive).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(status.mock.lastCall?.[0].state).toBe('synced');
    await vi.advanceTimersByTimeAsync(2500);
    expect(read).toHaveBeenCalledTimes(2);
    active = false;
    changed();
    await vi.advanceTimersByTimeAsync(10000);
    expect(read).toHaveBeenCalledTimes(2);
    online = false;
    active = true;
    changed();
    expect(status.mock.lastCall?.[0]).toMatchObject({
      state: 'offline',
      updatedAt: expect.any(String),
    });
    online = true;
    changed();
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(3);
    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('撤權清空且不再重試', async () => {
    vi.useFakeTimers();
    const clear = vi.fn();
    const receive = vi.fn();
    const read = vi.fn().mockRejectedValue({ status: 403 });
    const stop = startAssignmentLive({
      read,
      receive,
      clear,
      status: vi.fn(),
      active: () => true,
      online: () => true,
      subscribe: () => () => {},
    });
    await vi.advanceTimersByTimeAsync(10000);
    expect(clear).toHaveBeenCalledOnce();
    expect(receive).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledOnce();
    stop();
  });
});
it('兩個客戶端在五秒內讀到另一端確認的批改狀態', async () => {
  vi.useFakeTimers();
  let server = '待批改';
  const receive = vi.fn();
  const options = {
    read: async () => server,
    receive,
    clear: vi.fn(),
    status: vi.fn(),
    active: () => true,
    online: () => true,
    subscribe: () => () => {},
  };
  const stopA = startAssignmentLive(options);
  const other = vi.fn();
  const stopB = startAssignmentLive({ ...options, receive: other });
  await vi.advanceTimersByTimeAsync(0);
  server = '已退回';
  await vi.advanceTimersByTimeAsync(2500);
  expect(other.mock.lastCall?.[0]).toBe('已退回');
  stopA();
  stopB();
});
it('背景、登出後丟棄晚到的回應', async () => {
  vi.useFakeTimers();
  let finish!: (value: string) => void;
  const receive = vi.fn();
  let active = true;
  let changed = () => {};
  const stop = startAssignmentLive({
    read: () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
    receive,
    clear: vi.fn(),
    status: vi.fn(),
    active: () => active,
    online: () => true,
    subscribe: (next) => {
      changed = next;
      return () => {};
    },
  });
  active = false;
  changed();
  finish('舊帳號收據');
  await vi.advanceTimersByTimeAsync(0);
  expect(receive).not.toHaveBeenCalled();
  active = true;
  changed();
  stop();
  finish('登出前收據');
  await vi.advanceTimersByTimeAsync(0);
  expect(receive).not.toHaveBeenCalled();
});
it('本機送出確認後不採用較早開始的清單讀取', async () => {
  vi.useFakeTimers();
  let revision = 0;
  let finish!: (value: string) => void;
  const receive = vi.fn();
  const read = vi.fn().mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; })).mockResolvedValue('新收據');
  const stop = startAssignmentLive({ read, receive, revision: () => revision, clear: vi.fn(), status: vi.fn(), active: () => true, online: () => true, subscribe: () => () => {} });
  revision += 1;
  finish('送出前的清單');
  await vi.advanceTimersByTimeAsync(0);
  expect(receive).toHaveBeenCalledTimes(1);
  expect(receive).toHaveBeenCalledWith('新收據');
  stop();
});
