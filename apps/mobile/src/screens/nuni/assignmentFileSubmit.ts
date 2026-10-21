import Constants from 'expo-constants';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import {
  MAX_ASSIGNMENT_DOCUMENTS,
  MAX_ASSIGNMENT_IMAGES,
  formatAssignmentFileSize,
} from '@campus/shared/src/assignmentFiles';
import { NuniError, type NuniSubmissionFile } from '@campus/shared/src/nuni';

export type LocalNativeFile = {
  key: string;
  name: string;
  contentType: string;
  byteSize: number;
  kind: 'image' | 'file';
  uri: string;
};

export function assignmentFileSubmitEnabledNative(): boolean {
  return (
    process.env.EXPO_PUBLIC_ASSIGNMENT_FILE_SUBMIT_ENABLED === 'true' ||
    Constants.expoConfig?.extra?.assignmentFileSubmit === true
  );
}

function pushFile(current: LocalNativeFile[], incoming: LocalNativeFile): LocalNativeFile[] {
  const used = current.filter((item) => item.kind === incoming.kind).length;
  if (incoming.kind === 'image' && used >= MAX_ASSIGNMENT_IMAGES) return current;
  if (incoming.kind === 'file' && used >= MAX_ASSIGNMENT_DOCUMENTS) return current;
  return [...current, incoming];
}

async function fromUri(
  uri: string,
  name: string,
  contentType: string,
  kind: 'image' | 'file',
): Promise<LocalNativeFile> {
  const info = await FileSystem.getInfoAsync(uri);
  const byteSize = info.exists && 'size' in info && typeof info.size === 'number' ? info.size : 0;
  return {
    key: `${uri}:${byteSize}`,
    name,
    contentType,
    byteSize,
    kind,
    uri,
  };
}

export async function pickAssignmentCamera(current: LocalNativeFile[]): Promise<LocalNativeFile[]> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return current;
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.8,
  });
  if (result.canceled || !result.assets[0]) return current;
  const asset = result.assets[0];
  return pushFile(
    current,
    await fromUri(asset.uri, asset.fileName || 'photo.jpg', asset.mimeType || 'image/jpeg', 'image'),
  );
}

export async function pickAssignmentAlbum(current: LocalNativeFile[]): Promise<LocalNativeFile[]> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return current;
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsMultipleSelection: true,
    selectionLimit: MAX_ASSIGNMENT_IMAGES,
    quality: 0.8,
  });
  if (result.canceled) return current;
  let next = current;
  for (const asset of result.assets) {
    next = pushFile(
      next,
      await fromUri(asset.uri, asset.fileName || 'photo.jpg', asset.mimeType || 'image/jpeg', 'image'),
    );
  }
  return next;
}

export async function pickAssignmentDocuments(current: LocalNativeFile[]): Promise<LocalNativeFile[]> {
  const result = await DocumentPicker.getDocumentAsync({
    multiple: true,
    copyToCacheDirectory: true,
    type: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'application/zip',
    ],
  });
  if (result.canceled) return current;
  let next = current;
  for (const asset of result.assets) {
    next = pushFile(
      next,
      await fromUri(asset.uri, asset.name, asset.mimeType || 'application/octet-stream', 'file'),
    );
  }
  return next;
}

export async function nativeFileBytes(file: LocalNativeFile): Promise<Uint8Array> {
  const base64 = await FileSystem.readAsStringAsync(file.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function localFileSizeLabel(file: LocalNativeFile): string {
  return `${file.name} · ${formatAssignmentFileSize(file.byteSize)}`;
}

export function requireAssignmentPayload(body: string, files: LocalNativeFile[]) {
  if (!body.trim() && !files.length) throw new NuniError(422, 'ASSIGNMENT_FILE_REQUIRED');
}

export function assignmentFileDownloadUrl(file: NuniSubmissionFile): string {
  return `https://nuni.tw/api/nuni/${file.downloadPath}?exp=${encodeURIComponent(file.downloadExp)}&sig=${encodeURIComponent(file.downloadSig)}`;
}

export function usesAssignmentFileBff(path: string, input?: Record<string, unknown>): boolean {
  if (/^class-workspaces\/cw_[0-9a-f-]{36}\/assignments\/cwa_[0-9a-f-]{36}\/files\/intents$/.test(path))
    return true;
  if (/^class-workspaces\/cw_[0-9a-f-]{36}\/assignments\/cwa_[0-9a-f-]{36}\/submit-files$/.test(path))
    return true;
  if (!input && /^class-workspaces\/cw_[0-9a-f-]{36}\/assignments$/.test(path)) return true;
  if (
    !input &&
    /^class-workspaces\/cw_[0-9a-f-]{36}\/assignments\/cwa_[0-9a-f-]{36}\/submissions$/.test(path)
  )
    return true;
  return false;
}
