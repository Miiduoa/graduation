import { StrictMode, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  AssignmentFilePicker,
  collectLocalFiles,
  useAssignmentFilePreviews,
  type LocalAssignmentFile,
} from './AssignmentFileFields';

function Picker({ initial = [] }: { initial?: LocalAssignmentFile[] }) {
  const [files, setFiles] = useState(initial);
  const [visible, setVisible] = useState(true);
  useAssignmentFilePreviews(files);
  return (
    <>
      {visible && <AssignmentFilePicker files={files} onChange={setFiles} />}
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
});

afterEach(async () => {
  cleanup();
  await act(async () => {});
  vi.restoreAllMocks();
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
