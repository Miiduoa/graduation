import { requireOptionalNativeModule } from 'expo';
import { randomUUID } from 'expo-crypto';
import { isStudentCardToken, STUDENT_CARD_TTL_MS } from '@campus/shared/src/studentCard';
import { abortableCampusRead } from './abortableCampusRead';
import type { StudentCardCode } from './studentCard';

export type StudentCardNfcCapabilities = {
  moduleAvailable: boolean;
  canRead: boolean;
  canPresent: boolean;
  enabled: boolean;
};

export type StudentCardNfcErrorCode =
  | 'CANCELLED'
  | 'UNAVAILABLE'
  | 'DISABLED'
  | 'BUSY'
  | 'INVALID'
  | 'EXPIRED'
  | 'READ_FAILED'
  | 'FAILED';

export class StudentCardNfcError extends Error {
  constructor(
    public readonly code: StudentCardNfcErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'StudentCardNfcError';
  }
}

export interface StudentCardNfcNativeAdapter {
  getCapabilities(): Promise<unknown>;
  beginPresentation(token: string, expiresAt: number, presentationId: string): Promise<void>;
  endPresentation(): Promise<void>;
  readPresentation(): Promise<unknown>;
  cancelRead(): Promise<void>;
  addListener(
    event: 'onPresentationEnded',
    listener: (event: { presentationId: string }) => void,
  ): { remove(): void };
}

const messages: Record<StudentCardNfcErrorCode, string> = {
  CANCELLED: '已取消感應。',
  UNAVAILABLE: '這台裝置或目前的 App 版本無法使用 NFC，請改用 QR Code。',
  DISABLED: '請先在裝置設定中開啟 NFC。',
  BUSY: '上一個感應操作正在結束，請稍候再試。',
  INVALID: '感應資料無法確認，請對方重新出示。',
  EXPIRED: '這組驗證碼已到期，請重新取得。',
  READ_FAILED: '感應未完成，請靠近對方手機後再試。',
  FAILED: 'NFC 暫時無法使用，請稍後再試。',
};

function nfcError(code: StudentCardNfcErrorCode) {
  return new StudentCardNfcError(code, messages[code]);
}

function normalizeError(error: unknown): StudentCardNfcError {
  if (error instanceof StudentCardNfcError) return error;
  const code = (error as { code?: unknown } | null)?.code;
  if (
    typeof code === 'string' &&
    code.trim() === code &&
    /^ERR_NFC_(CANCELLED|UNAVAILABLE|DISABLED|BUSY|INVALID|EXPIRED|READ_FAILED)$/.test(code)
  ) {
    return nfcError(code.slice('ERR_NFC_'.length) as StudentCardNfcErrorCode);
  }
  return nfcError('FAILED');
}

function validatePresentation(code: Pick<StudentCardCode, 'token' | 'expiresAt'>) {
  if (!code || !isStudentCardToken(code.token)) throw nfcError('INVALID');
  if (
    !Number.isSafeInteger(code.expiresAt) ||
    code.expiresAt > Date.now() + STUDENT_CARD_TTL_MS + 5_000
  )
    throw nfcError('INVALID');
  if (code.expiresAt <= Date.now()) throw nfcError('EXPIRED');
}

type Session = {
  kind: 'read' | 'present';
  signal: AbortSignal;
  result: Promise<unknown>;
  stop(): Promise<void>;
  release(): void;
  expiryTimer?: ReturnType<typeof setTimeout>;
  endedSubscription?: { remove(): void };
};

export function createStudentCardNfcClient(adapter: StudentCardNfcNativeAdapter | null) {
  let active: Session | null = null;

  function startSession(
    kind: Session['kind'],
    start: (native: StudentCardNfcNativeAdapter) => Promise<unknown>,
    signal?: AbortSignal,
  ): Session {
    if (signal?.aborted) throw nfcError('CANCELLED');
    if (!adapter) throw nfcError('UNAVAILABLE');
    if (active) throw nfcError('BUSY');
    const controller = new AbortController();
    let stopping: Promise<void> | null = null;
    const stopNative = () => (kind === 'read' ? adapter.cancelRead() : adapter.endPresentation());
    const onAbort = () => {
      void session.stop().catch(() => undefined);
    };
    const session: Session = {
      kind,
      signal: controller.signal,
      result: Promise.resolve().then(() => {
        if (controller.signal.aborted) throw nfcError('CANCELLED');
        return start(adapter);
      }),
      stop() {
        if (active !== session) return Promise.resolve();
        if (stopping) return stopping;
        controller.abort();
        // Keep ownership until a delayed native start has settled and been cleared.
        stopping = Promise.resolve()
          .then(stopNative)
          .then(() =>
            session.result.then(
              () => undefined,
              () => undefined,
            ),
          )
          .then(stopNative)
          .then(() => session.release())
          .catch((error: unknown) => {
            stopping = null;
            throw normalizeError(error);
          });
        return stopping;
      },
      release() {
        signal?.removeEventListener('abort', onAbort);
        clearTimeout(session.expiryTimer);
        session.endedSubscription?.remove();
        session.endedSubscription = undefined;
        if (active === session) active = null;
      },
    };
    active = session;
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    return session;
  }

  return {
    async getCapabilities(): Promise<StudentCardNfcCapabilities> {
      if (!adapter)
        return { moduleAvailable: false, canRead: false, canPresent: false, enabled: false };
      try {
        const capabilities = await adapter.getCapabilities();
        if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities))
          throw nfcError('FAILED');
        const { canRead, canPresent, enabled } = capabilities as Record<string, unknown>;
        if (
          typeof canRead !== 'boolean' ||
          typeof canPresent !== 'boolean' ||
          typeof enabled !== 'boolean'
        )
          throw nfcError('FAILED');
        return { moduleAvailable: true, canRead, canPresent, enabled };
      } catch (error) {
        throw normalizeError(error);
      }
    },
    async beginPresentation(
      code: StudentCardCode,
      signal?: AbortSignal,
      onStopped?: () => void,
    ): Promise<void> {
      if (signal?.aborted) throw nfcError('CANCELLED');
      validatePresentation(code);
      const presentation = { token: code.token, expiresAt: code.expiresAt };
      const session = startSession(
        'present',
        (native) => {
          validatePresentation(presentation);
          const presentationId = randomUUID();
          session.endedSubscription = native.addListener('onPresentationEnded', (event) => {
            if (
              active !== session ||
              session.signal.aborted ||
              event?.presentationId !== presentationId
            )
              return;
            void session.stop().catch(() => undefined);
            onStopped?.();
          });
          if (session.signal.aborted) throw nfcError('CANCELLED');
          return native.beginPresentation(
            presentation.token,
            presentation.expiresAt,
            presentationId,
          );
        },
        signal,
      );
      try {
        await abortableCampusRead(() => session.result, session.signal);
        if (session.signal.aborted) throw nfcError('CANCELLED');
        validatePresentation(presentation);
        session.expiryTimer = setTimeout(() => {
          void session.stop().catch(() => undefined);
        }, presentation.expiresAt - Date.now());
      } catch (error) {
        const cancelled = session.signal.aborted;
        void session.stop().catch(() => undefined);
        throw cancelled ? nfcError('CANCELLED') : normalizeError(error);
      }
    },
    async endPresentation(): Promise<void> {
      if (active?.kind === 'present') await active.stop();
    },
    async read(signal?: AbortSignal): Promise<string> {
      const session = startSession('read', (native) => native.readPresentation(), signal);
      try {
        const token = await abortableCampusRead(() => session.result, session.signal);
        if (session.signal.aborted) throw nfcError('CANCELLED');
        if (!isStudentCardToken(token)) throw nfcError('INVALID');
        session.release();
        return token;
      } catch (error) {
        const cancelled = session.signal.aborted;
        void session.stop().catch(() => undefined);
        throw cancelled ? nfcError('CANCELLED') : normalizeError(error);
      }
    },
    async cancelRead(): Promise<void> {
      if (active?.kind === 'read') await active.stop();
    },
  };
}

const native = requireOptionalNativeModule<StudentCardNfcNativeAdapter>('CampusStudentCardNfc');
const client = createStudentCardNfcClient(native);

export const getStudentCardNfcCapabilities = client.getCapabilities;
export const beginStudentCardNfcPresentation = client.beginPresentation;
export const endStudentCardNfcPresentation = client.endPresentation;
export const readStudentCardNfc = client.read;
export const cancelStudentCardNfcRead = client.cancelRead;
