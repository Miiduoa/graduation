import * as FileSystem from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { Platform } from "react-native";

// ===== Types =====

export type FileInfo = {
  uri: string;
  name: string;
  type: string;
  size: number;
};

export type UploadProgress = {
  loaded: number;
  total: number;
  percentage: number;
};

export type UploadResult = {
  success: boolean;
  url?: string;
  error?: string;
};

export type ImagePickerOptions = {
  allowsEditing?: boolean;
  aspect?: [number, number];
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
  mediaTypes?: "images" | "videos" | "all";
};

export type DocumentPickerOptions = {
  type?: string[];
  copyToCacheDirectory?: boolean;
  multiple?: boolean;
};

// ===== Constants =====

const fileSystemCompat = FileSystem as typeof FileSystem & {
  cacheDirectory?: string | null;
  documentDirectory?: string | null;
  FileSystemUploadType?: { MULTIPART: unknown };
  createUploadTask?: typeof FileSystem.createUploadTask;
};

const CACHE_DIR = `${fileSystemCompat.cacheDirectory ?? fileSystemCompat.documentDirectory ?? "file:///tmp/"}uploads/`;
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

// 上傳重試配置
const UPLOAD_RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
};

/**
 * 計算重試延遲（指數退避 + 抖動）
 */
function getUploadRetryDelay(retryCount: number): number {
  const baseDelay = UPLOAD_RETRY_CONFIG.baseDelayMs * Math.pow(2, retryCount);
  const jitter = baseDelay * 0.2 * Math.random();
  return Math.min(baseDelay + jitter, UPLOAD_RETRY_CONFIG.maxDelayMs);
}

/**
 * 檢查錯誤是否可重試
 */
function isRetryableUploadError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("network") ||
      message.includes("timeout") ||
      message.includes("connection") ||
      message.includes("failed to fetch") ||
      message.includes("econnreset") ||
      message.includes("socket")
    );
  }
  return false;
}

/**
 * 安全解析 JSON
 */
function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch (e) {
    console.warn("[Storage] Failed to parse JSON response:", e);
    return fallback;
  }
}

// ===== Storage Service =====

class StorageService {
  private uploadEndpoint: string = "";

  constructor() {
    this.ensureCacheDir();
  }

  // ===== Configuration =====

  configure(endpoint: string): void {
    this.uploadEndpoint = endpoint;
  }

  // ===== File System =====

  private async ensureCacheDir(): Promise<void> {
    const dirInfo = await FileSystem.getInfoAsync(CACHE_DIR);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
    }
  }

  async getFileInfo(uri: string): Promise<FileInfo | null> {
    try {
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists) return null;

      const name = uri.split("/").pop() || "file";
      const type = this.getMimeType(name);

      return {
        uri,
        name,
        type,
        size: "size" in info ? info.size ?? 0 : 0,
      };
    } catch (e) {
      console.error("[Storage] Failed to get file info:", e);
      return null;
    }
  }

  private getMimeType(filename: string): string {
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    const mimeTypes: Record<string, string> = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
      heic: "image/heic",
      pdf: "application/pdf",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xls: "application/vnd.ms-excel",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ppt: "application/vnd.ms-powerpoint",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      txt: "text/plain",
      mp4: "video/mp4",
      mov: "video/quicktime",
      mp3: "audio/mpeg",
      wav: "audio/wav",
      zip: "application/zip",
    };
    return mimeTypes[ext] || "application/octet-stream";
  }

  // ===== Image Picker =====

  async pickImage(options: ImagePickerOptions = {}): Promise<FileInfo | null> {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      throw new Error("需要相簿存取權限");
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: options.mediaTypes === "videos" 
        ? ImagePicker.MediaTypeOptions.Videos 
        : options.mediaTypes === "all"
        ? ImagePicker.MediaTypeOptions.All
        : ImagePicker.MediaTypeOptions.Images,
      allowsEditing: options.allowsEditing ?? false,
      aspect: options.aspect,
      quality: options.quality ?? 0.8,
    });

    if (result.canceled || !result.assets?.[0]) {
      return null;
    }

    const asset = result.assets[0];
    return {
      uri: asset.uri,
      name: asset.fileName || `image_${Date.now()}.jpg`,
      type: asset.mimeType || "image/jpeg",
      size: asset.fileSize || 0,
    };
  }

  async takePhoto(options: ImagePickerOptions = {}): Promise<FileInfo | null> {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      throw new Error("需要相機存取權限");
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: options.allowsEditing ?? false,
      aspect: options.aspect,
      quality: options.quality ?? 0.8,
    });

    if (result.canceled || !result.assets?.[0]) {
      return null;
    }

    const asset = result.assets[0];
    return {
      uri: asset.uri,
      name: asset.fileName || `photo_${Date.now()}.jpg`,
      type: asset.mimeType || "image/jpeg",
      size: asset.fileSize || 0,
    };
  }

  // ===== Document Picker =====

  async pickDocument(options: DocumentPickerOptions = {}): Promise<FileInfo | null> {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: options.type || ["*/*"],
        copyToCacheDirectory: options.copyToCacheDirectory ?? true,
        multiple: options.multiple ?? false,
      });

      if (result.canceled || !result.assets?.[0]) {
        return null;
      }

      const asset = result.assets[0];
      return {
        uri: asset.uri,
        name: asset.name,
        type: asset.mimeType || this.getMimeType(asset.name),
        size: asset.size || 0,
      };
    } catch (e) {
      console.error("[Storage] Document picker error:", e);
      return null;
    }
  }

  async pickMultipleDocuments(options: DocumentPickerOptions = {}): Promise<FileInfo[]> {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: options.type || ["*/*"],
        copyToCacheDirectory: options.copyToCacheDirectory ?? true,
        multiple: true,
      });

      if (result.canceled || !result.assets) {
        return [];
      }

      return result.assets.map((asset) => ({
        uri: asset.uri,
        name: asset.name,
        type: asset.mimeType || this.getMimeType(asset.name),
        size: asset.size || 0,
      }));
    } catch (e) {
      console.error("[Storage] Document picker error:", e);
      return [];
    }
  }

  // ===== Upload =====

  async uploadFile(
    file: FileInfo,
    path: string,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<UploadResult> {
    if (file.size > MAX_FILE_SIZE) {
      return { success: false, error: "檔案大小超過限制 (50MB)" };
    }

    if (!this.uploadEndpoint) {
      return { success: false, error: "未設定上傳端點" };
    }

    let lastError: string = "上傳失敗";
    
    for (let retryCount = 0; retryCount <= UPLOAD_RETRY_CONFIG.maxRetries; retryCount++) {
      try {
        const uploadTask = fileSystemCompat.createUploadTask?.(
          this.uploadEndpoint,
          file.uri,
          {
            fieldName: "file",
            httpMethod: "POST",
            uploadType: fileSystemCompat.FileSystemUploadType?.MULTIPART as any,
            parameters: {
              path,
              filename: file.name,
            },
          },
          (data) => {
            if (onProgress) {
              onProgress({
                loaded: data.totalBytesSent,
                total: data.totalBytesExpectedToSend,
                percentage: Math.round(
                  (data.totalBytesSent / data.totalBytesExpectedToSend) * 100
                ),
              });
            }
          }
        );

        if (!uploadTask) {
          throw new Error("Upload task is not available in this environment");
        }

        const response = await uploadTask.uploadAsync();
        
        if (response?.status === 200) {
          // 安全解析 JSON，避免 parse 錯誤導致上傳被認為失敗
          const body = safeJsonParse<{ url?: string; error?: string }>(
            response.body, 
            { error: "無法解析伺服器回應" }
          );
          
          if (body.url) {
            return { success: true, url: body.url };
          }
          
          // 伺服器返回 200 但沒有 url，可能是業務邏輯錯誤
          lastError = body.error || "伺服器未返回檔案 URL";
          break; // 不重試業務邏輯錯誤
        }
        
        // 根據 HTTP 狀態碼決定是否重試
        const statusCode = response?.status ?? 0;
        const isServerError = statusCode >= 500 && statusCode < 600;
        const isTooManyRequests = statusCode === 429;
        
        if ((isServerError || isTooManyRequests) && retryCount < UPLOAD_RETRY_CONFIG.maxRetries) {
          const delay = getUploadRetryDelay(retryCount);
          console.log(`[Storage] Upload failed with ${statusCode}, retrying in ${delay}ms (attempt ${retryCount + 1})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        // 嘗試解析錯誤訊息
        if (response?.body) {
          const errorBody = safeJsonParse<{ error?: string; message?: string }>(
            response.body,
            {}
          );
          lastError = errorBody.error || errorBody.message || `上傳失敗 (HTTP ${statusCode})`;
        } else {
          lastError = `上傳失敗 (HTTP ${statusCode})`;
        }
        
        // 非可重試的 HTTP 錯誤，直接返回
        if (!isServerError && !isTooManyRequests) {
          break;
        }
      } catch (e) {
        console.error("[Storage] Upload error:", e);
        lastError = e instanceof Error ? e.message : "上傳失敗";
        
        // 檢查是否為可重試的網路錯誤
        if (isRetryableUploadError(e) && retryCount < UPLOAD_RETRY_CONFIG.maxRetries) {
          const delay = getUploadRetryDelay(retryCount);
          console.log(`[Storage] Network error, retrying in ${delay}ms (attempt ${retryCount + 1})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        break;
      }
    }
    
    return { success: false, error: lastError };
  }

  // ===== Download =====

  async downloadFile(
    url: string,
    filename: string,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<string | null> {
    try {
      const localUri = CACHE_DIR + filename;
      
      const downloadResumable = FileSystem.createDownloadResumable(
        url,
        localUri,
        {},
        (data) => {
          if (onProgress && data.totalBytesExpectedToWrite > 0) {
            onProgress({
              loaded: data.totalBytesWritten,
              total: data.totalBytesExpectedToWrite,
              percentage: Math.round(
                (data.totalBytesWritten / data.totalBytesExpectedToWrite) * 100
              ),
            });
          }
        }
      );

      const result = await downloadResumable.downloadAsync();
      return result?.uri || null;
    } catch (e) {
      console.error("[Storage] Download error:", e);
      return null;
    }
  }

  // ===== Cache Management =====

  async getCacheSize(): Promise<number> {
    try {
      const info = await FileSystem.getInfoAsync(CACHE_DIR);
      return "size" in info ? info.size ?? 0 : 0;
    } catch {
      return 0;
    }
  }

  async clearCache(): Promise<void> {
    try {
      await FileSystem.deleteAsync(CACHE_DIR, { idempotent: true });
      await this.ensureCacheDir();
    } catch (e) {
      console.error("[Storage] Failed to clear cache:", e);
    }
  }

  async deleteFile(uri: string): Promise<boolean> {
    try {
      await FileSystem.deleteAsync(uri, { idempotent: true });
      return true;
    } catch (e) {
      console.error("[Storage] Failed to delete file:", e);
      return false;
    }
  }

  // ===== Utilities =====

  formatFileSize(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  }

  isImage(type: string): boolean {
    return type.startsWith("image/");
  }

  isVideo(type: string): boolean {
    return type.startsWith("video/");
  }

  isDocument(type: string): boolean {
    return (
      type === "application/pdf" ||
      type.includes("document") ||
      type.includes("spreadsheet") ||
      type.includes("presentation") ||
      type === "text/plain"
    );
  }
}

// ===== Singleton Instance =====

export const storage = new StorageService();
