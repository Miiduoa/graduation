'use client';
import { useEffect, useMemo, useState } from 'react';
import { isPrivateFileObjectPath, resolvePrivateMedia } from './privateFiles';

export function usePrivateMedia(value: string | null | undefined, scope?: string) {
  // Returning to a previous story or file starts a fresh read. Its old object URL
  // may already have been revoked even if the storage path is the same.
  const request = useMemo(() => ({ value, scope }), [value, scope]);
  const [result, setResult] = useState<{ request: typeof request; url: string | null } | null>(null);

  useEffect(() => {
    if (!isPrivateFileObjectPath(request.value)) return;
    let active = true;
    let objectUrl: string | undefined;
    void resolvePrivateMedia(request.value)
      .then((media) => {
        if (!active) return;
        const url = media instanceof Blob ? (objectUrl = URL.createObjectURL(media)) : media;
        setResult({ request, url });
      })
      .catch(() => {
        if (active) setResult({ request, url: null });
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [request]);

  if (!isPrivateFileObjectPath(value)) return { url: value || null, loading: false };
  if (result?.request !== request) return { url: null, loading: true };
  return { url: result.url, loading: false };
}
