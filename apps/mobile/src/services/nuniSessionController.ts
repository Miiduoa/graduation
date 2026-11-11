import {
  NuniError,
  nuniId,
  nuniRecord,
  parseNuniPrincipal,
  type NuniPrincipal,
} from '@campus/shared/src/nuni';
import {
  NUNI_HANDLE,
  nuniBffFilePut,
  nuniBffRequest,
  parseNuniLoginSession,
  parseNuniLoginTransaction,
  type NuniTransport,
} from './nuniClient';

export type NativeNuniSession = NuniPrincipal & { context: string; expiresAt: number };
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
  savedPlansCleanup: {
    /** Must invalidate existing save leases synchronously, before returning its promise. */
    begin(): Promise<void>;
    /** Release the cleanup barrier after both local cleanup and logout have settled. */
    end(): void;
  };
  /** Revoke in-memory input synchronously, including callbacks held by closed routes. */
  invalidateLocalDrafts(): void;
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
  private logoutPending = false;
  private savedPlansCleanupFailed = false;
  private disposed = false;
  private localDraftsRevoked = true;
  private credentialCleanups = 0;
  private refreshAfterCleanup = false;
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
  private async call(
    path: string,
    handle?: string,
    input?: Record<string, unknown>,
    method?: 'PUT',
    query?: Record<string, string>,
  ) {
    const controller = new AbortController();
    this.controllers.add(controller);
    try {
      return await (query
        ? this.deps.request(path, handle, input, controller.signal, method, query)
        : method
          ? this.deps.request(path, handle, input, controller.signal, method)
          : this.deps.request(path, handle, input, controller.signal));
    } finally {
      this.controllers.delete(controller);
    }
  }
  private current(run: number) {
    return !this.disposed && run === this.generation;
  }
  /** Same account, still within the stored lifetime, already verified in memory. */
  private liveVerifiedSession(): NativeNuniSession | null {
    const { session, loading, error, pendingLogout } = this.state;
    if (
      this.loggingOut ||
      pendingLogout ||
      loading ||
      error ||
      !session ||
      !this.record ||
      this.record.pendingLogout ||
      session.platformAccountId !== this.record.platformAccountId ||
      this.record.expiresAt <= this.now()
    ) {
      return null;
    }
    return session;
  }
  private dropVerifiedSession(next: NativeNuniState) {
    this.invalidate();
    this.update(next);
  }
  private revokeLocalDrafts() {
    this.localDraftsRevoked = true;
    this.deps.invalidateLocalDrafts();
  }
  /** Retention is not authorization: masked revalidation can keep input but cannot send it. */
  canRetainLocalDrafts = (accountId: string): boolean => {
    return !this.disposed && !this.localDraftsRevoked && !this.loggingOut &&
      !this.logoutPending && !this.state.pendingLogout && !!this.record &&
      !this.record.pendingLogout && this.record.platformAccountId === accountId &&
      this.record.expiresAt > this.now();
  };
  // A transient foreground refresh or offline verification must preserve the owner's local alarms.
  localReminderOwner(): string | null | undefined {
    if (this.loggingOut || this.state.pendingLogout) return null;
    if (!this.storageRead || this.state.loading) return undefined;
    const row = this.record;
    return row && !row.pendingLogout && row.expiresAt > this.now() ? row.platformAccountId : null;
  }
  /** Check a captured session for local reads without refreshing or exposing its credential. */
  isSessionCurrent = (accountId: string, context: string): boolean => {
    const { session, loading, error, pendingLogout } = this.state;
    return !this.disposed && !loading && !error && !pendingLogout && !!session &&
      session.context === context && session.platformAccountId === accountId &&
      this.record?.platformAccountId === accountId && !this.record.pendingLogout &&
      this.record.expiresAt > this.now();
  };
  activate = () => {
    this.disposed = false;
    // React can reactivate a provider while an earlier secure deletion is pending.
    if (this.credentialCleanups) this.refreshAfterCleanup = true;
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
    this.logoutPending = true;
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
    ++this.credentialCleanups;
    try {
      await this.deps.storage.clear();
      this.record = null;
      this.storageRead = true;
    } finally {
      --this.credentialCleanups;
      if (!this.credentialCleanups && this.refreshAfterCleanup && !this.disposed) {
        this.refreshAfterCleanup = false;
        void this.refresh();
      }
    }
  }
  refresh = async (): Promise<void> => {
    if (this.signingIn || this.loggingOut || this.disposed || this.credentialCleanups) return;
    if (this.record && this.record.expiresAt <= this.now()) this.revokeLocalDrafts();
    const live = this.liveVerifiedSession();
    const run = live ? this.generation : this.invalidate();
    if (!live) {
      this.update({
        session: null,
        loading: true,
        error: '',
        pendingLogout: this.logoutPending || !!this.record?.pendingLogout,
      });
    }
    const finish = (next: NativeNuniState) => {
      if (live) this.dropVerifiedSession(next);
      else this.update(next);
    };
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
      if (fenced || this.record?.pendingLogout) this.logoutPending = true;
      // A fence without a credential can still mean local plans were not removed.
      // Only an explicit, successful cleanup retry may release this intent.
      if (this.logoutPending) {
        this.revokeLocalDrafts();
        finish({
          session: null,
          loading: false,
          error: this.savedPlansCleanupFailed
            ? '手機內的已儲存計畫尚未清除，請重試登出。'
            : '登出尚未完成，請重試以結束這次登入。',
          pendingLogout: true,
        });
        return;
      }
      if (!this.record) {
        this.revokeLocalDrafts();
        finish({ session: null, loading: false, error: '', pendingLogout: false });
        return;
      }
      if (this.record.expiresAt <= this.now()) {
        this.revokeLocalDrafts();
        await this.forget();
        if (this.current(run))
          finish({
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
      if (
        principal.platformAccountId !== this.record.platformAccountId ||
        (live && principal.platformAccountId !== live.platformAccountId)
      )
        throw new NuniError(409, 'SESSION_CHANGED');
      this.localDraftsRevoked = false;
      this.update({
        session: {
          ...principal,
          context: live?.context ?? `native-${this.now()}-${run}`,
          expiresAt: this.record.expiresAt,
        },
        loading: false,
        error: '',
        pendingLogout: false,
      });
    } catch (error) {
      if (!this.current(run)) return;
      const closed =
        error instanceof NuniError && (error.status === 401 || error.status === 409);
      if (live && !closed) return;
      if (closed) {
        this.revokeLocalDrafts();
        const closedRun = this.invalidate();
        const rejectedState: NativeNuniState = {
          session: null,
          loading: false,
          error: '無法確認登入狀態，請重新連線後再試。',
          pendingLogout: this.logoutPending || !!this.record?.pendingLogout,
        };
        if (error.status === 401) {
          // Stop using the revoked authority before waiting for Keychain/Keystore.
          // The cleanup fence also prevents another login from being erased by
          // this deletion after a concurrent logout has already finished.
          const cleanup = this.forget();
          this.update({ ...rejectedState, loading: true });
          try {
            await cleanup;
          } catch {
            /* Retain a hidden credential until secure deletion can be retried. */
          }
          if (this.current(closedRun)) this.update(rejectedState);
        } else {
          this.update(rejectedState);
        }
        return;
      }
      if (this.current(run))
        finish({
          session: null,
          loading: false,
          error: '無法確認登入狀態，請重新連線後再試。',
          pendingLogout: this.logoutPending || !!this.record?.pendingLogout,
        });
    }
  };
  signIn = async (): Promise<'signed-in' | 'cancelled'> => {
    if (this.disposed || this.signingIn || this.loggingOut || this.state.loading || this.credentialCleanups)
      throw new NuniError(409, 'SIGN_IN_BUSY');
    if (this.record || this.state.pendingLogout) throw new NuniError(409, 'SIGN_OUT_REQUIRED');
    this.revokeLocalDrafts();
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
      // Platform Google stores sessionHandle only. No Firebase customToken or uid.
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
      this.localDraftsRevoked = false;
      this.update({
        session: { ...principal, context: `native-${this.now()}-${run}`, expiresAt: this.record.expiresAt },
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
            if (this.logoutPending) {
              // Preserve the secure-storage fallback if another logout cleanup failed.
              this.record = { ...issued, pendingLogout: true };
              await this.markPendingLogout();
              // Logout may finish while this fallback write is still in flight.
              if (!this.logoutPending) {
                await this.forget();
                await this.deps.logoutFence.clear();
              }
            } else {
              await this.forget();
              await this.deps.logoutFence.clear();
            }
          }
        } catch {
          this.record = { ...issued, pendingLogout: true };
          await this.markPendingLogout();
        }
      }
      const cancelled = (error as { code?: unknown } | null)?.code === 'CANCELLED';
      if (!this.disposed && (this.current(run) || this.logoutPending || this.record?.pendingLogout))
        this.update({
          session: null,
          loading: false,
          error: this.savedPlansCleanupFailed
            ? '手機內的已儲存計畫尚未清除，請重試登出。'
            : this.logoutPending || this.record?.pendingLogout
              ? '登出尚未完成，請重試以結束這次登入。'
              : cancelled
                ? ''
                : '登入沒有完成，請重新連線後再試。',
          pendingLogout: this.logoutPending || !!this.record?.pendingLogout,
        });
      if (cancelled) return 'cancelled';
      throw error;
    } finally {
      this.signingIn = false;
    }
  };
  logout = async (): Promise<void> => {
    if (this.loggingOut || this.disposed) return;
    this.revokeLocalDrafts();
    this.loggingOut = true;
    const run = this.invalidate();
    this.logoutPending = true;
    // begin() fences saved-plan leases before the first await (including startup reads).
    const plansCleaned = (async () => {
      try {
        await this.deps.savedPlansCleanup.begin();
        return true;
      } catch {
        return false;
      }
    })();
    this.update({ session: null, loading: true, error: '', pendingLogout: true });
    let sessionCleanupFailed = false;
    let credentialCleanupFailed = false;
    try {
      // Persist the intent even when there is no credential left to revoke.
      await this.markPendingLogout();
      try {
        if (!this.storageRead) {
          const value = await this.deps.storage.read();
          if (!this.current(run)) return;
          this.record = value ? storedSession(value) : null;
          this.storageRead = true;
          if (this.record) await this.markPendingLogout();
        }
        if (this.record) await this.revoke(this.record.sessionHandle);
      } catch {
        sessionCleanupFailed = true;
      }
      this.savedPlansCleanupFailed = !(await plansCleaned);
      if (!sessionCleanupFailed && !this.savedPlansCleanupFailed) {
        try {
          // Retain the pending secure record until local cleanup also succeeds. It
          // remains a durable fallback when writing the independent fence failed.
          if (this.record) await this.forget();
          await this.deps.logoutFence.clear();
          this.logoutPending = false;
        } catch {
          sessionCleanupFailed = true;
        }
      }
      try {
        await this.deps.clearCredential();
      } catch {
        credentialCleanupFailed = true;
      }
      if (this.current(run))
        this.update({
          session: null,
          loading: false,
          error: this.savedPlansCleanupFailed
            ? '手機內的已儲存計畫尚未清除，請重試登出。'
            : sessionCleanupFailed
              ? '登出尚未完成，請重試以結束這次登入。'
              : credentialCleanupFailed
                ? '已登出；裝置上的 Google 帳號選擇狀態尚未清除。'
                : '',
          pendingLogout: this.logoutPending,
        });
    } finally {
      await plansCleaned;
      this.deps.savedPlansCleanup.end();
      this.loggingOut = false;
    }
  };
  bffRequest = async (
    path: string,
    expectedContext: string,
    input?: Record<string, unknown>,
    _method?: 'PUT',
    _query?: Record<string, string>,
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
      const controller = new AbortController();
      this.controllers.add(controller);
      try {
        const result = await nuniBffRequest(
          path,
          this.record.sessionHandle,
          input,
          controller.signal,
        );
        if (!this.current(run) || this.state.session?.context !== expectedContext)
          throw new NuniError(409, 'SESSION_CHANGED');
        return result;
      } finally {
        this.controllers.delete(controller);
      }
    } catch (error) {
      if (!this.current(run)) throw new NuniError(409, 'SESSION_CHANGED');
      if (error instanceof NuniError && error.status === 401) await this.refresh();
      throw error;
    }
  };
  upload = async (
    path: string,
    expectedContext: string,
    body: Uint8Array,
    contentType: string,
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
      const controller = new AbortController();
      this.controllers.add(controller);
      try {
        const result = await nuniBffFilePut(
          path,
          this.record.sessionHandle,
          body,
          contentType,
          controller.signal,
        );
        if (!this.current(run) || this.state.session?.context !== expectedContext)
          throw new NuniError(409, 'SESSION_CHANGED');
        return result;
      } finally {
        this.controllers.delete(controller);
      }
    } catch (error) {
      if (!this.current(run)) throw new NuniError(409, 'SESSION_CHANGED');
      if (error instanceof NuniError && error.status === 401) await this.refresh();
      throw error;
    }
  };
  request = async (
    path: string,
    expectedContext: string,
    input?: Record<string, unknown>,
    method?: 'PUT',
    query?: Record<string, string>,
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
      const result = await this.call(path, this.record.sessionHandle, input, method, query);
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
    this.revokeLocalDrafts();
    this.invalidate();
    this.listeners.clear();
  };
}
