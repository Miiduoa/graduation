'use strict';

const { connectCampusServiceData } = require('./semanticCampusData');
const fake = ({ verify = jest.fn(), tool = jest.fn(), events = jest.fn(), records = jest.fn() } = {}) => ({ verify, tool, events, records });

describe('verified campus data read-through', () => {
  test('reads only authorized current-school assignments and announcement records', async () => {
    const verify = jest.fn(async () => {});
    const tool = jest.fn(async (name) =>
      name === 'getAssignments'
        ? [{ title: '期末報告', groupName: '專題', dueAt: '2026-11-30T12:00:00Z' }]
        : [{ title: '教務處公告', office: '教務處' }]);
    const result = await connectCampusServiceData({
      uid: 'alice', schoolId: 'pu', utterance: '這週作業和公告', destinations: ['/classroom', '/announcements'],
    }, fake({ verify, tool }));
    expect(verify).toHaveBeenCalledWith('alice', 'pu');
    expect(tool).toHaveBeenCalledTimes(2);
    expect(result[0]).toMatchObject({ status: 'available', source: 'campus-platform', items: [{ title: '期末報告' }] });
    expect(result[1]).toMatchObject({ status: 'available', items: [{ title: '教務處公告' }] });
  });

  test('never reads private data if school membership is absent or revoked', async () => {
    const tool = jest.fn();
    const result = await connectCampusServiceData({
      uid: 'alice', schoolId: 'nthu', destinations: ['/classroom', '/library', '/announcements'],
    }, fake({ verify: jest.fn(async () => { throw new Error('not member'); }), tool }));
    expect(result.map(x => x.status)).toEqual(['connection-required', 'connection-required', 'connection-required']);
    expect(tool).not.toHaveBeenCalled();
  });

  test('announces unavailable authoritative schedule rather than inventing a free day', async () => {
    const tool = jest.fn(async () => ({
      status: 'unavailable', slots: null, message: '助理還不能查正式課表',
    }));
    const today = await connectCampusServiceData({
      uid: 'alice', schoolId: 'pu', utterance: '今天有空堂嗎', destinations: ['/timetable'],
    }, fake({ tool }));
    expect(today[0]).toMatchObject({ status: 'unavailable', items: [] });
    expect(today[0].message).toContain('不能查正式課表');

    tool.mockClear();
    const tomorrow = await connectCampusServiceData({
      uid: 'alice', schoolId: 'pu', utterance: '明天沒課嗎', destinations: ['/timetable'],
    }, fake({ tool }));
    expect(tomorrow[0]).toMatchObject({ status: 'open-service', items: [] });
    expect(tool).not.toHaveBeenCalled();
  });

  test('recognizes platform loans as platform data, not the authoritative library ledger', async () => {
    const results = await connectCampusServiceData({
      uid: 'alice', schoolId: 'pu', utterance: '我的借閱紀錄', destinations: ['/library'],
    }, fake({ tool: jest.fn(async () => ({ ok: true, loans: [] })) }));
    expect(results[0].status).toBe('empty');
    expect(results[0].message).toContain('不能據此判定官方圖書館');
  });

  test('uses only one specific named place, not the full multi-goal utterance, for campus POI', async () => {
    const tool = jest.fn(async () => ({
      success: true, pois: [{ name: '圖書館', code: 'LIB', lat: 24.1 }],
    }));
    const result = await connectCampusServiceData({
      uid: 'alice', schoolId: 'pu', utterance: '明天要去圖書館讀書再吃飯',
      destinations: ['/map', '/cafeteria'],
    }, fake({ tool }));
    expect(tool).toHaveBeenCalledWith('findCampusPoi', expect.objectContaining({ schoolId: 'pu', uid: 'alice' }), {
      query: '圖書館', limit: 4,
    });
    expect(result[0].items[0].title).toBe('圖書館');
  });

  test('treats unconnected official systems as open-service without querying a fake API', async () => {
    const tool = jest.fn();
    const result = await connectCampusServiceData({
      uid: 'alice', schoolId: 'pu', destinations: ['/bus', '/grades', '/calendar', '/friends'],
    }, fake({ tool }));
    expect(result).toHaveLength(3);
    expect(result.every(x => x.status === 'open-service')).toBe(true);
    expect(tool).not.toHaveBeenCalled();
  });

  test('opens school courses without reading LMS data through voice tools', async () => {
    const readers = fake();
    const result = await connectCampusServiceData({
      uid: 'alice', schoolId: 'pu', destinations: ['/school-courses'],
    }, readers);
    expect(result).toEqual([expect.objectContaining({
      destination: '/school-courses', status: 'open-service', source: 'none', items: [],
    })]);
    expect(result[0].message).toContain('使用學校帳號');
    expect(readers.tool).not.toHaveBeenCalled();
    expect(readers.records).not.toHaveBeenCalled();
    expect(readers.events).not.toHaveBeenCalled();
  });

  test('a failing reader is unavailable, never empty', async () => {
    const output = await connectCampusServiceData({
      uid: 'alice', schoolId: 'pu', destinations: ['/classroom'],
    }, fake({ tool: jest.fn(async () => { throw new Error('permission-denied'); }) }));
    expect(output[0].status).toBe('unavailable');
    expect(output[0].items).toEqual([]);
  });

  test('does not show unpublished events in results', async () => {
    const events = jest.fn(async () => [
      { title: '草稿活動', published: false, status: 'draft' },
      { title: '正式活動', published: true, status: 'published' },
    ]);
    const output = await connectCampusServiceData({
      uid: 'alice', schoolId: 'pu', destinations: ['/events'],
    }, fake({ events }));
    expect(output[0].items).toEqual([{ title: '正式活動', detail: '' }]);
  });
});


test('reads only authenticated school-scoped orders and excludes other schools', async () => {
  const results = await connectCampusServiceData({
    uid: 'alice', schoolId: 'pu', utterance: '我的取餐訂單',
    destinations: ['/food'],
  }, fake({ records: jest.fn(async () => [
    { schoolId: 'nthu', cafeteria: '不同學校餐廳', status: 'pending', queueNumber: 9 },
    { schoolId: 'pu', cafeteria: '校內餐廳', status: 'preparing', queueNumber: 21 },
  ]) }));
  expect(results[0]).toMatchObject({
    status: 'available', items: [{ title: '校內餐廳', detail: 'preparing · 取餐號 21' }],
  });
  expect(JSON.stringify(results[0])).not.toContain('不同學校餐廳');
});

test('filters private notifications by the requested school', async () => {
  const result = await connectCampusServiceData({
    uid: 'alice', schoolId: 'pu', utterance: '查通知',
    destinations: ['/messages'],
  }, fake({ records: jest.fn(async () => [
    { schoolId: 'nthu', title: '不同學校私人提醒', body: '秘密' },
    { schoolId: 'pu', userId: 'alice', title: '可讀通知', body: '今天有公告' },
  ]) }));
  expect(result[0].items).toEqual([{ title: '可讀通知', detail: '今天有公告' }]);
});

test('does not reveal lost-found contact details or unlisted posts', async () => {
  const result = await connectCampusServiceData({
    uid: 'alice', schoolId: 'pu', destinations: ['/lost-found'],
  }, fake({ records: jest.fn(async () => [
    { schoolId: 'pu', title: '耳機', type: 'found', status: 'open', location: '體育館', contactInfo: 'private@example.com' },
    { schoolId: 'pu', title: '已關閉案件', type: 'lost', status: 'resolved' },
  ]) }));
  expect(result[0].items).toEqual([{ title: '拾獲：耳機', detail: '體育館' }]);
  expect(JSON.stringify(result[0])).not.toContain('private@example.com');
});

test('hides a read result when membership is revoked while the read is in progress', async () => {
  const verify = jest.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('revoked'));
  const results = await connectCampusServiceData({
    uid: 'alice', schoolId: 'pu', destinations: ['/classroom'],
  }, fake({ verify, tool: jest.fn(async () => [{ title: '私密作業' }]) }));
  expect(results[0].status).toBe('connection-required');
  expect(JSON.stringify(results)).not.toContain('私密作業');
});
