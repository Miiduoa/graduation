'use strict';

const { connectCampusServiceData } = require('./semanticCampusData');
const fake = ({ verify = jest.fn(), tool = jest.fn(), events = jest.fn() } = {}) => ({ verify, tool, events });

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
