import { cachePrivateBlob } from './privateFileCache';
import { useEffect, useState } from 'react';
import { isPrivateFileObjectPath, resolvePrivateMedia } from './privateFiles';

export function usePrivateMedia(value: string | null | undefined) {
  const [result, setResult] = useState<{ value: typeof value; url: string | null }>({
    value: null,
    url: null,
  });
  useEffect(() => {
    if (!isPrivateFileObjectPath(value)) return;
    let active = true;
    let cached: Awaited<ReturnType<typeof cachePrivateBlob>> | undefined;
    void resolvePrivateMedia(value)
      .then(async (media) => {
        if (!active) return;
        if (media instanceof Blob) {
          const extension = media.type.split('/')[1]?.replace(/[^a-zA-Z0-9]/g, '') || 'bin';
          cached = await cachePrivateBlob(media, `media.${extension}`);
          if (!active) {
            await cached.dispose().catch(() => {});
            return;
          }
        }
        const url = cached?.uri ?? (typeof media === 'string' ? media : null);
        if (active) setResult({ value, url });
      })
      .catch(() => {
        if (active) setResult({ value, url: null });
      });
    return () => {
      active = false;
      void cached?.dispose().catch(() => {});
    };
  }, [value]);
  return value && !isPrivateFileObjectPath(value)
    ? value
    : result.value === value
      ? result.url
      : null;
}
