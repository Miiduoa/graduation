'use strict';

const { unavailablePaymentOperation } = require('./paymentUnavailable');

// A separate local ledger cannot authorize holds, captures or releases for the payment provider.
module.exports.walletHold = unavailablePaymentOperation();
module.exports.walletCapture = unavailablePaymentOperation();
module.exports.walletRelease = unavailablePaymentOperation();
