const { onCall, HttpsError } = require('firebase-functions/v2/https');

function unavailablePaymentOperation() {
  return onCall({ region: 'asia-east1' }, async (request) => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Must be logged in');
    throw new HttpsError('failed-precondition', '付款與退款服務尚未接通，請透過原付款管道確認。');
  });
}

module.exports = { unavailablePaymentOperation };
