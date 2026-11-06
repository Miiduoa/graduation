import { expect, it } from 'vitest';
import { normalizeDormWorkspace } from '@campus/shared/src/dormitory';
import { resolveDormRepairRoute } from '@campus/shared/src/dormRepairRoutes';

it.each([
  ['ntu', 'housing.ntu.edu.tw', 'ccnet.ntu.edu.tw'],
  ['ncku', 'dorm.osa.ncku.edu.tw', 'cc.ncku.edu.tw'],
  ['nsysu', 'sis.nsysu.edu.tw', 'dormnet-lis.nsysu.edu.tw'],
  ['ntou', 'ais.ntou.edu.tw', 'tel:0800080412'],
  ['nthu', 'sthousing.nthu.edu.tw', 'sthousing.site.nthu.edu.tw'],
  ['ncu', 'repair.ncu.edu.tw', 'repair.ncu.edu.tw'],
  ['nchu', 'cportal.nchu.edu.tw', 'www.osa.nchu.edu.tw'],
  ['nccu', 'i.nccu.edu.tw', 'support.video.nccu.edu.tw'],
])('routes %s equipment and network issues to the documented services', (school, general, network) => {
  const equipmentRoute = resolveDormRepairRoute(school, 'electric')!;
  const networkRoute = resolveDormRepairRoute(school, 'network')!;
  expect(new URL(equipmentRoute.url).hostname).toBe(general);
  expect(network.startsWith('tel:') ? networkRoute.url : new URL(networkRoute.url).hostname).toBe(network);
  expect(equipmentRoute.label).not.toBe(networkRoute.label);
  expect(resolveDormRepairRoute('tw-' + school, 'network')).toEqual(networkRoute);
});

it('resolves a single Providence hall in the recorded location without guessing ambiguous halls', () => {
  for (const [hall, extension] of [['希嘉', '11245'], ['思高', '11254'], ['善牧', '11255']]) {
    const route = resolveDormRepairRoute('tw-pu', 'air', hall + '學苑 303')!;
    expect(route.label).toContain(hall);
    expect(route.detail).toContain(extension);
    expect(route.url).toMatch(/^tel:/);
  }
  const general = resolveDormRepairRoute('pu', 'air');
  expect(resolveDormRepairRoute('tw-pu', 'air', '希嘉和思高之間')).toEqual(general);
  expect(resolveDormRepairRoute('pu', 'air', '303')).toEqual(general);
  expect(general?.url).toContain('pu.edu.tw/');
});

it('routes operator-run halls within their own university and keeps NTU network faults out of the equipment form', () => {
  expect(resolveDormRepairRoute('ncku', 'air', '太子學舍 201')?.url).toBe('https://nckudorm.prince.com.tw/Member_Repair.aspx');
  expect(resolveDormRepairRoute('ntu', 'air', '水源A棟 201')?.url).toBe('https://ntudorm.prince.com.tw/Member_Repair.aspx');
  expect(resolveDormRepairRoute('ntu', 'air', '修齊會館')?.url).toBe('https://ntudorm.prince.com.tw/Member_Repair.aspx');
  expect(resolveDormRepairRoute('ntu', 'network', '水源A棟 201')?.url).toContain('ccnet.ntu.edu.tw/');
  for (const location of ['南投宿舍', '松園二館', '松園十二館', '松園 2 館', '松園１２館 303']) {
    expect(resolveDormRepairRoute('tw-nchu', 'electric', location)?.url).toBe('tel:0492317574');
    expect(resolveDormRepairRoute('tw-nchu', 'network', location)?.url).toBe('tel:0492317574');
  }
});

it('only offers a status lookup when documented for that channel', () => {
  expect(resolveDormRepairRoute('ntou', 'water')?.trackingUrl).toBe('https://ais.ntou.edu.tw/Default.aspx');
  expect(resolveDormRepairRoute('nthu', 'furniture')?.trackingUrl).toBe('https://sthousing.nthu.edu.tw/DormRF/fillup');
  expect(resolveDormRepairRoute('ncu', 'air')?.trackingUrl).toBe('https://repair.ncu.edu.tw/RepairSystem/report');
  expect(resolveDormRepairRoute('ntou', 'network')?.trackingUrl).toBeUndefined();
  expect(resolveDormRepairRoute('nsysu', 'network')?.trackingUrl).toBeUndefined();
});

it('falls back to the selected university and never assigns an unknown tenant a real campus', () => {
  expect(resolveDormRepairRoute('ntpu', 'other')?.url).toContain('ntpu.edu.tw/');
  expect(resolveDormRepairRoute('tmu', 'air')).toMatchObject({ label: '前往臺北醫學大學官網' });
  for (const id of [undefined, 'all', 'unknown', 'constructor', 'ntou.example', 'tw-demo-uni']) {
    expect(resolveDormRepairRoute(id, 'air')).toBeNull();
  }
});

it('preserves a bounded, optional receipt without changing the resident-entered status or breaking old records', () => {
  const { repairs } = normalizeDormWorkspace({ repairs: [
    { id: 'old', title: '冷氣異音' },
    { id: 'receipt', title: '門鎖卡住', reference: ' ' + 'A'.repeat(90) + ' ' },
    { id: 'bad', title: '寢室停電', reference: { id: 7 }, status: 'accepted' },
  ] });
  expect(repairs[0]).not.toHaveProperty('reference');
  expect(repairs[1]).toMatchObject({ reference: 'A'.repeat(80), status: 'draft' });
  expect(repairs[2]).not.toHaveProperty('reference');
  expect(repairs[2]?.status).toBe('draft');
});
