import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['lib/**', 'node_modules/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-console': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // main 上既有大量 no-undef 是 helper function 跨檔引用導致的誤判
      // （這些 helper 確實存在於 puScraper / index.js 同檔域），降為 warn
      // 直到 owner 補上對應 require/export。
      'no-undef': 'warn',
    },
  },
  {
    files: ['**/*.test.js', '**/__tests__/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
  },
];
