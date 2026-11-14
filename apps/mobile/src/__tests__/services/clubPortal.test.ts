import { callClubPortal } from '../../services/clubPortal';
let mockCurrentUser: any;
jest.mock('../../firebase', () => ({ getAuthInstance: () => ({ currentUser: mockCurrentUser }) }));
beforeEach(() => {
  jest.resetAllMocks();
  mockCurrentUser = { uid: 'one', getIdToken: jest.fn().mockResolvedValue('token') };
  global.fetch = jest
    .fn()
    .mockResolvedValue({
      ok: true,
      json: async () => ({ result: { success: true, office: false, status: 'active' } }),
    });
});
test('手機走既有 Web API，以真實 token 和學校送出', async () => {
  expect((await callClubPortal('one', 'pu', { action: 'join', groupId: 'club' })).status).toBe(
    'active',
  );
  expect(fetch).toHaveBeenCalledWith(
    'https://nuni.tw/api/fn/clubPortal',
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer token' }),
      body: JSON.stringify({ data: { action: 'join', groupId: 'club', schoolId: 'pu' } }),
    }),
  );
});
test('切換帳號丟棄晚到成功回應', async () => {
  let done!: (value: any) => void;
  jest.mocked(fetch).mockReturnValue(
    new Promise((resolve) => {
      done = resolve;
    }),
  );
  const result = callClubPortal('one', 'pu', { action: 'join' });
  await Promise.resolve();
  await Promise.resolve();
  mockCurrentUser = { uid: 'two' };
  done({ ok: true, json: async () => ({ result: { success: true } }) });
  await expect(result).rejects.toThrow('帳號已變更');
});
test('後端未確認不當作加入成功', async () => {
  jest
    .mocked(fetch)
    .mockResolvedValue({ ok: true, json: async () => ({ result: {} }) } as Response);
  await expect(callClubPortal('one', 'pu')).rejects.toThrow('伺服器尚未確認');
});
