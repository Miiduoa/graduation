// @vitest-environment-options {"url":"http://localhost"}
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PhotoPdfEditor } from './PhotoPdfEditor';
import { buildPhotoPdf } from './photoPdf';
vi.mock('./photoPdf', () => ({ buildPhotoPdf: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
function select(files: File[]) {
  fireEvent.change(screen.getByLabelText('選擇 PDF 照片'), { target: { files } });
}
function photo(name: string) {
  return new File(['pixels'], name, { type: 'image/jpeg' });
}

it('requires preview, keeps the edited order and rotation, then adds the exact PDF without submitting', async () => {
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => `blob:${(blob as File).name}`);
  const file = new File(['%PDF-1.4'], '作業照片.pdf', { type: 'application/pdf' });
  vi.mocked(buildPhotoPdf).mockResolvedValue(file);
  const confirm = vi.fn();
  render(<PhotoPdfEditor onConfirm={confirm} onCancel={vi.fn()} />);
  expect(screen.queryByText('確認，加入待繳附件')).toBeNull();
  select([photo('a.jpg'), photo('b.jpg'), photo('c.jpg')]);
  fireEvent.click(screen.getAllByText('下移')[0]);
  fireEvent.click(screen.getAllByText('向右轉 90°')[0]);
  fireEvent.click(screen.getAllByText('刪頁')[2]);
  fireEvent.click(screen.getByText('預覽 PDF'));
  await screen.findByText('確認，加入待繳附件');
  expect(vi.mocked(buildPhotoPdf).mock.calls[0][0].map((p) => [p.file.name, p.rotation])).toEqual([
    ['b.jpg', 90],
    ['a.jpg', 0],
  ]);
  expect(confirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('確認，加入待繳附件'));
  expect(confirm.mock.calls[0][0] === file).toBe(true);
});

it('invalidates the proof after editing, rejects a ninth photo and cancels without adding', async () => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:photo');
  vi.mocked(buildPhotoPdf).mockResolvedValue(new File(['pdf'], '作業照片.pdf'));
  const confirm = vi.fn();
  const cancel = vi.fn();
  render(<PhotoPdfEditor onConfirm={confirm} onCancel={cancel} />);
  select(Array.from({ length: 9 }, (_, i) => photo(`${i}.jpg`)));
  expect(screen.getByRole('alert').textContent).toContain('最多 8 頁');
  select([photo('a.jpg')]);
  fireEvent.click(screen.getByText('預覽 PDF'));
  await screen.findByText('確認，加入待繳附件');
  fireEvent.click(screen.getByText('向右轉 90°'));
  expect(screen.queryByTitle('作業 PDF 預覽')).toBeNull();
  fireEvent.click(screen.getByText('取消製作'));
  expect(cancel).toHaveBeenCalledOnce();
  expect(confirm).not.toHaveBeenCalled();
});

it('blocks confirmation when generation exceeds the document limit', async () => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:photo');
  vi.mocked(buildPhotoPdf).mockRejectedValue(new Error('too large'));
  render(<PhotoPdfEditor onConfirm={vi.fn()} onCancel={vi.fn()} />);
  select([photo('a.jpg')]);
  fireEvent.click(screen.getByText('預覽 PDF'));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('20 MiB'));
  expect(screen.queryByText('確認，加入待繳附件')).toBeNull();
});
