module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  transformIgnorePatterns: [
    // decode-uri-component@0.5.1 is ESM-only (security override); allow Babel so Jest can load it.
    // Runtime interop is owned by patches/query-string@7.1.3.patch (not a Jest mapper/shim).
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|firebase|@firebase/.*|decode-uri-component)',
  ],
  moduleNameMapper: {
    '^@firebase/auth/dist/rn/index\\.js$': '<rootDir>/jest/firebase-auth-rn-mock.js',
    '^@/(.*)$': '<rootDir>/src/$1',
    '\\.(bin|gz)$': '<rootDir>/jest/assetFileMock.js',
  },
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts', '!src/**/index.ts'],
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 50,
      lines: 50,
      statements: 50,
    },
  },
  /** scripts/*.test.ts 僅供手動指令（見 ai:train:long），不納入預設 test */
  testMatch: ['<rootDir>/src/__tests__/**/*.test.{ts,tsx}'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  testEnvironment: 'jsdom',
  maxWorkers: 2,
  workerIdleMemoryLimit: '512MB',
  fakeTimers: {
    enableGlobally: false,
  },
};
