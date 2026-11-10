'use client';
import Image, { type ImageProps } from 'next/image';
import { usePrivateMedia } from '@/lib/usePrivateMedia';

export function PrivateImage(props: ImageProps) {
  const url = usePrivateMedia(typeof props.src === 'string' ? props.src : null);
  if (!url) return <span role="status">照片暫時無法顯示</span>;
  return <Image {...props} alt={props.alt} src={url} unoptimized />;
}
