import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import globals from "globals";
import js from "@eslint/js";

export default defineConfig([
  {
    ignores: ["dist/**"],
  },
  {
    files: [
      "src/**/*.ts",
      "tests/**/*.ts",
      "scripts/**/*.mjs",
      "vitest*.config.ts",
    ],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      globals: {
        ...globals.es2023,
        ...globals.node,
      },
    },
  },
]);
