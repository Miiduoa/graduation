'use client';

import { useState } from 'react';
import { Button, Modal } from '@/components/ui';
import type { LostFoundPhoto } from '@/lib/lostFoundPhotos';
import styles from './LostFound.module.css';

export function LostFoundThumbnail({ photos }: { photos: LostFoundPhoto[] }) {
  const preview = photos.find((photo) => photo.campusHosted);
  const [failedSrc, setFailedSrc] = useState('');
  const showImage = preview && preview.src !== failedSrc;
  return (
    <span className={styles.thumbnail}>
      {showImage && (
        // eslint-disable-next-line @next/next/no-img-element -- Private item photos must not use the shared image proxy.
        <img
          alt=""
          src={preview.src}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailedSrc(preview.src)}
        />
      )}
      <span className={showImage ? styles.overPhoto : styles.photoCount}>
        照片 {photos.length} 張
      </span>
    </span>
  );
}

function ItemPhoto({ photo, label }: { photo: LostFoundPhoto; label: string }) {
  const [allowed, setAllowed] = useState(false);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  if (!photo.campusHosted && !allowed) {
    return (
      <div className={styles.photoNotice}>
        <p>
          這張照片存放在 <bdi>{photo.host}</bdi>
        </p>
        <Button type="button" variant="outline" onClick={() => setAllowed(true)}>
          載入外部照片
        </Button>
      </div>
    );
  }
  if (failed) {
    return (
      <div className={styles.photoNotice}>
        <p role="status">這張照片暫時無法顯示。</p>
        <Button type="button" variant="outline" onClick={() => setFailed(false)}>
          重新載入照片
        </Button>
      </div>
    );
  }

  const image = (
    // eslint-disable-next-line @next/next/no-img-element -- Fetch directly only after checking the source or obtaining opt-in.
    <img
      className={styles.itemPhoto}
      src={photo.src}
      alt={label}
      referrerPolicy="no-referrer"
      onError={() => {
        setExpanded(false);
        setFailed(true);
      }}
    />
  );
  return (
    <>
      <button
        type="button"
        className={styles.zoomPhoto}
        aria-label={`放大${label}`}
        onClick={() => setExpanded(true)}
      >
        {image}
        <span className={styles.overPhoto}>放大照片</span>
      </button>
      <Modal isOpen={expanded} onClose={() => setExpanded(false)} title={label} size="full">
        {image}
      </Modal>
    </>
  );
}

export function LostFoundGallery({ photos, title }: { photos: LostFoundPhoto[]; title: string }) {
  const [index, setIndex] = useState(0);
  const current = Math.min(index, photos.length - 1);
  const photo = photos[current];
  if (!photo) return null;
  return (
    <section className={styles.gallery} aria-label="物品照片">
      <ItemPhoto key={photo.src} photo={photo} label={`${title}的第 ${current + 1} 張照片`} />
      <div className={styles.photoControls}>
        <span className={styles.muted} aria-live="polite">
          物品照片 {current + 1}／{photos.length}
        </span>
        {photos.length > 1 && (
          <div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={current === 0}
              onClick={() => setIndex(current - 1)}
            >
              上一張
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={current === photos.length - 1}
              onClick={() => setIndex(current + 1)}
            >
              下一張
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
