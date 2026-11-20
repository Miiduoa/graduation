import type { Firestore } from 'firebase/firestore';

/** Optional server-side limits around the same public, rule-checked readers. */
export type PublicCampusReadGuard = {
  /** A dedicated anonymous client; never an Admin SDK or signed-in user client. */
  db?: Firestore;
  beforeRead(): void;
  afterRead(): void;
  onIncomplete?(): void;
};

export async function guardedPublicCampusRead<T>(
  guard: PublicCampusReadGuard | undefined,
  read: () => Promise<T>,
): Promise<T> {
  guard?.beforeRead();
  const result = await read();
  guard?.afterRead();
  return result;
}
