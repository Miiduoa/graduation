'use strict';

const DENIED_RESULT_CODES = new Set([
  'permission-denied',
  'unauthenticated',
  'role_denied',
  'assistant_write_permission_denied',
]);

function isAuthorizationFailure(error) {
  return error?.code === 'permission-denied' || error?.code === 'unauthenticated';
}

// Some tools return a failed receipt instead of throwing an HttpsError.
// Only their explicit failure contract can stop a run; ordinary source text cannot.
function isAuthorizationDeniedResult(result) {
  return result?.success === false && DENIED_RESULT_CODES.has(result.errorCode);
}

module.exports = { isAuthorizationFailure, isAuthorizationDeniedResult };
