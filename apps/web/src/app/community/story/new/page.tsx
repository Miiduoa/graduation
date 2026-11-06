'use client';

import { STORY_VIDEO_CONTENT_TYPE, STORY_VIDEO_MAX_SECONDS } from '@campus/shared/src/storyVideo';
import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { CommunityAccess } from '../../_components/CommunityAccess';
import { SiteShell } from '@/components/SiteShell';
import { SchoolScopePlaceholder } from '@/components/SchoolScopePlaceholder';
import { useAuth } from '@/components/AuthGuard';
import { useBrowsingSchoolPageContext } from '@/lib/useBrowsingSchoolPageContext';
import { verifiedSocialPoisForSchool } from '@/lib/community/pois';
import { createStoryId, publishStory, type StoryPublication } from '@/lib/community/firestore';
import { storyMediaError, uploadStoryMedia } from '@/lib/community/media';
import styles from './composer.module.css';

const BACKGROUNDS = [
  ['深綠', '#243b35'],
  ['灰藍', '#3e5169'],
  ['琥珀棕', '#67513d'],
  ['暮紫', '#554661'],
  ['磚紅', '#6f4039'],
  ['石墨灰', '#303b42'],
] as const;
const MAX_TEXT = 220;
const TTL_24H = 24 * 3600 * 1000;

function readVideoDuration(url: string): Promise<number> {
  const video = document.createElement('video');
  return new Promise((resolve, reject) => {
    const unreadable = '無法播放這段影片，請改選含影像的 MP4 檔案。';
    const timeout = window.setTimeout(() => finish(unreadable), 12_000);
    function finish(error?: string) {
      window.clearTimeout(timeout);
      const duration = video.duration;
      video.onloadeddata = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.load();
      if (error) reject(new Error(error));
      else resolve(duration);
    }
    video.onloadeddata = () => {
      if (
        !video.videoWidth ||
        !video.videoHeight ||
        !Number.isFinite(video.duration) ||
        video.duration <= 0
      )
        finish(unreadable);
      else if (video.duration > STORY_VIDEO_MAX_SECONDS) finish('影片最長 30 秒，請先剪短再加入。');
      else finish();
    };
    video.onerror = () => finish(unreadable);
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;
  });
}

export default function StoryComposePage() {
  const { schoolId, schoolName, ready } = useBrowsingSchoolPageContext();
  return (
    <SiteShell
      title="發布限時動態"
      subtitle="與同校同學分享這一刻，動態會保留 24 小時。"
      schoolName={ready ? schoolName : undefined}
    >
      {ready ? (
        <CommunityAccess>
          <StoryComposeInner key={schoolId} schoolId={schoolId} />
        </CommunityAccess>
      ) : (
        <SchoolScopePlaceholder />
      )}
    </SiteShell>
  );
}

function StoryComposeInner({ schoolId }: { schoolId: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const requestedPoi = useSearchParams()?.get('poiId');
  const returnHref = `/community?tab=realtime&schoolId=${encodeURIComponent(schoolId)}`;
  const [poi, setPoi] = useState(() =>
    verifiedSocialPoisForSchool(schoolId).find((item) => item.id === requestedPoi),
  );
  const [body, setBody] = useState('');
  const [allowReplies, setAllowReplies] = useState(true);
  const [bgColor, setBgColor] = useState<string>(BACKGROUNDS[0][1]);
  const [media, setMedia] = useState<{ file: File; preview: string; duration?: number } | null>(
    null,
  );
  const mediaName = media?.duration ? '影片' : '照片';
  const [checkingMedia, setCheckingMedia] = useState(false);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'confirming' | 'publishing' | 'published'>('idle');
  const [result, setResult] = useState<'none' | 'cancelled' | 'unconfirmed' | 'stopped' | 'draft-preserved'>('none');
  const [progress, setProgress] = useState({ bytesTransferred: 0, totalBytes: 1 });
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const textInput = useRef<HTMLTextAreaElement>(null);
  const submitButton = useRef<HTMLButtonElement>(null);
  const mounted = useRef(false);
  const selection = useRef(0);
  const request = useRef<AbortController | null>(null);
  const revision = useRef(0);
  const publication = useRef<{ payload: StoryPublication; revision: number } | null>(null);
  const storyId = useRef('');
  const uploadedMedia = useRef<{ path: string; url?: string } | null>(null);
  const busy = status !== 'idle';
  const needsConfirmation = result === 'unconfirmed' || result === 'stopped';

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, []);
  useEffect(
    () => () => {
      if (media) URL.revokeObjectURL(media.preview);
    },
    [media],
  );

  async function selectMedia(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || request.current) return;
    const selected = ++selection.current;
    const invalid = storyMediaError(file);
    setError(invalid ?? '');
    setCheckingMedia(!invalid);
    if (invalid) return;

    const preview = URL.createObjectURL(file);
    try {
      let duration: number | undefined;
      if (file.type === STORY_VIDEO_CONTENT_TYPE) {
        duration = await readVideoDuration(preview);
      } else {
        const image = new window.Image();
        image.src = preview;
        await image.decode();
      }
      if (!mounted.current || selection.current !== selected) {
        URL.revokeObjectURL(preview);
        return;
      }
      revision.current++;
      storyId.current = '';
      uploadedMedia.current = null;
      setMedia({ file, preview, duration });
    } catch (cause) {
      URL.revokeObjectURL(preview);
      if (mounted.current && selection.current === selected)
        setError(
          file.type === STORY_VIDEO_CONTENT_TYPE && cause instanceof Error
            ? cause.message
            : '無法開啟這張照片，請改選其他圖片。',
        );
    } finally {
      if (mounted.current && selection.current === selected) setCheckingMedia(false);
    }
  }

  function removeMedia() {
    if (request.current) return;
    selection.current++;
    revision.current++;
    storyId.current = '';
    uploadedMedia.current = null;
    setCheckingMedia(false);
    setMedia(null);
    setError('');
  }

  function stopRequest() {
    const controller = request.current;
    if (!controller) return;
    const submitted = !!publication.current;
    controller.abort();
    request.current = null;
    setStatus('idle');
    setResult(submitted ? 'stopped' : 'cancelled');
    setError('');
    requestAnimationFrame(() => {
      if (!mounted.current || request.current) return;
      if (submitted) submitButton.current?.focus();
      else textInput.current?.focus();
    });
  }

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.current || busy || checkingMedia || !user?.uid || (!publication.current && !body.trim() && !media)) return;
    const controller = new AbortController();
    request.current = controller;
    const current = () => mounted.current && request.current === controller && !controller.signal.aborted;
    const retrying = !!publication.current;
    setError('');
    if (!retrying) setResult('none');
    try {
      let entry = publication.current;
      if (!entry) {
        const submittedRevision = revision.current;
        storyId.current ||= createStoryId();
        if (media && !uploadedMedia.current?.url) {
          setStatus('uploading');
          setProgress({ bytesTransferred: 0, totalBytes: media.file.size });
          const uploaded = await uploadStoryMedia({
            schoolId,
            storyId: storyId.current,
            uid: user.uid,
            file: media.file,
            signal: controller.signal,
            uploadedPath: uploadedMedia.current?.path,
            onProgress: (next) => {
              if (current()) setProgress(next);
            },
            onUploaded: (path) => {
              if (current()) uploadedMedia.current = { path };
            },
          });
          if (!current()) return;
          uploadedMedia.current = uploaded;
        }
        entry = {
          revision: submittedRevision,
          payload: {
            storyId: storyId.current,
            schoolId,
            authorUid: user.uid,
            kind: media?.duration ? 'video' : media ? 'image' : 'text',
            text: body.trim(),
            allowReplies,
            mediaUrl: media ? uploadedMedia.current?.url ?? null : null,
            bgColor,
            poiId: poi?.id ?? null,
            poiName: poi?.name ?? null,
            expiresAtMs: Date.now() + TTL_24H,
          },
        };
        publication.current = entry;
      }
      setStatus(retrying ? 'confirming' : 'publishing');
      await publishStory(entry.payload, {
        signal: controller.signal,
        confirmFirst: retrying,
      });
      if (!current()) return;
      publication.current = null;
      if (revision.current !== entry.revision) {
        storyId.current = '';
        uploadedMedia.current = null;
        setStatus('idle');
        setResult('draft-preserved');
        requestAnimationFrame(() => {
          if (mounted.current && !request.current) textInput.current?.focus();
        });
      } else {
        setStatus('published');
        router.replace(returnHref);
      }
    } catch {
      if (current()) {
        setStatus('idle');
        setResult(publication.current ? 'unconfirmed' : 'none');
        setError(publication.current
          ? '尚未確認原版本是否發布。請確認連線與校園帳號後再試一次。'
          : '媒體尚未完成上傳，草稿已保留。請確認連線後重試。');
        requestAnimationFrame(() => {
          if (mounted.current && !request.current) submitButton.current?.focus();
        });
      }
    } finally {
      if (request.current === controller) request.current = null;
    }
  }

  return (
    <form className={styles.composer} onSubmit={publish} aria-label="編輯限時動態">
      <div className={styles.layout}>
        <fieldset className={styles.editor} disabled={busy}>
          <div className={styles.labelRow}>
            <label htmlFor="story-text">{media ? `${mediaName}說明（選填）` : '文字內容'}</label>
            <small id="story-count">
              {body.length} / {MAX_TEXT}
            </small>
          </div>
          <textarea
            ref={textInput}
            id="story-text"
            className="input"
            value={body}
            onChange={(event) => {
              revision.current++;
              setBody(event.target.value);
            }}
            aria-describedby="story-count"
            maxLength={MAX_TEXT}
            rows={3}
            placeholder={media ? '這一刻有什麼故事？' : '校園裡有什麼新鮮事？'}
          />
          <div className={styles.photoRow}>
            <input
              ref={fileInput}
              type="file"
              accept={`image/*,${STORY_VIDEO_CONTENT_TYPE}`}
              aria-label="限動照片或影片"
              hidden
              onChange={selectMedia}
            />
            <button className="btn" type="button" onClick={() => fileInput.current?.click()}>
              {media ? '更換媒體' : '加入照片或影片'}
            </button>
            {media && (
              <button className="btn" type="button" onClick={removeMedia}>
                移除{mediaName}
              </button>
            )}
          </div>
          <small className={styles.mediaHint}>MP4 影片最長 30 秒，檔案須小於 100 MB。</small>
          {!media && (
            <fieldset className={styles.palette}>
              <legend>背景顏色</legend>
              {BACKGROUNDS.map(([name, color]) => (
                <button
                  key={color}
                  type="button"
                  aria-label={name}
                  aria-pressed={bgColor === color}
                  title={name}
                  onClick={() => {
                    if (bgColor !== color) revision.current++;
                    setBgColor(color);
                  }}
                >
                  <span style={{ backgroundColor: color }}>{bgColor === color ? '✓' : ''}</span>
                </button>
              ))}
            </fieldset>
          )}
          <label className={styles.replySetting}>
            <input
              type="checkbox"
              checked={allowReplies}
              onChange={(event) => {
                revision.current++;
                setAllowReplies(event.target.checked);
              }}
            />
            允許同校成員私訊回覆
          </label>
          {poi && (
            <button
              className={styles.location}
              type="button"
              onClick={() => {
                revision.current++;
                setPoi(undefined);
              }}
              aria-label={`移除地點：${poi.name}`}
            >
              {poi.name} <span aria-hidden="true">×</span>
            </button>
          )}
        </fieldset>

        <figure className={styles.previewPanel}>
          <figcaption>
            限時動態預覽{media?.duration ? ` · ${Math.ceil(media.duration)} 秒` : ''}
          </figcaption>
          <div
            className={styles.preview}
            data-video={!!media?.duration}
            style={{ background: media ? '#101315' : bgColor }}
          >
            {media?.duration ? (
              <video
                key={media.preview}
                src={media.preview}
                aria-label="已選取的影片"
                controls
                playsInline
                muted
                preload="metadata"
              />
            ) : media ? (
              <Image src={media.preview} alt="已選取的照片" unoptimized fill sizes="220px" />
            ) : null}
            {body.trim() ? (
              <span className={media ? styles.caption : styles.storyText}>{body.trim()}</span>
            ) : (
              !media && <span className={styles.hint}>你的文字會顯示在這裡</span>
            )}
            {poi && <span className={styles.place}>{poi.name}</span>}
          </div>
        </figure>
      </div>
      <div className={styles.actions}>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <span role="status" className={styles.status}>
          {checkingMedia
            ? '正在讀取媒體…'
            : status === 'uploading'
              ? `正在上傳${mediaName}…`
              : status === 'confirming'
                ? '正在確認或重試原版本…'
                : status === 'publishing'
                  ? '正在發布限時動態…'
                  : status === 'published'
                    ? '限時動態已發布'
                    : result === 'cancelled'
                      ? '已取消上傳，文字、媒體與設定已保留。'
                      : result === 'stopped'
                        ? '已停止等待，可稍後確認原版本是否發布。'
                        : result === 'unconfirmed'
                          ? '重新確認會沿用首次送出的內容，目前修改會保留。'
                          : result === 'draft-preserved'
                            ? '上一版已發布，修改後的草稿已保留。'
                            : ''}
        </span>
        {status === 'uploading' && (
          <div className={styles.progress}>
            <progress
              aria-label={`上傳${mediaName}進度`}
              value={progress.bytesTransferred}
              max={progress.totalBytes}
            />
            <span aria-hidden="true">{Math.floor(progress.bytesTransferred / progress.totalBytes * 100)}%</span>
          </div>
        )}
        <div className={styles.actionRow}>
          {status === 'uploading' || status === 'publishing' || status === 'confirming' ? (
            <button className="btn" type="button" onClick={stopRequest}>
              {status === 'uploading' ? '取消上傳' : '停止等待'}
            </button>
          ) : <Link
            href={returnHref}
            className="btn"
            aria-disabled={busy}
            onClick={(event) => {
              if (busy) event.preventDefault();
            }}
          >
            {result === 'draft-preserved' ? '查看限動' : '取消'}
          </Link>}
          <button
            ref={submitButton}
            className="btn primary"
            type="submit"
            disabled={busy || checkingMedia || (!needsConfirmation && !body.trim() && !media)}
          >
            {busy ? (status === 'published' ? '已發布' : '發布中…')
              : needsConfirmation ? '確認／重試原版本'
                : result === 'draft-preserved' ? '發布修改後的草稿' : '發布限時動態'}
          </button>
        </div>
      </div>
    </form>
  );
}
