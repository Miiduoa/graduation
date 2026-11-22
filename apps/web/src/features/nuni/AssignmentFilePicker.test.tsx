import { StrictMode, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  AssignmentFilePreview,
  AssignmentFilePicker,
  collectLocalFiles,
  useAssignmentFilePreviews,
  type LocalAssignmentFile,
} from './AssignmentFileFields';

const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');

function Picker({ initial = [] }: { initial?: LocalAssignmentFile[] }) {
  const [files, setFiles] = useState(initial);
  const [reviewRequired, setReviewRequired] = useState(false);
  const [visible, setVisible] = useState(true);
  useAssignmentFilePreviews(files);
  return (
    <>
      {visible && (
        <AssignmentFilePicker
          files={files}
          onChange={setFiles}
          reviewRequired={reviewRequired}
          onReviewRequiredChange={setReviewRequired}
        />
      )}
      <button type="button" onClick={() => setFiles([])}>
        清空附件
      </button>
      <button type="button" onClick={() => setVisible((value) => !value)}>
        切換收件狀態
      </button>
    </>
  );
}

function photo(name: string) {
  return new File(['photo'], name, { type: 'image/jpeg' });
}

function addPhotos(container: HTMLElement, names: string[]) {
  const album = container.querySelector<HTMLInputElement>(
    'input[type="file"][accept="image/*"][multiple]',
  )!;
  fireEvent.change(album, { target: { files: names.map(photo) } });
}

beforeEach(() => {
  let sequence = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:assignment-${++sequence}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  // jsdom checks the application lifecycle; native focus containment and inert
  // behavior belong to the browser checks for the shared Modal.
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

afterEach(async () => {
  cleanup();
  await act(async () => {});
  vi.restoreAllMocks();
  if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShow);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
  document.body.style.removeProperty('overflow');
});

it('releases photos selected after the picker mounted when leaving the assignment', async () => {
  const view = render(<Picker />);
  addPhotos(view.container, ['作業.jpg']);
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  view.unmount();
  await act(async () => {});
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:assignment-1');
});

it('retains previews when reordering and releases only removed or cleared photos', async () => {
  const view = render(<Picker />);
  addPhotos(view.container, ['第一頁.jpg', '第二頁.jpg']);
  const list = screen.getByRole('list', { name: '即將繳交的檔案' });
  fireEvent.click(within(list).getAllByRole('button', { name: '下移' })[0]!);
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  expect(within(list).getAllByRole('listitem')[0]!.textContent).toContain('第二頁.jpg');
  fireEvent.click(within(list).getAllByRole('button', { name: '刪除' })[0]!);
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:assignment-2');
  fireEvent.click(screen.getByRole('button', { name: '清空附件' }));
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  expect(URL.revokeObjectURL).toHaveBeenLastCalledWith('blob:assignment-1');
  view.unmount();
  await act(async () => {});
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
});

it('keeps preselected photos valid through Strict Mode effect replay', async () => {
  const initial = collectLocalFiles([], [photo('已選照片.jpg')]);
  const view = render(
    <StrictMode>
      <Picker initial={initial} />
    </StrictMode>,
  );
  await act(async () => {});
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '放大預覽 已選照片.jpg' })).toBeTruthy();
  view.unmount();
  await act(async () => {});
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:assignment-1');
});

it('keeps selected photos when the assignment temporarily stops accepting submissions', async () => {
  const view = render(<Picker />);
  addPhotos(view.container, ['待繳照片.jpg']);
  fireEvent.click(screen.getByRole('button', { name: '切換收件狀態' }));
  await act(async () => {});
  expect(screen.queryByRole('list', { name: '即將繳交的檔案' })).toBeNull();
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '切換收件狀態' }));
  expect(screen.getByRole('button', { name: '放大預覽 待繳照片.jpg' })).toBeTruthy();
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  view.unmount();
  await act(async () => {});
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:assignment-1');
});

it('closes a removed photo preview and does not revive it when another photo is added', () => {
  const view = render(<Picker />);
  addPhotos(view.container, ['舊照片.jpg']);
  fireEvent.click(screen.getByRole('button', { name: '放大預覽 舊照片.jpg' }));
  expect(screen.getByRole('dialog', { name: '舊照片.jpg' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '清空附件' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  addPhotos(view.container, ['新照片.jpg']);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:assignment-1');
  fireEvent.click(screen.getByRole('button', { name: '放大預覽 新照片.jpg' }));
  expect(screen.getByRole('dialog', { name: '新照片.jpg' })).toBeTruthy();
});

it('returns to the selected photo after Escape without discarding or submitting the attachment', () => {
  const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
  const view = render(
    <form onSubmit={submit}>
      <Picker />
    </form>,
  );
  addPhotos(view.container, ['長篇作業.jpg']);
  const opener = screen.getByRole('button', { name: '放大預覽 長篇作業.jpg' });
  opener.focus();
  fireEvent.click(opener);
  const dialog = screen.getByRole('dialog', { name: '長篇作業.jpg' });
  expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce();
  expect(document.body.style.overflow).toBe('hidden');
  expect(within(dialog).getByRole('img', { name: '長篇作業.jpg' }).getAttribute('src')).toBe(
    'blob:assignment-1',
  );

  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(opener);
  expect(document.body.style.overflow).toBe('');
  expect(screen.getByRole('list', { name: '即將繳交的檔案' }).textContent).toContain(
    '長篇作業.jpg',
  );
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
});

it('allows reading and closing an attachment during submission without enabling file edits', () => {
  const change = vi.fn();
  const initial = collectLocalFiles([], [photo('待繳照片.jpg')]);
  render(<AssignmentFilePreview files={initial} onChange={change} disabled />);
  const opener = screen.getByRole('button', { name: '放大預覽 待繳照片.jpg' });
  opener.focus();
  fireEvent.click(opener);
  fireEvent.click(screen.getByRole('button', { name: '關閉預覽' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(opener);
  expect((screen.getByRole('button', { name: '刪除' }) as HTMLButtonElement).disabled).toBe(true);
  expect(change).not.toHaveBeenCalled();
});

it('lists every file that could not be added while keeping existing and accepted attachments', () => {
  const initial = collectLocalFiles(
    [],
    [new File(['first'], '原有文件.pdf', { type: 'application/pdf' })],
  );
  const view = render(<Picker initial={initial} />);
  const docs = view.container.querySelector<HTMLInputElement>(
    'input[type="file"][accept^=".pdf"]',
  )!;
  fireEvent.change(docs, {
    target: {
      files: [
        new File(['second'], '新文件.pdf', { type: 'application/pdf' }),
        new File(['third'], '超額文件.pdf', { type: 'application/pdf' }),
        new File(['executable'], '程式.exe', { type: 'application/octet-stream' }),
        new File(['mismatch'], '格式不符.jpg', { type: 'application/pdf' }),
        new File(['invalid'], '../作業.pdf', { type: 'application/pdf' }),
      ],
    },
  });

  const result = screen.getByRole('status');
  expect(result.textContent).toContain('已加入 1 個檔案。');
  expect(result.textContent).toContain('4 個未加入');
  const rejected = within(result).getByRole('list', { name: '未加入的檔案' });
  expect(rejected.textContent).toContain('超額文件.pdf：文件最多 2 個');
  expect(rejected.textContent).toContain('程式.exe：格式不支援');
  expect(rejected.textContent).toContain('格式不符.jpg：格式不支援');
  expect(rejected.textContent).toContain('../作業.pdf：檔名無法使用');
  const accepted = screen.getByRole('list', { name: '即將繳交的檔案' });
  expect(within(accepted).getAllByRole('listitem')).toHaveLength(2);
  expect(accepted.textContent).toContain('原有文件.pdf');
  expect(accepted.textContent).toContain('新文件.pdf');
  expect(accepted.textContent).not.toContain('超額文件.pdf');
  expect(docs.value).toBe('');
  expect(screen.getByRole('button', { name: '確認附件清單' })).toBeTruthy();
});

it('explains a full photo allowance and lets the same rejected photo be added after space is freed', () => {
  const view = render(<Picker />);
  addPhotos(
    view.container,
    Array.from({ length: 9 }, (_, index) => `第${index + 1}頁.jpg`),
  );
  expect(screen.getByRole('status').textContent).toContain('已加入 8 個檔案。');
  expect(screen.getByRole('status').textContent).toContain('第9頁.jpg：照片最多 8 張');
  addPhotos(view.container, ['第9頁.jpg']);
  expect(screen.getByRole('status').textContent).toContain('這次沒有加入檔案。');
  expect(URL.createObjectURL).toHaveBeenCalledTimes(8);

  const accepted = screen.getByRole('list', { name: '即將繳交的檔案' });
  fireEvent.click(within(accepted).getAllByRole('button', { name: '刪除' })[0]!);
  fireEvent.click(screen.getByRole('button', { name: '確認附件清單' }));
  addPhotos(view.container, ['第9頁.jpg']);
  expect(screen.getByRole('status').textContent).toBe('已加入 1 個檔案。');
  expect(screen.queryByRole('list', { name: '未加入的檔案' })).toBeNull();
  expect(within(accepted).getAllByRole('listitem')).toHaveLength(8);
  expect(accepted.textContent).toContain('第9頁.jpg');
  expect(accepted.textContent).not.toContain('第1頁.jpg');
});

it('keeps selected attachments when a file chooser is cancelled or only unsupported files are chosen', () => {
  const initial = collectLocalFiles([], [photo('保留.jpg')]);
  const change = vi.fn();
  const view = render(<AssignmentFilePicker files={initial} onChange={change} reviewRequired={false} onReviewRequiredChange={vi.fn()} />);
  const docs = view.container.querySelector<HTMLInputElement>(
    'input[type="file"][accept^=".pdf"]',
  )!;
  fireEvent.change(docs, { target: { files: [] } });
  expect(screen.queryByRole('status')).toBeNull();
  fireEvent.change(docs, { target: { files: [new File(['bad'], '不支援.exe')] } });
  expect(screen.getByRole('status').textContent).toContain('這次沒有加入檔案。');
  expect(change).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '放大預覽 保留.jpg' })).toBeTruthy();
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
});

it('requires review when every file is rejected or a selected file is chosen again', () => {
  const view = render(<Picker />);
  const docs = view.container.querySelector<HTMLInputElement>('input[accept^=".pdf"]')!;
  fireEvent.change(docs, { target: { files: [new File(['pdf'], 'report.pdf')] } });
  expect(screen.getByText('目前沒有待送出的附件。')).toBeTruthy();
  expect(screen.queryByRole('list', { name: '即將繳交的檔案' })).toBeNull();

  const valid = photo('same.jpg');
  const album = view.container.querySelector<HTMLInputElement>('input[type="file"][multiple][accept="image/*"]')!;
  fireEvent.change(album, { target: { files: [valid, valid] } });
  const accepted = screen.getByRole('list', { name: '即將繳交的檔案' });
  expect(within(accepted).getAllByRole('listitem')).toHaveLength(1);
  fireEvent.change(album, { target: { files: [valid] } });
  expect(screen.getByRole('status').textContent).toContain('這個檔案已在待送出清單中');
  expect(within(accepted).getAllByRole('listitem')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '確認附件清單' }));
  expect(screen.queryByRole('button', { name: '確認附件清單' })).toBeNull();
});
