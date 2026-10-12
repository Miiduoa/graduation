'use client';

import { useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import { isOutsideDialog, openModalSession } from './modalSession';
import styles from './Modal.module.css';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  showCloseButton?: boolean;
  closeOnOverlayClick?: boolean;
  closeOnEsc?: boolean;
  footer?: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
  'aria-label'?: string;
  'aria-describedby'?: string;
}

const subscribeToClient = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

const widths = { sm: '360px', md: '480px', lg: '640px', xl: '800px', full: 'calc(100vw - 32px)' };

function Modal({
  isOpen, onClose, title, description, children, size = 'md', showCloseButton = true,
  closeOnOverlayClick = true, closeOnEsc = true, footer, initialFocusRef,
  'aria-label': label, 'aria-describedby': describedBy,
}: ModalProps) {
  const clientReady = useSyncExternalStore(subscribeToClient, clientSnapshot, serverSnapshot);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const backdropStart = useRef(false);
  const id = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!isOpen || !clientReady || !dialog) return;
    return openModalSession(dialog, initialFocusRef?.current);
  }, [isOpen, clientReady, initialFocusRef]);

  if (!isOpen || !clientReady) return null;
  return createPortal(
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      style={{ '--dialog-width': widths[size] } as CSSProperties}
      aria-modal="true"
      aria-labelledby={title ? `${id}-title` : undefined}
      aria-label={title ? undefined : label || '對話視窗'}
      aria-describedby={describedBy || (description ? `${id}-description` : undefined)}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (closeOnEsc) onClose();
      }}
      onClose={(event) => {
        event.stopPropagation();
        // Ignore a queued close event from an effect cleanup followed by a reopen.
        if (!event.currentTarget.open) onClose();
      }}
      onPointerDown={(event) => {
        backdropStart.current = event.target === event.currentTarget &&
          isOutsideDialog(event.currentTarget, event.clientX, event.clientY);
      }}
      onPointerCancel={() => { backdropStart.current = false; }}
      onClick={(event) => {
        const dismiss = backdropStart.current && event.target === event.currentTarget &&
          isOutsideDialog(event.currentTarget, event.clientX, event.clientY);
        backdropStart.current = false;
        if (dismiss && closeOnOverlayClick) onClose();
      }}
    >
      {(title || description || showCloseButton) && (
        <div className={styles.header}>
          <div className={styles.heading}>
            {title && <h2 id={`${id}-title`} className={styles.title}>{title}</h2>}
            {description && <p id={`${id}-description`} className={styles.description}>{description}</p>}
          </div>
          {showCloseButton && (
            <button type="button" onClick={onClose} className={styles.close} aria-label="關閉視窗">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
                <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
      )}
      <div className={styles.body}>{children}</div>
      {footer && <div className={styles.footer}>{footer}</div>}
    </dialog>,
    document.body,
  );
}

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => unknown;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
  loading?: boolean;
}

function ConfirmDialog({
  onClose, onConfirm, title, message, confirmText = '確認', cancelText = '取消',
  variant = 'info', loading = false,
}: ConfirmModalProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messageId = useId();
  const busy = loading || pending;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  function requestClose() {
    if (!loading && !inFlight.current) onClose();
  }

  async function confirm() {
    if (loading || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      await onConfirm();
    } catch {
      if (mounted.current) {
        // A lost response is not proof the server rejected an operation.
        setError('無法確認操作結果。請先查看目前狀態，再決定是否重試。');
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  }

  return (
    <Modal
      isOpen
      onClose={requestClose}
      title={title}
      size="sm"
      showCloseButton={false}
      closeOnEsc={!busy}
      closeOnOverlayClick={!busy}
      initialFocusRef={cancelRef}
      aria-describedby={messageId}
      footer={
        <>
          <Button ref={cancelRef} type="button" variant="ghost" onClick={requestClose} disabled={busy}>
            {cancelText}
          </Button>
          <Button type="button" variant={variant === 'danger' ? 'danger' : 'primary'} onClick={confirm} loading={busy}>
            {busy ? '處理中…' : confirmText}
          </Button>
        </>
      }
    >
      <p id={messageId} className={styles.message}>{message}</p>
      {busy && <p role="status" className={styles.notice}>正在處理，請勿重複送出。</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </Modal>
  );
}

function ConfirmModal(props: ConfirmModalProps) {
  // Each opening owns its pending state; a late response cannot alter the next opening.
  return props.isOpen ? <ConfirmDialog {...props} /> : null;
}

export { Modal, ConfirmModal };
export type { ModalProps, ConfirmModalProps };
