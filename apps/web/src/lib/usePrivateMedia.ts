'use client';
import { useEffect, useState } from 'react';
import { isPrivateFileObjectPath, resolvePrivateMedia } from './privateFiles';

export function usePrivateMedia(value: string | null | undefined, onFailure?: () => void) {
  const [result, setResult] = useState<{ value: typeof value; url: string | null }>({
    value: null,
    url: null,
  });
  useEffect(() => {
    if (!isPrivateFileObjectPath(value)) return;
    let active = true;
    let objectUrl: string | undefined;
    void resolvePrivateMedia(value)
      .then((media) => {
        if (!active) return;
        const url = media instanceof Blob ? (objectUrl = URL.createObjectURL(media)) : media;
        setResult({ value, url });
        if (url === null) onFailure?.();
      })
      .catch(() => {
        if (active) { setResult({ value, url: null }); onFailure?.(); }
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [value, onFailure]);
  return value && !isPrivateFileObjectPath(value)
    ? value
    : result.value === value
      ? result.url
      : null;
}
