'use strict';

/** firebase-admin 14 → jwks-rsa 4 會載入 ESM-only 的 jose，需轉成 CJS 才能在 Node 22 的 Jest 執行。 */
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.m?js$': 'babel-jest',
  },
  transformIgnorePatterns: ['/node_modules/(?!(jose|jwks-rsa|lru-cache)/)'],
};
