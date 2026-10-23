import { Platform } from 'react-native';
import * as Picker from 'expo-document-picker';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { File } from 'expo-file-system';
import {
  pickPrintDocument,
  previewAndPrintDocument,
  sharePrintDocument,
  savePrintDocument,
  MAX_DOCUMENT_BYTES,
  type PrintDocument,
} from '../features/printing/documents';

const mockBase64 = jest.fn();
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-print', () => ({ printAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: jest.fn() }));
const pdf: PrintDocument = {
  name: '報告.pdf',
  uri: 'file:///cache/report.pdf',
  mimeType: 'application/pdf',
  kind: 'pdf',
  size: 100,
};
const originalPlatform = Platform.OS;
function picked(overrides = {}) {
  jest.mocked(Picker.getDocumentAsync).mockResolvedValue({
    canceled: false,
    assets: [
      {
        name: pdf.name,
        uri: pdf.uri,
        size: 100,
        mimeType: 'application/pdf',
        lastModified: 1,
        ...overrides,
      },
    ],
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  jest
    .mocked(File)
    .mockImplementation((uri) => ({ uri, exists: true, size: 100, base64: mockBase64 }) as never);
  mockBase64.mockResolvedValue('cGhvdG8=');
  jest.mocked(Print.printAsync).mockResolvedValue();
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(true);
  jest.mocked(Sharing.shareAsync).mockResolvedValue();
  picked();
});
afterEach(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform });
  jest.restoreAllMocks();
});

test('selects a cached local document and cancellation keeps the current selection untouched', async () => {
  await expect(pickPrintDocument()).resolves.toMatchObject(pdf);
  expect(Picker.getDocumentAsync).toHaveBeenCalledWith(
    expect.objectContaining({ copyToCacheDirectory: true, multiple: false, base64: false }),
  );
  jest.mocked(Picker.getDocumentAsync).mockResolvedValueOnce({ canceled: true, assets: null });
  await expect(pickPrintDocument()).resolves.toBeNull();
});

test.each([
  { size: MAX_DOCUMENT_BYTES + 1 },
  { mimeType: 'text/html', name: 'disguised.pdf' },
  { uri: 'https://example.test/report.pdf' },
])('rejects oversized, active-content and remote inputs: %j', async (asset) => {
  picked(asset);
  await expect(pickPrintDocument()).rejects.toThrow();
  expect(Print.printAsync).not.toHaveBeenCalled();
});

test('uses the filename when a document provider omits its MIME type', async () => {
  picked({ mimeType: undefined, name: 'REPORT.PDF' });
  await expect(pickPrintDocument()).resolves.toMatchObject({
    kind: 'pdf',
    mimeType: 'application/pdf',
  });
});

test('prints the actual selected PDF through the native print dialog', async () => {
  await previewAndPrintDocument(pdf, () => true);
  expect(Print.printAsync).toHaveBeenCalledWith({ uri: pdf.uri });
  expect(mockBase64).not.toHaveBeenCalled();
});

test('embeds image bytes for native printing instead of passing an unsupported image URI', async () => {
  await previewAndPrintDocument(
    { ...pdf, uri: 'file:///photo.png', kind: 'image', mimeType: 'image/png' },
    () => true,
  );
  expect(Print.printAsync).toHaveBeenCalledWith({
    html: expect.stringContaining('data:image/png;base64,cGhvdG8='),
  });
});

test('an account change while loading image bytes prevents opening a native print dialog', async () => {
  const read = deferred<string>();
  mockBase64.mockReturnValueOnce(read.promise);
  let current = true;
  const pending = previewAndPrintDocument(
    { ...pdf, kind: 'image', mimeType: 'image/png' },
    () => current,
  );
  current = false;
  read.resolve('cGhvdG8=');
  await pending;
  expect(Print.printAsync).not.toHaveBeenCalled();
});

test('missing files and Word files are not sent to the PDF-only native printer', async () => {
  jest.mocked(File).mockImplementationOnce(() => ({ exists: false }) as never);
  await expect(previewAndPrintDocument(pdf, () => true)).rejects.toThrow('找不到');
  await expect(previewAndPrintDocument({ ...pdf, kind: 'office' }, () => true)).rejects.toThrow(
    'Word',
  );
  expect(Print.printAsync).not.toHaveBeenCalled();
});

test('shares the file rather than its inaccessible local path as text', async () => {
  await sharePrintDocument(pdf, () => true);
  expect(Sharing.shareAsync).toHaveBeenCalledWith(
    pdf.uri,
    expect.objectContaining({ mimeType: 'application/pdf' }),
  );
});

test('a stale share availability response cannot share an old account document', async () => {
  const ready = deferred<boolean>();
  jest.mocked(Sharing.isAvailableAsync).mockReturnValueOnce(ready.promise);
  let current = true;
  const pending = sharePrintDocument(pdf, () => current);
  current = false;
  ready.resolve(true);
  await pending;
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
});

test('web preview opens only the selected document, never expo-print which prints the app page', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  URL.createObjectURL = jest.fn(() => 'blob:selected-pdf');
  URL.revokeObjectURL = jest.fn();
  const preview = { opener: window };
  jest.spyOn(window, 'open').mockReturnValue(preview as never);
  const browserFile = new window.File(['%PDF'], pdf.name, { type: 'application/pdf' });
  await previewAndPrintDocument({ ...pdf, browserFile }, () => true);
  expect(window.open).toHaveBeenCalledWith('blob:selected-pdf', '_blank');
  expect(preview.opener).toBeNull();
  expect(Print.printAsync).not.toHaveBeenCalled();
});

test('a blocked web preview is reported instead of claiming a document was opened', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  URL.createObjectURL = jest.fn(() => 'blob:selected-pdf');
  URL.revokeObjectURL = jest.fn();
  jest.spyOn(window, 'open').mockReturnValue(null);
  await expect(
    previewAndPrintDocument(
      { ...pdf, browserFile: new window.File(['%PDF'], pdf.name) },
      () => true,
    ),
  ).rejects.toThrow('阻擋');
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:selected-pdf');
});

test('web sharing passes file bytes, not a device-local blob URL', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  const browserFile = new window.File(['%PDF'], pdf.name);
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: jest.fn(() => true) });
  Object.defineProperty(navigator, 'share', {
    configurable: true,
    value: jest.fn().mockResolvedValue(undefined),
  });
  await sharePrintDocument({ ...pdf, browserFile }, () => true);
  expect(navigator.share).toHaveBeenCalledWith({ files: [browserFile], title: pdf.name });
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
});

test('web download preserves the selected filename and releases its temporary URL', () => {
  jest.useFakeTimers();
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  URL.createObjectURL = jest.fn(() => 'blob:download');
  URL.revokeObjectURL = jest.fn();
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    expect(this.download).toBe(pdf.name);
    expect(this.href).toBe('blob:download');
  });
  savePrintDocument({ ...pdf, browserFile: new window.File(['%PDF'], pdf.name) });
  expect(click).toHaveBeenCalledTimes(1);
  jest.runOnlyPendingTimers();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:download');
  jest.useRealTimers();
});
