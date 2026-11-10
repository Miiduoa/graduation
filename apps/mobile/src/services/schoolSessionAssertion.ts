import type { PUSession } from './puDirectScraper';

/** 僅接受仍有效且已完成 Firebase 身分驗證的學校 session。 */
export function createSchoolSessionAssertion(
  identity: { uid: string; schoolId: string },
  getSession: () => PUSession | null,
  getGeneration: () => number,
): () => void {
  const session = getSession();
  const generation = getGeneration();
  return () => {
    if (generation !== getGeneration() || session !== getSession()) {
      throw new Error('學校登入已變更，請重新登入。');
    }
    if (!session?.loggedIn || session.localMock ||
        !session.backendOwnerUid || session.backendOwnerUid !== identity.uid ||
        session.schoolId !== identity.schoolId ||
        typeof session.expiresAt !== 'number' || !Number.isFinite(session.expiresAt) ||
        session.expiresAt <= Date.now()) {
      throw new Error('學校 session 無效或已過期，請重新登入。');
    }
  };
}
