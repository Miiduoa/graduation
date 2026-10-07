import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { PrintServiceScreen } from '../screens/PrintServiceScreen';
import {
  pickPrintDocument,
  previewAndPrintDocument,
  sharePrintDocument,
} from '../features/printing/documents';
import type { PrintDocument } from '../features/printing/documents';

let mockUser: { uid: string } | null = { uid: 'student-a' };
let mockSchool = { id: 'school-a', name: '目前學校' };
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: mockSchool }) }));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 80 }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../features/printing/documents', () => ({
  pickPrintDocument: jest.fn(),
  previewAndPrintDocument: jest.fn(),
  sharePrintDocument: jest.fn(),
  savePrintDocument: jest.fn(),
  documentSizeLabel: () => '1 KB',
  isDocumentActionCancelled: (error: { code?: string }) => error?.code === 'ERR_PRINT_INCOMPLETE',
  DocumentOperationError: class extends Error {},
}));
const pdf: PrintDocument = {
  name: '期末報告.pdf',
  uri: 'file:///report.pdf',
  size: 1000,
  mimeType: 'application/pdf',
  kind: 'pdf',
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { resolve, reject, promise };
}
beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { uid: 'student-a' };
  mockSchool = { id: 'school-a', name: '目前學校' };
  jest.mocked(pickPrintDocument).mockResolvedValue(pdf);
  jest.mocked(previewAndPrintDocument).mockResolvedValue();
  jest.mocked(sharePrintDocument).mockResolvedValue();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('picks and previews a real document without creating a remote job or claiming print completion', async () => {
  const view = render(<PrintServiceScreen />);
  expect(view.queryByText(/剩餘點數|環保積分|即時機器/)).toBeNull();
  await act(async () => fireEvent.press(view.getByText('選擇文件')));
  expect(view.getByText(pdf.name)).toBeTruthy();
  await act(async () => fireEvent.press(view.getByText('預覽並列印')));
  expect(previewAndPrintDocument).toHaveBeenCalledWith(pdf, expect.any(Function));
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(view.queryByText(/已送出|列印完成|獲得/)).toBeNull();
});

test('canceling a replacement picker preserves the current document', async () => {
  const view = render(<PrintServiceScreen />);
  await act(async () => fireEvent.press(view.getByText('選擇文件')));
  jest.mocked(pickPrintDocument).mockResolvedValueOnce(null);
  await act(async () => fireEvent.press(view.getByText('更換文件')));
  expect(view.getByText(pdf.name)).toBeTruthy();
});

test('image files have a visible local preview and Word files use an external document app', async () => {
  jest
    .mocked(pickPrintDocument)
    .mockResolvedValueOnce({ ...pdf, name: '照片.png', mimeType: 'image/png', kind: 'image' });
  const view = render(<PrintServiceScreen />);
  await act(async () => fireEvent.press(view.getByText('選擇文件')));
  expect(view.getByLabelText('文件預覽：照片.png')).toBeTruthy();
  jest
    .mocked(pickPrintDocument)
    .mockResolvedValueOnce({ ...pdf, name: '報告.docx', kind: 'office' });
  await act(async () => fireEvent.press(view.getByText('更換文件')));
  expect(view.queryByText('預覽並列印')).toBeNull();
  await act(async () => fireEvent.press(view.getByText('用其他 App 開啟或分享')));
  expect(sharePrintDocument).toHaveBeenCalledWith(
    expect.objectContaining({ kind: 'office' }),
    expect.any(Function),
  );
});

test('double taps cannot open duplicate print dialogs', async () => {
  const print = deferred<void>();
  jest.mocked(previewAndPrintDocument).mockReturnValueOnce(print.promise);
  const view = render(<PrintServiceScreen />);
  await act(async () => fireEvent.press(view.getByText('選擇文件')));
  fireEvent.press(view.getByText('預覽並列印'));
  fireEvent.press(view.getByText('預覽並列印'));
  expect(previewAndPrintDocument).toHaveBeenCalledTimes(1);
  await act(async () => print.resolve());
});

test('canceling the native print dialog produces no failure or success alert', async () => {
  jest.mocked(previewAndPrintDocument).mockRejectedValueOnce({ code: 'ERR_PRINT_INCOMPLETE' });
  const view = render(<PrintServiceScreen />);
  await act(async () => fireEvent.press(view.getByText('選擇文件')));
  await act(async () => fireEvent.press(view.getByText('預覽並列印')));
  expect(Alert.alert).not.toHaveBeenCalled();
});

test('a print failure can be retried without inventing a sent job', async () => {
  jest.mocked(previewAndPrintDocument).mockRejectedValueOnce(new Error('cannot load file'));
  const view = render(<PrintServiceScreen />);
  await act(async () => fireEvent.press(view.getByText('選擇文件')));
  await act(async () => fireEvent.press(view.getByText('預覽並列印')));
  expect(Alert.alert).toHaveBeenCalledWith('無法開啟列印', expect.any(String));
  await act(async () => fireEvent.press(view.getByText('預覽並列印')));
  expect(previewAndPrintDocument).toHaveBeenCalledTimes(2);
});

test('switching schools clears the old selection and ignores the late picker result', async () => {
  const selected = deferred<PrintDocument | null>();
  const view = render(<PrintServiceScreen />);
  await act(async () => fireEvent.press(view.getByText('選擇文件')));
  jest.mocked(pickPrintDocument).mockReturnValueOnce(selected.promise);
  fireEvent.press(view.getByText('更換文件'));
  mockSchool = { id: 'school-b', name: '另一間學校' };
  view.rerender(<PrintServiceScreen />);
  expect(view.queryByText(pdf.name)).toBeNull();
  await act(async () => selected.resolve({ ...pdf, name: '舊帳號文件.pdf' }));
  expect(view.queryByText('舊帳號文件.pdf')).toBeNull();
});

test('logout hides the file immediately and invalidates asynchronous document handoffs', async () => {
  const print = deferred<void>();
  jest.mocked(previewAndPrintDocument).mockReturnValueOnce(print.promise);
  const view = render(<PrintServiceScreen />);
  await act(async () => fireEvent.press(view.getByText('選擇文件')));
  fireEvent.press(view.getByText('預覽並列印'));
  const isCurrent = jest.mocked(previewAndPrintDocument).mock.calls[0][1];
  mockUser = null;
  view.rerender(<PrintServiceScreen />);
  expect(view.queryByText(pdf.name)).toBeNull();
  expect(isCurrent()).toBe(false);
  await act(async () => print.reject(new Error('old failure')));
  expect(Alert.alert).not.toHaveBeenCalled();
});
