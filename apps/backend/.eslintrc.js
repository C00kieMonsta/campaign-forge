module.exports = {
  extends: ["../../.eslintrc.js"],
  parserOptions: {
    project: "tsconfig.json",
    tsconfigRootDir: __dirname
  },
  rules: {
    // Backend-specific overrides
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-unused-vars": [
      "warn",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_"
      }
    ],
    "no-console": "off", // Allow console in backend

    // Keep some flexibility for NestJS patterns
    "@typescript-eslint/no-non-null-assertion": "warn",
    "@typescript-eslint/ban-ts-comment": "warn"
  }
};
