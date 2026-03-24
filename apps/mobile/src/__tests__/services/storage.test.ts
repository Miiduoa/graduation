/* eslint-disable */
import { storage } from '../../services/storage';
import * as FileSystem from 'expo-file-system';

jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///mock/documents/',
  cacheDirectory: 'file:///mock/cache/',
  writeAsStringAsync: jest.fn(() => Promise.resolve()),
  readAsStringAsync: jest.fn(() => Promise.resolve('{}')),
  deleteAsync: jest.fn(() => Promise.resolve()),
  getInfoAsync: jest.fn(() => Promise.resolve({ exists: true, size: 1024 })),
  makeDirectoryAsync: jest.fn(() => Promise.resolve()),
  createUploadTask: jest.fn(),
  createDownloadResumable: jest.fn(),
  FileSystemUploadType: {
    MULTIPART: 'MULTIPART',
  },
}));

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  MediaTypeOptions: {
    Images: 'Images',
    Videos: 'Videos',
    All: 'All',
  },
}));

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(),
}));

import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';

describe('StorageService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getFileInfo', () => {
    it('should return file info for existing file', async () => {
      (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({
        exists: true,
        size: 2048,
      });

      const info = await storage.getFileInfo('file:///test/image.jpg');

      expect(info).toEqual({
        uri: 'file:///test/image.jpg',
        name: 'image.jpg',
        type: 'image/jpeg',
        size: 2048,
      });
    });

    it('should return null for non-existing file', async () => {
      (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({
        exists: false,
      });

      const info = await storage.getFileInfo('file:///test/missing.jpg');

      expect(info).toBeNull();
    });

    it('should return null on error', async () => {
      (FileSystem.getInfoAsync as jest.Mock).mockRejectedValue(
        new Error('File access error')
      );

      const info = await storage.getFileInfo('file:///test/error.jpg');

      expect(info).toBeNull();
    });

    it('should detect correct mime types', async () => {
      (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({
        exists: true,
        size: 1000,
      });

      const testCases = [
        { file: 'test.jpg', type: 'image/jpeg' },
        { file: 'test.jpeg', type: 'image/jpeg' },
        { file: 'test.png', type: 'image/png' },
        { file: 'test.gif', type: 'image/gif' },
        { file: 'test.webp', type: 'image/webp' },
        { file: 'test.pdf', type: 'application/pdf' },
        { file: 'test.doc', type: 'application/msword' },
        { file: 'test.mp4', type: 'video/mp4' },
        { file: 'test.mp3', type: 'audio/mpeg' },
        { file: 'test.txt', type: 'text/plain' },
        { file: 'test.zip', type: 'application/zip' },
        { file: 'test.unknown', type: 'application/octet-stream' },
      ];

      for (const { file, type } of testCases) {
        const info = await storage.getFileInfo(`file:///test/${file}`);
        expect(info?.type).toBe(type);
      }
    });
  });

  describe('pickImage', () => {
    it('should return file info for selected image', async () => {
      (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'granted',
      });
      (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
        canceled: false,
        assets: [
          {
            uri: 'file:///selected/image.jpg',
            fileName: 'image.jpg',
            mimeType: 'image/jpeg',
            fileSize: 3000,
          },
        ],
      });

      const result = await storage.pickImage();

      expect(result).toEqual({
        uri: 'file:///selected/image.jpg',
        name: 'image.jpg',
        type: 'image/jpeg',
        size: 3000,
      });
    });

    it('should return null when canceled', async () => {
      (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'granted',
      });
      (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
        canceled: true,
      });

      const result = await storage.pickImage();

      expect(result).toBeNull();
    });

    it('should throw error when permission denied', async () => {
      (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'denied',
      });

      await expect(storage.pickImage()).rejects.toThrow('需要相簿存取權限');
    });

    it('should use custom options', async () => {
      (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'granted',
      });
      (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
        canceled: true,
      });

      await storage.pickImage({
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.5,
        mediaTypes: 'videos',
      });

      expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.5,
      });
    });
  });

  describe('takePhoto', () => {
    it('should return file info for captured photo', async () => {
      (ImagePicker.requestCameraPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'granted',
      });
      (ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValue({
        canceled: false,
        assets: [
          {
            uri: 'file:///captured/photo.jpg',
            fileName: 'photo.jpg',
            mimeType: 'image/jpeg',
            fileSize: 5000,
          },
        ],
      });

      const result = await storage.takePhoto();

      expect(result).toEqual({
        uri: 'file:///captured/photo.jpg',
        name: 'photo.jpg',
        type: 'image/jpeg',
        size: 5000,
      });
    });

    it('should throw error when camera permission denied', async () => {
      (ImagePicker.requestCameraPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'denied',
      });

      await expect(storage.takePhoto()).rejects.toThrow('需要相機存取權限');
    });
  });

  describe('pickDocument', () => {
    it('should return file info for selected document', async () => {
      (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
        canceled: false,
        assets: [
          {
            uri: 'file:///selected/document.pdf',
            name: 'document.pdf',
            mimeType: 'application/pdf',
            size: 10000,
          },
        ],
      });

      const result = await storage.pickDocument();

      expect(result).toEqual({
        uri: 'file:///selected/document.pdf',
        name: 'document.pdf',
        type: 'application/pdf',
        size: 10000,
      });
    });

    it('should return null when canceled', async () => {
      (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
        canceled: true,
      });

      const result = await storage.pickDocument();

      expect(result).toBeNull();
    });

    it('should use custom options', async () => {
      (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
        canceled: true,
      });

      await storage.pickDocument({
        type: ['application/pdf'],
        copyToCacheDirectory: false,
      });

      expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledWith({
        type: ['application/pdf'],
        copyToCacheDirectory: false,
        multiple: false,
      });
    });
  });

  describe('pickMultipleDocuments', () => {
    it('should return array of file infos', async () => {
      (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
        canceled: false,
        assets: [
          { uri: 'file:///doc1.pdf', name: 'doc1.pdf', mimeType: 'application/pdf', size: 1000 },
          { uri: 'file:///doc2.pdf', name: 'doc2.pdf', mimeType: 'application/pdf', size: 2000 },
        ],
      });

      const result = await storage.pickMultipleDocuments();

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('doc1.pdf');
      expect(result[1].name).toBe('doc2.pdf');
    });

    it('should return empty array when canceled', async () => {
      (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
        canceled: true,
      });

      const result = await storage.pickMultipleDocuments();

      expect(result).toEqual([]);
    });
  });

  describe('uploadFile', () => {
    beforeEach(() => {
      storage.configure('https://api.example.com/upload');
    });

    it('should reject file exceeding size limit', async () => {
      const largeFile = {
        uri: 'file:///large.zip',
        name: 'large.zip',
        type: 'application/zip',
        size: 100 * 1024 * 1024, // 100MB
      };

      const result = await storage.uploadFile(largeFile, '/uploads');

      expect(result.success).toBe(false);
      expect(result.error).toContain('50MB');
    });

    it('should fail when no endpoint configured', async () => {
      storage.configure('');

      const file = {
        uri: 'file:///test.jpg',
        name: 'test.jpg',
        type: 'image/jpeg',
        size: 1000,
      };

      const result = await storage.uploadFile(file, '/uploads');

      expect(result.success).toBe(false);
      expect(result.error).toBe('未設定上傳端點');
    });

    it('should upload file successfully', async () => {
      const mockUploadAsync = jest.fn().mockResolvedValue({
        status: 200,
        body: JSON.stringify({ url: 'https://cdn.example.com/uploaded.jpg' }),
      });

      (FileSystem.createUploadTask as jest.Mock).mockReturnValue({
        uploadAsync: mockUploadAsync,
      });

      const file = {
        uri: 'file:///test.jpg',
        name: 'test.jpg',
        type: 'image/jpeg',
        size: 1000,
      };

      const result = await storage.uploadFile(file, '/uploads');

      expect(result.success).toBe(true);
      expect(result.url).toBe('https://cdn.example.com/uploaded.jpg');
    });

    it('should handle upload failure', async () => {
      (FileSystem.createUploadTask as jest.Mock).mockReturnValue({
        uploadAsync: jest.fn().mockResolvedValue({
          status: 500,
        }),
      });

      const file = {
        uri: 'file:///test.jpg',
        name: 'test.jpg',
        type: 'image/jpeg',
        size: 1000,
      };

      const result = await storage.uploadFile(file, '/uploads');

      expect(result.success).toBe(false);
      expect(result.error).toContain('上傳失敗');
    });

    it('should call progress callback', async () => {
      let progressCallback: (data: any) => void;
      (FileSystem.createUploadTask as jest.Mock).mockImplementation(
        (url, uri, options, callback) => {
          progressCallback = callback;
          return {
            uploadAsync: jest.fn(async () => {
              progressCallback({
                totalBytesSent: 500,
                totalBytesExpectedToSend: 1000,
              });
              return { status: 200, body: JSON.stringify({ url: 'test' }) };
            }),
          };
        }
      );

      const file = {
        uri: 'file:///test.jpg',
        name: 'test.jpg',
        type: 'image/jpeg',
        size: 1000,
      };

      const onProgress = jest.fn();
      await storage.uploadFile(file, '/uploads', onProgress);

      expect(onProgress).toHaveBeenCalledWith({
        loaded: 500,
        total: 1000,
        percentage: 50,
      });
    });
  });

  describe('downloadFile', () => {
    it('should download file successfully', async () => {
      (FileSystem.createDownloadResumable as jest.Mock).mockReturnValue({
        downloadAsync: jest.fn().mockResolvedValue({
          uri: 'file:///mock/cache/uploads/downloaded.jpg',
        }),
      });

      const result = await storage.downloadFile(
        'https://cdn.example.com/file.jpg',
        'downloaded.jpg'
      );

      expect(result).toBe('file:///mock/cache/uploads/downloaded.jpg');
    });

    it('should return null on download failure', async () => {
      (FileSystem.createDownloadResumable as jest.Mock).mockReturnValue({
        downloadAsync: jest.fn().mockRejectedValue(new Error('Network error')),
      });

      const result = await storage.downloadFile(
        'https://cdn.example.com/file.jpg',
        'downloaded.jpg'
      );

      expect(result).toBeNull();
    });
  });

  describe('cache management', () => {
    it('should get cache size', async () => {
      (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({
        exists: true,
        size: 5000,
      });

      const size = await storage.getCacheSize();

      expect(size).toBe(5000);
    });

    it('should return 0 for non-existent cache', async () => {
      (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({
        exists: false,
      });

      const size = await storage.getCacheSize();

      expect(size).toBe(0);
    });

    it('should clear cache', async () => {
      await storage.clearCache();

      expect(FileSystem.deleteAsync).toHaveBeenCalled();
      expect(FileSystem.makeDirectoryAsync).toHaveBeenCalled();
    });

    it('should delete specific file', async () => {
      const result = await storage.deleteFile('file:///test/file.jpg');

      expect(FileSystem.deleteAsync).toHaveBeenCalledWith('file:///test/file.jpg', {
        idempotent: true,
      });
      expect(result).toBe(true);
    });

    it('should return false on delete error', async () => {
      (FileSystem.deleteAsync as jest.Mock).mockRejectedValue(new Error('Delete failed'));

      const result = await storage.deleteFile('file:///test/file.jpg');

      expect(result).toBe(false);
    });
  });

  describe('utilities', () => {
    it('should format file sizes correctly', () => {
      expect(storage.formatFileSize(0)).toBe('0 B');
      expect(storage.formatFileSize(500)).toBe('500 B');
      expect(storage.formatFileSize(1024)).toBe('1 KB');
      expect(storage.formatFileSize(1536)).toBe('1.5 KB');
      expect(storage.formatFileSize(1048576)).toBe('1 MB');
      expect(storage.formatFileSize(1073741824)).toBe('1 GB');
    });

    it('should detect image types', () => {
      expect(storage.isImage('image/jpeg')).toBe(true);
      expect(storage.isImage('image/png')).toBe(true);
      expect(storage.isImage('video/mp4')).toBe(false);
      expect(storage.isImage('application/pdf')).toBe(false);
    });

    it('should detect video types', () => {
      expect(storage.isVideo('video/mp4')).toBe(true);
      expect(storage.isVideo('video/quicktime')).toBe(true);
      expect(storage.isVideo('image/jpeg')).toBe(false);
    });

    it('should detect document types', () => {
      expect(storage.isDocument('application/pdf')).toBe(true);
      expect(storage.isDocument('text/plain')).toBe(true);
      expect(
        storage.isDocument(
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        )
      ).toBe(true);
      expect(storage.isDocument('image/jpeg')).toBe(false);
    });
  });
});
