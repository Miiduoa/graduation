const base = require('./jest.config.js');

// Keep Expo's native host mocks and the project's Babel transforms, but do not
// load jest.setup.js: it replaces Firebase with successful-looking test doubles.
// Node transport lets the real client SDK contact only the guarded local emulator.
module.exports = {
  ...base,
  rootDir: __dirname,
  setupFilesAfterEnv: ['<rootDir>/integration/title-history/setup.cjs'],
  testEnvironment: 'node',
  testEnvironmentOptions: { customExportConditions: ['node', 'node-addons'] },
  testMatch: ['<rootDir>/integration/title-history/*.emulator.test.jsx'],
  testTimeout: 30000,
  maxWorkers: 1,
};
