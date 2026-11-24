'use client';
import { useState } from 'react';
import Image, { type ImageProps } from 'next/image';
import { usePrivateMedia } from '@/lib/usePrivateMedia';
import styles from './PrivateImage.module.css';

export function PrivateImage(props: ImageProps) {
  if (typeof props.src !== 'string') return <Image {...props} alt={props.alt} unoptimized />;
  return <MediaImage key={props.src} {...props} src={props.src} />;
}

function MediaImage({ src, alt, onError, className = '', style, width, height, fill, ...props }: ImageProps & { src: string }) {
  const { url, loading } = usePrivateMedia(src);
  const [failed, setFailed] = useState(false);
  return (
    <span
      className={`${styles.frame} ${className}`}
      data-fill={fill || undefined}
      style={{
        width: width ? Number(width) : undefined,
        aspectRatio: width && height ? `${width} / ${height}` : undefined,
        ...style,
      }}
    >
      {url && !failed ? (
        <Image
          {...props}
          alt={alt}
          src={url}
          width={width}
          height={height}
          fill={fill}
          className={styles.image}
          unoptimized
          onError={(event) => {
            setFailed(true);
            onError?.(event);
          }}
        />
      ) : (
        <span
          className={styles.placeholder}
          role={alt ? 'status' : undefined}
          aria-hidden={alt ? undefined : true}
        >
          {loading ? '正在載入照片…' : '照片暫時無法顯示'}
        </span>
      )}
    </span>
  );
}
