'use strict';

/** Jest 以 CommonJS 載入程式；將 ESM-only 的 jose、parse5 與 entities 一起轉譯供測試使用。 */
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.m?js$': 'babel-jest',
  },
  transformIgnorePatterns: ['/node_modules/(?!(jose|jwks-rsa|lru-cache|parse5|entities)/)'],
};
