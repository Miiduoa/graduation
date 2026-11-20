import { createSign } from 'node:crypto';

export const FIREBASE_CUSTOM_TOKEN_AUDIENCE =
  'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';
const TOKEN_TTL_SECONDS = 3600;
const RESERVED_CLAIMS = new Set([
  'acr',
  'amr',
  'at_hash',
  'aud',
  'auth_time',
  'azp',
  'cnf',
  'exp',
  'firebase',
  'iat',
  'iss',
  'jti',
  'nbf',
  'nonce',
  'sub',
  'uid',
]);

export type ServiceAccountSigner = {
  client_email: string;
  private_key: string;
  private_key_id?: string;
};

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

export function signFirebaseCustomToken(
  account: ServiceAccountSigner,
  uid: string,
  developerClaims: Record<string, string> = {},
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  if (!uid || uid.length > 128) {
    throw new Error('invalid-uid');
  }
  for (const key of Object.keys(developerClaims)) {
    if (RESERVED_CLAIMS.has(key)) {
      throw new Error('reserved-claim');
    }
  }
  const header: Record<string, string> = { alg: 'RS256', typ: 'JWT' };
  if (account.private_key_id) header.kid = account.private_key_id;
  const payload: Record<string, unknown> = {
    iss: account.client_email,
    sub: account.client_email,
    aud: FIREBASE_CUSTOM_TOKEN_AUDIENCE,
    iat: nowSeconds,
    exp: nowSeconds + TOKEN_TTL_SECONDS,
    uid,
  };
  if (Object.keys(developerClaims).length > 0) {
    payload.claims = developerClaims;
  }
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(account.private_key, 'base64url')}`;
}

export function decodeFirebaseCustomTokenPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('invalid-token');
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
}
