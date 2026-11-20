'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { NuniLostFoundItem } from '@campus/shared/src/nuniLostFound';
import { lostFoundFormFields } from '@campus/shared/src/lostFoundFields';
import { Button } from '@/components/ui/Button';
import { LostFoundItemTag } from '@/components/lost-found/LostFoundItemTag';
import { PlatformLostFoundEditor } from './PlatformLostFoundEditor';
import type { PlatformLostFoundPending } from './platformLostFoundPending';
import {
  errorMessage,
  isExpired,
  platformLostFoundHref,
  type Scope,
  type Client,
  type Write,
  type Receipt,
} from './platformLostFoundUi';
import styles from '@/components/lost-found/LostFound.module.css';

export function PlatformLostFoundDetail({
  id,
  schoolId,
  filters,
  client,
  expire,
  pending,
  write,
  busy,
  disabled,
}: Scope & {
  id: string;
  client: Client;
  expire: () => void;
  pending: PlatformLostFoundPending | null;
  write: Write;
  busy: boolean;
  disabled: boolean;
}) {
  const router = useRouter();
  const alive = useRef(false);
  const readGeneration = useRef(0);
  const [item, setItem] = useState<NuniLostFoundItem | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<'resolve' | 'remove' | null>(null);
  const [message, setMessage] = useState('');
  const ownPending = pending?.input.id === id ? pending : null;
  const locked = disabled || busy || !!pending;
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let current = true;
    const generation = ++readGeneration.current;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- drop the previous receipt while confirming the current record
    setItem(null);
    setError('');
    setConfirm(null);
    setEditing(false);
    void client.get({ schoolId, id }).then(
      (value) => {
        if (current && alive.current && generation === readGeneration.current) setItem(value);
      },
      (reason) => {
        if (!current || !alive.current || generation !== readGeneration.current) return;
        if (isExpired(reason)) expire();
        else setError(errorMessage(reason, 'read'));
      },
    );
    return () => {
      current = false;
    };
    // The workspace key fences authentication and scope; expire is intentionally not a fetch trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, schoolId, id, revision]);
  function accept(receipt: Receipt) {
    if (!alive.current) return;
    ++readGeneration.current;
    setError('');
    setEditing(false);
    setConfirm(null);
    if ('removed' in receipt) {
      setItem(null);
      setMessage('刊登已下架，內容與聯絡方式已刪除。');
      router.replace(platformLostFoundHref(schoolId, 'list', undefined, filters));
    } else {
      setItem(receipt);
      setMessage(receipt.status === 'resolved' ? '已結案，聯絡方式已清除。' : '已儲存變更。');
    }
  }
  return (
    <section className={styles.panel}>
      <Link
        className={styles.link}
        href={platformLostFoundHref(schoolId, 'list', undefined, filters)}
      >
        返回刊登列表
      </Link>
      {error && (
        <>
          <p role="alert">{error}</p>
          <Button disabled={busy} onClick={() => setRevision((value) => value + 1)}>
            重新讀取
          </Button>
        </>
      )}
      {message && (
        <p role="status" className={styles.success}>
          {message}
        </p>
      )}
      {!item && !error && <p role="status">正在讀取刊登內容…</p>}
      {item && (
        <>
          <LostFoundItemTag item={item}>
            <p style={{ whiteSpace: 'pre-wrap' }}>{item.description}</p>
            <h3>聯絡方式</h3>
            <p style={{ whiteSpace: 'pre-wrap' }}>
              {item.status === 'resolved'
                ? '已結案，聯絡方式已清除。'
                : item.contactInfo || '未提供聯絡方式。'}
            </p>
          </LostFoundItemTag>
          {item.isOwner && (
            <>
              <div className={styles.actions}>
                {item.status === 'open' && (
                  <>
                    <Button
                      disabled={locked}
                      onClick={() => {
                        setEditing(true);
                        setMessage('');
                      }}
                    >
                      編輯刊登
                    </Button>
                    <Button disabled={locked} onClick={() => setConfirm('resolve')}>
                      標記結案
                    </Button>
                  </>
                )}
                <Button variant="danger" disabled={locked} onClick={() => setConfirm('remove')}>
                  下架刊登
                </Button>
                <Button disabled={busy} onClick={() => setRevision((value) => value + 1)}>
                  查看最新內容
                </Button>
              </div>
              {confirm && (
                <div
                  className={styles.resolveBox}
                  role="group"
                  aria-label={confirm === 'resolve' ? '確認結案' : '確認下架'}
                >
                  <p>
                    {confirm === 'resolve'
                      ? '結案後會清除聯絡方式，並停止編輯。確定這件物品已處理完成？'
                      : '下架後將刪除刊登內容與聯絡方式，其他人無法再查看。確定下架？'}
                  </p>
                  <div className={styles.actions}>
                    <Button
                      variant="danger"
                      disabled={locked}
                      onClick={() =>
                        void write(
                          {
                            action: confirm,
                            input: {
                              schoolId,
                              id,
                              expectedVersion: item.version,
                              mutationId: crypto.randomUUID(),
                            },
                          },
                          accept,
                        )
                      }
                    >
                      {confirm === 'resolve' ? '確認結案並清除聯絡方式' : '確認下架'}
                    </Button>
                    <Button disabled={busy} onClick={() => setConfirm(null)}>
                      取消
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
      {((editing && item?.isOwner && item.status === 'open') ||
        ownPending?.action === 'update') && (
        <div style={{ marginTop: 20 }}>
          <h2>編輯刊登</h2>
          <PlatformLostFoundEditor
            key={ownPending?.input.mutationId ?? 'edit-' + item?.version}
            initial={
              ownPending?.action === 'update' ? ownPending.input.fields : lostFoundFormFields(item!)
            }
            pending={ownPending?.action === 'update'}
            busy={busy}
            disabled={disabled || (!!pending && !ownPending)}
            submitLabel="儲存變更"
            onCancel={() => setEditing(false)}
            onSubmit={(fields) => {
              const operation =
                ownPending?.action === 'update'
                  ? ownPending
                  : {
                      action: 'update' as const,
                      input: {
                        schoolId,
                        id,
                        fields,
                        expectedVersion: item!.version,
                        mutationId: crypto.randomUUID(),
                      },
                    };
              void write(operation, accept);
            }}
          />
        </div>
      )}
      {ownPending && ownPending.action !== 'update' && (
        <div className={styles.actions}>
          <Button
            variant="primary"
            disabled={busy || disabled}
            onClick={() => void write(ownPending, accept)}
          >
            {busy ? '正在確認…' : '重試並確認結果'}
          </Button>
        </div>
      )}
    </section>
  );
}
