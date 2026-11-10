import { parsePrivateFilePath } from './privateFileAccess';

/** 既有網址沿用；只有合法的私人命名空間才需要換取下載權限。 */
export function isPrivateFileObjectPath(value: unknown): value is string {
  return parsePrivateFilePath(value) !== null;
}

/** 完整下載後交給播放器，避免短效網址在播放途中過期。失敗僅重新簽發一次。 */
export async function resolvePrivateFileMedia<T>(
  value: string | null | undefined,
  enabled: boolean,
  download: (path: string) => Promise<T>,
): Promise<string | T | null> {
  if (!value) return null;
  if (!isPrivateFileObjectPath(value)) return value;
  if (!enabled) return null;
  try {
    return await download(value);
  } catch (error) {
    const failure = error as { statusCode?: number; source?: string };
    const status = failure?.statusCode;
    const transient = error instanceof TypeError || (status !== undefined && status >= 500 && status <= 599) ||
      (failure?.source === 'object' && status === 403);
    if (!transient) return null;
    try {
      return await download(value);
    } catch {
      return null;
    }
  }
}

/** 相容既有附件物件與直接儲存路徑的附件清單。 */
export function privateAttachmentPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    const path =
      typeof entry === 'string'
        ? entry
        : entry && typeof entry === 'object' && 'url' in entry
          ? entry.url
          : null;
    return typeof path === 'string' && (isPrivateFileObjectPath(path) || /^https?:\/\//.test(path))
      ? [path]
      : [];
  });
}

/** Cleanup assumes every writer keeps private references inside its own container. */
export function assertPrivateFileNamespace(path: string, namespace: string): void {
  const scope = parsePrivateFilePath(path);
  if (!scope) {
    if (/^https?:\/\//.test(path)) return;
    throw new Error('附件路徑無效');
  }
  const container = path.slice(0, path.lastIndexOf('/'));
  if (container !== namespace || (scope.kind === 'group-cover' && !scope.filename.startsWith('cover.')))
    throw new Error('附件不屬於此文件');
}
