// @ts-check

/**
 * @typedef {import('firebase-functions/v2/https').HttpsError} HttpsErrorCtor
 * @typedef {import('firebase-admin/firestore').FieldValue} FirestoreFieldValue
 * @typedef {import('firebase-admin/firestore').Timestamp} FirestoreTimestamp
 */

/**
 * @param {{
 *   HttpsError: typeof import('firebase-functions/v2/https').HttpsError;
 *   FieldValue: typeof import('firebase-admin/firestore').FieldValue;
 *   Timestamp: typeof import('firebase-admin/firestore').Timestamp;
 *   toJsDate: (value: unknown) => Date | null;
 * }} deps
 */
function createValidationHelpers({ HttpsError, FieldValue, Timestamp, toJsDate }) {
  /**
   * @param {unknown} value
   * @param {number} [maxLength]
   */
  function trimString(value, maxLength = 5000) {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0, maxLength);
  }

  /**
   * @param {unknown} value
   * @param {number} [maxLength]
   */
  function optionalTrimmedString(value, maxLength = 5000) {
    const normalized = trimString(value, maxLength);
    return normalized || null;
  }

  /**
   * @param {unknown} value
   * @param {string} fieldName
   */
  function parsePositiveInteger(value, fieldName) {
    if (value == null || value === '') {
      return null;
    }

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new HttpsError('invalid-argument', `${fieldName} must be a positive integer`);
    }

    return parsed;
  }

  /**
   * @param {unknown} value
   * @param {string} fieldName
   * @param {{ required?: boolean }} [options]
   */
  function parseTimestampInput(value, fieldName, { required = false } = {}) {
    if (value == null || value === '') {
      if (required) {
        throw new HttpsError('invalid-argument', `Missing ${fieldName}`);
      }
      return FieldValue.delete();
    }

    const date = toJsDate(value);
    if (!date) {
      throw new HttpsError('invalid-argument', `Invalid ${fieldName}`);
    }

    return Timestamp.fromDate(date);
  }

  return {
    trimString,
    optionalTrimmedString,
    parsePositiveInteger,
    parseTimestampInput,
  };
}

module.exports = {
  createValidationHelpers,
};
