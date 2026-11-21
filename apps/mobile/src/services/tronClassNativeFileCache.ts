import { Directory, File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import * as Sharing from 'expo-sharing';
import type { DocumentPickerAsset } from 'expo-document-picker';
import type { TronClassLocalFile } from './tronClassIntegrationTypes';
import type { NativeTronClassDownloadedFile } from './tronClassNativeDownload';

const PREFIX = 'nuni-tronclass-';
const active = new Set<string>();
/** Call on entry even when the user only reads coursework after an earlier process stopped. */
export function purgeAbandonedNativeTronClassFiles(): void {
  try {
    for (const entry of Paths.cache.list()) {
      if (entry instanceof Directory && entry.name.startsWith(PREFIX) && !active.has(entry.uri)) {
        try {
          entry.delete();
        } catch {
          /* A subsequent entry or attachment use retries. */
        }
      }
    }
  } catch {
    /* Reading coursework must remain available when the cache is unavailable. */
  }
}
function insideCache(uri: string): boolean {
  const root = Paths.cache.uri.replace(/\/$/, '') + '/';
  try {
    const parsed = new URL(uri);
    return (
      parsed.protocol === 'file:' &&
      parsed.href.startsWith(root) &&
      !parsed.search &&
      !parsed.hash &&
      !decodeURIComponent(parsed.pathname)
        .split('/')
        .some((part) => part === '..' || part === '.')
    );
  } catch {
    return false;
  }
}
/** Delete only Expo's cache copies returned by this picker, never the user's originals. */
export function discardTronClassPickerCopies(assets: DocumentPickerAsset[]): void {
  for (const asset of assets) {
    if (!insideCache(asset.uri)) continue;
    try {
      const file = new File(asset.uri);
      if (file.exists) file.delete();
    } catch {
      /* Retried by OS cache cleanup. */
    }
  }
}

/** A mounted owner owns one temporary directory, including copies needed for iCloud/Android providers. */
export class NativeTronClassFileCache {
  private directory: Directory | null = null;
  private files = new Set<string>();
  private closed = false;

  private root(): Directory {
    if (this.closed) throw new Error('DRAFT_SCOPE_CLOSED');
    if (this.directory) return this.directory;
    // After an app restart, remove abandoned directories without touching another live screen.
    purgeAbandonedNativeTronClassFiles();
    const directory = new Directory(Paths.cache, `${PREFIX}${Crypto.randomUUID()}`);
    directory.create();
    this.directory = directory;
    active.add(directory.uri);
    return directory;
  }
  adopt(assets: DocumentPickerAsset[]): TronClassLocalFile[] {
    const incoming: TronClassLocalFile[] = [];
    try {
      for (const asset of assets) {
        if (!insideCache(asset.uri)) throw new Error('PICKER_CACHE_REQUIRED');
        const source = new File(asset.uri);
        const size = source.size;
        if (
          !source.exists ||
          !Number.isSafeInteger(size) ||
          size <= 0 ||
          size > 10 * 1024 * 1024 ||
          (asset.size !== undefined && size !== asset.size)
        )
          throw new Error('FILE_CHANGED');
        const target = new File(this.root(), `${Crypto.randomUUID()}.draft`);
        source.move(target);
        this.files.add(target.uri);
        incoming.push({
          key: Crypto.randomUUID(),
          uri: target.uri,
          name: asset.name,
          size,
          contentType: asset.mimeType?.toLowerCase() || 'application/octet-stream',
        });
      }
      return incoming;
    } catch (error) {
      for (const file of incoming) this.remove(file.uri);
      throw error;
    } finally {
      discardTronClassPickerCopies(assets);
    }
  }
  private remove(uri: string): void {
    if (!this.files.has(uri)) return;
    try {
      const file = new File(uri);
      if (file.exists) file.delete();
      this.files.delete(uri);
    } catch {
      /* Keep it tracked for clear/dispose; it is never exposed to another owner. */
    }
  }
  retain(files: TronClassLocalFile[]): void {
    const retained = new Set(files.map((file) => file.uri));
    for (const uri of this.files) if (!retained.has(uri)) this.remove(uri);
  }
  clear(): void {
    this.retain([]);
  }
  async share(file: NativeTronClassDownloadedFile, isCurrent: () => boolean): Promise<void> {
    if (this.closed || !isCurrent()) throw new Error('DRAFT_SCOPE_CLOSED');
    if (!(await Sharing.isAvailableAsync())) throw new Error('SHARING_UNAVAILABLE');
    if (this.closed || !isCurrent()) throw new Error('DRAFT_SCOPE_CLOSED');
    const shareDirectory = new Directory(this.root(), Crypto.randomUUID());
    shareDirectory.create();
    const target = new File(shareDirectory, file.filename);
    this.files.add(target.uri);
    try {
      target.create();
      target.write(file.bytes);
      if (this.closed || !isCurrent()) throw new Error('DRAFT_SCOPE_CLOSED');
      await Sharing.shareAsync(target.uri, {
        mimeType: file.contentType,
        dialogTitle: file.filename,
      });
    } finally {
      this.remove(target.uri);
      try {
        if (shareDirectory.exists) shareDirectory.delete();
      } catch {
        /* Root disposal retries. */
      }
    }
  }
  dispose(): void {
    this.closed = true;
    this.clear();
    if (this.directory) {
      active.delete(this.directory.uri);
      try {
        if (this.directory.exists) this.directory.delete();
      } catch {
        /* Next screen purges abandoned roots. */
      }
    }
  }
}
