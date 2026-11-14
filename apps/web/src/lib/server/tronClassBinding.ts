import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { NuniError } from '@campus/shared/src/nuni';
import type { TronClassBindingStatus, TronClassConnectInput } from '@campus/shared/src/tronClassIntegration';
import { getFirebaseAdmin } from './firebaseAdmin';
import { createPuCampusGateway, PuCampusError, type PuCampusGateway, type TronClassSession } from './puCampusClient';
import { canonicalizePuStudentId, isPuTeacherAccount } from './puIdentity';

export type { TronClassBindingStatus, TronClassConnectInput };

type RecordData = Record<string, unknown>;
type Snapshot = { exists: boolean; data(): RecordData | undefined };
export type TronClassBindingRef = { path: string; get(): Promise<Snapshot> };
export type TronClassBindingStore = {
  doc(path: string): TronClassBindingRef;
  runTransaction<T>(callback: (transaction: {
    get(ref: TronClassBindingRef): Promise<Snapshot>;
    set(ref: TronClassBindingRef, value: RecordData): unknown;
  }) => Promise<T>): Promise<T>;
};

/** Server-only. Never serialize the return value of requireBinding into an HTTP response. */
export type TronClassBoundSession = {
  schoolId: 'pu';
  revision: string;
  account: string;
  userId: number;
  userName: string | null;
  cookies: Record<string, string>;
  expiresAt: string;
};

type StoredBinding = {
  ownerKey: string;
  schoolId: 'pu';
  revision: string;
  state: 'connected' | 'disconnected';
  updatedAt: number;
  account?: string;
  userId?: number;
  userName?: string | null;
  expiresAt?: number;
  purgeAt?: Date;
  sealedCookies?: string;
};

export type TronClassBindingDependencies = {
  db?: TronClassBindingStore;
  getStore?: () => Promise<TronClassBindingStore | null>;
  login?: PuCampusGateway['loginTronClass'];
  now?: () => number;
  encryptionSecret?: string;
};

export const TRONCLASS_BINDING_TTL_MS = 12 * 60 * 60 * 1000;
export const TRONCLASS_LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const TRONCLASS_OWNER_LOGIN_LIMIT = 6;
export const TRONCLASS_ACCOUNT_LOGIN_LIMIT = 5;
const REVISION = /^[a-f0-9]{32}$/;
const MAX_COOKIES_BYTES = 32 * 1024;

function unavailable(): never { throw new NuniError(503, 'TRONCLASS_UNAVAILABLE'); }
function changed(): never { throw new NuniError(409, 'TRONCLASS_BINDING_CHANGED'); }
function reconnect(): never { throw new NuniError(401, 'TRONCLASS_RECONNECT_REQUIRED'); }

function checkedOwner(ownerKey: string): string {
  if (typeof ownerKey !== 'string' || ownerKey.length > 200 ||
    !/^(?:platform:pa_[A-Za-z0-9_-]+|firebase:[^\s/\x00-\x1f\x7f]{1,128})$/.test(ownerKey)) {
    throw new NuniError(401, 'SIGN_IN_REQUIRED');
  }
  return ownerKey;
}

function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }

function checkedRevision(value: unknown): asserts value is string | null {
  if (value !== null && (typeof value !== 'string' || !REVISION.test(value))) {
    throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
  }
}

function checkedAccount(value: unknown): string {
  if (typeof value !== 'string' || value.length > 100) throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
  const account = value.trim().toLowerCase();
  const local = account.replace(/@pu\.edu\.tw$/, '');
  if (local.includes('@') || (!canonicalizePuStudentId(account) && !isPuTeacherAccount(local))) {
    throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
  }
  return account;
}

function cookies(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (!entries.length || entries.length > 100 || entries.some(([name, item]) =>
    !name || name.length > 200 || /[\s;=\x00-\x1f\x7f]/.test(name) ||
    typeof item !== 'string' || !item || item.length > MAX_COOKIES_BYTES || /[;\x00-\x1f\x7f]/.test(item))) return null;
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_COOKIES_BYTES) return null;
  return Object.fromEntries(entries) as Record<string, string>;
}

function stored(snapshot: Snapshot, ownerKey: string): StoredBinding | null {
  if (!snapshot.exists) return null;
  const row = snapshot.data();
  // Account deletion replaces the record with a permanent, credential-free
  // barrier. Never treat it as an unbound account or allow a later login CAS.
  if (row?.state === 'closed' && row.ownerHash === hash(ownerKey)) {
    throw new NuniError(401, 'SIGN_IN_REQUIRED');
  }
  if (!row || row.ownerKey !== ownerKey || row.schoolId !== 'pu' ||
    typeof row.revision !== 'string' || !REVISION.test(row.revision) ||
    !['connected', 'disconnected'].includes(String(row.state)) ||
    typeof row.updatedAt !== 'number' || !Number.isSafeInteger(row.updatedAt) || row.updatedAt < 0 ||
    !Number.isFinite(new Date(row.updatedAt).getTime())) unavailable();
  if (row.state === 'connected' && (
    typeof row.account !== 'string' || !row.account || row.account.length > 100 ||
    typeof row.userId !== 'number' || !Number.isSafeInteger(row.userId) || row.userId <= 0 ||
    !(row.userName === null || (typeof row.userName === 'string' && row.userName.length <= 200)) ||
    typeof row.expiresAt !== 'number' || !Number.isSafeInteger(row.expiresAt) || row.expiresAt <= row.updatedAt ||
    !Number.isFinite(new Date(row.expiresAt).getTime()) ||
    typeof row.sealedCookies !== 'string' || row.sealedCookies.length > 50_000)) unavailable();
  return row as StoredBinding;
}

function publicStatus(row: StoredBinding | null, now: number): TronClassBindingStatus {
  const linked = row?.state === 'connected';
  return {
    schoolId: 'pu', connected: !!linked && row!.expiresAt! > now,
    revision: row?.revision ?? null,
    account: linked ? row!.account! : null,
    userName: linked ? row!.userName ?? null : null,
    expiresAt: linked ? new Date(row!.expiresAt!).toISOString() : null,
  };
}

function recentAttempts(snapshot: Snapshot, now: number, limit: number): number[] {
  if (!snapshot.exists) return [];
  const value = snapshot.data()?.timestamps;
  if (!Array.isArray(value) || value.length > limit || value.some((entry) =>
    typeof entry !== 'number' || !Number.isSafeInteger(entry) || entry < 0 || entry > now)) unavailable();
  return (value as number[]).filter((entry) => entry > now - TRONCLASS_LOGIN_WINDOW_MS);
}

/** Owns independent LMS connections; never creates a school membership or an e-campus session. */
export function createTronClassBindingService(dependencies: TronClassBindingDependencies = {}) {
  const now = dependencies.now ?? Date.now;
  const getStore = async (): Promise<TronClassBindingStore> => {
    const db = dependencies.db ?? await (dependencies.getStore ?? (async () =>
      (await getFirebaseAdmin())?.db as unknown as TronClassBindingStore ?? null))();
    if (!db) unavailable();
    return db;
  };
  const key = (): Buffer => {
    const secret = dependencies.encryptionSecret ?? process.env.TRONCLASS_SESSION_SECRET ?? process.env.BFF_SESSION_SECRET;
    if (!secret || secret.trim().length < 32) throw new NuniError(503, 'TRONCLASS_CONFIGURATION_REQUIRED');
    return createHash('sha256').update(`nuni-tronclass-session-v1\0${secret}`).digest();
  };
  const bindingRef = (db: TronClassBindingStore, ownerKey: string) =>
    db.doc(`_tronClassBindings/${hash(checkedOwner(ownerKey))}`);
  const seal = (ownerKey: string, revision: string, value: Record<string, string>) => {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key(), iv);
    cipher.setAAD(Buffer.from(JSON.stringify(['tronclass:v1', ownerKey, revision])));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), encrypted.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
  };
  const unseal = (row: StoredBinding): Record<string, string> => {
    const encryptionKey = key();
    try {
      const [version, ...parts] = row.sealedCookies!.split('.');
      if (version !== 'v1' || parts.length !== 3) reconnect();
      const [iv, encrypted, tag] = parts.map((part) => Buffer.from(part, 'base64url'));
      if (iv.length !== 12 || tag.length !== 16 || encrypted.length > MAX_COOKIES_BYTES ||
        [iv, encrypted, tag].some((bytes, index) => bytes.toString('base64url') !== parts[index])) reconnect();
      const cipher = createDecipheriv('aes-256-gcm', encryptionKey, iv);
      cipher.setAAD(Buffer.from(JSON.stringify(['tronclass:v1', row.ownerKey, row.revision])));
      cipher.setAuthTag(tag);
      const value = cookies(JSON.parse(Buffer.concat([cipher.update(encrypted), cipher.final()]).toString('utf8')));
      if (!value) reconnect();
      return value;
    } catch { reconnect(); }
  };
  const read = async (ownerKey: string) => {
    const db = await getStore();
    return stored(await bindingRef(db, ownerKey).get(), ownerKey);
  };

  const getStatus = async (ownerKey: string): Promise<TronClassBindingStatus> => {
    const row = await read(ownerKey);
    const status = publicStatus(row, now());
    if (status.connected) {
      try { unseal(row!); }
      catch (error) {
        if (error instanceof NuniError && error.code === 'TRONCLASS_RECONNECT_REQUIRED') return { ...status, connected: false };
        throw error;
      }
    }
    return status;
  };

  const connect = async (ownerKey: string, input: TronClassConnectInput): Promise<TronClassBindingStatus> => {
    checkedOwner(ownerKey);
    if (!input || input.schoolId !== 'pu' || Object.keys(input).some((field) =>
      !['schoolId', 'account', 'password', 'expectedRevision'].includes(field)) ||
      typeof input.password !== 'string' || !input.password || input.password.length > 1024) {
      throw new NuniError(422, 'TRONCLASS_INVALID_INPUT');
    }
    checkedRevision(input.expectedRevision);
    const expectedRevision = input.expectedRevision;
    const account = checkedAccount(input.account);
    const encryptionKey = key();
    const db = await getStore();
    const ref = bindingRef(db, ownerKey);
    const rateId = (kind: string, value: string) => createHmac('sha256', encryptionKey)
      .update(JSON.stringify(['tronclass-login:v1', kind, value])).digest('hex');
    const ownerRate = db.doc(`_tronClassLoginAttempts/${rateId('owner', ownerKey)}`);
    const accountRate = db.doc(`_tronClassLoginAttempts/${rateId('account', canonicalizePuStudentId(account) ?? account.replace(/@pu\.edu\.tw$/, ''))}`);
    await db.runTransaction(async (transaction) => {
      const [binding, owner, accountAttempts] = await Promise.all([
        transaction.get(ref), transaction.get(ownerRate), transaction.get(accountRate),
      ]);
      if ((stored(binding, ownerKey)?.revision ?? null) !== expectedRevision) changed();
      const timestamp = now();
      const own = recentAttempts(owner, timestamp, TRONCLASS_OWNER_LOGIN_LIMIT);
      const remote = recentAttempts(accountAttempts, timestamp, TRONCLASS_ACCOUNT_LOGIN_LIMIT);
      if (own.length >= TRONCLASS_OWNER_LOGIN_LIMIT || remote.length >= TRONCLASS_ACCOUNT_LOGIN_LIMIT) {
        throw new NuniError(429, 'TRONCLASS_LOGIN_RATE_LIMITED');
      }
      transaction.set(ownerRate, { ownerKey, scope: 'owner', timestamps: [...own, timestamp], purgeAt: new Date(timestamp + TRONCLASS_LOGIN_WINDOW_MS) });
      transaction.set(accountRate, { scope: 'account', timestamps: [...remote, timestamp], purgeAt: new Date(timestamp + TRONCLASS_LOGIN_WINDOW_MS) });
    });
    let session: TronClassSession;
    try {
      const login = dependencies.login ?? createPuCampusGateway().loginTronClass;
      session = await login(account, input.password, {
        route: canonicalizePuStudentId(account) ? 'student' : 'teacher',
        timeoutMs: 25_000, hopTimeoutMs: 10_000,
      });
    } catch (error) {
      if (error instanceof PuCampusError && error.kind === 'credentials') {
        throw new NuniError(401, 'TRONCLASS_INVALID_CREDENTIALS');
      }
      throw new NuniError(502, 'TRONCLASS_LOGIN_UNAVAILABLE');
    }
    const verifiedCookies = cookies(session?.cookies);
    if (!verifiedCookies || !Number.isSafeInteger(session?.userId) || session.userId! <= 0) {
      throw new NuniError(502, 'TRONCLASS_IDENTITY_UNVERIFIED');
    }
    const timestamp = now();
    const revision = randomBytes(16).toString('hex');
    const row: StoredBinding = {
      ownerKey, schoolId: 'pu', revision, state: 'connected', account,
      userId: session.userId!,
      userName: typeof session.userName === 'string' ? session.userName.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 200) || null : null,
      updatedAt: timestamp, expiresAt: timestamp + TRONCLASS_BINDING_TTL_MS,
      purgeAt: new Date(timestamp + TRONCLASS_BINDING_TTL_MS),
      sealedCookies: seal(ownerKey, revision, verifiedCookies),
    };
    await db.runTransaction(async (transaction) => {
      const current = stored(await transaction.get(ref), ownerKey);
      if ((current?.revision ?? null) !== expectedRevision) changed();
      transaction.set(ref, row);
    });
    await assertCurrent(ownerKey, revision);
    return publicStatus(row, now());
  };

  const disconnect = async (ownerKey: string, expectedRevision: string | null): Promise<TronClassBindingStatus> => {
    checkedOwner(ownerKey);
    checkedRevision(expectedRevision);
    const db = await getStore();
    const ref = bindingRef(db, ownerKey);
    const tombstone: StoredBinding = {
      ownerKey, schoolId: 'pu', revision: randomBytes(16).toString('hex'), state: 'disconnected', updatedAt: now(),
    };
    await db.runTransaction(async (transaction) => {
      const current = stored(await transaction.get(ref), ownerKey);
      if ((current?.revision ?? null) !== expectedRevision) changed();
      // Retain a new revision to prevent an in-flight first connection from resurrecting after unlink.
      transaction.set(ref, tombstone);
    });
    return publicStatus(tombstone, now());
  };

  const requireBinding = async (ownerKey: string): Promise<TronClassBoundSession> => {
    const row = await read(ownerKey);
    if (row?.state !== 'connected' || !(row.expiresAt! > now())) reconnect();
    return { schoolId: 'pu', revision: row.revision, account: row.account!, userId: row.userId!,
      userName: row.userName ?? null, cookies: unseal(row), expiresAt: new Date(row.expiresAt!).toISOString() };
  };

  const assertCurrent = async (ownerKey: string, revision: string): Promise<void> => {
    checkedRevision(revision);
    const current = await read(ownerKey);
    if (!current || current.revision !== revision || current.state !== 'connected') changed();
    if (!(current.expiresAt! > now())) reconnect();
  };

  return { getStatus, connect, disconnect, requireBinding, assertCurrent };
}

export type TronClassBindingService = ReturnType<typeof createTronClassBindingService>;
