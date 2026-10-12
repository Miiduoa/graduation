import { StrictMode, useState } from 'react';
import { renderToString } from 'react-dom/server';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmModal, Modal } from './Modal';

const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
beforeEach(() => {
  // jsdom tests React wiring only. Native focus/inert behavior is checked in Chromium.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true, writable: true,
    value: vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); }),
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true, writable: true,
    value: vi.fn(function (this: HTMLDialogElement) { this.removeAttribute('open'); }),
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

function backdropClick(dialog: HTMLElement) {
  // jsdom has a zero-size rect, so negative coordinates are outside.
  fireEvent(dialog, new MouseEvent('pointerdown', { bubbles: true, clientX: -10, clientY: -10 }));
  fireEvent.click(dialog, { clientX: -10, clientY: -10 });
}

describe('modal interaction', () => {
  it('dismisses an idle dialog only when the pointer starts and ends on its backdrop', () => {
    const close = vi.fn();
    render(<Modal isOpen title="檢視" onClose={close}>內容</Modal>);
    const dialog = screen.getByRole('dialog');
    fireEvent(dialog, new MouseEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 0 }));
    fireEvent.click(dialog, { clientX: -10, clientY: -10 });
    expect(close).not.toHaveBeenCalled();
    backdropClick(dialog);
    expect(close).toHaveBeenCalledOnce();
  });

  it('does not render a portal on the server even when initially open', () => {
    expect(renderToString(<Modal isOpen title="伺服器渲染" onClose={vi.fn()}>內容</Modal>)).toBe('');
    expect(HTMLDialogElement.prototype.showModal).not.toHaveBeenCalled();
  });

  it('names the dialog, links its description and restores the opener', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { unmount } = render(<Modal isOpen onClose={vi.fn()} title="編輯資料" description="修改後儲存">內容</Modal>);
    const dialog = screen.getByRole('dialog', { name: '編輯資料' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dialog.getAttribute('aria-describedby')!)?.textContent).toBe('修改後儲存');
    expect(screen.getByRole('button', { name: '關閉視窗' }).getAttribute('type')).toBe('button');
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('retains the scroll lock until the last open modal unmounts', () => {
    document.body.style.setProperty('overflow', 'scroll', 'important');
    const a = render(<Modal isOpen title="第一層" onClose={vi.fn()}>內容</Modal>);
    const b = render(<Modal isOpen title="第二層" onClose={vi.fn()}>內容</Modal>);
    a.unmount();
    expect(document.body.style.overflow).toBe('hidden');
    b.unmount();
    expect(document.body.style.overflow).toBe('scroll');
    expect(document.body.style.getPropertyPriority('overflow')).toBe('important');
  });

  it('does not release another modal lock when a closed modal rerenders', () => {
    const opened = render(<Modal isOpen title="保留" onClose={vi.fn()}>內容</Modal>);
    const closed = render(<Modal isOpen={false} onClose={vi.fn()}>內容</Modal>);
    closed.rerender(<Modal isOpen={false} onClose={vi.fn()}>其他內容</Modal>);
    closed.unmount();
    expect(document.body.style.overflow).toBe('hidden');
    opened.unmount();
  });

  it('handles Escape only on the innermost dialog', () => {
    const parentClose = vi.fn();
    const childClose = vi.fn();
    render(<Modal isOpen title="父視窗" onClose={parentClose}><Modal isOpen title="子視窗" onClose={childClose}>內容</Modal></Modal>);
    const event = new Event('cancel', { bubbles: false, cancelable: true });
    fireEvent(screen.getByRole('dialog', { name: '子視窗' }), event);
    expect(event.defaultPrevented).toBe(true);
    expect(childClose).toHaveBeenCalledOnce();
    expect(parentClose).not.toHaveBeenCalled();
  });

  it('ignores queued close events while the same dialog is open again', () => {
    const close = vi.fn();
    render(<StrictMode><Modal isOpen title="編輯" onClose={close}>內容</Modal></StrictMode>);
    fireEvent(screen.getByRole('dialog', { name: '編輯' }), new Event('close'));
    expect(close).not.toHaveBeenCalled();
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('retains its contents and does not reopen when the close callback changes', () => {
    const { rerender } = render(<Modal isOpen onClose={vi.fn()} title="草稿"><input aria-label="內容" defaultValue="保留" /></Modal>);
    const count = vi.mocked(HTMLDialogElement.prototype.showModal).mock.calls.length;
    rerender(<Modal isOpen onClose={vi.fn()} title="草稿"><input aria-label="內容" defaultValue="保留" /></Modal>);
    expect((screen.getByRole('textbox', { name: '內容' }) as HTMLInputElement).value).toBe('保留');
    expect(vi.mocked(HTMLDialogElement.prototype.showModal).mock.calls.length).toBe(count);
  });
});

describe('confirmation safety', () => {
  it('starts on cancel and does not submit an enclosing form', () => {
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(<form onSubmit={submit}><ConfirmModal isOpen title="移除資料" message="這個操作無法復原。" onConfirm={vi.fn()} onClose={vi.fn()} /></form>);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '取消' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(submit).not.toHaveBeenCalled();
  });

  it('blocks Escape, backdrop dismissal and repeated confirmation until the promise settles', async () => {
    let resolve!: () => void;
    const confirm = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    const close = vi.fn();
    render(<ConfirmModal isOpen title="確認操作" message="即將送出。" onConfirm={confirm} onClose={close} />);
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    fireEvent.click(screen.getByRole('button', { name: '處理中…' }));
    const dialog = screen.getByRole('dialog', { name: '確認操作' });
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    backdropClick(dialog);
    expect(confirm).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toContain('請勿重複送出');
    await act(async () => { resolve(); });
    expect((screen.getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(false);
    expect(close).not.toHaveBeenCalled();
  });

  it('also respects loading controlled by the parent', () => {
    const close = vi.fn();
    const confirm = vi.fn();
    render(<ConfirmModal isOpen loading title="正在送出" message="內容" onConfirm={confirm} onClose={close} />);
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    fireEvent.click(screen.getByRole('button', { name: '處理中…' }));
    expect(close).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('handles rejection without falsely saying the server rejected the operation', async () => {
    const confirm = vi.fn().mockRejectedValue(new Error('network response lost'));
    render(<ConfirmModal isOpen title="確認" message="內容" onConfirm={confirm} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('無法確認操作結果'));
    expect(screen.queryByText('network response lost')).toBeNull();
    expect((screen.getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('does not carry a late failure into a newly opened confirmation', async () => {
    let reject!: (error: Error) => void;
    const confirm = () => new Promise<void>((_, fail) => { reject = fail; });
    function Harness() {
      const [open, setOpen] = useState(true);
      return <><button onClick={() => setOpen((value) => !value)}>切換</button><ConfirmModal isOpen={open} title="操作" message="內容" onConfirm={confirm} onClose={() => setOpen(false)} /></>;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    fireEvent.click(screen.getByRole('button', { name: '切換' }));
    fireEvent.click(screen.getByRole('button', { name: '切換' }));
    await act(async () => { reject(new Error('late response')); });
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByRole('button', { name: '確認' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
