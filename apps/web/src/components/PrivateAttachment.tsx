'use client';
import { useState } from 'react';
import { PrivateImage } from './PrivateImage';
import { resolvePrivateMedia } from '@/lib/privateFiles';

export function PrivateAttachment({ path }: { path: string }) {
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  async function open() {
    setBusy(true);
    setNotice('');
    try {
      const media = await resolvePrivateMedia(path);
      if (!media) {
        setNotice('附件尚未開放或暫時無法下載');
        return;
      }
      const url = media instanceof Blob ? URL.createObjectURL(media) : media;
      const link = document.createElement('a');
      link.href = url;
      link.download = path.split('/').pop() || '附件';
      link.rel = 'noopener';
      link.click();
      if (media instanceof Blob) setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setNotice('附件暫時無法下載');
    } finally {
      setBusy(false);
    }
  }
  return (
    <span>
      {/\.(png|jpe?g|webp|gif|avif)$/i.test(path) && <PrivateImage src={path} width={360} height={240} alt="貼文附件圖片" style={{ objectFit: 'contain', maxWidth: '100%' }} />}
      <button type="button" disabled={busy} onClick={() => void open()}>
        {busy ? '下載中…' : path.split('/').pop()}
      </button>
      {notice && <span role="status">{notice}</span>}
    </span>
  );
}
