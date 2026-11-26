'use client';

import { useLayoutEffect, useRef } from 'react';

/** Keep a selected file's preview bound to its own local object URL. */
export function PostImagePreview({ file }: { file: File }) {
  const imageRef = useRef<HTMLImageElement>(null);

  useLayoutEffect(() => {
    const image = imageRef.current;
    if (!image) return;
    const objectUrl = URL.createObjectURL(file);
    try {
      const localUrl = new URL(objectUrl);
      if (localUrl.protocol === 'blob:' && localUrl.origin === window.location.origin) {
        image.src = localUrl.href;
      }
    } catch {
      // An invalid object URL must not become an image source.
    }
    return () => {
      image.removeAttribute('src');
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  return (
    <img
      ref={imageRef}
      alt="貼文圖片預覽"
      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
    />
  );
}
