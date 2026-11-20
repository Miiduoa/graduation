import { open } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const {
  NuniIdentityError,
  createNuniIdentityClient,
  resolveIdentityBinding,
  validateIdentityBindings,
} = require('../backend/functions/integrations/nuniIdentity.js');
const MAX_MAPPING_BYTES = 1024 * 1024;

async function readBindings(path) {
  if (!path) throw new NuniIdentityError('invalid_config');
  let file;
  try {
    file = await open(path, 'r');
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_MAPPING_BYTES) throw new Error();
    const bytes = Buffer.alloc(MAX_MAPPING_BYTES + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, null);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > MAX_MAPPING_BYTES) throw new Error();
    return JSON.parse(bytes.subarray(0, offset).toString('utf8'));
  } catch {
    throw new NuniIdentityError('invalid_mapping');
  } finally {
    await file?.close();
  }
}

/** Read-only operator check, not proof that the operator owns the supplied Firebase UID. */
export async function verifyNuniIntegration(environment, { fetchImpl = globalThis.fetch } = {}) {
  const document = await readBindings(environment.NUNI_IDENTITY_BINDINGS_FILE);
  validateIdentityBindings(document);
  const firebaseProjectId = environment.NUNI_EXPECTED_FIREBASE_PROJECT_ID;
  const firebaseUid = environment.NUNI_EXPECTED_FIREBASE_UID;
  const schoolId = environment.NUNI_EXPECTED_SCHOOL_ID;
  const client = createNuniIdentityClient({ origin: environment.NUNI_API_ORIGIN, fetchImpl });
  // Reject missing/revoked/unusable mappings before sending any credential upstream.
  const expected = document.bindings.find(
    (row) =>
      row.firebaseProjectId === firebaseProjectId &&
      row.firebaseUid === firebaseUid &&
      row.schoolId === schoolId,
  );
  const selection = { document, firebaseProjectId, firebaseUid, schoolId, origin: client.origin };
  resolveIdentityBinding({ ...selection, identity: expected });
  const identity = await client.introspect(environment.NUNI_SESSION_AUTHORIZATION);
  resolveIdentityBinding({ ...selection, identity });
  return {
    status: 'verified',
    check: 'nuni-session-explicit-binding',
    tokenIssued: false,
    dataModified: false,
    firebaseAuthenticationVerified: false,
  };
}

export async function runNuniVerification(environment, dependencies) {
  try {
    return { exitCode: 0, result: await verifyNuniIntegration(environment, dependencies) };
  } catch (error) {
    return {
      exitCode: 1,
      result: {
        status: 'blocked',
        code: error instanceof NuniIdentityError ? error.code : 'verification_failed',
        message: error instanceof NuniIdentityError ? error.message : '無法完成身分對照驗證。',
        tokenIssued: false,
        dataModified: false,
      },
    };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { exitCode, result } = await runNuniVerification(process.env);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = exitCode;
}
