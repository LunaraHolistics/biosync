import { Linter } from "eslint";

const config: Linter.Config = {
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: "module",
    ecmaFeatures: {
      jsx: true,
    },
  },
  plugins: ["react", "@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:react/recommended",
    "plugin:@typescript-eslint/recommended"
  ],
  env: {
    browser: true,
    es2021: true,
  },
  settings: {
    react: {
      version: "detect"
    }
  }
};

export default config;