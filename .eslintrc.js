module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true
  },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:prettier/recommended"
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module"
  },
  plugins: ["@typescript-eslint"],
  rules: {
    // Code quality
    "@typescript-eslint/no-unused-vars": [
      "warn",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_"
      }
    ],
    "@typescript-eslint/no-explicit-any": "warn",
    // Prefer const handled by TypeScript ESLint
    "@typescript-eslint/no-var-requires": "warn",

    // Style consistency
    "no-var": "error",
    "no-console": "warn",
    "no-debugger": "warn",

    // Disabled for flexibility during development
    "@typescript-eslint/explicit-function-return-type": "off",
    "@typescript-eslint/explicit-module-boundary-types": "off",
    "@typescript-eslint/no-empty-function": "off"
  },
  ignorePatterns: [
    "node_modules/",
    "dist/",
    "build/",
    "coverage/",
    ".next/",
    "out/",
    "*.config.js",
    "*.config.mjs"
  ],
  overrides: [
    // Frontend-specific rules
    {
      files: ["apps/frontend/**/*.{ts,tsx}"],
      env: {
        browser: true,
        es2022: true
      },
      extends: ["next/core-web-vitals", "next/typescript"],
      rules: {
        // React-specific rules
        "react/prop-types": "off",
        "react/react-in-jsx-scope": "off"
      }
    },
    // Backend-specific rules
    {
      files: ["apps/backend/**/*.ts"],
      env: {
        node: true,
        jest: true
      },
      rules: {
        // Allow console in backend
        "no-console": "off",
        // Stricter backend rules
        "@typescript-eslint/no-explicit-any": "error"
      }
    },
    // Test files
    {
      files: ["**/*.{test,spec}.{ts,tsx}"],
      env: {
        jest: true
      },
      rules: {
        "@typescript-eslint/no-explicit-any": "off",
        "no-console": "off"
      }
    }
  ]
};
