'use strict';

const { unavailablePaymentOperation } = require('./paymentUnavailable');

module.exports.refundCaptured = unavailablePaymentOperation();
