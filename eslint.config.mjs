import globals from "globals";
import js from "@eslint/js";

export default [
    {
        ignores: ["eslint.config.mjs", "node_modules/**", "dist/**", "coverage/**"],
    },
    js.configs.recommended,
    {
        languageOptions: {
            globals: {
                ...globals.commonjs,
                ...globals.jest,
                ...globals.node,
                Atomics: "readonly",
                SharedArrayBuffer: "readonly",
            },
            ecmaVersion: 2024,
            sourceType: "commonjs",
        },
        rules: {},
    },
];
