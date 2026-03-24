import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import firebaseScreenBoundaries from "./apps/mobile/firebase-screen-boundaries.js";

const { allowedScreenDirectFirebaseImports } = firebaseScreenBoundaries;

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/.expo/**",
      "**/.next/**",
      "**/build/**",
      "**/web-build/**",
      "**/*.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["apps/mobile/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "no-console": "off",
      "no-undef": "off",
    },
  },
  {
    files: ["apps/mobile/**/*.{ts,tsx}", "packages/shared/**/*.ts"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-case-declarations": "warn",
      "no-empty": "warn",
      "no-unused-expressions": "warn",
      "no-useless-escape": "warn",
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/rules-of-hooks": "error",
    },
  },
  {
    files: ["apps/mobile/src/screens/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "firebase/firestore",
              message: "Use feature repositories instead of direct Firestore access in screens.",
            },
            {
              name: "../firebase",
              message: "Use DataSource or feature repositories instead of direct Firebase clients in screens.",
            },
            {
              name: "@react-native-async-storage/async-storage",
              message: "Use feature repositories or persisted storage helpers instead of AsyncStorage in screens.",
            },
          ],
        },
      ],
    },
  },
  {
    files: allowedScreenDirectFirebaseImports,
    rules: {
      "no-restricted-imports": "off",
    },
  }
);
