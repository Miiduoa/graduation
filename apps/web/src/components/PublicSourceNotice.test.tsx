import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PublicSourceNotice } from './PublicSourceNotice';
afterEach(cleanup);

it('無來源與日期時給出查核下一步，不顯示假的官方入口', () => {
  render(<PublicSourceNotice officialUrl="javascript:alert(1)" />);
  expect(screen.getByText('未提供，尚無法確認資料出處')).toBeTruthy();
  expect(screen.getByText('未提供')).toBeTruthy();
  expect(screen.getByText(/請從學校官網查找聯絡方式/)).toBeTruthy();
  expect(screen.queryByRole('link')).toBeNull();
});
it('呈現過期與無效日期', () => {
  const view = render(<PublicSourceNotice confirmedAt="2020-01-01" expired />);
  expect(screen.getByText(/已超過更新提醒期限/)).toBeTruthy();
  view.rerender(<PublicSourceNotice confirmedAt="2026-02-30" />);
  expect(screen.getByText('未提供（日期無法確認）')).toBeTruthy();
});
it('外站無法開啟時可複製網址，失敗仍保留可手動複製的地址', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  render(<PublicSourceNotice sourceLabel="校方名錄" officialUrl="https://school.example/" />);
  expect(screen.getByRole('link').getAttribute('rel')).toBe('noopener noreferrer');
  fireEvent.click(screen.getByText('官方網站開不了？'));
  fireEvent.click(screen.getByRole('button', { name: '複製官方網址' }));
  expect(await screen.findByText('已複製網址，可貼到瀏覽器開啟。')).toBeTruthy();
  expect(writeText).toHaveBeenCalledWith('https://school.example/');
  writeText.mockRejectedValueOnce(new Error('denied'));
  fireEvent.click(screen.getByRole('button', { name: '複製官方網址' }));
  expect(await screen.findByText(/無法自動複製，請選取下方網址/)).toBeTruthy();
  expect(screen.getByText('https://school.example/')).toBeTruthy();
});
