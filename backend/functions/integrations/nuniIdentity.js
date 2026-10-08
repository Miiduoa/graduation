'use strict';

// Server/operator boundary only. Never import into a browser or issue a token here.
const DEFAULT_NUNI_ORIGIN = 'https://api.nuni.tw';
const MAX_RESPONSE_BYTES = 8192;
const messages = Object.freeze({
  invalid_config: 'Nuni 驗證設定不完整或格式不正確。',
  invalid_session: 'Nuni 登入已失效，請重新登入。',
  upstream_unavailable: '目前無法向 Nuni 確認登入身分。',
  timeout: 'Nuni 身分確認逾時，請稍後重試。',
  invalid_response: 'Nuni 身分回覆不符合約定格式。',
  invalid_mapping: '身分對照資料不完整、重複或格式不正確。',
  mapping_unavailable: '沒有有效且經確認的身分對照。',
  identity_mismatch: '目前 Nuni 身分與指定的帳號對照不符。',
});

class NuniIdentityError extends Error {
  constructor(code) {
    super(messages[code] || messages.upstream_unavailable);
    this.name = 'NuniIdentityError';
    this.code = code;
  }
}

const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
const identifier = (value) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 256 &&
  value.trim() === value &&
  ![...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);

function nuniOrigin(value = DEFAULT_NUNI_ORIGIN) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      (value !== url.origin && value !== `${url.origin}/`)
    )
      throw new Error();
    return url.origin;
  } catch {
    throw new NuniIdentityError('invalid_config');
  }
}

async function readIdentity(response, signal) {
  if (signal.aborted) throw new NuniIdentityError('timeout');
  if (response.status === 401 || response.status === 403)
    throw new NuniIdentityError('invalid_session');
  if (response.status !== 200) throw new NuniIdentityError('upstream_unavailable');
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) {
    throw new NuniIdentityError('invalid_response');
  }
  const declaredSize = response.headers.get('content-length');
  if (
    declaredSize !== null &&
    (!/^\d+$/.test(declaredSize) || Number(declaredSize) > MAX_RESPONSE_BYTES)
  ) {
    throw new NuniIdentityError('invalid_response');
  }
  if (!response.body?.getReader) throw new NuniIdentityError('invalid_response');
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new NuniIdentityError('invalid_response');
      chunks.push(Buffer.from(value));
    }
    let data;
    try {
      data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new NuniIdentityError('invalid_response');
    }
    if (
      !record(data) ||
      !identifier(data.tenantId) ||
      !identifier(data.personId) ||
      Object.keys(data).some((key) => !['tenantId', 'personId'].includes(key))
    ) {
      throw new NuniIdentityError('invalid_response');
    }
    return { tenantId: data.tenantId, personId: data.personId };
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
    reader.releaseLock();
  }
}

function createNuniIdentityClient({
  origin = DEFAULT_NUNI_ORIGIN,
  timeoutMs = 5000,
  fetchImpl = globalThis.fetch,
} = {}) {
  const base = nuniOrigin(origin);
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 30000 ||
    typeof fetchImpl !== 'function'
  ) {
    throw new NuniIdentityError('invalid_config');
  }
  return {
    origin: base,
    async introspect(authorization) {
      // Nuni supports mobile Bearer sessions and its server-held Web Session handle.
      if (
        typeof authorization !== 'string' ||
        authorization.length > 16384 ||
        !/^(Bearer|Session) [\x21-\x7e]+$/.test(authorization)
      )
        throw new NuniIdentityError('invalid_config');
      const controller = new AbortController();
      let timer;
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new NuniIdentityError('timeout'));
          controller.abort();
        }, timeoutMs);
      });
      try {
        return await Promise.race([
          (async () =>
            readIdentity(
              await fetchImpl(`${base}/v1/auth/session/identity`, {
                method: 'GET',
                redirect: 'error',
                cache: 'no-store',
                signal: controller.signal,
                headers: { authorization, accept: 'application/json' },
              }),
              controller.signal,
            ))(),
          deadline,
        ]);
      } catch (error) {
        if (error instanceof NuniIdentityError) throw error;
        // Neither upstream bodies nor fetch errors may expose session credentials.
        throw new NuniIdentityError('upstream_unavailable');
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
    },
  };
}

function validateIdentityBindings(document) {
  if (
    !record(document) ||
    document.version !== 1 ||
    !Array.isArray(document.bindings) ||
    document.bindings.length > 10000
  ) {
    throw new NuniIdentityError('invalid_mapping');
  }
  const campusKeys = new Set();
  const nuniKeys = new Set();
  return document.bindings.map((binding) => {
    const fields = [
      'firebaseProjectId',
      'firebaseUid',
      'schoolId',
      'tenantId',
      'personId',
      'evidenceRef',
    ];
    if (
      !record(binding) ||
      fields.some((key) => !identifier(binding[key])) ||
      !['active', 'revoked'].includes(binding.status) ||
      typeof binding.verifiedAt !== 'string' ||
      !Number.isFinite(Date.parse(binding.verifiedAt))
    ) {
      throw new NuniIdentityError('invalid_mapping');
    }
    let origin;
    try {
      origin = nuniOrigin(binding.nuniOrigin);
    } catch {
      throw new NuniIdentityError('invalid_mapping');
    }
    // A binding must explicitly name its authority; the client's default is not evidence.
    if (!binding.nuniOrigin) throw new NuniIdentityError('invalid_mapping');
    const campusKey = JSON.stringify([
      binding.firebaseProjectId,
      binding.firebaseUid,
      binding.schoolId,
    ]);
    const nuniKey = JSON.stringify([origin, binding.tenantId, binding.personId]);
    if (campusKeys.has(campusKey) || nuniKeys.has(nuniKey))
      throw new NuniIdentityError('invalid_mapping');
    campusKeys.add(campusKey);
    nuniKeys.add(nuniKey);
    return Object.freeze({
      ...Object.fromEntries(fields.map((key) => [key, binding[key]])),
      nuniOrigin: origin,
      status: binding.status,
      verifiedAt: binding.verifiedAt,
    });
  });
}

/** Inputs identify the expected record only; callers must separately verify Firebase authentication. */
function resolveIdentityBinding({
  document,
  firebaseProjectId,
  firebaseUid,
  schoolId,
  origin,
  identity,
  now = Date.now(),
}) {
  if (![firebaseProjectId, firebaseUid, schoolId].every(identifier) || !Number.isFinite(now)) {
    throw new NuniIdentityError('invalid_config');
  }
  const bindings = validateIdentityBindings(document);
  const binding = bindings.find(
    (row) =>
      row.firebaseProjectId === firebaseProjectId &&
      row.firebaseUid === firebaseUid &&
      row.schoolId === schoolId,
  );
  if (!binding || binding.status !== 'active' || Date.parse(binding.verifiedAt) > now) {
    throw new NuniIdentityError('mapping_unavailable');
  }
  if (
    binding.nuniOrigin !== nuniOrigin(origin) ||
    !record(identity) ||
    binding.tenantId !== identity.tenantId ||
    binding.personId !== identity.personId
  ) {
    throw new NuniIdentityError('identity_mismatch');
  }
  return binding;
}

module.exports = {
  DEFAULT_NUNI_ORIGIN,
  NuniIdentityError,
  createNuniIdentityClient,
  validateIdentityBindings,
  resolveIdentityBinding,
};
