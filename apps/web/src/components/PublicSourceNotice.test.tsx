import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PublicSourceNotice } from './PublicSourceNotice';
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
afterEach(() => {
  cleanup();
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
});

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function clipboard(writeText: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
}

const copyButton = () => screen.getByRole<HTMLButtonElement>('button', { name: '複製官方網址' });

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

it('複製中阻止同步連點，保留網址並顯示處理狀態', async () => {
  const request = deferred();
  const writeText = vi.fn().mockReturnValue(request.promise);
  clipboard(writeText);
  render(<PublicSourceNotice officialUrl="https://school.example/" />);
  act(() => {
    copyButton().click();
    copyButton().click();
  });
  expect(writeText).toHaveBeenCalledTimes(1);
  expect(copyButton().disabled).toBe(true);
  expect(copyButton().getAttribute('aria-busy')).toBe('true');
  expect(screen.getByRole('status').textContent).toBe('正在複製網址…');
  expect(screen.getByText('https://school.example/')).toBeTruthy();
  await act(async () => request.resolve());
  expect(copyButton().disabled).toBe(false);
  expect(copyButton().getAttribute('aria-busy')).toBe('false');
  expect(screen.getByRole('status').textContent).toBe('已複製網址，可貼到瀏覽器開啟。');
});

it('再次複製立刻清除舊成功，真正失敗顯示手動備援並可重試', async () => {
  const request = deferred();
  const writeText = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockReturnValueOnce(request.promise)
    .mockResolvedValue(undefined);
  clipboard(writeText);
  render(<PublicSourceNotice officialUrl="https://school.example/" />);
  await act(async () => fireEvent.click(copyButton()));
  expect(screen.getByRole('status').textContent).toMatch(/已複製網址/);
  fireEvent.click(copyButton());
  expect(screen.queryByText('已複製網址，可貼到瀏覽器開啟。')).toBeNull();
  expect(screen.getByRole('status').textContent).toBe('正在複製網址…');
  await act(async () => request.reject(new Error('denied')));
  expect(screen.getByRole('status').textContent).toMatch(/無法自動複製/);
  expect(screen.getByText('https://school.example/')).toBeTruthy();
  expect(copyButton().disabled).toBe(false);
  await act(async () => fireEvent.click(copyButton()));
  expect(writeText).toHaveBeenCalledTimes(3);
  expect(screen.getByRole('status').textContent).toMatch(/已複製網址/);
});

it.each(['missing', 'throws'])('剪貼簿 %s 時仍可手動複製且不鎖住操作', async (mode) => {
  if (mode === 'missing') {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  } else
    clipboard(
      vi.fn(() => {
        throw new Error('blocked');
      }),
    );
  render(<PublicSourceNotice officialUrl="https://school.example/" />);
  await act(async () => fireEvent.click(copyButton()));
  expect(screen.getByRole('status').textContent).toMatch(/無法自動複製/);
  expect(screen.getByText('https://school.example/')).toBeTruthy();
  expect(copyButton().disabled).toBe(false);
});

it('同一來源重新渲染時不解鎖尚未完成的複製', async () => {
  const request = deferred();
  const writeText = vi.fn().mockReturnValue(request.promise);
  clipboard(writeText);
  const view = render(
    <PublicSourceNotice officialUrl="https://school.example/" sourceLabel="校方" />,
  );
  fireEvent.click(copyButton());
  view.rerender(
    <PublicSourceNotice officialUrl="https://school.example/" sourceLabel="校方名錄" />,
  );
  fireEvent.click(copyButton());
  expect(writeText).toHaveBeenCalledTimes(1);
  expect(copyButton().disabled).toBe(true);
  await act(async () => request.resolve());
  expect(copyButton().disabled).toBe(false);
});

it.each(['resolve', 'reject'])('換頁後舊複製 %s 不影響新頁的忙碌狀態', async (outcome) => {
  const previous = deferred();
  const current = deferred();
  const writeText = vi
    .fn()
    .mockReturnValueOnce(previous.promise)
    .mockReturnValueOnce(current.promise);
  clipboard(writeText);
  const view = render(
    <div>
      <PublicSourceNotice key="a" officialUrl="https://school-a.example/" />
    </div>,
  );
  fireEvent.click(copyButton());
  view.rerender(
    <div>
      <PublicSourceNotice key="b" officialUrl="https://school-b.example/" />
    </div>,
  );
  fireEvent.click(copyButton());
  await act(async () => {
    if (outcome === 'resolve') previous.resolve();
    else previous.reject(new Error('old failure'));
  });
  expect(copyButton().disabled).toBe(true);
  expect(screen.getByRole('status').textContent).toBe('正在複製網址…');
  fireEvent.click(copyButton());
  expect(writeText).toHaveBeenCalledTimes(2);
  await act(async () => current.resolve());
  expect(copyButton().disabled).toBe(false);
  expect(screen.getByRole('status').textContent).toMatch(/已複製網址/);
  expect(writeText).toHaveBeenLastCalledWith('https://school-b.example/');
});

it.each(['success', 'failure'])('新頁 %s 完成後，舊頁晚到結果不能覆寫提示', async (latest) => {
  const previous = deferred();
  const current = deferred();
  const writeText = vi
    .fn()
    .mockReturnValueOnce(previous.promise)
    .mockReturnValueOnce(current.promise);
  clipboard(writeText);
  const view = render(
    <div>
      <PublicSourceNotice key="a" officialUrl="https://school-a.example/" />
    </div>,
  );
  fireEvent.click(copyButton());
  view.rerender(
    <div>
      <PublicSourceNotice key="b" officialUrl="https://school-b.example/" />
    </div>,
  );
  fireEvent.click(copyButton());
  await act(async () => {
    if (latest === 'success') current.resolve();
    else current.reject(new Error('current failure'));
  });
  const message = screen.getByRole('status').textContent;
  expect(message).toMatch(latest === 'success' ? /已複製網址/ : /無法自動複製/);
  await act(async () => {
    if (latest === 'success') previous.reject(new Error('old failure'));
    else previous.resolve();
  });
  expect(screen.getByRole('status').textContent).toBe(message);
  expect(copyButton().disabled).toBe(false);
});
