const parser = require("@typescript-eslint/parser");
const typescript = require("@typescript-eslint/eslint-plugin");
const hooks = require("eslint-plugin-react-hooks");
const imports = require("eslint-plugin-import");

module.exports = [
  { ignores: ["node_modules/**", "**/build/**", "ios/Pods/**", ".expo/**", "coverage/**", "dist/**"] },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { "react-hooks": hooks, "@typescript-eslint": typescript, import: imports },
    linterOptions: { reportUnusedDisableDirectives: "off" },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "no-dupe-keys": "error",
      "no-dupe-else-if": "error",
      "no-unreachable": "error",
      "no-self-compare": "error",
      "valid-typeof": "error",
      "use-isnan": "error",
    },
  },
];
