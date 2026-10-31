import { pickPhotoPdfFiles } from '../screens/nuni/assignmentFileSubmit';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({
  File: class { exists = true; size = 24; },
}));

test('照片選取只複製原檔，不經相簿解碼或重編碼', async () => {
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///synthetic.png', name: 'synthetic.png', mimeType: 'image/png', size: 24 }],
  });
  const files = await pickPhotoPdfFiles();
  expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledWith({
    multiple: true, copyToCacheDirectory: true, type: ['image/jpeg', 'image/png'],
  });
  expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
  expect(files[0].uri).toBe('file:///synthetic.png');
});
