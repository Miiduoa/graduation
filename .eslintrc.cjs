module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
  env: {
    es2022: true,
    browser: true,
    node: true,
  },
  plugins: ["@typescript-eslint", "react-hooks"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react-hooks/recommended",
  ],
  ignorePatterns: [
    "node_modules/",
    "dist/",
    ".next/",
    "build/",
    "coverage/",
  ],
  rules: {
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
  },
  overrides: [
    {
      files: ["apps/web/**/*.{ts,tsx}"],
      env: {
        browser: true,
      },
    },
    {
      files: ["apps/mobile/**/*.{ts,tsx}"],
      env: {
        "react-native/react-native": true,
      },
    },
  ],
};

