module.exports = {
  semi: true,
  singleQuote: false,
  tabWidth: 2,
  trailingComma: "none",
  plugins: ["@ianvs/prettier-plugin-sort-imports"],
  importOrder: [
    "^(react/(.*)$)|^(react$)",
    "^(next/(.*)$)|^(next$)",
    "<THIRD_PARTY_MODULES>",
    "^@/(.*)$",
    "^[./]"
  ],
  importOrderParserPlugins: ["typescript", "decorators-legacy", "jsx"]
};
