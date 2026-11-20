import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { NativePhotoPdfEditor } from '../screens/nuni/NativePhotoPdfEditor';
import { pickPhotoPdfFiles, releasePhotoPdfFiles } from '../screens/nuni/assignmentFileSubmit';
import { buildNativePhotoPdf } from '../screens/nuni/nativePhotoPdf';
jest.mock('../state/theme', () => ({ useTheme: () => require('../ui/theme').theme }));
jest.mock('../screens/nuni/assignmentFileSubmit', () => ({
  pickPhotoPdfFiles: jest.fn(),
  releasePhotoPdfFiles: jest.fn(),
}));
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

test('刪頁與成功加入即釋放來源，保留成品', async () => {
  const a = file('a'),
    b = file('b');
  jest.mocked(pickPhotoPdfFiles).mockResolvedValue([a, b]);
  const dispose = jest.fn();
  jest
    .mocked(buildNativePhotoPdf)
    .mockResolvedValue({ file: file('output'), previews: [], dispose });
  const view = render(<NativePhotoPdfEditor onConfirm={jest.fn()} onCancel={jest.fn()} />);
  fireEvent.press(view.getByText('選照片'));
  await view.findByText('第 2 頁');
  fireEvent.press(view.getAllByText('刪頁')[0]);
  expect(releasePhotoPdfFiles).toHaveBeenCalledWith([a]);
  fireEvent.press(view.getByText('預覽 PDF 頁面'));
  await view.findByText('確認，加入待繳附件');
  fireEvent.press(view.getByText('確認，加入待繳附件'));
  expect(releasePhotoPdfFiles).toHaveBeenCalledWith([b]);
  expect(dispose).toHaveBeenCalledWith(true);
});

test.each(['取消', '卸載'])('%s等待轉檔結束才釋放來源', async (action) => {
  const a = file('a');
  jest.mocked(pickPhotoPdfFiles).mockResolvedValue([a]);
  let reject!: (error: Error) => void;
  jest.mocked(buildNativePhotoPdf).mockImplementation(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  const view = render(<NativePhotoPdfEditor onConfirm={jest.fn()} onCancel={jest.fn()} />);
  fireEvent.press(view.getByText('選照片'));
  await view.findByText('第 1 頁');
  fireEvent.press(view.getByText('預覽 PDF 頁面'));
  jest.mocked(releasePhotoPdfFiles).mockClear();
  if (action === '取消') fireEvent.press(view.getByText('取消製作'));
  else view.unmount();
  expect(releasePhotoPdfFiles).not.toHaveBeenCalled();
  await act(async () => reject(new Error('stopped')));
  expect(releasePhotoPdfFiles).toHaveBeenCalledWith([a]);
});

test.each(['預檢', '超頁數', '離開後返回'])('%s拒絕時釋放新副本', async (reason) => {
  const files = Array.from({ length: reason === '超頁數' ? 9 : 1 }, (_, i) => file(String(i)));
  let resolve!: (files: ReturnType<typeof file>[]) => void;
  jest.mocked(pickPhotoPdfFiles).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { validateNativePhotoPages } = require('../screens/nuni/nativePhotoPdf');
  if (reason === '預檢') validateNativePhotoPages.mockRejectedValueOnce(new Error('invalid'));
  const view = render(<NativePhotoPdfEditor onConfirm={jest.fn()} onCancel={jest.fn()} />);
  fireEvent.press(view.getByText('選照片'));
  if (reason === '離開後返回') view.unmount();
  await act(async () => resolve(files));
  await waitFor(() => expect(releasePhotoPdfFiles).toHaveBeenCalledWith(files));
});

test('轉檔失敗即釋放來源並清空頁面', async () => {
  const a = file('a');
  jest.mocked(pickPhotoPdfFiles).mockResolvedValue([a]);
  jest.mocked(buildNativePhotoPdf).mockRejectedValue(new Error('synthetic failure'));
  const view = render(<NativePhotoPdfEditor onConfirm={jest.fn()} onCancel={jest.fn()} />);
  fireEvent.press(view.getByText('選照片'));
  await view.findByText('第 1 頁');
  fireEvent.press(view.getByText('預覽 PDF 頁面'));
  await view.findByText(/synthetic failure/);
  expect(releasePhotoPdfFiles).toHaveBeenCalledWith([a]);
  expect(view.queryByText('第 1 頁')).toBeNull();
});

test('預檢途中離開會等讀取完成再清除所有來源', async () => {
  const a = file('a'),
    b = file('b');
  jest.mocked(pickPhotoPdfFiles).mockResolvedValueOnce([a]).mockResolvedValueOnce([b]);
  const { validateNativePhotoPages } = require('../screens/nuni/nativePhotoPdf');
  validateNativePhotoPages.mockResolvedValueOnce(undefined);
  let finish!: () => void;
  validateNativePhotoPages.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<NativePhotoPdfEditor onConfirm={jest.fn()} onCancel={jest.fn()} />);
  fireEvent.press(view.getByText('選照片'));
  await view.findByText('第 1 頁');
  fireEvent.press(view.getByText('選照片'));
  await waitFor(() => expect(finish).toBeDefined());
  jest.mocked(releasePhotoPdfFiles).mockClear();
  view.unmount();
  expect(releasePhotoPdfFiles).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(releasePhotoPdfFiles).toHaveBeenCalledWith([a]);
  expect(releasePhotoPdfFiles).toHaveBeenCalledWith([b]);
});

test.each(['取消', '卸載'])('未轉檔時%s立即釋放來源', async (action) => {
  const a = file('a');
  jest.mocked(pickPhotoPdfFiles).mockResolvedValue([a]);
  const view = render(<NativePhotoPdfEditor onConfirm={jest.fn()} onCancel={jest.fn()} />);
  fireEvent.press(view.getByText('選照片'));
  await view.findByText('第 1 頁');
  jest.mocked(releasePhotoPdfFiles).mockClear();
  if (action === '取消') fireEvent.press(view.getByText('取消製作'));
  else view.unmount();
  expect(releasePhotoPdfFiles).toHaveBeenCalledWith([a]);
});
