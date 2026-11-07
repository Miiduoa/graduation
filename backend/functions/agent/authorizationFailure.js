'use strict';

const DENIED_RESULT_CODES = new Set([
  'permission-denied',
  'unauthenticated',
  'role_denied',
  'assistant_write_permission_denied',
]);

function isAuthorizationFailure(error) {
  // Firestore uses gRPC codes while callable handlers use Firebase error names.
  return error?.code === 'permission-denied' || error?.code === 'unauthenticated' ||
    error?.code === 7 || error?.code === 16;
}

// Some tools return a failed receipt instead of throwing an HttpsError.
// Only their explicit failure contract can stop a run; ordinary source text cannot.
function isAuthorizationDeniedResult(result) {
  return result?.success === false && DENIED_RESULT_CODES.has(result.errorCode);
}

module.exports = { isAuthorizationFailure, isAuthorizationDeniedResult };
