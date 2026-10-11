import {
  NuniError,
  nuniId,
  nuniRecord,
  parseNuniPrincipal,
  type NuniPrincipal,
} from '@campus/shared/src/nuni';
import {
  NUNI_HANDLE,
  parseNuniLoginSession,
  parseNuniLoginTransaction,
  type NuniTransport,
} from './nuniClient';

export type NativeNuniSession = NuniPrincipal & { context: string };
export type NativeNuniState = {
  session: NativeNuniSession | null;
  loading: boolean;
  error: string;
  pendingLogout: boolean;
};
type StoredSession = {
  sessionHandle: string;
  platformAccountId: string;
  expiresAt: number;
  pendingLogout: boolean;
};
export type NuniSessionDependencies = {
  storage: {
    read(): Promise<string | null>;
    write(value: string): Promise<void>;
    clear(): Promise<void>;
  };
  logoutFence: {
    read(): Promise<boolean>;
    mark(): Promise<void>;
    clear(): Promise<void>;
  };
  request: NuniTransport;
  credential(clientId: string, nonce: string): Promise<string>;
  clearCredential(): Promise<void>;
  now?: () => number;
};

function storedSession(value: string): StoredSession {
  const row = JSON.parse(value) as StoredSession;
  if (
    !row ||
    !NUNI_HANDLE.test(row.sessionHandle) ||
    typeof row.expiresAt !== 'number' ||
    !Number.isFinite(row.expiresAt) ||
    typeof row.pendingLogout !== 'boolean'
  ) {
    throw new NuniError(502, 'INVALID_SESSION_STORAGE');
  }
  nuniId(row.platformAccountId, 'pa');
  return row;
}

/** Owns one native session; a screen must present its captured context for every request. */
export class NuniSessionController {
  state: NativeNuniState = { session: null, loading: true, error: '', pendingLogout: false };
  private listeners = new Set<(state: NativeNuniState) => void>();
  private generation = 0;
  private controllers = new Set<AbortController>();
  private record: StoredSession | null = null;
  private storageRead = false;
  private signingIn = false;
  private loggingOut = false;
  private disposed = false;
  private readonly now: () => number;
  constructor(private readonly deps: NuniSessionDependencies) {
    this.now = deps.now ?? Date.now;
  }
  subscribe = (listener: (state: NativeNuniState) => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(next: NativeNuniState) {
    this.state = next;
    if (!this.disposed) for (const listener of this.listeners) listener(next);
  }
  private invalidate() {
    ++this.generation;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    return this.generation;
  }
  private async call(path: string, handle?: string, input?: Record<string, unknown>) {
    const controller = new AbortController();
    this.controllers.add(controller);
    try {
      return await this.deps.request(path, handle, input, controller.signal);
    } finally {
      this.controllers.delete(controller);
    }
  }
  private current(run: number) {
    return !this.disposed && run === this.generation;
  }
  activate = () => {
    this.disposed = false;
  };
  private async save() {
    if (this.record) await this.deps.storage.write(JSON.stringify(this.record));
  }
  private async revoke(handle: string, cancelable = true) {
    try {
      const receipt = nuniRecord(
        await (cancelable
          ? this.call('logout', handle, {})
          : this.deps.request('logout', handle, {})),
      );
      if (receipt.signedOut !== true) throw new NuniError(502, 'INVALID_RESPONSE');
    } catch (error) {
      if (!(error instanceof NuniError && error.status === 401)) throw error;
    }
  }
  private async markPendingLogout() {
    // This independent, non-secret marker survives a Keychain/Keystore write failure.
    // Neither failure may prevent an attempt to revoke the server session.
    try {
      await this.deps.logoutFence.mark();
    } catch {
      /* Keep trying secure storage and revocation. */
    }
    if (this.record) {
      this.record = { ...this.record, pendingLogout: true };
      try {
        await this.save();
      } catch {
        /* The independent fence blocks restoration. */
      }
    }
  }
  private async forget() {
    await this.deps.storage.clear();
    this.record = null;
    this.storageRead = true;
  }
  refresh = async (): Promise<void> => {
    if (this.signingIn || this.loggingOut || this.disposed) return;
    const run = this.invalidate();
    this.update({
      session: null,
      loading: true,
      error: '',
      pendingLogout: !!this.record?.pendingLogout,
    });
    try {
      if (!this.storageRead) {
        const value = await this.deps.storage.read();
        if (!this.current(run)) return;
        this.record = value ? storedSession(value) : null;
        this.storageRead = true;
      }
      const fenced = await this.deps.logoutFence.read();
      if (!this.current(run)) return;
      if (fenced && this.record) this.record = { ...this.record, pendingLogout: true };
      if (fenced && !this.record) await this.deps.logoutFence.clear();
      if (!this.current(run)) return;
      if (!this.record) {
        this.update({ session: null, loading: false, error: '', pendingLogout: false });
        return;
      }
      if (this.record.pendingLogout) {
        this.update({
          session: null,
          loading: false,
          error: '登出尚未完成，請重試以結束這次登入。',
          pendingLogout: true,
        });
        return;
      }
      if (this.record.expiresAt <= this.now()) {
        await this.forget();
        if (this.current(run))
          this.update({
            session: null,
            loading: false,
            error: '登入已逾時，請重新登入。',
            pendingLogout: false,
          });
        return;
      }
      const principal = parseNuniPrincipal(
        await this.call('sessions/current', this.record.sessionHandle),
      );
      if (!this.current(run)) return;
      if (principal.platformAccountId !== this.record.platformAccountId)
        throw new NuniError(409, 'SESSION_CHANGED');
      this.update({
        session: { ...principal, context: `native-${this.now()}-${run}` },
        loading: false,
        error: '',
        pendingLogout: false,
      });
    } catch (error) {
      if (!this.current(run)) return;
      if (error instanceof NuniError && error.status === 401) {
        try {
          await this.forget();
        } catch {
          /* Retain a hidden session until secure deletion can be retried. */
        }
      }
      if (this.current(run))
        this.update({
          session: null,
          loading: false,
          error: '無法確認登入狀態，請重新連線後再試。',
          pendingLogout: !!this.record?.pendingLogout,
        });
    }
  };
  signIn = async (): Promise<'signed-in' | 'cancelled'> => {
    if (this.disposed || this.signingIn || this.loggingOut || this.state.loading)
      throw new NuniError(409, 'SIGN_IN_BUSY');
    if (this.record || this.state.pendingLogout) throw new NuniError(409, 'SIGN_OUT_REQUIRED');
    this.signingIn = true;
    const run = this.invalidate();
    let issued: StoredSession | null = null;
    this.update({ session: null, loading: true, error: '', pendingLogout: false });
    try {
      const startedAt = this.now();
      const tx = parseNuniLoginTransaction(
        await this.call('login-transactions', undefined, { kind: 'google-consumer' }),
      );
      if (!this.current(run)) throw new NuniError(409, 'SESSION_CHANGED');
      const idToken = await this.deps.credential(tx.clientId, tx.nonce);
      if (!this.current(run)) throw new NuniError(409, 'SESSION_CHANGED');
      if (this.now() - startedAt >= tx.expiresInSeconds * 1000)
        throw new NuniError(401, 'LOGIN_EXPIRED');
      const result = parseNuniLoginSession(
        await this.call('sessions', undefined, {
          kind: 'google-consumer',
          transactionId: tx.transactionId,
          nonce: tx.nonce,
          idToken,
        }),
      );
      issued = {
        sessionHandle: result.sessionHandle,
        platformAccountId: result.platformAccountId,
        expiresAt: this.now() + result.expiresInSeconds * 1000,
        pendingLogout: false,
      };
      if (!this.current(run)) throw new NuniError(409, 'SESSION_CHANGED');
      const principal = parseNuniPrincipal(
        await this.call('sessions/current', issued.sessionHandle),
      );
      if (principal.platformAccountId !== issued.platformAccountId)
        throw new NuniError(409, 'SESSION_CHANGED');
      if (!this.current(run)) throw new NuniError(409, 'SESSION_CHANGED');
      this.record = issued;
      await this.save();
      if (!this.current(run)) throw new NuniError(409, 'SESSION_CHANGED');
      this.storageRead = true;
      this.update({
        session: { ...principal, context: `native-${this.now()}-${run}` },
        loading: false,
        error: '',
        pendingLogout: false,
      });
      return 'signed-in';
    } catch (error) {
      if (issued) {
        // A callback arriving after logout/unmount must not leave a newly issued session active.
        try {
          await this.revoke(issued.sessionHandle, false);
          if (!this.record || this.record.sessionHandle === issued.sessionHandle) {
            await this.forget();
            await this.deps.logoutFence.clear();
          }
        } catch {
          this.record = { ...issued, pendingLogout: true };
          await this.markPendingLogout();
        }
      }
      const cancelled = (error as { code?: unknown } | null)?.code === 'CANCELLED';
      if (!this.disposed && (this.current(run) || this.record?.pendingLogout))
        this.update({
          session: null,
          loading: false,
          error: this.record?.pendingLogout
            ? '登出尚未完成，請重試以結束這次登入。'
            : cancelled
              ? ''
              : '登入沒有完成，請重新連線後再試。',
          pendingLogout: !!this.record?.pendingLogout,
        });
      if (cancelled) return 'cancelled';
      throw error;
    } finally {
      this.signingIn = false;
    }
  };
  logout = async (): Promise<void> => {
    if (this.loggingOut || this.disposed) return;
    this.loggingOut = true;
    const run = this.invalidate();
    this.update({ session: null, loading: true, error: '', pendingLogout: !!this.record });
    try {
      if (!this.storageRead) {
        const value = await this.deps.storage.read();
        if (!this.current(run)) return;
        this.record = value ? storedSession(value) : null;
        this.storageRead = true;
      }
      if (this.record) {
        await this.markPendingLogout();
        await this.revoke(this.record!.sessionHandle);
        await this.forget();
      }
      await this.deps.logoutFence.clear();
      await this.deps.clearCredential();
      if (this.current(run))
        this.update({ session: null, loading: false, error: '', pendingLogout: false });
    } catch {
      if (this.current(run))
        this.update({
          session: null,
          loading: false,
          error: this.record
            ? '登出尚未完成，請重試以結束這次登入。'
            : '已登出；裝置上的 Google 帳號選擇狀態尚未清除。',
          pendingLogout: !!this.record,
        });
    } finally {
      this.loggingOut = false;
    }
  };
  request = async (
    path: string,
    expectedContext: string,
    input?: Record<string, unknown>,
  ): Promise<unknown> => {
    const session = this.state.session;
    if (
      !session ||
      session.context !== expectedContext ||
      this.state.loading ||
      this.state.pendingLogout ||
      !this.record
    ) {
      throw new NuniError(409, 'SESSION_CHANGED');
    }
    if (this.record.expiresAt <= this.now()) {
      await this.refresh();
      throw new NuniError(401, 'SESSION_EXPIRED');
    }
    const run = this.generation;
    try {
      const result = await this.call(path, this.record.sessionHandle, input);
      if (!this.current(run) || this.state.session?.context !== expectedContext)
        throw new NuniError(409, 'SESSION_CHANGED');
      return result;
    } catch (error) {
      if (!this.current(run)) throw new NuniError(409, 'SESSION_CHANGED');
      if (error instanceof NuniError && error.status === 401) await this.refresh();
      throw error;
    }
  };
  dispose = () => {
    this.disposed = true;
    this.invalidate();
    this.listeners.clear();
  };
}
