import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // 全域降級：以下規則本支大量觸發，主要為 React 19 strict mode 新引入
    // 及部分既有 any 用法；本 PR 聚焦跨角色 demoStore 功能，不做風格大改。
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
      'prefer-const': 'warn',
      // 允許 @ts-nocheck 但需附說明（暫擋其他人合進來的 type 破洞）
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-nocheck': 'allow-with-description',
          'ts-ignore': 'allow-with-description',
          'ts-expect-error': 'allow-with-description',
          minimumDescriptionLength: 3,
        },
      ],
    },
  },
  {
    files: [
      'src/app/login/page.tsx',
      'src/app/sso-callback/page.tsx',
      'src/components/AuthGuard.tsx',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/lib/firebase',
              message:
                'Use feature-level auth clients instead of importing the firebase monolith from pages/components.',
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
  ]),
]);

export default eslintConfig;
