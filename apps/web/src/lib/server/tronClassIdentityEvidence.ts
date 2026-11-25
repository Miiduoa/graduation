// Server-side evidence parser for the future account sign-in adapter.
import { canonicalizePuStudentId } from './puIdentity';

export const TRONCLASS_IDENTITY_ORIGIN = 'https://tronclass.pu.edu.tw';

export type TronClassProfileEvidence = {
  readonly schoolId: 'pu';
  readonly source: 'authenticated-profile';
  readonly issuer: typeof TRONCLASS_IDENTITY_ORIGIN;
  readonly subject: string;
};

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  return value as Record<string, unknown>;
}

/**
 * Accept only a positive integer from the authenticated /api/profile response itself.
 * An email, entered student number, HTML fallback, or login response cannot be the subject.
 * This is evidence for contract review, NOT an authorization or a verified campus role.
 * The caller must obtain the body through the pinned school gateway, not client JSON.
 */
export function parseTronClassStudentIdentityEvidence(
  body: unknown,
  requestedAccount: string,
): TronClassProfileEvidence | null {
  const profile = record(body);
  if (!profile || typeof requestedAccount !== 'string' || requestedAccount.length > 128) return null;
  const account = canonicalizePuStudentId(requestedAccount);
  if (!account || !Object.hasOwn(profile, 'id')) return null;
  const id = profile.id;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return null;

  const nested = Object.hasOwn(profile, 'user') ? record(profile.user) : null;
  if (Object.hasOwn(profile, 'user') && profile.user !== null && !nested) return null;
  for (const source of [profile, nested]) {
    if (!source) continue;
    // Conflicting aliases must not silently choose another subject.
    for (const key of ['id', 'user_id', 'userId']) {
      if (Object.hasOwn(source, key) && source[key] !== id) return null;
    }
  }

  // Require at least one explicit top-level login identifier. Never infer from email.
  // If additional explicit login identifiers are present, they must agree.
  const identifiers: unknown[] = [];
  for (const source of [profile, nested]) {
    if (!source) continue;
    for (const key of ['login_name', 'user_name', 'userName']) {
      if (Object.hasOwn(source, key)) identifiers.push(source[key]);
    }
  }
  if (!['login_name', 'user_name', 'userName'].some(key => Object.hasOwn(profile, key))) return null;
  if (!identifiers.length || identifiers.some(value =>
    typeof value !== 'string' || value.length > 128 || canonicalizePuStudentId(value) !== account
  )) return null;
  return Object.freeze({
    schoolId: 'pu',
    source: 'authenticated-profile',
    issuer: TRONCLASS_IDENTITY_ORIGIN,
    subject: String(id),
  });
}
