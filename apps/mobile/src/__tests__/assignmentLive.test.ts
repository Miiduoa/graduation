import { startAssignmentLive } from '@campus/shared/src/assignmentLive';
afterEach(() => jest.useRealTimers());
describe('作業同步', () => {
  it('伺服器確認後同步，前景補讀，離線保留時間並清除排程', async () => {
    jest.useFakeTimers();
    let active = true;
    let online = true;
    let changed = () => {};
    const receive = jest.fn();
    const status = jest.fn();
    const read = jest.fn().mockResolvedValue(['已批改']);
    const unsubscribe = jest.fn();
    const stop = startAssignmentLive({
      read,
      receive,
      status,
      clear: jest.fn(),
      active: () => active,
      online: () => online,
      subscribe: (next) => {
        changed = next;
        return unsubscribe;
      },
    });
    expect(receive).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(0);
    expect(status.mock.lastCall?.[0].state).toBe('synced');
    await jest.advanceTimersByTimeAsync(2500);
    expect(read).toHaveBeenCalledTimes(2);
    active = false;
    changed();
    await jest.advanceTimersByTimeAsync(10000);
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
    await jest.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(3);
    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
  it('撤權清空且不再重試', async () => {
    jest.useFakeTimers();
    const clear = jest.fn();
    const receive = jest.fn();
    const read = jest.fn().mockRejectedValue({ status: 403 });
    const stop = startAssignmentLive({
      read,
      receive,
      clear,
      status: jest.fn(),
      active: () => true,
      online: () => true,
      subscribe: () => () => {},
    });
    await jest.advanceTimersByTimeAsync(10000);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(receive).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(1);
    stop();
  });
});
it('兩個客戶端在五秒內讀到另一端確認的批改狀態', async () => {
  jest.useFakeTimers();
  let server = '待批改';
  const receive = jest.fn();
  const options = {
    read: async () => server,
    receive,
    clear: jest.fn(),
    status: jest.fn(),
    active: () => true,
    online: () => true,
    subscribe: () => () => {},
  };
  const stopA = startAssignmentLive(options);
  const other = jest.fn();
  const stopB = startAssignmentLive({ ...options, receive: other });
  await jest.advanceTimersByTimeAsync(0);
  server = '已退回';
  await jest.advanceTimersByTimeAsync(2500);
  expect(other.mock.lastCall?.[0]).toBe('已退回');
  stopA();
  stopB();
});
it('背景、登出後丟棄晚到的回應', async () => {
  jest.useFakeTimers();
  let finish!: (value: string) => void;
  const receive = jest.fn();
  let active = true;
  let changed = () => {};
  const stop = startAssignmentLive({
    read: () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
    receive,
    clear: jest.fn(),
    status: jest.fn(),
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
  await jest.advanceTimersByTimeAsync(0);
  expect(receive).not.toHaveBeenCalled();
  active = true;
  changed();
  stop();
  finish('登出前收據');
  await jest.advanceTimersByTimeAsync(0);
  expect(receive).not.toHaveBeenCalled();
});
it('本機送出確認後不採用較早開始的清單讀取', async () => {
  jest.useFakeTimers();
  let revision = 0;
  let finish!: (value: string) => void;
  const receive = jest.fn();
  const read = jest.fn().mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; })).mockResolvedValue('新收據');
  const stop = startAssignmentLive({ read, receive, revision: () => revision, clear: jest.fn(), status: jest.fn(), active: () => true, online: () => true, subscribe: () => () => {} });
  revision += 1;
  finish('送出前的清單');
  await jest.advanceTimersByTimeAsync(0);
  expect(receive).toHaveBeenCalledTimes(1);
  expect(receive).toHaveBeenCalledWith('新收據');
  stop();
});

it('失敗採指數退避，成功後恢復正常間隔', async () => {
  jest.useFakeTimers();
  const read = jest.fn().mockRejectedValue({ status: 429 });
  const status = jest.fn();
  const stop = startAssignmentLive({ read, receive: jest.fn(), clear: jest.fn(), status,
    active: () => true, online: () => true, subscribe: () => () => {} });
  await jest.advanceTimersByTimeAsync(0);
  for (const wait of [5000, 10000, 20000, 40000, 60000]) {
    const before = read.mock.calls.length;
    await jest.advanceTimersByTimeAsync(wait - 1);
    expect(read).toHaveBeenCalledTimes(before);
    await jest.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(before + 1);
  }
  read.mockResolvedValue([]);
  await jest.advanceTimersByTimeAsync(60000);
  expect(status.mock.lastCall?.[0].state).toBe('synced');
  const before = read.mock.calls.length;
  await jest.advanceTimersByTimeAsync(2500);
  expect(read).toHaveBeenCalledTimes(before + 1);
  stop();
});

it('一分鐘正常前景流量上限為主清單 25 次及選取的收件 24 次', async () => {
  jest.useFakeTimers();
  const main = jest.fn().mockResolvedValue([]);
  const receipts = jest.fn().mockResolvedValue([]);
  const options = { receive: jest.fn(), clear: jest.fn(), status: jest.fn(), active: () => true,
    online: () => true, subscribe: () => () => {} };
  const stopMain = startAssignmentLive({ ...options, read: main });
  const stopReceipts = startAssignmentLive({ ...options, read: receipts, initialDelay: 2500 });
  await jest.advanceTimersByTimeAsync(60000);
  expect(main).toHaveBeenCalledTimes(25);
  expect(receipts).toHaveBeenCalledTimes(24);
  stopMain();
  stopReceipts();
});
