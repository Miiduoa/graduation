'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  NuniError,
  nuniErrorMessage,
  type NuniMaterial,
  type NuniUnit,
  type NuniWorkspace,
} from '@campus/shared/src/nuni';
import { MutationForm, useClasses } from './CourseUI';
import { CourseUnitSelect } from './CourseUnitSelect';
import { selectCourseUnit } from './courseOutline';
import { useLocationHash } from '@/lib/useLocationHash';
import { useNuniSession } from './Session';
import shared from './NuniApp.module.css';
import styles from './CourseLearning.module.css';

function referenceUrl(candidate: string): string | null {
  try {
    const url = new URL(candidate);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function CourseText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const expression = /https?:\/\/[^\s<>"']+/gi;
  let offset = 0;
  for (const match of text.matchAll(expression)) {
    const start = match.index!;
    const candidate = match[0].replace(/[。，、；：！？）〉》」』】,.;!?)]+$/u, '');
    parts.push(text.slice(offset, start));
    const href = referenceUrl(candidate);
    if (href) {
      parts.push(
        <a key={start} href={href} target="_blank" rel="noopener noreferrer">
          {candidate}
        </a>,
      );
      parts.push(match[0].slice(candidate.length));
    } else {
      parts.push(match[0]);
    }
    offset = start + match[0].length;
  }
  parts.push(text.slice(offset));
  return <div className={`${shared.prose} ${styles.body}`}>{parts}</div>;
}

export function CourseMaterials({ workspace, units, onChanged }: { workspace: NuniWorkspace; units?: NuniUnit[] | null; onChanged?: () => void }) {
  const { session, pendingLogout } = useNuniSession();
  if (!session || pendingLogout) return null;
  return (
    <Materials
      key={`${session.context}:${workspace.id}:${workspace.memberRole}:${workspace.state}`}
      workspace={workspace}
      units={units}
      onChanged={onChanged}
    />
  );
}

function Materials({ workspace, units, onChanged }: { workspace: NuniWorkspace; units?: NuniUnit[] | null; onChanged?: () => void }) {
  const classes = useClasses();
  const [items, setItems] = useState<NuniMaterial[] | null>(null);
  const hash = useLocationHash();
  const revealed = useRef('');
  const [reading, setReading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [accessDenied, setAccessDenied] = useState(false);
  const denied = useRef(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [readingMore, setReadingMore] = useState(false);
  const [moreError, setMoreError] = useState('');
  const moreRequest = useRef<symbol | null>(null);
  const request = useRef(0);
  const mounted = useRef(true);
  const editable =
    !accessDenied && workspace.state === 'active' && workspace.memberRole !== 'student';

  async function load() {
    if (denied.current) return;
    const run = ++request.current;
    moreRequest.current = null;
    setReadingMore(false);
    setMoreError('');
    setNextCursor(null);
    setReading(true);
    setError('');
    try {
      const result = await classes.materialsPage(workspace.id);
      if (mounted.current && run === request.current) {
        setItems(result.materials);
        setNextCursor(result.nextCursor);
      }
    } catch (failure) {
      if (mounted.current && run === request.current) {
        if (failure instanceof NuniError && [403, 404].includes(failure.status)) {
          setItems(null);
          setNotice('');
          denied.current = true;
          setAccessDenied(true);
        }
        setError(nuniErrorMessage(failure));
      }
    } finally {
      if (mounted.current && run === request.current) setReading(false);
    }
  }

  async function loadMore() {
    if (reading || denied.current || !nextCursor || moreRequest.current) return;
    const run = request.current;
    const token = Symbol();
    moreRequest.current = token;
    setReadingMore(true);
    setMoreError('');
    try {
      const result = await classes.materialsPage(workspace.id, nextCursor);
      if (!mounted.current || run !== request.current || moreRequest.current !== token) return;
      setItems((previous) => {
        const existing = new Set(previous?.map((item) => item.id));
        return [...(previous ?? []), ...result.materials.filter((item) => !existing.has(item.id))];
      });
      setNextCursor(result.nextCursor);
    } catch (failure) {
      if (!mounted.current || run !== request.current || moreRequest.current !== token) return;
      if (failure instanceof NuniError && [403, 404].includes(failure.status)) {
        denied.current = true;
        setAccessDenied(true);
        setItems(null);
        setNextCursor(null);
        setNotice('');
        setError(nuniErrorMessage(failure));
      } else if (failure instanceof NuniError && failure.code === 'CLASS_WORKSPACE_MATERIAL_CURSOR_INVALID') {
        ++request.current;
        moreRequest.current = null;
        setReadingMore(false);
        setNextCursor(null);
        setError(nuniErrorMessage(failure));
      } else {
        setMoreError(nuniErrorMessage(failure));
      }
    } finally {
      if (mounted.current && run === request.current && moreRequest.current === token) {
        moreRequest.current = null;
        setReadingMore(false);
      }
    }
  }

  useEffect(() => {
    mounted.current = true;
    // Start the course read on mount; the same loader also manages explicit refreshes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    return () => {
      mounted.current = false;
    };
    // The parent key changes with session, workspace, role and archive status.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const target = hash.slice(1);
    if (!target.startsWith('material-') || revealed.current === target ||
      !items?.some((item) => `material-${item.id}` === target)) return;
    const frame = window.requestAnimationFrame(() => {
      const element = document.getElementById(target);
      if (!element) return;
      element.scrollIntoView?.({ block: 'start' });
      element.focus({ preventScroll: true });
      revealed.current = target;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [hash, items]);

  return (
    <section className={shared.panel} aria-labelledby={`materials-${workspace.id}`}>
      <div className={styles.heading}>
        <div>
          <p className={shared.eyebrow}>課程內容</p>
          <h2 id={`materials-${workspace.id}`}>教材與參考資料</h2>
        </div>
        <button
          type="button"
          className={`${shared.button} ${shared.secondary}`}
          disabled={reading || accessDenied}
          onClick={() => void load()}
        >
          {reading ? '讀取中…' : '更新教材'}
        </button>
      </div>
      <p className={shared.muted}>閱讀老師發布的說明與參考連結。</p>
      {workspace.state === 'archived' && (
        <p className={styles.note}>課程已封存，教材保留供成員閱讀。</p>
      )}
      {notice && (
        <p role="status" className={shared.receipt}>
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className={shared.notice}>
          {error} {accessDenied ? '請回到課程列表，重新確認課程權限。' : '請使用「更新教材」重試。'}
        </p>
      )}
      {reading && items === null && <p role="status">正在讀取教材…</p>}
      {items !== null &&
        (items.length ? (
          <ul className={`${shared.list} ${styles.materials}`}>
            {items.map((item) => (
              <li key={item.id}>
                <article id={`material-${item.id}`} tabIndex={-1} aria-labelledby={`material-heading-${item.id}`}>
                  <div className={styles.metadata}>
                    {item.unitTitle && <span>{item.unitTitle}</span>}
                    <time dateTime={item.createdAt}>
                      {new Date(item.createdAt).toLocaleDateString('zh-TW')}
                    </time>
                  </div>
                  <h3 id={`material-heading-${item.id}`}>{item.title}</h3>
                  <CourseText text={item.body} />
                </article>
              </li>
            ))}
          </ul>
        ) : (
          <p className={shared.muted}>
            目前還沒有教材。
            {editable ? '可在下方發布課程說明或參考連結。' : '老師發布後會顯示在這裡。'}
          </p>
        ))}
      {moreError && (
        <p role="alert" className={shared.notice}>
          {moreError} 已讀取的教材仍保留。請重試載入較早教材，或使用「更新教材」重新讀取。
        </p>
      )}
      {nextCursor && !accessDenied && (
        <button
          type="button"
          className={`${shared.button} ${shared.secondary}`}
          disabled={reading || readingMore}
          onClick={() => void loadMore()}
        >
          {readingMore ? '讀取較早教材中…' : moreError ? '重試載入較早教材' : '載入較早教材'}
        </button>
      )}
      {editable && (
        <details className={`${shared.compose} ${styles.compose}`}>
          <summary>發布教材</summary>
          <p className={shared.muted}>填寫文字內容，或貼上學生可以開啟的參考網址。</p>
          <MutationForm
            label="發布教材"
            submit={async (data, key) => {
              setNotice('');
              const receipt = await classes.createMaterial(workspace.id, {
                title: String(data.get('title') ?? ''),
                body: String(data.get('body') ?? ''),
                unitId: units === undefined ? undefined : selectCourseUnit(data, units),
                idempotencyKey: key,
              });
              if (!mounted.current || denied.current) throw new NuniError(409, 'SESSION_CHANGED');
              ++request.current;
              setItems((previous) => [
                receipt,
                ...(previous ?? []).filter((item) => item.id !== receipt.id),
              ]);
              setNotice(`已發布「${receipt.title}」。`);
              onChanged?.();
              void load();
            }}
          >
            <label>
              教材標題
              <input name="title" required maxLength={160} placeholder="例如：本週閱讀與課前準備" />
            </label>
            {units !== undefined && <CourseUnitSelect units={units} />}
            <label>
              教材內容或參考連結
              <textarea
                name="body"
                required
                maxLength={8000}
                placeholder="說明閱讀重點，或貼上 https:// 開頭的參考網址。"
              />
            </label>
          </MutationForm>
        </details>
      )}
    </section>
  );
}
