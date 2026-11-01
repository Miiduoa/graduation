import { StrictMode, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportPostDialog } from './ReportPostDialog';

const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    writable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    }),
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    writable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    }),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShow);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
  document.body.style.removeProperty('overflow');
});

function chooseReason(label: string) {
  fireEvent.change(screen.getByLabelText('檢舉原因'), { target: { value: label } });
}

function fillDetail(text: string) {
  fireEvent.change(screen.getByLabelText('補充說明（選填）'), { target: { value: text } });
}

describe('ReportPostDialog', () => {
  it('取消不送出', () => {
    const submit = vi.fn();
    const close = vi.fn();
    render(<ReportPostDialog isOpen onClose={close} onSubmit={submit} />);
    chooseReason('垃圾訊息');
    fillDetail('這是垃圾');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(submit).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it('連點送出只呼叫一次', async () => {
    let resolve!: () => void;
    const submit = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    render(<ReportPostDialog isOpen onClose={vi.fn()} onSubmit={submit} />);
    chooseReason('其他違規');
    fireEvent.click(screen.getByRole('button', { name: '送出檢舉' }));
    fireEvent.click(screen.getByRole('button', { name: '送出中…' }));
    fireEvent.click(screen.getByRole('button', { name: '送出中…' }));
    expect(submit).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledWith({ reason: '其他違規' });
    expect((screen.getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toContain('請勿重複點擊');
    await act(async () => {
      resolve();
    });
  });

  it('失敗時保留已選原因與補充說明並可重試', async () => {
    const submit = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(undefined);
    render(<ReportPostDialog isOpen onClose={vi.fn()} onSubmit={submit} />);
    chooseReason('騷擾或不當言行');
    fillDetail('請儘快處理');
    fireEvent.click(screen.getByRole('button', { name: '送出檢舉' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('這次未能檢舉'),
    );
    expect((screen.getByLabelText('檢舉原因') as HTMLSelectElement).value).toBe('騷擾或不當言行');
    expect((screen.getByLabelText('補充說明（選填）') as HTMLTextAreaElement).value).toBe(
      '請儘快處理',
    );
    fireEvent.click(screen.getByRole('button', { name: '送出檢舉' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('已記錄你的檢舉'));
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit).toHaveBeenLastCalledWith({
      reason: '騷擾或不當言行',
      detail: '請儘快處理',
    });
  });

  it('成功後顯示完成回饋', async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn();
    render(<ReportPostDialog isOpen onClose={close} onSubmit={submit} />);
    chooseReason('垃圾訊息');
    fireEvent.click(screen.getByRole('button', { name: '送出檢舉' }));
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: '檢舉已送出' })).toBeTruthy(),
    );
    expect(screen.getByRole('status').textContent).toContain('已記錄你的檢舉');
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    expect(close).toHaveBeenCalledOnce();
  });

  it('關閉後鍵盤焦點回到原本的檢舉按鈕', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            檢舉
          </button>
          <ReportPostDialog isOpen={open} onClose={() => setOpen(false)} onSubmit={vi.fn()} />
        </>
      );
    }
    render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );
    const opener = screen.getByRole('button', { name: '檢舉' });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole('dialog', { name: '檢舉貼文' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});
