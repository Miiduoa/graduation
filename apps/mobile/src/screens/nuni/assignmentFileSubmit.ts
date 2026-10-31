import Constants from 'expo-constants';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import {
  MAX_ASSIGNMENT_DOCUMENTS,
  MAX_ASSIGNMENT_IMAGES,
  assignmentFileContentQuery,
  assignmentImageTargetSize,
  formatAssignmentFileSize,
  moveAssignmentFile,
} from '@campus/shared/src/assignmentFiles';
import { NuniError, type NuniSubmissionFile } from '@campus/shared/src/nuni';

export type LocalNativeFile = {
  key: string;
  name: string;
  contentType: string;
  byteSize: number;
  kind: 'image' | 'file';
  uri: string;
  width?: number;
  height?: number;
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
  size?: { width?: number; height?: number },
): Promise<LocalNativeFile> {
  const file = new File(uri);
  const byteSize = file.exists ? file.size : 0;
  return {
    key: `${uri}:${byteSize}:${Date.now()}`,
    name,
    contentType,
    byteSize,
    kind,
    uri,
    width: size?.width,
    height: size?.height,
  };
}

export async function compressNativeAssignmentImage(file: LocalNativeFile): Promise<LocalNativeFile> {
  if (file.kind !== 'image') return file;
  const width = file.width ?? 0;
  const height = file.height ?? 0;
  const target = assignmentImageTargetSize(width || 2000, height || 2000);
  if (width && height && target.width === width && target.height === height && file.byteSize <= 1.5 * 1024 * 1024)
    return file;
  try {
    const ImageManipulator = await import('expo-image-manipulator');
    const result = await ImageManipulator.manipulateAsync(
      file.uri,
      width && height ? [{ resize: { width: target.width, height: target.height } }] : [{ resize: { width: 2000 } }],
      { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG },
    );
    return fromUri(result.uri, file.name.replace(/\.[^.]+$/, '.jpg'), 'image/jpeg', 'image', {
      width: result.width,
      height: result.height,
    });
  } catch {
    return file;
  }
}

export function removeNativeFile(files: LocalNativeFile[], key: string): LocalNativeFile[] {
  return files.filter((item) => item.key !== key);
}

export function moveNativeFile(files: LocalNativeFile[], from: number, delta: number): LocalNativeFile[] {
  return moveAssignmentFile(files, from, delta);
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
    await fromUri(asset.uri, asset.fileName || 'photo.jpg', asset.mimeType || 'image/jpeg', 'image', {
      width: asset.width,
      height: asset.height,
    }),
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
      await fromUri(asset.uri, asset.fileName || 'photo.jpg', asset.mimeType || 'image/jpeg', 'image', {
        width: asset.width,
        height: asset.height,
      }),
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
  return new Uint8Array(await new File(file.uri).arrayBuffer());
}

export function localFileSizeLabel(file: LocalNativeFile): string {
  return `${file.name} · ${formatAssignmentFileSize(file.byteSize)}`;
}

export function requireAssignmentPayload(body: string, files: LocalNativeFile[]) {
  if (!body.trim() && !files.length) throw new NuniError(422, 'ASSIGNMENT_FILE_REQUIRED');
}

export type NativeFileOperation = {
  key?: string;
  prepared?: LocalNativeFile[];
  intents?: { id: string; uploadPath: string; contentType: string }[];
  uploaded?: string[];
  submitting?: boolean;
  body?: string;
};

export type NativeUploadProgress = { completed: number; total: number };

export async function submitNativeAssignmentFiles<T>(
  classes: {
    createAssignmentFileIntents(
      workspaceId: string,
      assignmentId: string,
      input: {
        files: {
          originalName: string;
          contentType: string;
          byteSize: number;
          idempotencyKey?: string;
        }[];
        idempotencyKey: string;
      },
    ): Promise<{ id: string; uploadPath: string; contentType: string }[]>;
    uploadAssignmentFile(
      uploadPath: string,
      body: Uint8Array,
      contentType: string,
    ): Promise<unknown>;
    submitFiles(
      workspaceId: string,
      assignmentId: string,
      input: { body?: string; fileIds: string[]; idempotencyKey: string },
    ): Promise<T>;
  },
  workspaceId: string,
  assignmentId: string,
  body: string,
  files: LocalNativeFile[],
  key: string,
  onProgress?: (progress: NativeUploadProgress) => void,
  operation: NativeFileOperation = {},
) {
  if (operation.key !== key) {
    Object.assign(operation, {
      key,
      prepared: undefined,
      intents: undefined,
      uploaded: [],
      submitting: false,
      body: body.trim() || undefined,
    });
  }
  if (operation.submitting) {
    return classes.submitFiles(workspaceId, assignmentId, {
      body: operation.body,
      fileIds: operation.intents!.map((intent) => intent.id),
      idempotencyKey: key,
    });
  }
  requireAssignmentPayload(body, files);
  const prepared: LocalNativeFile[] = operation.prepared ?? [];
  if (!operation.prepared) {
    for (const file of files) prepared.push(await compressNativeAssignmentImage(file));
    operation.prepared = prepared;
  }
  onProgress?.({ completed: operation.uploaded?.length ?? 0, total: prepared.length });
  const intents =
    operation.intents ??
    (prepared.length
      ? await classes.createAssignmentFileIntents(workspaceId, assignmentId, {
          idempotencyKey: `${key}:intents`,
          files: prepared.map((file, index) => ({
            originalName: file.name,
            contentType: file.contentType,
            byteSize: file.byteSize,
            idempotencyKey: `${key}:file:${index}`,
          })),
        })
      : []);
  operation.intents = intents;
  let completed = operation.uploaded?.length ?? 0;
  const uploads = await Promise.allSettled(
    intents.map(async (intent, index) => {
      if (operation.uploaded?.includes(intent.id)) return;
      const file = prepared[index];
      if (!file) throw new NuniError(502, 'INVALID_RESPONSE');
      await classes.uploadAssignmentFile(
        intent.uploadPath,
        await nativeFileBytes(file),
        intent.contentType,
      );
      operation.uploaded!.push(intent.id);
      completed += 1;
      onProgress?.({ completed, total: prepared.length });
    }),
  );
  // Wait for every upload before allowing a retry to reuse this operation.
  const failed = uploads.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
  operation.submitting = true;
  return classes.submitFiles(workspaceId, assignmentId, {
    body: operation.body,
    fileIds: intents.map((intent) => intent.id),
    idempotencyKey: key,
  });
}

export function assignmentFileDownloadUrl(file: NuniSubmissionFile, download = false): string {
  return `https://nuni.tw/api/nuni/${file.downloadPath}?${assignmentFileContentQuery(file.downloadExp, file.downloadSig, download)}`;
}

export function usesAssignmentFileBff(path: string, input?: Record<string, unknown>): boolean {
  if (/^class-workspaces\/cw_[0-9a-f-]{36}\/assignments\/cwa_[0-9a-f-]{36}\/files\/intents$/.test(path))
    return true;
  if (/^class-workspaces\/cw_[0-9a-f-]{36}\/assignments\/cwa_[0-9a-f-]{36}\/(?:submit|submit-files|withdraw-submission)$/.test(path))
    return true;
  if (!input && /^class-workspaces\/cw_[0-9a-f-]{36}\/assignments$/.test(path)) return true;
  if (
    !input &&
    /^class-workspaces\/cw_[0-9a-f-]{36}\/assignments\/cwa_[0-9a-f-]{36}\/submissions$/.test(path)
  )
    return true;
  return false;
}

export function assignmentRequest<T>(path: string, input: Record<string, unknown> | undefined, direct: T, bff?: T): T {
  if (!usesAssignmentFileBff(path, input)) return direct;
  if (!bff) throw new NuniError(503, 'ASSIGNMENT_FILE_STORE_UNAVAILABLE');
  return bff;
}
