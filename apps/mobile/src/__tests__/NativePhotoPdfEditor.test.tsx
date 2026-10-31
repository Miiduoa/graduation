import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { NativePhotoPdfEditor } from '../screens/nuni/NativePhotoPdfEditor';
import { pickPhotoPdfFiles } from '../screens/nuni/assignmentFileSubmit';
import { buildNativePhotoPdf } from '../screens/nuni/nativePhotoPdf';
jest.mock('../state/theme', () => ({ useTheme: () => require('../ui/theme').theme }));
jest.mock('../screens/nuni/assignmentFileSubmit', () => ({ pickPhotoPdfFiles: jest.fn() }));
jest.mock('../screens/nuni/nativePhotoPdf', () => ({
  buildNativePhotoPdf: jest.fn(),
  validateNativePhotoPages: jest.fn(async () => {}),
}));
const file = (name: string) => ({
  key: name,
  uri: name,
  name,
  kind: 'image' as const,
  contentType: 'image/jpeg',
  byteSize: 12,
});
beforeEach(() => jest.clearAllMocks());

test('edits pages, previews and confirms only the generated file', async () => {
  jest.mocked(pickPhotoPdfFiles).mockResolvedValue([file('a'), file('b'), file('c')]);
  const output = { ...file('作業照片.pdf'), kind: 'file' as const, contentType: 'application/pdf' };
  const dispose = jest.fn();
  jest
    .mocked(buildNativePhotoPdf)
    .mockResolvedValue({ file: output, previews: ['b-rotated', 'a'], dispose });
  const confirm = jest.fn();
  const view = render(<NativePhotoPdfEditor onConfirm={confirm} onCancel={jest.fn()} />);
  expect(view.queryByText('確認，加入待繳附件')).toBeNull();
  fireEvent.press(view.getByText('選照片'));
  await view.findByText('第 3 頁');
  fireEvent.press(view.getAllByText('下移')[0]);
  fireEvent.press(view.getAllByText('向右轉 90°')[0]);
  fireEvent.press(view.getAllByText('刪頁')[2]);
  fireEvent.press(view.getByText('預覽 PDF 頁面'));
  await view.findByText('確認，加入待繳附件');
  expect(
    jest.mocked(buildNativePhotoPdf).mock.calls[0][0].map((p) => [p.file.name, p.rotation]),
  ).toEqual([
    ['b', 90],
    ['a', 0],
  ]);
  expect(confirm).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('放大第 1 頁'));
  const initial = view.getByLabelText('放大頁面').props.style.width;
  fireEvent.press(view.getByText('放大'));
  expect(view.getByLabelText('放大頁面').props.style.width).toBeGreaterThan(initial);
  fireEvent.press(view.getByText('關閉放大預覽'));
  fireEvent.press(view.getByText('確認，加入待繳附件'));
  expect(confirm).toHaveBeenCalledWith(output);
  expect(dispose).toHaveBeenCalledWith(true);
});

test('cancel never adds a file and oversized generation cannot be confirmed', async () => {
  jest.mocked(pickPhotoPdfFiles).mockResolvedValue([file('a')]);
  jest.mocked(buildNativePhotoPdf).mockRejectedValue(new Error('too large'));
  const confirm = jest.fn();
  const cancel = jest.fn();
  const view = render(<NativePhotoPdfEditor onConfirm={confirm} onCancel={cancel} />);
  fireEvent.press(view.getByText('選照片'));
  await view.findByText('第 1 頁');
  fireEvent.press(view.getByText('預覽 PDF 頁面'));
  await view.findByText(/20 MiB/);
  expect(view.queryByText('確認，加入待繳附件')).toBeNull();
  fireEvent.press(view.getByText('取消製作'));
  expect(cancel).toHaveBeenCalled();
  expect(confirm).not.toHaveBeenCalled();
});

test('取消或卸載會通知進行中的轉檔停止', async () => {
  jest.mocked(pickPhotoPdfFiles).mockResolvedValue([file('a')]);
  jest.mocked(buildNativePhotoPdf).mockImplementation(() => new Promise(() => {}));
  const view = render(<NativePhotoPdfEditor onConfirm={jest.fn()} onCancel={jest.fn()} />);
  fireEvent.press(view.getByText('選照片'));
  await view.findByText('第 1 頁');
  fireEvent.press(view.getByText('預覽 PDF 頁面'));
  const signal = jest.mocked(buildNativePhotoPdf).mock.calls[0][1];
  fireEvent.press(view.getByText('取消製作'));
  expect(signal?.aborted).toBe(true);
  view.unmount();
});
