import {
  pickPhotoPdfFiles,
  releasePhotoPdfFiles,
  pickAssignmentDocuments,
} from '../screens/nuni/assignmentFileSubmit';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
const mockDeleted: string[] = [];
jest.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///cache' } },
  File: class {
    exists = true;
    size = 24;
    uri: string;
    constructor(value: string) {
      this.uri = value;
    }
    delete() {
      mockDeleted.push(this.uri);
    }
  },
}));
beforeEach(() => {
  mockDeleted.length = 0;
});

test('照片選取只複製原檔，不經相簿解碼或重編碼', async () => {
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({
    canceled: false,
    assets: [
      { uri: 'file:///synthetic.png', name: 'synthetic.png', mimeType: 'image/png', size: 24 },
    ],
  });
  const files = await pickPhotoPdfFiles();
  expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledWith({
    multiple: true,
    copyToCacheDirectory: true,
    type: ['image/jpeg', 'image/png'],
  });
  expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
  expect(files[0].uri).toBe('file:///synthetic.png');
});

const asset = (uri: string) => ({ uri, name: 'synthetic.png', mimeType: 'image/png', size: 24 });
test('只清本次專用選取的快取副本，一般附件與原檔保持完整', async () => {
  const uri = 'file:///cache/DocumentPicker/synthetic.png';
  jest
    .mocked(DocumentPicker.getDocumentAsync)
    .mockResolvedValue({ canceled: false, assets: [asset(uri), asset('file:///original.png')] });
  const files = await pickPhotoPdfFiles();
  releasePhotoPdfFiles([{ ...files[0] }]);
  expect(mockDeleted).toEqual([]);
  releasePhotoPdfFiles(files);
  releasePhotoPdfFiles(files);
  expect(mockDeleted).toEqual([uri]);
  jest
    .mocked(DocumentPicker.getDocumentAsync)
    .mockResolvedValue({ canceled: false, assets: [asset(uri)] });
  releasePhotoPdfFiles(await pickAssignmentDocuments([]));
  expect(mockDeleted).toEqual([uri]);
});
test('選取超過八張時回收所有已複製來源', async () => {
  const assets = Array.from({ length: 9 }, (_, i) =>
    asset(`file:///cache/DocumentPicker/${i}.png`),
  );
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({ canceled: false, assets });
  await expect(pickPhotoPdfFiles()).rejects.toThrow();
  expect(mockDeleted).toEqual(assets.map((item) => item.uri));
});
