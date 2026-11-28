'use client';
import { useLayoutEffect, useId, useRef, useState } from 'react';
import { CampusIcon } from './CampusIcon';
import { PrivateImage } from './PrivateImage';
import { LoadingSpinner } from './ui/Button';
import { isPrivateFileObjectPath, resolvePrivateMedia } from '@/lib/privateFiles';
import styles from './PrivateAttachment.module.css';

const FALLBACK_NAME = '附件';
const OBJECT_URL_LIFETIME_MS = 30_000;
const IMAGE_NAME = /\.(png|jpe?g|webp|gif|avif)$/i;
// Control and bidi-override characters must not reach labels or download names.
const UNSAFE_NAME_CHARS = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;

type Props = { path: string; ordinal?: number };

type Attachment =
  | { kind: 'private'; name: string }
  | { kind: 'external'; name: string; href: string }
  | { kind: 'unavailable' };

/** Decode each percent-run on its own so one malformed escape cannot discard the whole name. */
function decodeLoosely(value: string): string {
  return value.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}

function safeName(value: string): string {
  const last = value
    .replace(UNSAFE_NAME_CHARS, '')
    .split(/[\\/]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .at(-1);
  return last && last !== '.' && last !== '..' ? last : FALLBACK_NAME;
}

function describeAttachment(path: string, ordinal: number): Attachment {
  if (isPrivateFileObjectPath(path)) {
    const filename = safeName(path);
    // Current uploaders store a timestamp, index and nonce. These keys omit the original name.
    const generated = /^(?:\d{13}-\d+|\d+-[\da-z]{6,10})-[\da-f]{32}(\.[\da-z]{1,16})?$/i.exec(filename);
    const name = generated ? `附件 ${ordinal}${generated[1] ?? ''}` : filename;
    return { kind: 'private', name };
  }
  if (!/^https?:\/\//i.test(path)) return { kind: 'unavailable' };
  try {
    // pathname never contains the search or hash. Firebase keeps its object path in one
    // encoded segment (`o/groups%2Fg%2Ffile.pdf`), so decoding then taking the basename works.
    const { pathname } = new URL(path);
    return { kind: 'external', name: safeName(decodeLoosely(pathname)), href: path };
  } catch {
    return { kind: 'unavailable' };
  }
}

type Status = 'idle' | 'busy' | 'started' | 'error';

const STATUS_TEXT: Record<Status, string> = {
  idle: '',
  busy: '正在準備下載…',
  started: '已開始下載，請查看瀏覽器的下載項目。',
  error: '附件尚未開放或暫時無法下載，請重試。',
};

function PrivateAttachmentRow({ path, ordinal = 1 }: Props) {
  const attachment = describeAttachment(path, ordinal);
  const [status, setStatus] = useState<Status>('idle');
  const active = useRef(false);
  const busy = useRef(false);
  const statusId = useId();

  useLayoutEffect(() => {
    // Remounted by `key={path}`: an old request can never reach a newer path's state.
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  async function download(name: string) {
    if (busy.current) return;
    busy.current = true;
    setStatus('busy');
    try {
      const media = await resolvePrivateMedia(path);
      if (!active.current) return;
      if (!(media instanceof Blob)) {
        setStatus('error');
        return;
      }
      const url = URL.createObjectURL(media);
      const link = document.createElement('a');
      let clicked = false;
      try {
        link.href = url;
        link.download = name;
        link.rel = 'noopener';
        document.body.append(link);
        link.click();
        clicked = true;
      } finally {
        link.remove();
        if (clicked) setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_LIFETIME_MS);
        else URL.revokeObjectURL(url);
      }
      setStatus('started');
    } catch {
      if (active.current) setStatus('error');
    } finally {
      busy.current = false;
    }
  }

  if (attachment.kind === 'unavailable') {
    return (
      <span className={styles.attachment}>
        <span className={`${styles.row} ${styles.unavailable}`}>
          <CampusIcon name="orders" size={20} className={styles.icon} />
          <span className={styles.name}>{FALLBACK_NAME}</span>
          <span className={`${styles.status} ${styles.statusError}`} role="status">
            附件無法使用
          </span>
        </span>
      </span>
    );
  }

  const { name } = attachment;
  const showImage = IMAGE_NAME.test(name);
  const actionLabel = status === 'busy' ? '準備中…' : status === 'error' ? '重試' : '下載';
  const statusClass = status === 'error' ? styles.statusError : status === 'started' ? styles.statusSuccess : '';

  return (
    <span className={styles.attachment}>
      {showImage && (
        <PrivateImage src={path} width={360} height={240} alt={`附件圖片：${name}`} className={styles.preview} />
      )}
      <span className={styles.row}>
        <CampusIcon name="orders" size={20} className={styles.icon} />
        <span className={styles.name} title={name}>
          {name}
        </span>
        {attachment.kind === 'external' ? (
          <a
            className={`btn ${styles.action} ${styles.external}`}
            href={attachment.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`開啟 ${name}（在新分頁開啟）`}
          >
            <CampusIcon name="arrow" size={18} />
            <span>開啟</span>
          </a>
        ) : (
          <button
            type="button"
            className={`btn ${styles.action}`}
            // aria-disabled keeps keyboard focus on the button while the request runs.
            aria-disabled={status === 'busy' || undefined}
            aria-label={`${actionLabel} ${name}`}
            aria-describedby={statusId}
            onClick={() => void download(name)}
          >
            {status === 'busy' ? <LoadingSpinner size={18} /> : <CampusIcon name="import" size={18} />}
            <span>{actionLabel}</span>
          </button>
        )}
        {attachment.kind === 'private' && (
          <span id={statusId} className={`${styles.status} ${statusClass}`} role="status">
            {STATUS_TEXT[status]}
          </span>
        )}
      </span>
    </span>
  );
}

export function PrivateAttachment(props: Props) {
  return <PrivateAttachmentRow key={props.path} {...props} />;
}
