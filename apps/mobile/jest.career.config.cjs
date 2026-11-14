// Resolve this lane's shared source without changing the shared node_modules symlink.
const base = require('./jest.config.js');
module.exports = {
  ...base,
  moduleNameMapper: {
    ...base.moduleNameMapper,
    '^@campus/shared$': '<rootDir>/../../packages/shared/src/index.ts',
    '^@campus/shared/(.*)$': '<rootDir>/../../packages/shared/$1',
  },
};
