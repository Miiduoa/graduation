import { expect, it } from 'vitest';
import { publicSourceStatus, publicSourceUrl } from './publicSourceStatus';

const now = Date.parse('2026-11-01T00:00:00Z');
it.each([undefined, '', ' '])('缺少時間不宣稱已更新：%s', (date) => {
  expect(publicSourceStatus(date, false, now).date).toBe('未提供');
});
it.each(['bad', '2026-02-30', '2026-13-01', '2027-01-01', '2026-10-20T10:00:00'])(
  '拒絕無法確認的日期：%s',
  (date) => {
    expect(publicSourceStatus(date, false, now).date).toContain('日期無法確認');
  },
);
it('以台灣日期顯示並保留過期警示', () => {
  expect(publicSourceStatus('2026-10-24T18:00:00Z', true, now)).toEqual({
    date: '2026/10/25',
    message: '資料已超過更新提醒期限，請先向官方確認。',
  });
  expect(publicSourceStatus('2026-10-24', false, now).message).toContain('資料快照');
});
it.each(['javascript:alert(1)', 'https://user:secret@example.com', '/relative', undefined])(
  '不提供不安全的入口：%s',
  (url) => {
    expect(publicSourceUrl(url)).toBeNull();
  },
);
it('保留官方 http 網站', () => {
  expect(publicSourceUrl('http://www.pu.edu.tw')).toBe('http://www.pu.edu.tw');
});
