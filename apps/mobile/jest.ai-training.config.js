/** 僅供 pnpm ai:train:long：跑 scripts 下的長時訓練，其餘與 jest.config.js 相同。（heap／expose-gc 見 package.json ai:train:long） */
const base = require('./jest.config.js');

module.exports = {
  ...base,
  testMatch: ['<rootDir>/scripts/ai-training-long.test.ts'],
};
