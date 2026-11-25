import { NuniError } from '@campus/shared/src/nuni';
import type { TronClassSubmissionBinding } from './tronClassSubmissionSource';

const ORIGIN = 'https://tronclass.pu.edu.tw';
const has = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
function invalid(): never { throw new NuniError(400, 'TRONCLASS_PROTOCOL_INVALID_INPUT'); }

/**
 * Request serialization from PU's public Angular client, checked 2026-11-18:
 * - /static/56029-a5e838cb.js sends X-XSRF-TOKEN only when its same-origin
 *   XSRF-TOKEN cookie has a nonempty value; the cookie reader URL-decodes it.
 * - /static/72914-965f4ad4.js commonModule does not override that policy.
 *
 * This copies the client protocol; it does not establish that a school session
 * can write. Tenant verification, authorization and runtime gates remain the
 * caller's responsibility. Never use these headers for a storage destination.
 */
export function tronClassSchoolWriteHeaders(binding: TronClassSubmissionBinding): Headers {
  const cookies = binding?.cookies;
  if (!cookies || typeof cookies !== 'object' || Array.isArray(cookies) ||
    (Object.getPrototypeOf(cookies) !== Object.prototype && Object.getPrototypeOf(cookies) !== null)) invalid();
  const pairs = Object.entries(cookies);
  if (!pairs.length || pairs.length > 64) invalid();
  const cookie = pairs.map(([key, value]) => {
    if (!/^[A-Za-z0-9!#$%&'*+.^_|~-]{1,128}$/.test(key) || typeof value !== 'string' ||
      !/^[\x21-\x7e]*$/.test(value) || /[;\\",]/.test(value)) invalid();
    return `${key}=${value}`;
  }).join('; ');
  if (cookie.length > 32 * 1024) invalid();
  const headers = new Headers({ Cookie: cookie, Accept: 'application/json', 'Content-Type': 'application/json',
    'Accept-Encoding': 'identity', Origin: ORIGIN, Referer: `${ORIGIN}/` });
  const rawToken = has(cookies, 'XSRF-TOKEN') ? cookies['XSRF-TOKEN'] : undefined;
  if (rawToken) {
    let token: string;
    try { token = decodeURIComponent(rawToken); } catch { return invalid(); }
    if (!token || token.length > 4096 || !/^[\x21-\x7e]+$/.test(token)) invalid();
    headers.set('X-XSRF-TOKEN', token);
  }
  return headers;
}
