'use strict';

const { HttpsError } = require('firebase-functions/v2/https');

/** Firestore batch-friendly array cap (e.g. question-bank upsert). */
const MAX_ARRAY_ITEMS = 500;
const MAX_OBJECT_KEYS = 256;
const MAX_DEPTH = 16;
const MAX_TOTAL_NODES = 50_000;
/** Cumulative UTF-8 bytes of object keys + string values. */
const MAX_TOTAL_UTF8_BYTES = 1_048_576;

function utf8ByteLength(value) {
  return Buffer.byteLength(value, 'utf8');
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function throwLimit(message) {
  throw new HttpsError('resource-exhausted', message);
}

function throwInvalid(message) {
  throw new HttpsError('invalid-argument', message);
}

function addUtf8(state, text) {
  state.utf8 += utf8ByteLength(text);
  if (state.utf8 > MAX_TOTAL_UTF8_BYTES) {
    throwLimit('Tool input exceeds UTF-8 budget');
  }
}

function bumpNode(state) {
  state.nodes += 1;
  if (state.nodes > MAX_TOTAL_NODES) {
    throwLimit('Tool input exceeds node budget');
  }
}

/**
 * Iterative preflight: reject oversized / exotic tool inputs before Zod parse.
 * Does not copy the payload or JSON.stringify it for sizing.
 *
 * @param {unknown} input
 */
function assertToolInputBounds(input) {
  if (input === undefined) {
    return assertToolInputBounds({});
  }
  if (!isPlainObject(input)) {
    throwInvalid('Tool input must be a plain object');
  }

  const state = { nodes: 0, utf8: 0 };
  const seen = new WeakSet();
  const stack = [{ value: input, depth: 1 }];

  while (stack.length > 0) {
    const { value, depth } = stack.pop();

    if (depth > MAX_DEPTH) {
      throwLimit('Tool input exceeds max depth');
    }

    bumpNode(state);

    if (value === null || typeof value === 'boolean') {
      continue;
    }

    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throwInvalid('Tool input contains non-finite number');
      }
      continue;
    }

    if (typeof value === 'string') {
      addUtf8(state, value);
      continue;
    }

    // Internal callers may pass optional fields as undefined (e.g. preferredGroupId).
    if (value === undefined) {
      continue;
    }

    if (
      typeof value === 'bigint' ||
      typeof value === 'symbol' ||
      typeof value === 'function' ||
      typeof value !== 'object'
    ) {
      throwInvalid('Tool input contains unsupported value type');
    }

    if (seen.has(value)) {
      throwInvalid('Tool input must not contain cycles');
    }
    seen.add(value);

    if (Array.isArray(value)) {
      // Reject length before scheduling/walking children.
      if (value.length > MAX_ARRAY_ITEMS) {
        throwLimit('Tool input array exceeds max items');
      }
      for (let i = value.length - 1; i >= 0; i -= 1) {
        stack.push({ value: value[i], depth: depth + 1 });
      }
      continue;
    }

    if (!isPlainObject(value)) {
      throwInvalid('Tool input contains unsupported object type');
    }

    let keyCount = 0;
    // Count own enumerable string keys without Object.keys/entries of an unbounded object.
    for (const key in value) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;

      keyCount += 1;
      if (keyCount > MAX_OBJECT_KEYS) {
        throwLimit('Tool input object exceeds max keys');
      }

      const desc = Object.getOwnPropertyDescriptor(value, key);
      if (!desc || typeof desc.get === 'function' || typeof desc.set === 'function') {
        throwInvalid('Tool input must not contain accessor properties');
      }

      addUtf8(state, key);
      stack.push({ value: desc.value, depth: depth + 1 });
    }

    // Symbol keys are never produced by JSON.parse; reject without evaluating values.
    const symbols = Object.getOwnPropertySymbols(value);
    if (symbols.length > 0) {
      throwInvalid('Tool input must not contain symbol keys');
    }
  }
}

module.exports = {
  MAX_ARRAY_ITEMS,
  MAX_OBJECT_KEYS,
  MAX_DEPTH,
  MAX_TOTAL_NODES,
  MAX_TOTAL_UTF8_BYTES,
  assertToolInputBounds,
  utf8ByteLength,
};
